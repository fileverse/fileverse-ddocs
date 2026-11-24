import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import {
  destroyTracked,
  makeEditor,
  track,
  undoManager,
} from './caret-marks/test-helpers';

// Text replacements (Typography, ordinals) stay in the typed text's undo step:
// Tiptap 3.34 tags each rule transaction so Collaboration stops capturing.

afterEach(destroyTracked);

/** Typed text as the browser delivers it, so input rules run. */
const typeChars = (editor: Editor, text: string) => {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, from, to, ch),
    );
    if (!handled)
      editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
};

const undoKey = (editor: Editor) =>
  editor.view.someProp('handleKeyDown', (f) =>
    f(
      editor.view,
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
    ),
  );

// lib0 reads a Date.now captured at import, so fake timers cannot move Yjs's
// capture window: widen it instead, so only stopCapturing() splits a group.
const open = (version: number) => {
  const editor = track(makeEditor(version, '<p></p>', { ydoc: new Y.Doc() }));
  const um = undoManager(editor);
  um.captureTimeout = 60_000;
  um.stopCapturing();
  um.clear();
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return { editor, um };
};

describe.each([1, 2])('input rule undo grouping (schema v%i)', (version) => {
  it.each([
    ['smart quotes and a dash', 'It\'s "fine" -- ok', 'It’s “fine” — ok'],
    ['an ordinal', 'the 1st place ok', 'the 1ˢᵗ place ok'],
  ])('keeps %s in one undo step', (_name, typed, shown) => {
    const { editor, um } = open(version);
    typeChars(editor, typed);
    expect(editor.state.doc.textContent).toBe(shown);
    expect(um.undoStack).toHaveLength(1);
    undoKey(editor);
    expect(editor.state.doc.textContent).toBe('');
  });
});
