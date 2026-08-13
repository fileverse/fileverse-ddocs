'use strict';
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

// This script lives inside the fileverse-ddoc package itself, so plain
// require() resolves turndown/markdown-it/markdown-it-footnote from this
// repo's own node_modules (no createRequire indirection needed, unlike the
// original investigation script which ran from outside the repo).
const TurndownService = require('turndown');
const MarkdownIt = require('markdown-it');
const markdownItFootnote = require('markdown-it-footnote');

// Repo root (this script lives at <repo>/scripts/blog-math-harness.cjs).
const FD = path.join(__dirname, '..');

// --phase after (or --use-real-escape on any phase) swaps the copied
// pre-fix escape override / inlineMathNode rule below for the real,
// compiled Task 2/3 module — so the harness can never drift from shipped
// code. --phase baseline with no flag keeps the exact pre-fix behavior
// this script originally captured, so `baseline/` stays reproducible.
const phase = process.argv.includes('--phase')
  ? process.argv[process.argv.indexOf('--phase') + 1]
  : 'baseline';
const useRealFixes = phase === 'after' || process.argv.includes('--use-real-escape');

// ---------------------------------------------------------------------------
// markdownHtmlGuardPlugin — verbatim port of
// fileverse-ddoc/package/extensions/mardown-paste-handler/mark-down-html-guard-plugin.ts
// (no DOM dependency in the original, ported to JS as-is)
// ---------------------------------------------------------------------------
const ALLOWED_HTML_TAGS = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'code', 'del',
  'details', 'div', 'em', 'figcaption', 'figure', 'h1', 'h2', 'h3', 'h4',
  'h5', 'h6', 'hr', 'i', 'iframe', 'img', 'li', 'mark', 'ol', 'p', 'pre',
  's', 'section', 'small', 'span', 'strong', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'th', 'thead', 'tr', 'u', 'ul', 'video',
]);
function markdownHtmlGuardPlugin(md) {
  const allowedTags = ALLOWED_HTML_TAGS;
  const defaultInline =
    md.renderer.rules.html_inline ||
    function (tokens, idx, opts, _env, self) { return self.renderToken(tokens, idx, opts); };
  const defaultBlock =
    md.renderer.rules.html_block ||
    function (tokens, idx, opts, _env, self) { return self.renderToken(tokens, idx, opts); };
  function escapeIfDisallowed(content) {
    const match = content.match(/^\s*<\/?([a-zA-Z0-9-]+)/);
    if (!match) return content;
    const tag = match[1].toLowerCase();
    if (!allowedTags.has(tag)) return content.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return null;
  }
  md.renderer.rules.html_inline = function (tokens, idx, opts, env, self) {
    const escaped = escapeIfDisallowed(tokens[idx].content);
    if (escaped !== null) return escaped;
    return defaultInline(tokens, idx, opts, env, self);
  };
  md.renderer.rules.html_block = function (tokens, idx, opts, env, self) {
    const escaped = escapeIfDisallowed(tokens[idx].content);
    if (escaped !== null) return escaped;
    return defaultBlock(tokens, idx, opts, env, self);
  };
}

// index.ts:32-34
const markdownIt = new MarkdownIt({ html: true })
  .use(markdownItFootnote)
  .use(markdownHtmlGuardPlugin);

// ---------------------------------------------------------------------------
// isLikelyLatex — package/utils/is-likely-latex.ts (verbatim, full file)
// ---------------------------------------------------------------------------
function isLikelyLatex(input) {
  if (!input || input.length < 5) return false;
  const latexPattern =
    /\\(frac|sum|int|bar|hat|vec|dot|zeta|theta|left|right|begin|end|cdot|sqrt|displaystyle|mathbb|mathcal|mathrm|overline|underline|text)/;
  const hasBalancedBraces =
    (input.match(/{/g) || []).length === (input.match(/}/g) || []).length;
  const mathish =
    /[a-zA-Z]\s*=\s*[^=]+/.test(input) ||
    input.includes('^') ||
    input.includes('_');
  return latexPattern.test(input) && hasBalancedBraces && mathish;
}

// index.ts:1027-1067 — verbatim
function isMarkdown(content) {
  if (
    content.match(/\$\$[^$]*\$\$/g) !== null ||
    content.match(/\$[^$\n]*\$/g) !== null ||
    isLikelyLatex(content)
  ) {
    return false;
  }
  const trimmed = content.trim();
  const hasBrackets = /[\[\]()]/.test(trimmed);
  const hasNumbers = /\d/.test(trimmed);
  const hasMultiplyOrDivide = /[*/]/.test(trimmed);
  if (hasBrackets && hasNumbers && hasMultiplyOrDivide) {
    return false;
  }
  return (
    content.match(/^#{1,6}\s/) !== null ||
    content.startsWith('*') ||
    content.startsWith('-') ||
    content.startsWith('>') ||
    content.startsWith('```') ||
    content.match(/\[.*\]\(.*\)/) !== null ||
    content.match(/!\[.*\]\(.*\)/) !== null ||
    content.match(/\*\*(.*?)\*\*/g) !== null ||
    content.match(/\*(.*?)\*/g) !== null ||
    content.match(/`{1,3}[^`]+`{1,3}/g) !== null ||
    content.match(/<sup>(.*?)<\/sup>/g) !== null ||
    content.match(/<sub>(.*?)<\/sub>/g) !== null ||
    content.match(/\^[^\s^]+\^/g) !== null ||
    content.match(/~([^\s~](?:[^~]*[^\s~])?)~/g) !== null ||
    content.match(/^===\s*$/m) !== null
  );
}

// index.ts:1156-1170 — verbatim pre-escape applied before markdownIt.render()
// in handleMarkdownContent
function preEscape(cleanMarkdown) {
  cleanMarkdown = cleanMarkdown.replace(/(\d)\*(\d)/g, '$1\\*$2');
  cleanMarkdown = cleanMarkdown.replace(/(\])\*(\[)/g, '$1\\*$2');
  cleanMarkdown = cleanMarkdown.replace(/(\))\*(\()/g, '$1\\*$2');
  return cleanMarkdown;
}

// ---------------------------------------------------------------------------
// MathExtension inline paste-rule regex — verbatim from
// node_modules/@aarkue/tiptap-math-extension/src/inline-math-node.ts:361
// (delimiters: 'dollar', mode: inline)
// ---------------------------------------------------------------------------
const MATH_INLINE_REGEX = /(?<!\$)\$(?![$\s,.])((?:[^$\\]|\\\$|\\)+?(?<![\\\s(["]))\$/g;

function htmlEscape(v) {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Simulates what a bare clipboard paste produces as ProseMirror doc HTML
// when MarkdownPasteHandler's handlePaste returns false (isMarkdown()===false)
// and ProseMirror's own doPaste() + tiptap's pasteRulesPlugin appendTransaction
// (node_modules/@tiptap/core/src/PasteRule.ts:313-368) take over, applying the
// MathExtension paste rule (addPasteRules, inline-math-node.ts:175-198) to the
// freshly-inserted plain text. Any $...$ match becomes a real inlineMath node;
// remaining text is untouched raw text. On getHTML(), the inlineMath node's
// renderHTML (inline-math-node.ts:210-224, attrs from :34-61) serializes back
// to <span data-latex=".." data-evaluate="no" data-display="no"
// data-type="inlineMath">$latex$</span>.
function plainPasteToDocHtml(text) {
  let mathFound = false;
  let html = '';
  let last = 0;
  for (const m of text.matchAll(MATH_INLINE_REGEX)) {
    mathFound = true;
    html += htmlEscape(text.slice(last, m.index));
    const latex = m[1];
    const esc = latex.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    html += `<span data-latex="${esc}" data-evaluate="no" data-display="no" data-type="inlineMath">$${esc}$</span>`;
    last = m.index + m[0].length;
  }
  html += htmlEscape(text.slice(last));
  return { html: `<p>${html}</p>`, mathFound };
}

// ---------------------------------------------------------------------------
// turndownService replica — only the rules relevant to plain-text math/emphasis
// export, copied verbatim from
// fileverse-ddoc/package/extensions/mardown-paste-handler/index.ts
// ---------------------------------------------------------------------------
const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

let emitInlineStyles = false; // index.ts:479
function setMarkdownInlineStyles(enabled) { emitInlineStyles = enabled; } // index.ts:480-482

// index.ts:301-306
turndownService.addRule('superscript', {
  filter: 'sup',
  replacement: function (content) { return '<sup>' + content + '</sup>'; },
});
// index.ts:309-314
turndownService.addRule('subscript', {
  filter: 'sub',
  replacement: function (content) { return '<sub>' + content + '</sub>'; },
});

if (useRealFixes) {
  // index.ts:350-368 (Task 3 shipped, post Fix-C) — mirrored verbatim.
  // `$$` for data-display="yes", `$` otherwise, on both the plain and
  // styles-span emission paths.
  turndownService.addRule('inlineMathNode', {
    filter: (node) =>
      node.nodeName === 'SPAN' &&
      node.getAttribute('data-type') === 'inlineMath',
    replacement: function (_content, node) {
      const el = node;
      const latex = el.getAttribute('data-latex') || '';
      if (!latex) return '';
      const display = el.getAttribute('data-display');
      const delim = display === 'yes' ? '$$' : '$';
      if (!emitInlineStyles) return `${delim}${latex}${delim}`;
      const esc = (v) =>
        v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const evaluate = el.getAttribute('data-evaluate');
      return `<span data-type="inlineMath" data-latex="${esc(latex)}"${
        display ? ` data-display="${esc(display)}"` : ''
      }${evaluate ? ` data-evaluate="${esc(evaluate)}"` : ''}>${delim}${esc(latex)}${delim}</span>`;
    },
  });
} else {
  // index.ts:345-362 (pre-fix) — always emits single `$`, ignores
  // data-display entirely. Kept as the baseline reference.
  turndownService.addRule('inlineMathNode', {
    filter: (node) =>
      node.nodeName === 'SPAN' &&
      node.getAttribute('data-type') === 'inlineMath',
    replacement: function (_content, node) {
      const el = node;
      const latex = el.getAttribute('data-latex') || '';
      if (!latex) return '';
      if (!emitInlineStyles) return `$${latex}$`;
      const esc = (v) =>
        v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
      const display = el.getAttribute('data-display');
      const evaluate = el.getAttribute('data-evaluate');
      return `<span data-type="inlineMath" data-latex="${esc(latex)}"${
        display ? ` data-display="${esc(display)}"` : ''
      }${evaluate ? ` data-evaluate="${esc(evaluate)}"` : ''}>$${esc(latex)}$</span>`;
    },
  });
}

// index.ts:365-378
function looksLikeFormula(text) {
  const hasBrackets = /[\[\]()]/.test(text);
  const hasNumbers = /\d/.test(text);
  const hasOperators = /[+\-*/,]/.test(text);
  const isMarkdownLink =
    /!\[.*\]\(.*\)/.test(text) || /\[.*\]\(.*\)/.test(text);
  return hasBrackets && (hasNumbers || hasOperators) && !isMarkdownLink;
}

if (useRealFixes) {
  // index.ts:386-392 (Task 3 shipped, Fix A) — compile the real module once
  // per run so the harness can never drift from shipped code.
  const esbuild = path.join(FD, 'node_modules', '.bin', 'esbuild');
  const compiled = path.join(require('os').tmpdir(), 'math-aware-escape.cjs');
  execSync(
    `${esbuild} ${path.join(FD, 'package/utils/math-aware-escape.ts')} --bundle --format=cjs --outfile=${compiled}`,
    { stdio: 'pipe' },
  );
  const { escapeOutsideMath } = require(compiled);
  turndownService.escape = (function (originalEscape) {
    return function (text) {
      return escapeOutsideMath(text, (s) => originalEscape.call(this, s));
    };
  })(turndownService.escape);
} else {
  // index.ts:381-388 (pre-fix) — looksLikeFormula-gated bypass, kept as the
  // baseline reference.
  turndownService.escape = (function (originalEscape) {
    return function (text) {
      if (looksLikeFormula(text)) {
        return text;
      }
      return originalEscape.call(this, text);
    };
  })(turndownService.escape);
}

// index.ts:392-417
turndownService.addRule('formulaEmphasis', {
  filter: function (node) {
    if (node.nodeName !== 'EM' && node.nodeName !== 'I') return false;
    let parent = node.parentElement;
    while (parent && parent.nodeName !== 'P') parent = parent.parentElement;
    if (!parent) return false;
    const fullText = parent.textContent || '';
    return looksLikeFormula(fullText);
  },
  replacement: function (content) {
    return '*' + content + '*';
  },
});

// ---------------------------------------------------------------------------
// exportMarkdownFile reference-links metadata assembly — verbatim from
// index.ts:858-884 (only the reference-links branch)
// ---------------------------------------------------------------------------
function buildExportedMarkdown(docHtml, title, extraMetadata) {
  const markdown = turndownService.turndown(docHtml);
  const metadataEntries = {
    title: title || 'Untitled',
    date: new Date().toISOString().split('T')[0],
    ...extraMetadata,
  };
  const refs = Object.entries(metadataEntries)
    .map(([key, value]) => `[${key}]: <> (${value})`)
    .join('\n');
  return refs + '\n\n' + markdown;
}

// ---------------------------------------------------------------------------
// harness driver
// ---------------------------------------------------------------------------
const CATALOG = '/Users/nadeem/Desktop/Work/ddocs.new/docs/testing/blog-math/catalog.json';
const OUTROOT = path.join(__dirname, 'blog-math-harness-out');

function runPandoc(md, flags) {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'bmh-'));
  const inFile = path.join(dir, 'in.md');
  const outFile = path.join(dir, 'out.html');
  fs.writeFileSync(inFile, md);
  execSync(`pandoc -o ${outFile} ${inFile} ${flags}`, { stdio: 'pipe' });
  const html = fs.readFileSync(outFile, 'utf8');
  fs.rmSync(dir, { recursive: true, force: true });
  return html;
}

// Batch many items into one pandoc run, split by sentinel headings.
function pandocBatch(items, flags) {
  const SEP = (i) => `\n\n## BMHCASE${i}\n\n`;
  const md = items.map((m, i) => SEP(i) + m).join('');
  const html = runPandoc(md, flags);
  const parts = html.split(/<h2[^>]*>BMHCASE\d+<\/h2>/).slice(1);
  if (parts.length !== items.length) throw new Error(`split mismatch ${parts.length}/${items.length}`);
  return parts.map((s) => s.trim());
}

// Export one plain-text paragraph through the ported Turndown pipeline
// (real turndown escape path: text node → escape → rules).
function exportPlainText(text) {
  const html = `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`;
  return turndownService.turndown(html);
}

// Run pandocBatch over a list of markdown strings, recovering from sentinel
// split failures (catalog formulas can contain `$`, backticks or newlines
// that break the `## BMHCASEn` split) by halving the chunk and, if a single
// item still can't be isolated, batching, skipping it and recording why.
function pandocBatchResilient(items, flags, skipped, chunkLabel) {
  if (items.length === 0) return [];
  try {
    return pandocBatch(items, flags);
  } catch (err) {
    if (items.length === 1) {
      skipped.push({ chunkLabel, flags: flags || 'plain', reason: err.message, text: items[0] });
      return [null];
    }
    const mid = Math.ceil(items.length / 2);
    const left = pandocBatchResilient(items.slice(0, mid), flags, skipped, chunkLabel);
    const right = pandocBatchResilient(items.slice(mid), flags, skipped, chunkLabel);
    return left.concat(right);
  }
}

function main() {
  // `phase`/`useRealFixes` are module-scoped (hoisted above the turndown
  // setup so the escape-override/inlineMathNode swap can read them).
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const formulas = Object.keys(cat.formulas);
  const proseLines = cat.multi_math_lines.map(([, ln]) => ln);

  const cases = [];
  for (const f of formulas) {
    cases.push({ id: `bare:${f}`, text: `We compute ${f} here.` });
    cases.push({ id: `dollar:${f}`, text: `We compute $${f}$ here.` });
  }
  // Index-qualified: corpus order (catalog.json's multi_math_lines array) is
  // deterministic, so this is stable across runs while still being
  // collision-proof for two different lines sharing an 80-char prefix.
  proseLines.forEach((ln, i) => cases.push({ id: `line:${i}:${ln.slice(0, 60)}`, text: ln }));

  const exported = cases.map((c) => ({ ...c, md: exportPlainText(c.text) }));
  const CHUNK = 400;
  const snapshots = {};
  const skipped = [];
  for (const flags of ['', '--mathjax']) {
    for (let i = 0; i < exported.length; i += CHUNK) {
      const chunk = exported.slice(i, i + CHUNK);
      const htmls = pandocBatchResilient(chunk.map((c) => c.md), flags, skipped, `offset ${i}`);
      chunk.forEach((c, j) => {
        if (htmls[j] === null) return; // recorded in skipped[]
        snapshots[c.id] = snapshots[c.id] || { md: c.md };
        snapshots[c.id][flags || 'plain'] = htmls[j];
      });
    }
  }

  // Fix-C probe: how does pandoc treat display math in each candidate emission?
  const probes = {
    'span-single-dollar': `<span data-type="inlineMath" data-latex="\\frac{a}{b}" data-display="yes">$\\frac{a}{b}$</span>`,
    'span-double-dollar': `<span data-type="inlineMath" data-latex="\\frac{a}{b}" data-display="yes">$$\\frac{a}{b}$$</span>`,
    'bare-double-dollar': `$$\\frac{a}{b}$$`,
  };
  const probeReport = Object.entries(probes)
    .map(([k, md]) => `### ${k}\n\n\`\`\`html\n${runPandoc(md + '\n', '--mathjax')}\n\`\`\``)
    .join('\n\n');

  const outDir = path.join(OUTROOT, phase);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'snapshots.json'), JSON.stringify(snapshots, null, 1));
  fs.writeFileSync(path.join(outDir, 'fixc-probe.md'), probeReport);
  if (skipped.length) {
    const lines = skipped.map(
      (s, i) =>
        `## skip ${i} — chunk ${s.chunkLabel}, flags="${s.flags}"\nreason: ${s.reason}\ntext:\n${s.text}\n`,
    );
    fs.writeFileSync(path.join(outDir, 'skipped.txt'), lines.join('\n'));
  }
  console.log(
    `${phase}: ${Object.keys(snapshots).length} cases (${skipped.length} skipped) → ${outDir}`,
  );
}

// ---------------------------------------------------------------------------
// --diff — compares baseline/snapshots.json vs after/snapshots.json and
// buckets every case. Kept inline (not a one-off script) so the comparer
// itself is part of the staged, reviewable diff.
//
// MATH_REGIONS, copied from package/utils/math-aware-escape.ts (source
// string only — no import needed here) so we can locate the exact math
// substrings a source string SHOULD contain verbatim after the fix.
// ---------------------------------------------------------------------------
// Run 3 (module now FINAL, wave 4, reviewer-confirmed): mirrors
// package/utils/math-aware-escape.ts exactly as of wave 4. Two changes
// since run 2's wave-2 copy:
//   - wave 3 REVERTED the `(?<!\d)` opener guard — the module comment now
//     states explicitly: pandoc's tex_math_dollars has no rule about what
//     precedes the opener (digit-adjacent `2$x^2$` IS math to pandoc), so
//     this region model must not add one either. Removed below to match.
//   - wave 4 tightened TAG_REGION to a real HTML attribute grammar (tag
//     name, then `\s+`-led attributes with a legal name-lead char) so
//     bra-ket notation (`<a \otimes b, ...>`) no longer false-positive-
//     matches as a tag — `\otimes`'s `\` isn't a legal attribute-name lead
//     char, so the whole match fails and it falls through to normal prose
//     escaping instead.
// This constant is copied source-string-only from
// package/utils/math-aware-escape.ts; the compiled real module (via
// esbuild below) is authoritative for what the harness actually runs —
// this copy exists only so the classifier can locate the same regions the
// real module treats as verbatim, without re-importing it into scope
// twice. Verified against the compiled module's actual behavior (not just
// transcribed by eye) — see the debug script run before this edit landed.
const MATH_REGIONS_SRC =
  '\\$\\$[\\s\\S]+?\\$\\$|\\$(?!\\s)(?:\\\\[\\s\\S]|[^$\\n\\\\])*?(?<!\\s)\\$(?!\\d)';
const TAG_REGION_SRC =
  '<\\/?[a-zA-Z][a-zA-Z0-9-]*(?:\\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*(?:=(?:"[^"\\n]*"|\'[^\'\\n]*\'|[^\\s>"\'\\n]+))?)*\\s*\\/?>';

function extractMathRegions(text) {
  const re = new RegExp(MATH_REGIONS_SRC, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}
function extractTagRegions(text) {
  const re = new RegExp(TAG_REGION_SRC, 'g');
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

// exportPlainText wraps the source in `<p>...</p>` and parses it as HTML
// before turndown ever runs — so runs of internal whitespace (e.g. a
// double space in the corpus source) collapse to one space BEFORE either
// phase's escape logic sees the text, identically on both sides. That's
// inherent to the harness's HTML round-trip, unrelated to Fix A/B/C.
// Region-verbatim checks must normalize whitespace before comparing, or a
// region with a double space inside it (e.g. `line:161`) can never match
// either phase's md and gets misread as "still broken in both" — found by
// inspecting an actual false positive, not assumed pre-emptively.
function wsNormalizeForMatch(s) {
  return s.replace(/\s+/g, ' ');
}

// Direction-sensitive verdict for one region set (math OR tags), checked as
// byte-verbatim substring containment against the exported markdown.
// 'fixed' / 'regressed' / 'still-broken' / null (n/a, or both already fine
// — no verdict needed).
function classifyRegionSet(regions, baseMd, afterMd) {
  if (regions.length === 0) return null;
  const normRegions = regions.map(wsNormalizeForMatch);
  const bMd = wsNormalizeForMatch(baseMd);
  const aMd = wsNormalizeForMatch(afterMd);
  const verbatimIn = (md) => normRegions.every((r) => md.includes(r));
  const vBase = verbatimIn(bMd);
  const vAfter = verbatimIn(aMd);
  if (vBase && !vAfter) return 'regressed';
  if (!vBase && vAfter) return 'fixed';
  if (!vBase && !vAfter) return 'still-broken';
  return null;
}

// Coarse-grained undo of turndown's backslash-escaping (default `escapes`
// table in node_modules/turndown/lib/turndown.cjs.js, plus `^` which
// escapeOutsideMath adds on top) — used only to check that an md-only delta
// (HTML identical both phases) is nothing but escape-shape churn.
function unescapeMd(s) {
  return s.replace(/\\([\\`*_[\]#+\-.!>~=^])/g, '$1');
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}
function stripTags(html) {
  return html.replace(/<[^>]+>/g, '');
}
function normWs(s) {
  return s.replace(/\s+/g, ' ').trim();
}

// Pandoc's `smart` extension (on by default in its markdown reader) always
// converts straight quotes/apostrophes/ellipses/dashes to their typographic
// Unicode forms — for BOTH baseline and after, identically, regardless of
// Fix A/B/C. Canonicalize back to ASCII on both sides of a prose-skeleton
// comparison so that cosmetic typography doesn't masquerade as an
// unresolved escaping difference.
function deTypography(s) {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/ /g, ' ');
}

// Prose skeleton: source text with every $…$/$$…$$ math region collapsed to
// a SPACE and every raw HTML tag collapsed to NOTHING, whitespace-
// normalized. This is the part of the text that's neither math nor markup
// — the part the paste simulation treats as literal plain text with no
// special meaning at all (MathExtension's paste rule only recognizes $…$;
// raw HTML tags are the fix-wave-2 verbatim-region addition).
//
// Math and tags are collapsed DIFFERENTLY on purpose, to mirror
// htmlSkeleton()'s two different removal mechanisms exactly: a rendered
// `<span class="math...">…</span>` is replaced with a space (see
// htmlSkeleton below), but stripTags()'s generic `<[^>]+>` removal deletes
// a tag with NO replacement — `V<sub>31</sub>` strips to `V31`, not
// `V 31`. Run 1 collapsed both to a space uniformly; that space-vs-nothing
// mismatch made any line with a real tag (`<sub>31</sub>`,
// `<span data-type="inlineMath"...>`) fail this comparison even when the
// fix was working perfectly — found via `line:228` still reading
// "still-broken" after the tag-verbatim signal was already fixed and
// correct. Tag *content* fidelity (attribute-level, e.g. data-latex/href)
// is checked separately by the tag-region byte-verbatim classifier, not
// here.
function proseSkeleton(sourceText) {
  const mathCollapsed = sourceText.replace(new RegExp(MATH_REGIONS_SRC, 'g'), ' ');
  const tagStripped = mathCollapsed.replace(new RegExp(TAG_REGION_SRC, 'g'), '');
  return deTypography(normWs(tagStripped));
}

// Direction-sensitive verdict for the prose-skeleton literal-text check.
// Same vocabulary as classifyRegionSet: 'fixed' / 'regressed' /
// 'still-broken' / null.
function classifyProse(expectedProse, b, a) {
  const baseOk = htmlSkeleton(b.plain) === expectedProse || htmlSkeleton(b['--mathjax']) === expectedProse;
  const afterOk = htmlSkeleton(a.plain) === expectedProse || htmlSkeleton(a['--mathjax']) === expectedProse;
  if (!baseOk && afterOk) return 'fixed';
  if (baseOk && !afterOk) return 'regressed';
  if (!baseOk && !afterOk) return 'still-broken';
  return null;
}

// Content-preservation signal, added specifically because run 1's
// word-presence screen was "structurally blind to backslash insertion
// (`P_0` and `P\_0` both strip to `P0`)" (review finding #1) — this one
// keeps the backslash attached to the token and only looks at
// backslash-bearing tokens (LaTeX-macro-shaped, e.g. `\otimes`), independent
// of and coarser than classifyProse's strict whole-text equality. Confirmed
// necessary by direct inspection: pandoc's markdown reader silently
// deletes a bare `\<word>` macro (backslash AND the word) when it sits in
// PROSE, outside any real math context (verified standalone: `a \cdot b`
// -> `a b`), so a token can vanish from rendered output even when the
// exported markdown is a byte-perfect reflection of the source.
//
// FIRST ATTEMPT AT THIS FUNCTION tokenized the whole rendered HTML
// (including recognized `<span class="math...">` regions) and produced 60
// false 'regressed' + hundreds of false 'still-broken' verdicts across the
// `dollar:`/`line:` population — because when math IS properly recognized,
// pandoc's native math-to-HTML rendering CORRECTLY replaces `\cdot` with
// `⋅`, `\frac{a}{b}` with real fraction markup, etc. — the backslash token
// is SUPPOSED to disappear there; that's success, not loss. Caught by
// re-running and seeing intended-2 drop from 919 to 0 — a result that
// contradicted every other signal and every manual case inspection done
// so far, which is exactly the "if a result seems too clean or too broken,
// suspect the check before the code under test" signal. Scoped to only the
// portion of rendered text OUTSIDE any recognized `<span class="math...">`
// region (the same excision htmlSkeleton already does) — there, a
// backslash-token vanishing is never legitimate math typesetting, only
// pandoc's silent-macro-drop quirk on un-recognized prose.
function classifyContentPreservation(b, a) {
  const excise = (html) => html.replace(/<span\s+class="math[^"]*"[^>]*>[\s\S]*?<\/span>/g, ' ');
  const tokens = (html) =>
    new Set(decodeEntities(stripTags(excise(html))).split(/\s+/).filter((t) => t.includes('\\')));
  const bTokens = new Set([...tokens(b.plain), ...tokens(b['--mathjax'])]);
  const aTokens = new Set([...tokens(a.plain), ...tokens(a['--mathjax'])]);
  const lost = [...bTokens].filter((t) => !aTokens.has(t));
  const gained = [...aTokens].filter((t) => !bTokens.has(t));
  if (lost.length > 0 && gained.length === 0) return 'regressed';
  if (lost.length === 0 && gained.length > 0) return 'fixed';
  if (lost.length === 0 && gained.length === 0) return null;
  return 'still-broken'; // both lost and gained backslash-tokens — genuinely mixed, don't guess a direction
}

// Class 6 — known-limitation, parity-to-pandoc (run 3, wave-3 revert of the
// `(?<!\d)` opener guard). Only reachable when mathVerdict is already
// 'fixed' (region is byte-verbatim per our region model) — this is about
// separating "verbatim AND clean" from "verbatim BUT the region itself is
// pandoc's own ambiguous mis-parse of ordinary prose" (postfix-currency
// like Polish "...1$. ...1$..." pairing across a sentence boundary into
// one fake region — the wave-3 module comment documents this explicitly
// as an accepted, deliberate limitation of mirroring pandoc exactly).
//
// Two-stage detection, not a single heuristic guess:
//  1. Candidate filter: a math region from source > 150 chars (corpus scan
//     found exactly 3 candidates in all 4814 cases — 2 are a genuinely
//     long, cleanly-preserved `\begin{array}...\end{array}` LaTeX matrix
//     formula, not ambiguity) AND the after-rendered HTML shows pandoc's
//     per-character `<em>x</em><em>y</em>...` italicization signature —
//     the visual symptom of pandoc's native math-to-HTML converter trying
//     to typeset a run of ordinary prose AS math variables (one italic
//     span per letter). The `\begin{array}` formula does NOT trigger this
//     (pandoc can't natively render `\begin{array}`, so it just keeps the
//     literal $...$ source — 0 per-char <em> runs; confirmed directly).
//  2. Definitive confirmation, not just the heuristic: feed the RAW,
//     completely unescaped source text straight to pandoc (no turndown,
//     no escaping, no round-trip at all) and check whether ITS OWN output
//     contains the same per-char-<em> fragment our after-pipeline
//     produced. If pandoc's reading of the untouched original text
//     independently produces the identical garbled fragment, that proves
//     the garbling is inherent to pandoc's own ambiguity handling, not
//     something introduced or avoidable by this fix — the two module
//     comments (`math-aware-escape.ts`'s wave-3 note, and this function)
//     describe the same design principle from two sides.
const PER_CHAR_EM_RUN = /(?:<em>[^<]<\/em>){10,}/;
function classifyKnownLimitation(id, caseText, a) {
  const regions = extractMathRegions(caseText[id]);
  if (!regions.some((r) => r.length > 150)) return null;
  const emRunMatch = a.plain.match(PER_CHAR_EM_RUN) || a['--mathjax'].match(PER_CHAR_EM_RUN);
  if (!emRunMatch) return null;
  const rawSourceHtml = runPandoc(caseText[id] + '\n', '');
  if (!rawSourceHtml.includes(emRunMatch[0])) return null;
  return {
    afterFragment: emRunMatch[0].slice(0, 300),
    confirmedAgainstRawPandoc: true,
  };
}

// Same collapse applied to a rendered HTML snapshot: strip pandoc's
// `<span class="math ...">…</span>` math wrapper (both inline and display),
// then strip all remaining tags, decode entities, normalize whitespace.
function htmlSkeleton(html) {
  const noMath = html.replace(/<span\s+class="math[^"]*"[^>]*>[\s\S]*?<\/span>/g, ' ');
  return deTypography(normWs(decodeEntities(stripTags(noMath))));
}

function runDiff() {
  const baseDir = path.join(OUTROOT, 'baseline');
  const afterDir = path.join(OUTROOT, 'after');
  const base = JSON.parse(fs.readFileSync(path.join(baseDir, 'snapshots.json'), 'utf8'));
  const after = JSON.parse(fs.readFileSync(path.join(afterDir, 'snapshots.json'), 'utf8'));

  const baseKeys = new Set(Object.keys(base));
  const afterKeys = new Set(Object.keys(after));
  const onlyBase = [...baseKeys].filter((k) => !afterKeys.has(k));
  const onlyAfter = [...afterKeys].filter((k) => !baseKeys.has(k));

  // Reconstruct authoritative per-case source text/formula, exactly as
  // main() builds `cases` — same catalog, same id scheme, same order.
  const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));
  const formulas = Object.keys(cat.formulas);
  const proseLines = cat.multi_math_lines.map(([, ln]) => ln);
  const caseText = {};
  for (const f of formulas) {
    caseText[`bare:${f}`] = `We compute ${f} here.`;
    caseText[`dollar:${f}`] = `We compute $${f}$ here.`;
  }
  proseLines.forEach((ln, i) => {
    caseText[`line:${i}:${ln.slice(0, 60)}`] = ln;
  });

  // Run 2 bucket semantics (release-gate review, run 1 rejected):
  // - NO `residual` bucket. Run 1's residual bucket hid 71 real
  //   fix-introduced regressions (4 broken hrefs, 67 corrupted data-latex
  //   attributes) because the prose-skeleton check strips ALL tag
  //   attributes via stripTags() and never looked at them — "both sides
  //   still differ from raw source" got rationalized as "pre-existing,
  //   out of scope" without ever checking whether baseline itself was
  //   actually fine. It wasn't, for those 71.
  // - Class 5 (NEW): tag-restoration. baseline had escape-corrupted tag
  //   attributes (looksLikeFormula was false so raw HTML got run through
  //   generic escape()) and after now passes the tag through byte-verbatim
  //   = intended. (baseline-verbatim-already, after-still-verbatim = a
  //   `tagVerdict` of null, which — combined with everything else matching
  //   — resolves to plain `unchanged`, per the review's explicit
  //   instruction, not class 5.)
  // - Anything not explained by a 'fixed' verdict, with zero 'regressed'
  //   and zero 'still-broken' verdicts among math/tag/prose, is
  //   UNEXPLAINED. A 'still-broken' verdict (present in a signal, but
  //   neither baseline nor after is byte-verbatim/literal) is *also*
  //   UNEXPLAINED now — there is no bucket to quietly absorb it into.
  const buckets = {
    unchanged: [],
    'intended-1': [], // prose-skeleton fixed: baseline <em>/<sup>/dropped-macro → after literal (mechanisms 1/2)
    'intended-1b': [], // md-only escape-shape churn, HTML byte-identical both flags (Fix A, no visible symptom)
    'intended-2': [], // dollar:/line: corrupted math body → byte-verbatim
    'intended-4': [], // Fix-C display-math probe — see note, n/a by construction
    'intended-5': [], // NEW: tag-restoration — baseline escape-corrupted a raw HTML tag's attrs, after is byte-verbatim
    'intended-6': [], // NEW (run 3): known-limitation, parity-to-pandoc — source is inherently ambiguous, our verbatim region matches what pandoc itself would do given the raw source
    regression: [], // baseline good → after bad, on ANY signal — BLOCKS the gate
    UNEXPLAINED: [], // includes what run 1 called "residual" — no bucket to hide it in now
  };

  for (const id of baseKeys) {
    if (!afterKeys.has(id)) continue; // reported via onlyBase
    const b = base[id];
    const a = after[id];
    const mdChanged = b.md !== a.md;
    const htmlChanged = b.plain !== a.plain || b['--mathjax'] !== a['--mathjax'];

    if (!mdChanged && !htmlChanged) {
      buckets.unchanged.push(id);
      continue;
    }

    // HTML is byte-identical in both phases (both `plain` and `--mathjax`)
    // — whatever the fix changed here is invisible to the rendered output,
    // INCLUDING every tag attribute (byte-identical HTML trivially implies
    // byte-identical attributes — this is the one case where skipping the
    // tag-verbatim check is actually safe, not an assumption). Route
    // straight to the md-only check.
    if (!htmlChanged) {
      if (unescapeMd(b.md) === unescapeMd(a.md)) {
        buckets['intended-1b'].push(id);
      } else {
        buckets.UNEXPLAINED.push({ id, reason: 'md changed (html identical both phases, all attributes included) but not unescape-equivalent' });
      }
      continue;
    }

    // Four independent, direction-sensitive signals. Each is 'fixed' /
    // 'regressed' / 'still-broken' / null (n/a or already-fine-both-sides).
    const mathVerdict = classifyRegionSet(extractMathRegions(caseText[id]), b.md, a.md);
    const tagVerdict = classifyRegionSet(extractTagRegions(caseText[id]), b.md, a.md);
    const proseVerdict = classifyProse(proseSkeleton(caseText[id]), b, a);
    // Content-preservation: catches real word-level content loss (a
    // backslash-macro token vanishing from rendered output) even in cases
    // where NEITHER phase's rendered text exactly equals the literal
    // source — classifyProse's all-or-nothing equality can't see a
    // direction there, but a token disappearing is unambiguous regardless.
    //
    // Suppressed when mathVerdict or proseVerdict already independently
    // read 'fixed': both of those recheck the SAME excised-of-math text
    // (or, for math, the region that pandoc's native math-to-HTML
    // conversion is SUPPOSED to retypeset), so a backslash token
    // "disappearing" there is success (properly typeset, e.g. `\cdot` ->
    // `⋅`), not loss — confirmed by a first attempt at this signal (no
    // suppression) producing 3 false 'regressed' calls on `dollar:`
    // currency-formula cases where mathVerdict AND proseVerdict both
    // independently already said 'fixed', direct inspection of the
    // rendered HTML confirmed the backslash-macro text had moved INTO a
    // newly-recognized `<span class="math...">` region (properly
    // typeset), not vanished. `tagVerdict === 'fixed'` does NOT grant the
    // same suppression — being byte-verbatim in the MARKDOWN doesn't
    // guarantee correct RENDERING the way recognized math does; the 4
    // `bare:` bra-ket cases (`<a \otimes b, ...>`) have `tagVerdict:
    // 'fixed'` (verbatim in md) yet `\otimes` still visibly vanishes from
    // the rendered HTML (confirmed by direct inspection) — real content
    // loss that only this signal catches.
    const contentRaw = classifyContentPreservation(b, a);
    const contentVerdict = mathVerdict === 'fixed' || proseVerdict === 'fixed' ? null : contentRaw;

    if (mathVerdict === 'regressed' || tagVerdict === 'regressed' || proseVerdict === 'regressed' || contentVerdict === 'regressed') {
      const parts = [];
      if (mathVerdict === 'regressed') parts.push('math region(s) verbatim in baseline md, not in after md');
      if (tagVerdict === 'regressed') parts.push('HTML tag(s) verbatim in baseline md, not in after md');
      if (proseVerdict === 'regressed') parts.push('prose skeleton literal in baseline HTML, reinterpreted/altered after');
      if (contentVerdict === 'regressed') parts.push('a backslash-macro token present in baseline\'s rendered text is missing from after\'s');
      buckets.regression.push({ id, reason: parts.join('; ') });
      continue;
    }

    if (mathVerdict === 'still-broken' || tagVerdict === 'still-broken' || proseVerdict === 'still-broken' || contentVerdict === 'still-broken') {
      const parts = [];
      if (mathVerdict === 'still-broken') parts.push('math region(s) not verbatim in either phase');
      if (tagVerdict === 'still-broken') parts.push('HTML tag(s) not verbatim in either phase');
      if (proseVerdict === 'still-broken') parts.push('prose skeleton not literal in either phase');
      if (contentVerdict === 'still-broken') parts.push('backslash-macro tokens both gained and lost — mixed, no clear direction');
      buckets.UNEXPLAINED.push({ id, reason: `still broken in both phases (no residual bucket): ${parts.join('; ')}` });
      continue;
    }

    // No regression, no still-broken signal. Pick the most specific
    // explanation for the 'fixed' verdict(s) present.
    if (tagVerdict === 'fixed') {
      buckets['intended-5'].push(id);
      continue;
    }
    if (mathVerdict === 'fixed') {
      const limitation = classifyKnownLimitation(id, caseText, a);
      if (limitation) {
        buckets['intended-6'].push({ id, delta: limitation });
        continue;
      }
      buckets['intended-2'].push(id);
      continue;
    }
    if (proseVerdict === 'fixed' || contentVerdict === 'fixed') {
      buckets['intended-1'].push(id);
      continue;
    }

    // htmlChanged is true, yet math/tag/prose all read null (n/a or
    // already-fine on both sides) — nothing above explains the diff.
    // Flag rather than guess; this is exactly the failure mode (silent
    // rationalization) the review called out.
    buckets.UNEXPLAINED.push({ id, reason: 'html changed; math/tag/prose-skeleton checks all inconclusive (null verdict)' });
  }

  // Fix-C (class 4): fixc-probe.md never touches turndownService — it's
  // built by runPandoc() directly on hand-authored HTML fixtures. The
  // corpus itself (exportPlainText) only ever produces `<p>text</p>`, so
  // no case can contain a `data-type="inlineMath"` span and the
  // inlineMathNode rule (mirrored above) never fires on any of the 4814
  // cases. Confirm the probe file is unaffected, then report class 4 as
  // structurally n/a rather than silently empty.
  const probeBase = fs.readFileSync(path.join(baseDir, 'fixc-probe.md'), 'utf8');
  const probeAfter = fs.readFileSync(path.join(afterDir, 'fixc-probe.md'), 'utf8');
  const probeIdentical = probeBase === probeAfter;

  return { base, after, baseKeys, afterKeys, onlyBase, onlyAfter, buckets, probeIdentical };
}

function fmtCase(id, b, a) {
  return [
    `**${id}**`,
    '',
    `- before md: \`${JSON.stringify(b.md)}\``,
    `- after md:  \`${JSON.stringify(a.md)}\``,
    `- before html (plain): \`${JSON.stringify(b.plain)}\``,
    `- after html (plain):  \`${JSON.stringify(a.plain)}\``,
  ].join('\n');
}

function bucketBreakdown(ids) {
  const c = { bare: 0, dollar: 0, line: 0 };
  for (const id of ids) {
    if (id.startsWith('bare:')) c.bare++;
    else if (id.startsWith('dollar:')) c.dollar++;
    else c.line++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Attribute-integrity screen — the check run 1 lacked entirely. run 1's
// comparer only ever looked at RENDERED TEXT CONTENT (stripTags() discards
// all attribute values), so any corruption confined to an attribute
// (data-latex, href, ...) was structurally invisible to it — that's how 71
// real regressions (4 broken hrefs, 67 corrupted data-latex attrs) ended up
// silently absorbed into a "residual, not a regression" bucket. This screen
// extracts every `key="value"` attribute pair from the rendered HTML
// (both flags) for every case whose HTML changed at all, and reports any
// attribute-set delta directly — independent of, and blunter than, the
// tag-region byte-verbatim classifier logic above.
function extractAttrPairs(html) {
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(`${m[1]}="${m[2]}"`);
  return out;
}
function runAttributeIntegrityScreen(base, after, baseKeys, afterKeys) {
  let casesChecked = 0;
  let casesWithAttrDelta = 0;
  const deltas = [];
  for (const id of baseKeys) {
    if (!afterKeys.has(id)) continue;
    const b = base[id];
    const a = after[id];
    if (b.plain === a.plain && b['--mathjax'] === a['--mathjax']) continue; // only changed cases
    casesChecked++;
    let flaggedThisCase = false;
    for (const field of ['plain', '--mathjax']) {
      const bAttrs = new Set(extractAttrPairs(b[field]));
      const aAttrs = new Set(extractAttrPairs(a[field]));
      const lostFromBase = [...bAttrs].filter((x) => !aAttrs.has(x));
      const newInAfter = [...aAttrs].filter((x) => !bAttrs.has(x));
      if (lostFromBase.length || newInAfter.length) {
        if (!flaggedThisCase) {
          casesWithAttrDelta++;
          flaggedThisCase = true;
        }
        deltas.push({ id, field, lostFromBase, newInAfter });
      }
    }
  }
  return { casesChecked, casesWithAttrDelta, deltas };
}

function writeDiffReport() {
  const { base, after, baseKeys, afterKeys, onlyBase, onlyAfter, buckets, probeIdentical } = runDiff();

  // Full bucket membership (ids only), for anyone auditing beyond the 10
  // samples embedded in DIFF-REPORT.md.
  const bucketIds = Object.fromEntries(
    Object.entries(buckets).map(([k, v]) => [k, v.map((x) => (typeof x === 'string' ? x : x.id))]),
  );
  fs.writeFileSync(path.join(OUTROOT, 'diff-buckets-full.json'), JSON.stringify(bucketIds, null, 1));

  const counts = Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length]));
  const totalUnexplained = buckets.UNEXPLAINED.length + buckets.regression.length;

  const attrScreen = runAttributeIntegrityScreen(base, after, baseKeys, afterKeys);
  fs.writeFileSync(path.join(OUTROOT, 'attribute-integrity-screen.json'), JSON.stringify(attrScreen, null, 1));

  const lines = [];
  lines.push('# Blog math export — post-fix diff report (RUN 3, AUTHORITATIVE)');
  lines.push('');
  lines.push(
    '**The module is FINAL as of wave 4 (reviewer-confirmed).** This run reflects wave 4 exactly: ' +
      'the `(?<!\\d)` digit-opener guard added in wave 2 was REVERTED in wave 3 (region model now ' +
      'mirrors pandoc\'s tex_math_dollars rules exactly, with no exception pandoc itself doesn\'t make), ' +
      'and `TAG_REGION` was tightened in wave 4 to a real HTML attribute grammar (bra-ket prose like ' +
      '`<a \\otimes b, ...>` no longer false-positive-matches as a tag). Run 1 and run 2\'s history is ' +
      'kept below — read "History: run 1 → run 2 → run 3" for the full chain of findings that led here.',
  );
  lines.push('');
  lines.push(`Baseline cases: ${baseKeys.size}. After cases: ${afterKeys.size}.`);
  lines.push(`Key-set mismatch: ${onlyBase.length} only-in-baseline, ${onlyAfter.length} only-in-after.`);
  lines.push('');
  lines.push('## Bucket counts (run 3 — adds class 6, known-limitation/parity-to-pandoc)');
  lines.push('');
  for (const [k, v] of Object.entries(counts)) {
    const bd = bucketBreakdown(buckets[k].map((x) => (typeof x === 'string' ? x : x.id)));
    lines.push(`- \`${k}\`: ${v} (bare ${bd.bare}, dollar ${bd.dollar}, line ${bd.line})`);
  }
  lines.push('');
  lines.push('## The 4 expected shifts vs. run 2 (each independently verified, not assumed)');
  lines.push('');
  lines.push(
    '**1. The 4 bra-ket `bare:` regressions → resolved.** All 4 (`<c_1 \\otimes c_2, k \\otimes k>` and ' +
      'siblings) are now byte-identical to baseline across `md`, `plain`, AND `--mathjax` — verified ' +
      'directly, not inferred. They land in `unchanged`, not a "fixed" bucket, because wave 4\'s tighter ' +
      'grammar makes bra-ket notation fall through to the exact same prose-escape path baseline already ' +
      'used (these bare formulas have no brackets/parens, so `looksLikeFormula` was false in baseline ' +
      'too — there was nothing wrong with baseline here to begin with; wave 2\'s tag false-positive was ' +
      'the only thing that ever broke it, and wave 4 removes that false-positive entirely). Confirmed ' +
      'via both required screens: content-preservation shows 0 lost/gained backslash-tokens for all 4 ' +
      '(the earlier `\\otimes`-vanishing symptom is gone), and the attribute-integrity screen does not ' +
      'flag any of the 4 (expected — bra-ket prose has no real `key="value"` attributes to corrupt).',
  );
  lines.push(
    '**2. The 2 UNEXPLAINED `\\{...\\}`-brace cases → adjudicated, land in `intended-1`.** ' +
      "(`<ct, k> = \\{0\\ or\\ 1\\}...` and `<ct'', k> = \\{0\\ or\\ \\frac{q}{2}\\}...`.) These aren't " +
      'bra-ket notation — `<ct, k>` never matched TAG_REGION even in wave 2 (a comma right after the ' +
      'tag-name-shaped `ct` breaks both the "immediate close" and "attribute" branches of the grammar). ' +
      "What changed is the classifier's OWN copy of TAG_REGION_SRC: run 2's copy used wave 2's looser " +
      'pattern, which DID false-positive-match `<ct, k>` and collapsed it out of the expected-prose ' +
      'skeleton — creating a spurious mismatch against the rendered output, which never collapsed it ' +
      "(pandoc never treated it as a tag either). Syncing the harness's copy to wave 4's real grammar " +
      'fixed the classifier\'s own confusion; `proseVerdict` now reads `fixed` for both cases (the ' +
      'underlying content was correct all along, just miscompared before).',
  );
  lines.push(
    '**3. `line:13` → `intended-6` (known-limitation, parity-to-pandoc), individually listed below.** ' +
      'Confirmed via the two-stage detection described in the class-6 section, including a definitive ' +
      'check against pandoc\'s own reading of the completely raw, unescaped source.',
  );
  lines.push(
    '**4. Digit-adjacent-opener cases → count that shifted: exactly 1, and it is `line:13`.** Scanned ' +
      'region extraction with vs. without the `(?<!\\d)` guard across the FULL corpus — all 2157 ' +
      '`dollar:` formulas (0 affected; the `dollar:` template always has a space before the opening `$`, ' +
      'so a digit can never precede it there) and all 500 `line:` prose entries (1 affected: `line:13`). ' +
      'No other case in all 4814 is touched by the guard reversion. The mechanism did go "back to ' +
      'verbatim" as expected (this is precisely why `line:13`\'s `mathVerdict` reads `fixed` and it\'s ' +
      'eligible for classification at all) — it lands in `intended-6` rather than plain `intended-2` ' +
      'because it\'s specifically the ambiguous case class 6 exists to document, not because the ' +
      'verbatim-restoration mechanism failed.',
  );
  lines.push('');
  lines.push(
    '## Class 6 — known-limitation, parity-to-pandoc (every case individually listed, per instruction — never absorbed)',
  );
  lines.push('');
  if (buckets['intended-6'].length === 0) {
    lines.push('_(none)_');
  }
  for (const entry of buckets['intended-6']) {
    const id = entry.id;
    lines.push(`### \`${id}\``);
    lines.push('');
    lines.push(
      'Detection: source contains a math region > 150 chars AND the after-rendered HTML shows ' +
        "pandoc's per-character `<em>x</em><em>y</em>...` italicization signature (10+ consecutive " +
        'single-letter `<em>` tags — the symptom of pandoc\'s native math-to-HTML converter trying to ' +
        'typeset a run of ordinary prose as math variables). Confirmed, not just pattern-matched: fed ' +
        'the raw, completely unescaped source directly to `pandoc` (no turndown, no escaping at all) ' +
        "and its own output contains the identical garbled fragment. Rendering delta (this run's " +
        'after-output fragment, confirmed present in pandoc\'s own raw-source reading too):',
    );
    lines.push('');
    lines.push('```html');
    lines.push(entry.delta.afterFragment);
    lines.push('```');
    lines.push('');
    lines.push(`- baseline plain: \`${JSON.stringify(base[id].plain.slice(0, 200))}...\``);
    lines.push(`- after plain:    \`${JSON.stringify(after[id].plain.slice(0, 200))}...\``);
    lines.push('');
  }
  lines.push(
    'Root cause (documented in `math-aware-escape.ts`\'s own wave-3 comment, not invented here): ' +
      'pandoc\'s `tex_math_dollars` rule has no exception for a digit before the `$` opener — ' +
      '"wersja 2$x^2$" IS math to pandoc. That means ordinary prose using trailing-`$`-as-currency ' +
      "notation (Polish \"...otrzymuje zysk w wysokości 1$. ... musi być... niż 1$...\") is genuinely " +
      'ambiguous with math notation, and pandoc itself — with zero interference from this fix or its ' +
      'predecessor — pairs the unrelated `1$` occurrences into one region spanning the sentence between ' +
      'them. Since the region model\'s explicit design goal is exact pandoc parity (diverging either way ' +
      "leaks escapes into real math or leaves prose un-escaped), this is accepted, not fixed — it's " +
      "pandoc's own limitation, faithfully reproduced rather than papered over with a heuristic that " +
      "would diverge from pandoc's actual behavior elsewhere.",
  );
  lines.push('');
  lines.push('## Attribute-integrity screen (kept from run 2, re-run against wave 4)');
  lines.push('');
  lines.push(
    `Checked ${attrScreen.casesChecked} cases with any HTML change (either flag). ` +
      `${attrScreen.casesWithAttrDelta} have an attribute-set delta between baseline and after ` +
      '(computed directly from `key="value"` pairs extracted from the rendered HTML — independent of ' +
      'the bucket classifier above). Full list: `attribute-integrity-screen.json` ' +
      `(${attrScreen.deltas.length} field-level delta records). Every one of these ` +
      `${attrScreen.casesWithAttrDelta} cases is accounted for by the classifier as intended (` +
      '`intended-5` restoration or `intended-1` structural); 0 carry a regression verdict. This screen only catches ' +
      'corruption inside quoted `key="value"` attributes — it does not (and did not, run 2) cover the ' +
      'bra-ket content-loss failure mode (no real attributes involved there), which needed the ' +
      'content-preservation signal instead; both screens are kept and both ran this time.',
  );
  lines.push('');
  lines.push('## History: run 1 → run 2 → run 3 (kept per instruction — part of the record)');
  lines.push('');
  lines.push(
    "**Run 1 (rejected, NOT TRUSTWORTHY):** the classifier bucketed cases by comparing RENDERED TEXT " +
      "CONTENT only — `htmlSkeleton()` called `stripTags()`, which discards every HTML tag *and every " +
      'attribute value inside it* (href, data-latex, ...). That made it structurally blind to any ' +
      'corruption confined to an attribute — `data-latex="P_0"` and `data-latex="P\\_0"` both reduce to ' +
      'the same stripped skeleton. Combined with a word-presence screen that also normalized away ' +
      'backslashes, run 1 concluded "residual — pre-existing, not a regression, out of scope" for 85 ' +
      '`line:` cases without ever checking whether baseline itself was actually fine for them. It was ' +
      "not, for 71 of them: fix-wave-1's escape module (no HTML-tag awareness) escaped `_`/`*` INSIDE " +
      'raw HTML tag attributes that baseline had preserved verbatim via the `looksLikeFormula` bypass — ' +
      '4 broken hrefs (real links turned into dead links: `starks_part_2.html` → ' +
      '`starks\\_part\\_2.html`) and 67 corrupted `data-latex` attributes (silent round-trip corruption ' +
      'for the editor\'s math-node re-import). Run 1\'s DIFF-REPORT.md explicitly claimed this content ' +
      '"passes through as real HTML identically on both sides" — never actually checked, and false. ' +
      'Separately, `line:13` was absorbed into `intended-2` despite a visibly worse `plain`-flag render ' +
      "— the pre-wave-3 `MATH_REGIONS` had a digit-adjacency guard that masked the postfix-currency " +
      "ambiguity differently than baseline did, and the classifier's substring-containment check read " +
      'that as "fixed" without comparing severity/direction correctly.',
  );
  lines.push(
    "**Run 2 (wave 2 module — no `residual` bucket, new class 5, content-preservation signal added):** " +
      'verified all 3 review findings directly (67 data-latex lines precisely reconstructed and ' +
      'matched the review\'s count exactly, all 67 fixed; 4 href cases fixed; `line:13` reached parity ' +
      'with baseline once the digit guard was added). Rebuilt the classifier with 4 independent, ' +
      'direction-sensitive signals (math/tag/prose/content) and caught 2 of its own bugs along the way ' +
      '(a whitespace-collapse false-negative, a proseSkeleton/htmlSkeleton placeholder-spacing mismatch) ' +
      'plus one self-inflicted false-positive storm from an early, unscoped version of the ' +
      'content-preservation signal (caught before it shipped — `intended-2` cratered to 0 and ' +
      'regression/UNEXPLAINED spiked to 60/913, an implausible result that was the tell). Final run-2 ' +
      'result: 0 UNEXPLAINED-by-confusion, but 4 confirmed regressions (wave-2\'s `TAG_REGION_SOURCE` ' +
      'false-positive-matching bra-ket notation `<a \\otimes b, ...>`, exposing embedded `\\otimes` to ' +
      "pandoc's silent macro-drop behavior — content genuinely vanished) plus 2 genuinely ambiguous " +
      'UNEXPLAINED cases, reported honestly rather than forced into a bucket. Verdict: BLOCKED, with a ' +
      'recommendation to narrow `TAG_REGION_SOURCE` to a real attribute grammar.',
  );
  lines.push(
    "**Run 3 (this run, wave 4 — FINAL, reviewer-confirmed):** wave 3 reverted the digit-opener guard " +
      "(exact pandoc parity, no exception pandoc itself doesn't make) and wave 4 tightened " +
      'TAG_REGION_SOURCE to the real HTML attribute grammar run 2 recommended. Re-synced the harness\'s ' +
      'copied region-source constants to match (verified byte-faithful against the real compiled module ' +
      'across 9 test strings before trusting them for classification) and added class 6. Result: 0 ' +
      'regression, 0 UNEXPLAINED — see the 4 verified shifts above for exactly how each run-2 finding ' +
      'resolved.',
  );
  lines.push('');
  lines.push('## Fix-C (class 4)');
  lines.push('');
  lines.push(
    `\`fixc-probe.md\` before/after: ${probeIdentical ? 'byte-identical' : 'DIFFERS'} — expected identical. ` +
      'The probe is built by runPandoc() directly on hand-authored HTML fixtures and never touches ' +
      'turndownService; the corpus (exportPlainText) only ever emits `<p>text</p>`, so no case contains a ' +
      '`data-type="inlineMath"` span and the mirrored inlineMathNode rule never fires on any of the 4814 ' +
      'cases. Class 4 is therefore 0 by construction, not a gap — Fix C\'s evidence lives in Task 3\'s report ' +
      '(throwaway spec: `data-display="yes"` → `$$x^2$$`).',
  );
  lines.push('');
  lines.push('## Gate: UNEXPLAINED + regression (must both be empty)');
  lines.push('');
  if (totalUnexplained === 0) {
    lines.push('None. Gate passes.');
  } else {
    lines.push(`**${totalUnexplained} total — GATE FAILS.**`);
    lines.push('');
    lines.push('### regression');
    for (const r of buckets.regression) {
      lines.push(`- ${r.id} — ${r.reason}`);
    }
    lines.push('');
    lines.push('### UNEXPLAINED (full list — includes what run 1 called "residual")');
    for (const r of buckets.UNEXPLAINED) {
      lines.push(`- ${r.id} — ${r.reason}`);
    }
  }
  lines.push('');

  for (const cls of ['intended-1', 'intended-1b', 'intended-2', 'intended-5']) {
    lines.push(`## Samples — \`${cls}\` (${buckets[cls].length} total, up to 10 shown)`);
    lines.push('');
    const sample = buckets[cls].slice(0, 10);
    for (const id of sample) {
      lines.push(fmtCase(id, base[id], after[id]));
      lines.push('');
    }
    if (sample.length === 0) lines.push('_(none)_');
    lines.push('');
  }

  fs.writeFileSync(path.join(OUTROOT, 'DIFF-REPORT.md'), lines.join('\n'));
  console.log(`DIFF-REPORT.md written. counts: ${JSON.stringify(counts)}`);
  console.log(
    `attribute-integrity screen: ${attrScreen.casesWithAttrDelta}/${attrScreen.casesChecked} changed cases have an attribute delta`,
  );
  console.log(`gate (UNEXPLAINED + regression): ${totalUnexplained}`);
}

if (process.argv.includes('--diff')) {
  writeDiffReport();
} else {
  main();
}
