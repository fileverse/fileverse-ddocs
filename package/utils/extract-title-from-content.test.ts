import { describe, expect, it } from 'vitest';
import { extractTitleFromContent } from './extract-title-from-content';

// The same document in both shapes: v1 wraps each block in a dBlock, the flat
// v2 schema does not. Titles must come out identical.
const wrap = (node: unknown) => ({ type: 'dBlock', content: [node] });

const heading = (text: string, level = 1) => ({
  type: 'heading',
  attrs: { level, textAlign: 'left' },
  content: [{ type: 'text', text }],
});

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('extractTitleFromContent', () => {
  it('reads an H1 in both schemas', () => {
    const v1 = { content: [wrap(heading('Quarterly Report')), wrap(paragraph('body'))] };
    const v2 = { content: [heading('Quarterly Report'), paragraph('body')] };

    expect(extractTitleFromContent(v1 as never)).toBe('Quarterly Report');
    expect(extractTitleFromContent(v2 as never)).toBe('Quarterly Report');
  });

  it('prefers an H1 over earlier text in both schemas', () => {
    const blocks = [paragraph('intro line'), heading('The Real Title')];
    const v1 = { content: blocks.map(wrap) };
    const v2 = { content: blocks };

    expect(extractTitleFromContent(v1 as never)).toBe('The Real Title');
    expect(extractTitleFromContent(v2 as never)).toBe('The Real Title');
  });

  it('falls back to the first text when there is no H1, in both schemas', () => {
    const blocks = [paragraph(''), paragraph('first real line'), paragraph('second')];
    const v1 = { content: blocks.map(wrap) };
    const v2 = { content: blocks };

    expect(extractTitleFromContent(v1 as never)).toBe('first real line');
    expect(extractTitleFromContent(v2 as never)).toBe('first real line');
  });

  it('joins split text nodes of a marked heading in both schemas', () => {
    const split = {
      type: 'heading',
      attrs: { level: 1 },
      content: [
        { type: 'text', text: 'Bold' },
        { type: 'text', text: 'ed Title', marks: [{ type: 'bold' }] },
      ],
    };

    expect(extractTitleFromContent({ content: [wrap(split)] } as never)).toBe('Bolded Title');
    expect(extractTitleFromContent({ content: [split] } as never)).toBe('Bolded Title');
  });

  it('ignores a non-H1 heading for the H1 pass but still finds its text', () => {
    const blocks = [heading('Section', 2)];
    expect(extractTitleFromContent({ content: blocks.map(wrap) } as never)).toBe('Section');
    expect(extractTitleFromContent({ content: blocks } as never)).toBe('Section');
  });

  it('truncates to 50 characters in both schemas', () => {
    const long = 'x'.repeat(80);
    expect(extractTitleFromContent({ content: [wrap(heading(long))] } as never)).toHaveLength(50);
    expect(extractTitleFromContent({ content: [heading(long)] } as never)).toHaveLength(50);
  });

  it('returns null for an empty document in both schemas', () => {
    expect(extractTitleFromContent({ content: [wrap(paragraph(''))] } as never)).toBeNull();
    expect(extractTitleFromContent({ content: [paragraph('')] } as never)).toBeNull();
  });
});
