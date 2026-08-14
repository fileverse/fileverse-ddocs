import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss, { type Rule } from 'postcss';

// The "Type / to browse options" hint must only ever land on an empty
// PARAGRAPH in the first block position. TEC-2515's flat-schema rewrite
// targeted `> .is-empty:first-child` (any first direct child), which:
//   - v1: matched the dBlock WRAPPER div (also decorated is-empty), so the
//     hint overlapped the inner heading's own "Heading 1" placeholder;
//   - v2: matched an empty first heading, so on blur (when the focus-gated
//     "Heading 1" rule stops applying) the heading fell back to the generic
//     hint rendered in heading typography.
// These tests pin the paragraph-only contract for both schema shapes.

const css = readFileSync(path.join(__dirname, 'editor.css'), 'utf8');
const root = postcss.parse(css);

const BROWSE_HINT = 'Type  /  to browse options';

// Collect via decl.parent: walkDecls on a rule recurses into nested rules,
// which would also report every ancestor wrapper as a "hint rule".
const hintRules: Rule[] = [];
root.walkDecls('content', (decl) => {
  if (decl.value.includes(BROWSE_HINT) && decl.parent?.type === 'rule') {
    hintRules.push(decl.parent as Rule);
  }
});

// postcss keeps nested selectors relative; resolve the `&`/implicit
// .ProseMirror prefix by walking parents.
const resolvedSelectors = hintRules.flatMap((rule) =>
  rule.selectors.map((selector) => {
    let parent = rule.parent;
    let prefix = '';
    while (parent && parent.type === 'rule') {
      prefix = `${(parent as Rule).selector} `;
      parent = parent.parent;
    }
    return `${prefix}${selector.replace(/^&\s*/, '')}`.trim();
  }),
);

describe('default "Type /" placeholder scoping', () => {
  it('defines the hint somewhere', () => {
    expect(resolvedSelectors.length).toBeGreaterThan(0);
  });

  it('every hint selector is scoped to a paragraph', () => {
    for (const selector of resolvedSelectors) {
      expect(selector, selector).toMatch(/p(:where\([^)]*\))?\.is-empty/);
    }
  });

  it('covers the flat schema: a first-child paragraph', () => {
    expect(
      resolvedSelectors.some(
        (s) => /"?>\s*p/.test(s) && s.includes(':first-child'),
      ),
    ).toBe(true);
  });

  it('covers v1: a paragraph inside the first dBlock wrapper', () => {
    expect(
      resolvedSelectors.some(
        (s) => s.includes("[data-type='d-block']") && s.includes('p'),
      ),
    ).toBe(true);
  });

  it('never targets a bare first child (the wrapper/heading footgun)', () => {
    for (const selector of resolvedSelectors) {
      // `> .is-empty:first-child` with no `p` is exactly the 2515 bug.
      expect(selector, selector).not.toMatch(/>\s*\.is-empty/);
      expect(selector, selector).not.toMatch(/h[1-6]/);
    }
  });

  // The focus-mode canvas cancels the hint with a (0,3,1) selector
  // (`[data-mode='focus'] :is(...) p.is-empty::before`). The hint selectors
  // must not out-rank it, or focus mode regains the hint. Pre-2515 parity
  // is (0,2,1): one class from .ProseMirror, one from .is-empty, plus the
  // p — every structural extra must sit inside :where().
  it('keeps hint specificity at (0,2,1) so focus mode still cancels it', () => {
    for (const selector of resolvedSelectors) {
      const noWhere = selector
        .replace(/:where\([^)]*\)/g, '')
        .replace(/::[\w-]+/g, ''); // pseudo-elements don't count at class level
      const classish = (noWhere.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? [])
        .length;
      expect(classish, selector).toBeLessThanOrEqual(2);
    }
  });

  // Blurred empty headings must keep their "Heading N" placeholder: the
  // caret's block stays decorated is-empty after blur (showOnlyCurrent
  // keeps the last selection), and a focus-gated rule would leave the
  // heading blank (or worse — fall through to another hint) on blur.
  it('heading placeholders do not depend on editor focus', () => {
    const headingChains: string[] = [];
    root.walkDecls('content', (decl) => {
      if (!/Heading [1-3]/.test(decl.value)) return;
      const rule = decl.parent as Rule;
      let parent = rule.parent;
      let chain = rule.selector;
      while (parent && parent.type === 'rule') {
        chain = `${(parent as Rule).selector} ${chain}`;
        parent = parent.parent;
      }
      headingChains.push(chain);
    });
    expect(headingChains.length).toBeGreaterThanOrEqual(3);
    for (const chain of headingChains) {
      expect(chain, chain).not.toContain('ProseMirror-focused');
    }
  });
});
