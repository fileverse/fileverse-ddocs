import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';

/**
 * TEC-2677: typing a tilde-wrapped word used to subscript it. A tilde is
 * punctuation people write, and when they do deliberately wrap a word in one
 * they mean what `~~x~~` means — so one or two tildes both strike through.
 */

const mounted: Editor[] = [];
afterEach(() => mounted.splice(0).forEach((editor) => editor.destroy()));

const makeEditor = () => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion: 2 }) as AnyExtension[],
    textDirection: 'auto',
  });
  mounted.push(editor);
  return editor;
};

/** Drives the real input-rule path, one character at a time, as typing does. */
const type = (editor: Editor, text: string) => {
  for (const ch of text) {
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(
        editor.view,
        editor.state.selection.from,
        editor.state.selection.to,
        ch,
      ),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch));
  }
};

const marksIn = (editor: Editor) => {
  const found = new Set<string>();
  editor.state.doc.descendants((node) =>
    node.marks.forEach((m) => found.add(m.type.name)),
  );
  return found;
};

describe('typing tilde-wrapped text', () => {
  it('strikes through a single-tilde span', () => {
    const editor = makeEditor();

    type(editor, 'I ~missed you~');

    expect(marksIn(editor).has('strike')).toBe(true);
    expect(marksIn(editor).has('subscript')).toBe(false);
    expect(editor.state.doc.textContent).toBe('I missed you');
  });

  it('strikes through a double-tilde span', () => {
    const editor = makeEditor();

    type(editor, 'I ~~missed you~~');

    expect(marksIn(editor).has('strike')).toBe(true);
    expect(marksIn(editor).has('subscript')).toBe(false);
    expect(editor.state.doc.textContent).toBe('I missed you');
  });

  // The single-tilde rule must not fire on `~~x~` and strike before the pair
  // is closed — that would leave a stray tilde behind.
  it('does not strike halfway through a double-tilde span', () => {
    const editor = makeEditor();

    type(editor, 'a ~~word~');

    expect(marksIn(editor).has('strike')).toBe(false);
    expect(editor.state.doc.textContent).toBe('a ~~word~');
  });

  it('leaves a lone tilde alone', () => {
    const editor = makeEditor();

    type(editor, 'roughly ~5 minutes');

    expect(marksIn(editor).has('strike')).toBe(false);
    expect(editor.state.doc.textContent).toBe('roughly ~5 minutes');
  });

  // A tilde with spaces inside is arithmetic-ish prose, not a formatting gesture.
  it('leaves a spaced tilde span alone', () => {
    const editor = makeEditor();

    type(editor, 'from ~ 5 ~ to');

    expect(marksIn(editor).has('strike')).toBe(false);
    expect(editor.state.doc.textContent).toBe('from ~ 5 ~ to');
  });
});
