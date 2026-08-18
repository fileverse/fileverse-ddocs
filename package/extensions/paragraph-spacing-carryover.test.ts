import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

// Carry-over spans the v1 dBlock Enter handler and v2's stock split, so these
// run against a real Collaboration-backed editor rather than the schema-only
// editor used in paragraph-spacing.test.ts.
const makeEditor = (schemaVersion: number, content: string) => {
  // Mounted, not detached: Enter does not split in a view-less editor, so a
  // detached editor made these assertions vacuous — nothing was ever created
  // and they read the original block instead.
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
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

/**
 * Every textblock in the document, in order.
 *
 * Deliberately not "the block at the cursor": in v1 the cursor stays in the
 * original paragraph after Enter, so reading from the selection returned the
 * block that already had the spacing and the assertion passed while the newly
 * created block was empty of it.
 */
const textblocks = (editor: Editor) => {
  const blocks: { name: string; attrs: Record<string, unknown> }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isTextblock) {
      blocks.push({ name: node.type.name, attrs: node.attrs });
    }
  });
  return blocks;
};

/** The block Enter created, which is always the one after the original. */
const createdBlock = (editor: Editor) => textblocks(editor)[1];

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

      const created = createdBlock(editor);
      expect(created?.name).toBe('paragraph');
      expect(created?.attrs.spaceBefore).toBe(12);
      expect(created?.attrs.spaceAfter).toBe(8);
    });
  },
);

// Both schemas drop to a paragraph when Enter is pressed at the end of a
// heading. An earlier version of this file claimed v1 continued with another
// heading — that came from a detached editor where Enter never split at all.
describe.each([1, 2])(
  'space before across a heading boundary (schema v%i)',
  (version) => {
    it('drops space before, but still carries space after', () => {
      const editor = track(
        makeEditor(
          version,
          '<h2 style="margin-top: 24pt; margin-bottom: 6pt">t</h2>',
        ),
      );

      pressEnterAtEndOf(editor, 't');

      const created = createdBlock(editor);
      expect(created?.name).toBe('paragraph');
      // A heading's section gap must not land on the body text below it.
      expect(created?.attrs.spaceBefore).toBeNull();
      expect(created?.attrs.spaceAfter).toBe(6);
    });
  },
);
