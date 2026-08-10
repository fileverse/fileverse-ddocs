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

  // An undo can empty the Yjs fragment outright (undoing an edit that
  // replaced the initial paragraph — a heading insert does). ProseMirror
  // still renders its mandatory empty paragraph, and the next dispatch made
  // the y-sync binding write it back as a fresh TRACKED change, which the
  // UndoManager captured — wiping the redo stack. Redo was dead for any
  // heading-bearing insert, in both schemas.
  it('keeps redo alive when undo empties the document', async () => {
    editor = makeEditor(schemaVersion);
    editor
      .chain()
      .focus()
      .insertContent([
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Only heading' }],
        },
      ])
      .run();
    await settle();
    const inserted = editor.getText().trim();
    expect(inserted).toBe('Only heading');

    editor.commands.undo();
    await settle();
    expect(editor.getText().trim()).toBe('');

    // In the app SOMETHING always dispatches between undo and redo (the TOC
    // debounce, a caret move); that dispatch is what made the binding write
    // the phantom paragraph back as a tracked change. Reproduce it.
    editor.view.dispatch(editor.state.tr);
    await settle(150);

    editor.commands.redo();
    await settle();
    expect(editor.getText().trim()).toBe(inserted);
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
