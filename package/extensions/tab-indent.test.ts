import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

const EM_SPACE = '\u2003';
const mounted: Editor[] = [];

const makeEditor = (schemaVersion: number, content: string) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
  });
  editor.commands.setContent(content);
  mounted.push(editor);
  return editor;
};

const cursorAfter = (editor: Editor, text: string) => {
  let at = 1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) at = pos + node.nodeSize;
  });
  editor.commands.setTextSelection(at);
};

// Runs the real keymap chain, so the test covers the wiring, not a helper.
const press = (editor: Editor, shiftKey = false) => {
  const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey });
  return Boolean(
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)),
  );
};

const textOf = (editor: Editor, type: string) => {
  let text = '';
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) text = node.textContent;
  });
  return text;
};

afterEach(() => {
  mounted.splice(0).forEach((editor) => editor.destroy());
});

describe.each([1, 2])('Tab indentation (schema v%i)', (schemaVersion) => {
  it('Tab inserts an EM space in a paragraph, Shift-Tab removes it', () => {
    const editor = makeEditor(schemaVersion, '<p>hello</p>');
    cursorAfter(editor, 'hello');

    expect(press(editor)).toBe(true);
    expect(textOf(editor, 'paragraph')).toMatch(
      new RegExp(`^hello${EM_SPACE}+$`),
    );

    expect(press(editor, true)).toBe(true);
    expect(textOf(editor, 'paragraph')).toBe('hello');
  });

  it('Tab inserts an EM space in a heading', () => {
    const editor = makeEditor(schemaVersion, '<h1>title</h1>');
    cursorAfter(editor, 'title');

    expect(press(editor)).toBe(true);
    expect(textOf(editor, 'heading')).toMatch(
      new RegExp(`^title${EM_SPACE}+$`),
    );
  });

  it('Tab sinks a list item and Shift-Tab lifts it back', () => {
    const editor = makeEditor(
      schemaVersion,
      '<ul><li><p>one</p></li><li><p>two</p></li></ul>',
    );
    cursorAfter(editor, 'two');
    const depth = editor.state.selection.$from.depth;

    expect(press(editor)).toBe(true);
    expect(editor.state.selection.$from.depth).toBe(depth + 2);

    expect(press(editor, true)).toBe(true);
    expect(editor.state.selection.$from.depth).toBe(depth);
  });

  it('Tab on the first list item is consumed instead of leaving the editor', () => {
    const editor = makeEditor(schemaVersion, '<ul><li><p>one</p></li></ul>');
    cursorAfter(editor, 'one');
    const before = editor.state.doc.toJSON();

    expect(press(editor)).toBe(true);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it('Tab inserts an EM space in a column paragraph', () => {
    const editor = makeEditor(schemaVersion, '<p>x</p>');
    // v1: dBlock > columns > column > dBlock > paragraph; v2 has no wrappers.
    const wrap = (node: object) =>
      schemaVersion >= 2 ? node : { type: 'dBlock', content: [node] };
    const paragraph = (text: string) =>
      wrap({ type: 'paragraph', content: [{ type: 'text', text }] });
    const columns = wrap({
      type: 'columns',
      content: [
        { type: 'column', content: [paragraph('left')] },
        { type: 'column', content: [paragraph('right')] },
      ],
    });
    editor.commands.setContent(
      { type: 'doc', content: [columns] },
      { errorOnInvalidContent: true },
    );
    expect(editor.state.doc.check()).toBeUndefined();
    cursorAfter(editor, 'left');

    expect(press(editor)).toBe(true);
    expect(editor.state.doc.textContent).toMatch(
      new RegExp(`^left${EM_SPACE}+right$`),
    );
  });
});
