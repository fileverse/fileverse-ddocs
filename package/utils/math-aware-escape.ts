// Design principle: this region model mirrors pandoc's tex_math_dollars
// delimiter rules EXACTLY. Any divergence — in either direction — leaks our
// escapes into content pandoc will typeset as math, or leaves prose that
// pandoc treats as literal text un-escaped. Pandoc's actual rule set (no
// more, no less):
//   1. `$$…$$` (display math) matches anywhere.
//   2. `$…$` (inline math) opens only where the `$` is NOT followed by
//      whitespace.
//   3. `$…$` closes only where the `$` is NOT preceded by whitespace AND
//      NOT followed by a digit (this second half is what keeps ordinary
//      "$5 and $10" currency prose from closing as math).
// Notably there is NO rule about what precedes the *opener* — pandoc does
// not special-case a digit before `$` (e.g. "version 2$x^2$" IS math to
// pandoc), so this regex must not add one either, even though a digit
// before the opener also makes some prose ambiguous with postfix-currency
// notation (see the `hasMathRegions`/`escapeOutsideMath` tests for that
// known, pandoc-parity limitation). Lookbehind is ES2018 — within the
// package's browser floor. The negated class excludes `\` (not just
// `$`/newline) so each backslash has exactly one path through the
// alternation (`\\[\s\S]` or the class, never both) — leaving `\` in the
// class made it ambiguous and caused catastrophic backtracking on unclosed
// `$` + backslash runs (e.g. a pasted Windows path after a stray `$`).
export const MATH_REGIONS =
  /\$\$[\s\S]+?\$\$|\$(?!\s)(?:\\[\s\S]|[^$\n\\])*?(?<!\s)\$(?!\d)/g;

// Raw HTML tag — a real attribute grammar, not "anything until >". The
// earlier `[^>"'\n]*`-after-tag-name shape accepted arbitrary text there,
// so bra-ket/inner-product notation like `<a \otimes b, c \otimes d>`
// (real content — a homomorphic-encryption post) false-positive-matched as
// a tag and rode through verbatim, exposing the bare `\otimes` macro to
// pandoc's raw_tex extension, which silently drops unrecognized macros —
// content loss. Same design principle as MATH_REGIONS above: this must
// mirror what the downstream HTML/markdown parser actually recognizes as a
// tag, in both directions — too loose leaks non-tag prose through
// unescaped (this bug); too strict would prose-escape inside a real tag
// (the earlier regression this module already fixes). Structure: tag name
// (`[a-zA-Z][a-zA-Z0-9-]*`), then zero or more attributes, each requiring
// leading whitespace (`\s+`) and a legal attribute-name lead char
// (letter/`_`/`:` — `\otimes`'s `\` is neither, so bra-ket attributes never
// parse as attributes and the whole match fails), each with an optional
// `=`value that's quoted (`"…"`/`'…'`, `\n`-free, no nested-quote handling
// needed since HTML attribute values can't contain their own delimiter) or
// unquoted (`[^\s>"'\n]+`, e.g. `<img src=x>`). Linear, not catastrophic,
// on adversarial input: every iteration of the attribute group consumes at
// least one whitespace char via the mandatory `\s+`, so iteration count is
// bounded by the string's whitespace count with no ambiguous re-split; the
// value alternatives' first characters (`"`, `'`, "anything else") are
// mutually exclusive, so there's no overlapping path for the engine to
// retry. Verified empirically: unclosed `<a ` + `'href '.repeat(20000)`
// and a pathological `<a ` + `"x='".repeat(10000)` both resolve in <1ms.
const TAG_REGION_SOURCE = String.raw`<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*(?:=(?:"[^"\n]*"|'[^'\n]*'|[^\s>"'\n]+))?)*\s*\/?>`;

// escapeOutsideMath's verbatim set is math ∪ raw-HTML-tags — a tag alone
// must not flip on --mathjax, so this stays internal; hasMathRegions below
// deliberately checks MATH_REGIONS only.
const VERBATIM_REGIONS_SOURCE = `${MATH_REGIONS.source}|${TAG_REGION_SOURCE}`;

export const hasMathRegions = (text: string): boolean =>
  new RegExp(MATH_REGIONS.source).test(text);

// Escape a text chunk for markdown: math regions and raw HTML tags pass
// through verbatim (backslash-escaping inside $…$ corrupts MathJax input;
// escaping inside a tag corrupts hrefs/attributes and breaks editor
// re-import); everything else gets the caller's escape plus `^` (pandoc's
// +superscript pairs tight runs). Assumes proseEscape never emits or itself
// escapes `^` (true of Turndown's escape) — otherwise the trailing
// `.replace(/\^/g, '\\^')` would double-escape.
export const escapeOutsideMath = (
  text: string,
  proseEscape: (s: string) => string,
): string => {
  const matcher = new RegExp(VERBATIM_REGIONS_SOURCE, 'g');
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    const prose = text.slice(lastIndex, match.index);
    result += proseEscape(prose).replace(/\^/g, '\\^');
    result += match[0];
    lastIndex = match.index + match[0].length;
  }
  const tail = text.slice(lastIndex);
  result += proseEscape(tail).replace(/\^/g, '\\^');

  return result;
};
