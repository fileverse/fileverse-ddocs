import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The print stylesheet has to mirror the editor canvas, which expresses block
// spacing as margin-bottom only. Two margins per gap collapse to the larger,
// so a shorthand here would also keep overriding whichever side an author left
// unset — authored spacing arrives as an inline margin-top or margin-bottom,
// and inline only wins for the longhand it actually sets.
const source = readFileSync(path.join(__dirname, 'handle-print.ts'), 'utf8');

/** Selectors ParagraphSpacing can target, plus the list containers. */
const SPACING_SELECTOR = /^\.print-content-root\s+(?:p|h[1-6]|li|ul|ol)$/;

type Rule = { selector: string; body: string };

// Declarations are read per rule rather than by one clever regex — an earlier
// attempt let `\s*` backtrack so that `margin-top: 0` matched as non-zero.
const rules: Rule[] = [];
for (const match of source.matchAll(/\.print-content-root[^{}]*\{([^}]*)\}/g)) {
  rules.push({
    selector: match[0].slice(0, match[0].indexOf('{')),
    body: match[1],
  });
}

const normalizeSelector = (selector: string) =>
  selector.trim().replace(/\s+/g, ' ');

const spacingRules = rules.filter((rule) =>
  rule.selector
    .split(',')
    .some((part) => SPACING_SELECTOR.test(normalizeSelector(part))),
);

const declaration = (body: string, prop: string) =>
  body.match(new RegExp(`\\b${prop}:\\s*([^;]+)`))?.[1].trim();

const mediaImageAlignmentRule = (alignment: string) =>
  rules.find((rule) =>
    rule.selector
      .split(',')
      .some(
        (part) =>
          normalizeSelector(part) ===
          `.print-content-root [data-type='resizable-media'][dataalign='${alignment}'] > img`,
      ),
  );

const defaultWidthMediaImageRule = rules.find(
  (rule) =>
    normalizeSelector(rule.selector) ===
    ".print-content-root [data-type='resizable-media'] > img[width='100%']",
);

describe('print stylesheet', () => {
  it('finds the rules it means to assert on', () => {
    expect(spacingRules.length).toBeGreaterThan(5);
  });

  it('never uses the margin shorthand on a block that can carry spacing', () => {
    const offenders = spacingRules
      .filter((rule) => declaration(rule.body, 'margin') !== undefined)
      .map((rule) => rule.selector.trim());

    expect(offenders).toEqual([]);
  });

  it('carries no non-zero top margin, matching the editor canvas', () => {
    const offenders = spacingRules
      .map((rule) => ({
        selector: rule.selector.trim(),
        marginTop: declaration(rule.body, 'margin-top'),
      }))
      .filter(({ marginTop }) => marginTop !== undefined && marginTop !== '0');

    expect(offenders).toEqual([]);
  });

  it('still sets the gap below each block', () => {
    const withBottom = spacingRules.filter(
      (rule) => declaration(rule.body, 'margin-bottom') !== undefined,
    );

    expect(withBottom.length).toBeGreaterThan(5);
  });

  it('keeps default-width media images at their intrinsic size', () => {
    expect(defaultWidthMediaImageRule).toBeDefined();
    expect(declaration(defaultWidthMediaImageRule!.body, 'width')).toBe('auto');
  });

  it.each([
    ['start', 'margin-left'],
    ['left', 'margin-left'],
    ['end', 'margin-right'],
    ['right', 'margin-right'],
  ])(
    'preserves %s-aligned media images',
    (alignment, overriddenMargin) => {
      const rule = mediaImageAlignmentRule(alignment);

      expect(rule).toBeDefined();
      expect(declaration(rule!.body, overriddenMargin)).toBe('0');
    },
  );
});
