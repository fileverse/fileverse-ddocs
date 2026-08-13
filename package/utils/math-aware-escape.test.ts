import { describe, it, expect } from 'vitest';
import { escapeOutsideMath, hasMathRegions } from './math-aware-escape';

const id = (s: string) => s;
// Mirrors Turndown's real `escape` (lib/turndown.cjs.js `escapes` array):
// backslash is escaped FIRST (`/\\/g` → `\\\\`), before `*`/`_` — escaping
// `*`/`_` first would double-escape the backslashes those steps introduce.
const turndownish = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/\*/g, '\\*').replace(/_/g, '\\_');

describe('escapeOutsideMath', () => {
  it('escapes caret in prose (pandoc +superscript)', () => {
    expect(escapeOutsideMath('2^8*3^2 and 5^2*7^3', turndownish)).toBe(
      '2\\^8\\*3\\^2 and 5\\^2\\*7\\^3',
    );
  });

  it('escapes asterisks in bracket-y prose (no looksLikeFormula skip)', () => {
    expect(escapeOutsideMath('(2*3) plus (4*5)', turndownish)).toBe(
      '(2\\*3) plus (4\\*5)',
    );
  });

  it('leaves $…$ regions verbatim, escapes around them', () => {
    expect(escapeOutsideMath('so $x^2 * y_1$ and a*b', turndownish)).toBe(
      'so $x^2 * y_1$ and a\\*b',
    );
  });

  it('leaves $$…$$ display regions verbatim (single line)', () => {
    const t = 'see $$\\frac{a}{b} * c^2$$ end*';
    expect(escapeOutsideMath(t, turndownish)).toBe(
      'see $$\\frac{a}{b} * c^2$$ end\\*',
    );
  });

  it('leaves $$…$$ display regions verbatim across an actual line break', () => {
    const t = 'see $$\n\\frac{a}{b} * c^2\n$$ end*';
    expect(escapeOutsideMath(t, turndownish)).toBe(
      'see $$\n\\frac{a}{b} * c^2\n$$ end\\*',
    );
  });

  it('does not treat currency pairs as math', () => {
    expect(escapeOutsideMath('I paid $5 and $10 for a*b', turndownish)).toBe(
      'I paid $5 and $10 for a\\*b',
    );
  });

  it('resolves currency and real math coexisting in the same string', () => {
    expect(escapeOutsideMath('$5 and $x$ math', turndownish)).toBe(
      '$5 and $x$ math',
    );
  });

  it('passes prose without math straight through proseEscape + caret', () => {
    expect(escapeOutsideMath('plain text', id)).toBe('plain text');
    expect(escapeOutsideMath('x^y', id)).toBe('x\\^y');
  });

  it('handles adjacent inline regions ($a$$b$ parses as $a$ + $b$, not display)', () => {
    expect(escapeOutsideMath('$a$$b$ x*y', turndownish)).toBe('$a$$b$ x\\*y');
  });

  it('leaves raw HTML tags verbatim, including underscores/parens in attributes', () => {
    const t =
      'see <a href="https://x/wiki/Master_theorem_(analysis)">thm</a> and a*b';
    expect(escapeOutsideMath(t, turndownish)).toBe(
      'see <a href="https://x/wiki/Master_theorem_(analysis)">thm</a> and a\\*b',
    );
  });

  it('leaves a tag verbatim even when a quoted attribute contains ">"', () => {
    const t = '<span data-latex="G^{-1}(x) > y">m</span> and x^2';
    expect(escapeOutsideMath(t, turndownish)).toBe(
      '<span data-latex="G^{-1}(x) > y">m</span> and x\\^2',
    );
  });

  it('does not treat bare < / > (not a tag) as a verbatim region', () => {
    expect(escapeOutsideMath('a < b and c > d', id)).toBe('a < b and c > d');
  });

  // KNOWN LIMITATION, not a bug: pandoc's tex_math_dollars has no rule
  // barring a digit before the opener, so postfix-currency notation ("1$",
  // as used in Polish) that happens to pair two "N$" occurrences reads as
  // one math region to pandoc too — the source text is inherently
  // ambiguous and garbles identically on pandoc's own pipeline. Treating it
  // as prose instead would inject escape backslashes into what pandoc still
  // typesets as math, which is strictly worse (this was tried and reverted
  // — see math-aware-escape.ts's MATH_REGIONS comment). Parity with pandoc
  // is the contract this module holds itself to, not an endorsement of the
  // Polish-currency edge case.
  it('treats a postfix-currency pair as one math region, matching pandoc (known limitation)', () => {
    const t = 'koszt 1$. O ile *nie* są 1$';
    expect(escapeOutsideMath(t, turndownish)).toBe(t);
  });

  it('recognizes math with a digit immediately before the opener (pandoc has no such guard)', () => {
    expect(escapeOutsideMath('version 2$x^2$ next', turndownish)).toBe(
      'version 2$x^2$ next',
    );
  });

  it('escapes a caret outside math even when a later digit-adjacent $ opens real math', () => {
    expect(escapeOutsideMath('2^8 then 2$x^2$', turndownish)).toBe(
      '2\\^8 then 2$x^2$',
    );
  });

  // Regression: an unclosed tag with a long unquoted run used to be the
  // shape most likely to hit backtracking in a naive tag pattern. If this
  // regresses, the test times out rather than failing an assertion — that
  // timeout IS the signal.
  it('does not catastrophically backtrack on an unclosed HTML tag', () => {
    const t = '<' + 'a'.repeat(5000);
    expect(escapeOutsideMath(t, id)).toBe(t);
  });

  // Regression: the wave-2 tag pattern's `[^>"'\n]*` accepted anything
  // after the tag name, so bra-ket/inner-product notation like this
  // (real content from a homomorphic-encryption post) false-positive-
  // matched as a tag and was passed through verbatim — exposing the bare
  // `\otimes` to pandoc's raw_tex extension, which silently drops unknown
  // macros. A real HTML attribute grammar requires whitespace before each
  // attribute and a legal attribute-name leading char (letter/`_`/`:`);
  // `\otimes` starts with `\`, which is neither, so this must NOT match as
  // a tag and instead falls through to ordinary prose escaping — including
  // `\` → `\\`, which is what protects it from raw_tex.
  it('rejects bra-ket notation as a tag (regression); escapes backslash + asterisk', () => {
    const t = 'so <a \\otimes b, c \\otimes d> and x*y';
    expect(escapeOutsideMath(t, turndownish)).toBe(
      'so <a \\\\otimes b, c \\\\otimes d> and x\\*y',
    );
  });

  it('rejects bra-ket-with-subscripts as a tag; escapes underscores', () => {
    const t = '<ct_1 \\otimes ct_2, k \\otimes k>';
    expect(escapeOutsideMath(t, turndownish)).toBe(
      '<ct\\_1 \\\\otimes ct\\_2, k \\\\otimes k>',
    );
  });

  it('still leaves a self-closing tag verbatim', () => {
    expect(escapeOutsideMath('a<br/>b', id)).toBe('a<br/>b');
  });

  it('still leaves a tag with an unquoted attribute value verbatim', () => {
    expect(escapeOutsideMath('a<img src=x>b', id)).toBe('a<img src=x>b');
  });

  it('still leaves a closing tag verbatim', () => {
    expect(escapeOutsideMath('a</span>b', id)).toBe('a</span>b');
  });

  // Borderline cases, characterized rather than treated as bugs: `<a href>`
  // is valid HTML5 (a valueless/boolean attribute) and correctly matches as
  // a tag; `<x, y>` has a comma directly after the tag name — not a legal
  // attribute lead-in (no whitespace, no `=`) — and correctly does not
  // match, falling through to ordinary prose escaping.
  it('matches a valueless attribute ("<a href>", valid HTML)', () => {
    expect(escapeOutsideMath('x<a href>y', id)).toBe('x<a href>y');
  });

  it('does not match a comma directly after the tag name ("<x, y>")', () => {
    expect(escapeOutsideMath('z<x, y>w', id)).toBe('z<x, y>w');
  });

  // Regression probes for the new attribute grammar: mandatory `\s+` before
  // each attribute plus disjoint value-branch first-chars (`"`/`'`/
  // not-quote-not-space) should make iteration linear with no ambiguous
  // split. If either regresses to catastrophic backtracking, these time out
  // rather than failing an assertion — the timeout IS the signal.
  it('does not catastrophically backtrack on a long unclosed attribute-name stream', () => {
    const t = '<a ' + 'href '.repeat(5000);
    expect(escapeOutsideMath(t, id)).toBe(t);
  });

  it('does not catastrophically backtrack on a pathological unclosed-quote stream', () => {
    const t = '<a ' + "x='".repeat(5000);
    expect(escapeOutsideMath(t, id)).toBe(t);
  });
});

describe('hasMathRegions', () => {
  it('detects inline and display math, rejects currency', () => {
    expect(hasMathRegions('has $x_1$ math')).toBe(true);
    expect(hasMathRegions('has $$\\frac{a}{b}$$')).toBe(true);
    expect(hasMathRegions('costs $5 and $10')).toBe(false);
    expect(hasMathRegions('no math at all')).toBe(false);
  });

  // Regression: an unclosed `$` followed by a long backslash run (e.g. a
  // pasted Windows path or raw LaTeX after a stray `$`) used to hit
  // catastrophic backtracking. If this regresses, the test times out rather
  // than failing an assertion — that timeout IS the signal.
  it('does not catastrophically backtrack on unclosed $ + long backslash runs', () => {
    expect(hasMathRegions('$' + '\\'.repeat(200) + 'a')).toBe(false);
  });

  // Matches pandoc's own reading: a postfix-currency "N$ … N$" pair with
  // no rule barring a digit before the opener is real math to pandoc, so
  // --mathjax should fire on it too — see the KNOWN LIMITATION test above.
  // NOTE: a superficially similar pair, `'koszt 1$ i 1$'` (space, not `.`,
  // right after the first `$`), stays false — that one fails the *opener*
  // whitespace guard (rule 2 above), a real pandoc rule this module keeps
  // regardless of the digit question, so it is not an example of the same
  // limitation.
  it('detects a postfix-currency pair as math, matching pandoc (known limitation)', () => {
    expect(hasMathRegions('koszt 1$. O ile *nie* są 1$')).toBe(true);
  });

  it('rejects HTML tags alone (tags must not trigger --mathjax)', () => {
    expect(hasMathRegions('<b>x</b>')).toBe(false);
  });

  it('still detects real inline math', () => {
    expect(hasMathRegions('$x_1$')).toBe(true);
  });
});
