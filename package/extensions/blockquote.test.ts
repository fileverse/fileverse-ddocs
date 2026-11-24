import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import {
  destroyTracked,
  pressKey,
  startOf,
  textblocks,
} from './caret-marks/test-helpers';
import {
  addComment,
  expectValid,
  makeListEditor,
  resolvedAnchors,
} from './list-toggle/test-helpers';

// Backspace after a quote is the core keymap's joinBackward, not upstream
// Blockquote's merge (Tiptap 3.26+), which drops a v2 heading's type. In v1
// upstream's handler declines, so only v2 can tell the two apart.

afterEach(destroyTracked);

const blocks = (editor: Editor) =>
  textblocks(editor).map(({ node }) =>
    node.type.name === 'heading'
      ? `h${node.attrs.level}:${node.textContent}`
      : node.textContent,
  );

describe('Backspace at the start of a block after a quote (schema v2)', () => {
  it.each([
    ['an H2', '<h2>hh</h2>', 'hh', ['qq', 'h2:hh', '']],
    ['a paragraph', '<p>pp</p>', 'pp', ['qq', 'pp', '']],
  ])(
    'keeps %s whole, not merged into the quote',
    (_name, after, text, want) => {
      const h = makeListEditor(2, `<blockquote><p>qq</p></blockquote>${after}`);
      addComment(h, 'c-qq', 'qq');
      h.editor.commands.setTextSelection(startOf(h.editor, text));
      expect(pressKey(h.editor, 'Backspace')).toBe(true);
      expect(blocks(h.editor)).toEqual(want);
      expect(resolvedAnchors(h)).toBe('c-qq:qq');
      expectValid(h.editor, 2);
    },
  );
});
