import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { defaultExtensions } from './default-extension';
import { PageBreak } from './page-break';
import { joinListsAroundEmptyBlock } from './list-normalization';

const li = (text: string) => ({
  type: 'listItem',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ],
});

const makeV2Editor = (content: object[]) => {
  const editor = new Editor({
    // PageBreak is registered by the callers (use-tab-editor / headless),
    // and FlatDocument's content expression requires it in the schema.
    extensions: [
      ...defaultExtensions({ onError: () => null, schemaVersion: 2 }),
      PageBreak,
    ] as never,
  });
  editor.commands.setContent({ type: 'doc', content });
  return editor;
};

// caret into the empty top-level paragraph between the two lists
const putCaretInEmptyParagraph = (editor: Editor) => {
  let pos: number | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (pos === null && node.type.name === 'paragraph' && node.childCount === 0)
      pos = offset;
  });
  editor.commands.setTextSelection(pos! + 1);
  return pos!;
};

describe('joinListsAroundEmptyBlock (Notion-template list normalization)', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('joins two bullet lists when the empty block between them is backspaced away', () => {
    editor = makeV2Editor([
      { type: 'bulletList', content: [li('one'), li('two'), li('three')] },
      { type: 'paragraph' },
      {
        type: 'bulletList',
        content: [li('four'), li('five'), li('six'), li('seven')],
      },
    ]);
    putCaretInEmptyParagraph(editor);

    expect(joinListsAroundEmptyBlock(editor)).toBe(true);

    const lists: number[] = [];
    editor.state.doc.forEach((node) => {
      if (node.type.name === 'bulletList') lists.push(node.childCount);
    });
    expect(lists).toEqual([7]);
    expect(editor.state.doc.firstChild!.textContent).toBe(
      'onetwothreefourfivesixseven',
    );
    // caret parked at the end of "three" — typing continues in the old last item
    const { $from } = editor.state.selection;
    expect($from.parent.textContent).toBe('three');
    expect($from.parentOffset).toBe(5);
  });

  it('declines when the lists are of different types', () => {
    editor = makeV2Editor([
      { type: 'bulletList', content: [li('a')] },
      { type: 'paragraph' },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'b' }] },
            ],
          },
        ],
      },
    ]);
    putCaretInEmptyParagraph(editor);

    const docBefore = editor.state.doc.toJSON();
    expect(joinListsAroundEmptyBlock(editor)).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(docBefore);
  });

  it('declines when the block between the lists has content', () => {
    editor = makeV2Editor([
      { type: 'bulletList', content: [li('a')] },
      { type: 'paragraph', content: [{ type: 'text', text: 'random text' }] },
      { type: 'bulletList', content: [li('b')] },
    ]);
    // caret at the START of the non-empty paragraph
    let pos: number | null = null;
    editor.state.doc.forEach((node, offset) => {
      if (pos === null && node.type.name === 'paragraph' && node.childCount > 0)
        pos = offset;
    });
    editor.commands.setTextSelection(pos! + 1);

    expect(joinListsAroundEmptyBlock(editor)).toBe(false);
  });

  it('declines at the document edges (no list on one side)', () => {
    editor = makeV2Editor([
      { type: 'paragraph' },
      { type: 'bulletList', content: [li('a')] },
    ]);
    putCaretInEmptyParagraph(editor);

    expect(joinListsAroundEmptyBlock(editor)).toBe(false);
  });

  it('is registered in the v2 extension set only', () => {
    const names = (schemaVersion: number) =>
      defaultExtensions({ onError: () => null, schemaVersion }).map(
        (extension) => (extension as { name: string }).name,
      );
    expect(names(2)).toContain('listNormalization');
    expect(names(1)).not.toContain('listNormalization');
  });
});
