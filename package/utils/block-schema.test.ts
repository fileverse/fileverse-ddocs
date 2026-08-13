// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import { unwrapDBlocksInJSON } from './block-schema';
import { getTemplateContent } from './getTemplateContent';

const TEMPLATE_NAMES = [
  'meeting-notes',
  'todo-list',
  'brainstorm',
  'breathe',
  'pretend-to-work',
  'resume',
];

const containsDBlock = (node: JSONContent): boolean => {
  if (node.type === 'dBlock') return true;
  return (node.content || []).some(containsDBlock);
};

const collectText = (node: JSONContent): string => {
  const own = node.type === 'text' ? (node.text ?? '') : '';
  return own + (node.content || []).map(collectText).join('');
};

describe('unwrapDBlocksInJSON', () => {
  it('hoists the single child out of a dBlock', () => {
    const result = unwrapDBlocksInJSON({
      type: 'doc',
      content: [
        { type: 'dBlock', content: [{ type: 'heading', attrs: { level: 1 } }] },
      ],
    });
    expect(result.content).toEqual([{ type: 'heading', attrs: { level: 1 } }]);
  });

  it('recurses into columns whose cells hold dBlocks', () => {
    const result = unwrapDBlocksInJSON({
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
                    { type: 'dBlock', content: [{ type: 'paragraph' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    expect(containsDBlock(result)).toBe(false);
    expect(result.content?.[0].content?.[0].content).toEqual([
      { type: 'paragraph' },
    ]);
  });

  it('degrades an empty dBlock to an empty paragraph', () => {
    const result = unwrapDBlocksInJSON({
      type: 'doc',
      content: [{ type: 'dBlock' }],
    });
    expect(result.content).toEqual([{ type: 'paragraph' }]);
  });

  it('leaves flat JSON untouched', () => {
    const flat = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }],
    };
    expect(unwrapDBlocksInJSON(flat)).toEqual(flat);
  });

  describe('every package template survives the unwrap (M2 exit check)', () => {
    TEMPLATE_NAMES.forEach((name) => {
      it(`${name}: no dBlock remains, text and block count preserved`, () => {
        const raw = getTemplateContent(name);
        expect(raw).not.toBeNull();

        const unwrapped = unwrapDBlocksInJSON(raw!);
        expect(containsDBlock(unwrapped)).toBe(false);
        expect(collectText(unwrapped)).toBe(collectText(raw!));
        expect(unwrapped.content?.length).toBe(raw!.content?.length);
      });
    });
  });
});
