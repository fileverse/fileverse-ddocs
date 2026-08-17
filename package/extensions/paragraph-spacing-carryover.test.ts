import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

// Carry-over spans the v1 dBlock Enter handler and v2's stock split, so these
// run against a real Collaboration-backed editor rather than the schema-only
// editor used in paragraph-spacing.test.ts.
const makeEditor = (schemaVersion: number, content: string) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
    textDirection: 'auto',
  });
  // Collaboration owns the doc — content has to be set after construction.
  editor.commands.setContent(content);
  return editor;
};

const endOf = (editor: Editor, text: string) => {
  let end = 1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) {
      end = pos + node.text.indexOf(text) + text.length;
    }
  });
  return end;
};

const pressEnterAtEndOf = (editor: Editor, text: string) => {
  editor.commands.setTextSelection(endOf(editor, text));
  editor.commands.keyboardShortcut('Enter');
};

// The textblock the cursor lands in after Enter.
const blockAtCursor = (editor: Editor) => {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.isTextblock) return node;
  }
  return null;
};

const editors: Editor[] = [];
const track = (editor: Editor) => {
  editors.push(editor);
  return editor;
};

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe.each([1, 2])(
  'paragraph spacing carry-over (schema v%i)',
  (version) => {
    it('carries both attributes onto the next paragraph', () => {
      const editor = track(
        makeEditor(
          version,
          '<p style="margin-top: 12pt; margin-bottom: 8pt">one</p>',
        ),
      );

      pressEnterAtEndOf(editor, 'one');

      const created = blockAtCursor(editor);
      expect(created?.type.name).toBe('paragraph');
      expect(created?.attrs.spaceBefore).toBe(12);
      expect(created?.attrs.spaceAfter).toBe(8);
    });
  },
);

// The two schemas differ in what Enter at the end of a heading produces: v1's
// dBlock handler keeps the heading type, v2 drops to a paragraph. The carve-out
// only exists for the type change — continuing a heading should keep its
// rhythm, but body text should not inherit a heading's section gap.
describe('space before across a heading boundary', () => {
  it('keeps it when v1 continues with another heading', () => {
    const editor = track(
      makeEditor(1, '<h2 style="margin-top: 24pt; margin-bottom: 6pt">t</h2>'),
    );

    pressEnterAtEndOf(editor, 't');

    const created = blockAtCursor(editor);
    expect(created?.type.name).toBe('heading');
    expect(created?.attrs.spaceBefore).toBe(24);
  });

  it('drops it when v2 drops to a paragraph', () => {
    const editor = track(
      makeEditor(2, '<h2 style="margin-top: 24pt; margin-bottom: 6pt">t</h2>'),
    );

    pressEnterAtEndOf(editor, 't');

    const created = blockAtCursor(editor);
    expect(created?.type.name).toBe('paragraph');
    expect(created?.attrs.spaceBefore).toBe(null);
    expect(created?.attrs.spaceAfter).toBe(6);
  });
});
