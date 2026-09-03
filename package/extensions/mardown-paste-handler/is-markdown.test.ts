import { describe, it, expect } from 'vitest';
import { isMarkdown } from './index';

/**
 * The sniffer gates the WHOLE paste: a false positive sends plain prose through
 * markdown-it, which collapses its newlines and invents lists. So each clause
 * has to be tight as well as present.
 */
describe('isMarkdown', () => {
  it('recognises a paste whose only signal is a double tilde', () => {
    expect(isMarkdown('~~struck out~~')).toBe(true);
    expect(isMarkdown('a ~~b~~ c')).toBe(true);
  });

  // The clause this replaced required a non-space at both ends of the span.
  // Dropping that let arithmetic-ish prose through.
  it('does not treat spaced double tildes as strikethrough', () => {
    expect(isMarkdown('f1 ~~ f2 and f3 ~~ f4')).toBe(false);
    expect(isMarkdown('costs ~~5 dollars, maybe ~~10')).toBe(false);
  });

  it('does not treat a lone single-tilde span as markdown', () => {
    expect(isMarkdown('~I missed you~')).toBe(false);
  });

  // <s> is what the markdown export emits for a strike mark, so copying a
  // struck word out and pasting it back has to be recognised.
  it('recognises the strikethrough tag the export emits', () => {
    expect(isMarkdown('<s>gone</s>')).toBe(true);
  });

  it('leaves the other signals alone', () => {
    expect(isMarkdown('# heading')).toBe(true);
    expect(isMarkdown('**bold**')).toBe(true);
    expect(isMarkdown('x^2^')).toBe(true);
    expect(isMarkdown('<sub>n</sub>')).toBe(true);
    expect(isMarkdown('just some prose')).toBe(false);
  });
});
