import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { JSONContent } from '@tiptap/core';
import {
  splitDocIntoSlides,
  isSoloMediaSlide,
  scaleInlineFontSizes,
  matchListMarkersToText,
} from './doc-to-slides';
// Same extension assembly the headless editor uses, so custom nodes
// (dBlock, columns, pageBreak) are registered and the documents below are
// validated against the real schema rather than hand-rolled JSON.
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

/** Collect all text on a slide, for order-independent content assertions. */
const slideText = (slide: JSONContent): string => {
  const walk = (node?: JSONContent): string => {
    if (!node) return '';
    if (node.type === 'text') return node.text ?? '';
    return (node.content ?? []).map(walk).join(' ');
  };
  return walk(slide).replace(/\s+/g, ' ').trim();
};

/** Depth-first search for a node type anywhere in a slide. */
const hasNodeType = (slide: JSONContent, type: string): boolean => {
  const walk = (node?: JSONContent): boolean => {
    if (!node) return false;
    if (node.type === type) return true;
    return (node.content ?? []).some(walk);
  };
  return walk(slide);
};

describe('splitDocIntoSlides', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({ extensions: getHeadlessExtensions() });
  });

  afterEach(() => {
    editor.destroy();
  });

  /** Round-trips content through the editor so it conforms to the schema. */
  const docFrom = (content: string | JSONContent): JSONContent => {
    editor.commands.setContent(content);
    return editor.getJSON();
  };

  // Titles used to be stranded on a slide of their own even when the content
  // after them plainly fitted alongside.
  it('keeps a heading together with the content that follows it', () => {
    const slides = splitDocIntoSlides(
      docFrom('<h1>Title</h1><p>Body copy</p>'),
    );

    expect(slides).toHaveLength(1);
    expect(slideText(slides[0])).toBe('Title Body copy');
  });

  it('starts a new slide at a heading', () => {
    const slides = splitDocIntoSlides(
      docFrom('<p>Trailing text</p><h1>Title</h1><p>Body copy</p>'),
    );

    expect(slides).toHaveLength(2);
    expect(slideText(slides[0])).toBe('Trailing text');
    expect(slideText(slides[1])).toBe('Title Body copy');
  });

  it('leaves splitting to measurement when overflow limits are disabled', () => {
    const paragraphs = Array.from(
      { length: 30 },
      (_, i) => `<p>Paragraph number ${i}</p>`,
    ).join('');

    const slides = splitDocIntoSlides(docFrom(paragraphs), {
      applyOverflowLimits: false,
    });

    // No structural breaks in the document, so it stays a single slide for
    // the measurement pass to divide against the real stage.
    expect(slides).toHaveLength(1);
  });

  it('starts a new slide at each H2 and keeps the heading on it', () => {
    const slides = splitDocIntoSlides(
      docFrom('<h2>One</h2><p>First</p><h2>Two</h2><p>Second</p>'),
    );

    expect(slides).toHaveLength(2);
    expect(slideText(slides[0])).toBe('One First');
    expect(slideText(slides[1])).toBe('Two Second');
  });

  it('breaks on an explicit page break without rendering the break itself', () => {
    const slides = splitDocIntoSlides(
      docFrom(
        '<p>Before</p><div data-type="page-break" data-page-break="true"></div><p>After</p>',
      ),
    );

    expect(slides).toHaveLength(2);
    expect(slideText(slides[0])).toBe('Before');
    expect(slideText(slides[1])).toBe('After');
    expect(slides.some((slide) => hasNodeType(slide, 'pageBreak'))).toBe(false);
  });

  it('breaks a long run of paragraphs once it overflows the slide', () => {
    const paragraphs = Array.from(
      { length: 12 },
      (_, i) => `<p>Paragraph number ${i}</p>`,
    ).join('');

    const slides = splitDocIntoSlides(docFrom(paragraphs), {
      maxLinesPerSlide: 4,
    });

    expect(slides.length).toBeGreaterThan(1);
    // Nothing may be dropped on the way to the stage.
    const allText = slides.map(slideText).join(' ');
    for (let i = 0; i < 12; i++) {
      expect(allText).toContain(`Paragraph number ${i}`);
    }
  });

  it('never emits an empty slide', () => {
    const slides = splitDocIntoSlides(
      docFrom(
        '<div data-type="page-break" data-page-break="true"></div><p>Only</p><div data-type="page-break" data-page-break="true"></div>',
      ),
    );

    expect(slides).toHaveLength(1);
    expect(slideText(slides[0])).toBe('Only');
  });

  // The reason this module exists: the Markdown pipeline flattens a columns
  // block into sequential paragraphs, which is what makes "image left, text
  // right" impossible on a slide today.
  it('preserves a multi-column block instead of flattening it', () => {
    const doc = docFrom({
      type: 'doc',
      content: [
        {
          type: 'dBlock',
          content: [
            {
              type: 'columns',
              content: [
                {
                  type: 'column',
                  content: [
                    {
                      type: 'dBlock',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Left side' }],
                        },
                      ],
                    },
                  ],
                },
                {
                  type: 'column',
                  content: [
                    {
                      type: 'dBlock',
                      content: [
                        {
                          type: 'paragraph',
                          content: [{ type: 'text', text: 'Right side' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    // Guard: if the schema rejected the structure the assertion below would
    // pass vacuously, so confirm the source document really has columns.
    expect(hasNodeType(doc, 'columns')).toBe(true);

    const slides = splitDocIntoSlides(doc);

    expect(slides).toHaveLength(1);
    expect(hasNodeType(slides[0], 'columns')).toBe(true);
    expect(hasNodeType(slides[0], 'column')).toBe(true);
    expect(slideText(slides[0])).toContain('Left side');
    expect(slideText(slides[0])).toContain('Right side');
  });

  it('measures a columns block by its tallest column, not the sum', () => {
    const column = (lines: number) => ({
      type: 'column',
      content: Array.from({ length: lines }, (_, i) => ({
        type: 'dBlock',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: `line ${i}` }],
          },
        ],
      })),
    });

    const doc = docFrom({
      type: 'doc',
      content: [
        {
          type: 'dBlock',
          content: [{ type: 'columns', content: [column(3), column(3)] }],
        },
      ],
    });

    // Six paragraphs total but only three lines tall, so it fits a 4-line
    // slide. Summing the columns would wrongly split it.
    const slides = splitDocIntoSlides(doc, { maxLinesPerSlide: 4 });
    expect(slides).toHaveLength(1);
  });
});

describe('matchListMarkersToText', () => {
  const listItem = (text: JSONContent): JSONContent => ({
    type: 'listItem',
    content: [{ type: 'paragraph', content: [text] }],
  });

  // A native marker is sized by its <li>, but the size lives on the mark
  // inside it, so a resized item kept a base-size bullet.
  it('copies a size carried by a textStyle mark onto the item', () => {
    const result = matchListMarkersToText({
      type: 'bulletList',
      content: [
        listItem({
          type: 'text',
          text: 'big',
          marks: [{ type: 'textStyle', attrs: { fontSize: '30px' } }],
        }),
      ],
    });

    expect(result.content?.[0].attrs?.fontSize).toBe('30px');
  });

  it('copies a size carried as a paragraph attribute', () => {
    const result = matchListMarkersToText({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              attrs: { fontSize: '24px' },
              content: [{ type: 'text', text: 'big' }],
            },
          ],
        },
      ],
    });

    expect(result.content?.[0].attrs?.fontSize).toBe('24px');
  });

  it('leaves an item with no explicit size untouched', () => {
    const result = matchListMarkersToText({
      type: 'bulletList',
      content: [listItem({ type: 'text', text: 'plain' })],
    });

    expect(result.content?.[0].attrs?.fontSize).toBeUndefined();
  });

  it('sizes each item independently', () => {
    const result = matchListMarkersToText({
      type: 'bulletList',
      content: [
        listItem({
          type: 'text',
          text: 'small',
          marks: [{ type: 'textStyle', attrs: { fontSize: '12px' } }],
        }),
        listItem({
          type: 'text',
          text: 'large',
          marks: [{ type: 'textStyle', attrs: { fontSize: '40px' } }],
        }),
      ],
    });

    expect(result.content?.[0].attrs?.fontSize).toBe('12px');
    expect(result.content?.[1].attrs?.fontSize).toBe('40px');
  });

  it('reaches items nested inside another list', () => {
    const result = matchListMarkersToText({
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'bulletList',
              content: [
                listItem({
                  type: 'text',
                  text: 'nested',
                  marks: [{ type: 'textStyle', attrs: { fontSize: '18px' } }],
                }),
              ],
            },
          ],
        },
      ],
    });

    const nested = result.content?.[0].content?.[0].content?.[0];
    expect(nested?.attrs?.fontSize).toBe('18px');
  });

  it('preserves content and other node types', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
        {
          type: 'bulletList',
          content: [listItem({ type: 'text', text: 'item' })],
        },
      ],
    };

    expect(JSON.stringify(matchListMarkersToText(doc))).toContain('before');
    expect(JSON.stringify(matchListMarkersToText(doc))).toContain('item');
  });
});

describe('scaleInlineFontSizes', () => {
  // Inline font-size beats any stylesheet rule, so explicitly-sized text used
  // to ignore the presenter font scale while everything around it responded.
  it('routes an explicit size through the scale variable', () => {
    expect(scaleInlineFontSizes('<p style="font-size: 20px">big</p>')).toBe(
      '<p style="font-size: calc(var(--slide-font-scale, 1) * 20px)">big</p>',
    );
  });

  it.each(['px', 'rem', 'em', 'pt'])('handles %s units', (unit) => {
    expect(
      scaleInlineFontSizes(`<span style="font-size:1.5${unit}">x</span>`),
    ).toBe(
      `<span style="font-size: calc(var(--slide-font-scale, 1) * 1.5${unit})">x</span>`,
    );
  });

  it('scales every occurrence, not just the first', () => {
    const scaled = scaleInlineFontSizes(
      '<p style="font-size: 12px">a</p><p style="font-size: 30px">b</p>',
    );

    expect(scaled).toContain('* 12px)');
    expect(scaled).toContain('* 30px)');
  });

  // Running twice must not nest calc() inside calc().
  it('is idempotent', () => {
    const once = scaleInlineFontSizes('<p style="font-size: 20px">x</p>');
    expect(scaleInlineFontSizes(once)).toBe(once);
  });

  it('leaves markup without an inline size untouched', () => {
    const html = '<p>plain</p><ul><li>item</li></ul>';
    expect(scaleInlineFontSizes(html)).toBe(html);
  });
});

describe('isSoloMediaSlide', () => {
  it('is false for a slide carrying text alongside media', () => {
    const slide: JSONContent = {
      type: 'doc',
      content: [
        { type: 'dBlock', content: [{ type: 'resizableMedia', attrs: {} }] },
        {
          type: 'dBlock',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'caption' }] },
          ],
        },
      ],
    };

    expect(isSoloMediaSlide(slide)).toBe(false);
  });

  it('is true for a slide holding only media', () => {
    const slide: JSONContent = {
      type: 'doc',
      content: [
        { type: 'dBlock', content: [{ type: 'resizableMedia', attrs: {} }] },
      ],
    };

    expect(isSoloMediaSlide(slide)).toBe(true);
  });
});
