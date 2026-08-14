import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { getTemplateTarget } from './dblock-toolbar';
import { DEFAULT_DBLOCK_RUNTIME_STATE } from './dblock-runtime';

// Repro for: clean editor -> '#' + space (markdown heading) -> Backspace.
// The hint placeholder returns but the template buttons never do — the user
// has to Cmd+A + Delete to get them back.

const makeSchemaEditor = (schemaVersion: number) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({ schemaVersion }),
    textDirection: 'auto',
  });
  return editor;
};

const typeText = (editor: Editor, text: string) => {
  for (const char of text) {
    const { view } = editor;
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (f) =>
      f(view, from, to, char),
    );
    if (!handled) {
      view.dispatch(view.state.tr.insertText(char, from, to));
    }
  }
};

const pressBackspace = (editor: Editor) => {
  editor.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    }),
  );
};

const docShape = (editor: Editor) =>
  editor.state.doc.content.content.map((n) =>
    n.type.name === 'dBlock' ? `dBlock(${n.firstChild?.type.name})` : n.type.name,
  );

describe.each([1, 2])('template target after # -> space -> Backspace (v%i)', (schemaVersion) => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('shows template buttons again once the doc is back to an empty paragraph', () => {
    editor = makeSchemaEditor(schemaVersion);
    editor.commands.focus('start');

    // Clean editor: buttons visible.
    expect(
      getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE),
    ).not.toBeNull();

    typeText(editor, '# ');
    // '#'+space converts the block to a heading, so TrailingNode appends an
    // empty paragraph — the doc is now two blocks.
    expect(editor.state.doc.childCount).toBe(2);
    expect(getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE)).toBeNull();

    pressBackspace(editor);
    // Backspace turns the heading back into a paragraph, but nothing removes
    // the trailing residue: the doc stays at two blank paragraphs.
    expect(docShape(editor)).toEqual(
      schemaVersion >= 2
        ? ['paragraph', 'paragraph']
        : ['dBlock(paragraph)', 'dBlock(paragraph)'],
    );

    // The regression: hint placeholder is back but the template target is not.
    expect(
      getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE),
    ).not.toBeNull();
  });

  it('keeps buttons hidden while any block holds real content', () => {
    editor = makeSchemaEditor(schemaVersion);
    editor.commands.setContent('<p></p><p>hello</p>');
    editor.commands.focus('start');

    expect(getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE)).toBeNull();
  });

  it('keeps buttons hidden when the first block is a heading', () => {
    editor = makeSchemaEditor(schemaVersion);
    editor.commands.setContent('<h1></h1><p></p>');
    editor.commands.focus('start');

    expect(getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE)).toBeNull();
  });
});
