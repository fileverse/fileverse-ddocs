import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { isUndoRedoSelection } from './undo-selection';

const makeEditor = (schemaVersion: number) =>
  new Editor({
    extensions: getHeadlessExtensions({
      ydoc: new Y.Doc(),
      schemaVersion,
    }) as AnyExtension[],
    textDirection: 'auto',
  });

// The UndoManager merges everything inside a 500ms window into one stack item.
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

const selectWord = (editor: Editor, word: string) => {
  let at: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (at === null && node.isText && node.text?.includes(word)) {
      at = pos + (node.text?.indexOf(word) ?? 0);
    }
  });
  if (at === null) throw new Error(`"${word}" not found`);
  editor.chain().focus().setTextSelection({ from: at, to: at + word.length }).run();
};

const selectedText = (editor: Editor) => {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, ' ');
};

describe.each([
  ['v1 (dBlock)', 1],
  ['v2 (flat)', 2],
])('undo selection — %s', (_label, schemaVersion) => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  // Yjs restores the selection captured before the change it is undoing, which
  // runs one step behind: undoing the colour change used to leave the
  // previously-formatted word highlighted, and the bubble menu opened over it.
  it('selects the range that each undo actually changed', async () => {
    editor = makeEditor(schemaVersion);
    editor.commands.setContent('<p>alpha bravo charlie delta echo</p>');
    await settle();

    selectWord(editor, 'alpha');
    editor.chain().focus().toggleBold().run();
    await settle();

    selectWord(editor, 'charlie');
    editor.chain().focus().toggleItalic().run();
    await settle();

    selectWord(editor, 'echo');
    editor.chain().focus().toggleUnderline().run();
    await settle();

    editor.commands.undo();
    await settle(150);
    expect(selectedText(editor)).toBe('echo');

    editor.commands.undo();
    await settle(150);
    expect(selectedText(editor)).toBe('charlie');

    editor.commands.undo();
    await settle(150);
    expect(selectedText(editor)).toBe('alpha');

    expect(editor.isActive('bold')).toBe(false);
    expect(editor.isActive('italic')).toBe(false);
    expect(editor.isActive('underline')).toBe(false);
  });

  it('flags the selection as machine-made, and clears on the next gesture', async () => {
    editor = makeEditor(schemaVersion);
    editor.commands.setContent('<p>alpha bravo charlie</p>');
    await settle();

    selectWord(editor, 'alpha');
    editor.chain().focus().toggleBold().run();
    await settle();
    expect(isUndoRedoSelection(editor.state)).toBe(false);

    editor.commands.undo();
    await settle(150);
    expect(isUndoRedoSelection(editor.state)).toBe(true);

    selectWord(editor, 'charlie');
    expect(isUndoRedoSelection(editor.state)).toBe(false);
  });

  it('leaves a plain edit untouched', async () => {
    editor = makeEditor(schemaVersion);
    editor.commands.setContent('<p>alpha</p>');
    await settle();

    editor.chain().focus('end').insertContent(' bravo').run();
    await settle();
    expect(isUndoRedoSelection(editor.state)).toBe(false);
    expect(editor.state.selection.empty).toBe(true);
  });
});
