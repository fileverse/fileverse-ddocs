import { describe, it, expect } from 'vitest';
import { turndownService, setMarkdownInlineStyles } from './index';

const exportStyled = (html: string) => {
  setMarkdownInlineStyles(true);
  try {
    return turndownService.turndown(html);
  } finally {
    setMarkdownInlineStyles(false);
  }
};

const mathSpan = (latex: string, display = false) => {
  const el = document.createElement('span');
  el.setAttribute('data-type', 'inlineMath');
  el.setAttribute('data-latex', latex);
  if (display) el.setAttribute('data-display', 'yes');
  // Real getHTML output carries the rendered math as text content — an empty
  // span would short-circuit into turndown's blankReplacement, not our rule.
  el.textContent = latex;
  return `<p>${el.outerHTML}</p>`;
};

// "Misplaced &" (TEC-2634): pandoc keeps entities VERBATIM inside
// tex_math_dollars, then its HTML writer escapes the `&` again — so any
// entity we emit in the inner $…$ body reaches MathJax double-escaped
// (`&lt;` literal → `&` = alignment char → error). The inner body must be
// entity-free: `<` becomes \lt (same glyph, no tag-open ambiguity), `&` and
// `>` stay raw. The data-latex ATTRIBUTE keeps entity escaping — that's
// correct HTML attribute encoding and round-trips via getAttribute.
describe('inline math export — Misplaced & fix', () => {
  it('emits < as \\lt in the inner body, entity-escaped in data-latex', () => {
    const md = exportStyled(mathSpan('a < b'));
    expect(md).toContain('$a \\lt  b$');
    expect(md).toContain('data-latex="a &lt; b"');
    expect(md).not.toContain('$a &lt; b$');
  });

  it('pads \\lt so a following letter cannot extend the macro name', () => {
    const md = exportStyled(mathSpan('x<y'));
    expect(md).toContain('$x\\lt y$');
    expect(md).not.toContain('\\lty');
  });

  it('keeps & raw in the inner body (alignment char in matrices)', () => {
    const md = exportStyled(mathSpan('\\begin{matrix} a & b \\end{matrix}'));
    expect(md).toContain('$\\begin{matrix} a & b \\end{matrix}$');
    expect(md).not.toContain('$\\begin{matrix} a &amp; b');
    expect(md).toContain(
      'data-latex="\\begin{matrix} a &amp; b \\end{matrix}"',
    );
  });

  it('keeps > raw in the inner body (already worked, must not regress)', () => {
    const md = exportStyled(mathSpan('a > b'));
    expect(md).toContain('$a > b$');
  });

  it('uses $$ delimiters for display math', () => {
    const md = exportStyled(mathSpan('c_1 < k', true));
    expect(md).toContain('$$c_1 \\lt  k$$');
    expect(md).toContain('data-display="yes"');
  });

  it('plain export keeps the raw latex untouched', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(mathSpan('a < b & c'));
    expect(md).toContain('$a < b & c$');
    expect(md).not.toContain('\\lt');
  });
});
