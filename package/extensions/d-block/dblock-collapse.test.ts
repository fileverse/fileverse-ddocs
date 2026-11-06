import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { PAGINATION_META } from '../pagination';
import { toggleHeadingCollapse } from './dblock-collapse';

const makeCollapsed = (schemaVersion: number) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({ schemaVersion }),
  });
  editor.commands.setContent('<h2>Title</h2><p>body</p><p>more</p>');
  toggleHeadingCollapse(editor, 0);
  return editor;
};

const hidden = (editor: Editor) =>
  editor.view.dom.querySelectorAll('.d-block-hidden').length;
const headingCollapsed = (editor: Editor) => {
  let value: unknown;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') value = node.attrs.isCollapsed;
  });
  return value;
};
const send = (editor: Editor, meta: unknown) =>
  editor.view.dispatch(editor.state.tr.setMeta(PAGINATION_META, meta));

describe.each([1, 2])('collapsed headings in Pages mode (schema v%i)', (v) => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('shows hidden blocks while Pages is enabled, keeping isCollapsed', () => {
    editor = makeCollapsed(v);
    expect(hidden(editor)).toBe(2);

    send(editor, { enabled: true });
    expect(hidden(editor)).toBe(0);
    expect(headingCollapsed(editor)).toBe(true);

    send(editor, { enabled: false });
    expect(hidden(editor)).toBe(2);
    expect(headingCollapsed(editor)).toBe(true);
  });

  it('ignores pass metas carrying spacers', () => {
    editor = makeCollapsed(v);
    send(editor, { enabled: true });
    send(editor, { spacers: [] });
    expect(hidden(editor)).toBe(0);
    send(editor, { enabled: false });
    send(editor, { spacers: [] });
    expect(hidden(editor)).toBe(2);
  });

  it('keeps the collapsed state applied to later edits while expanded', () => {
    editor = makeCollapsed(v);
    send(editor, { enabled: true });
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>x</p>');
    expect(hidden(editor)).toBe(0);
    send(editor, { enabled: false });
    expect(hidden(editor)).toBe(3);
  });

  it('Enter at the end of a collapsed heading is a plain split while expanded', () => {
    editor = makeCollapsed(v);
    send(editor, { enabled: true });
    let end = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') end = pos + node.nodeSize - 1;
    });
    editor.commands.setTextSelection(end);
    editor.view.someProp('handleKeyDown', (f) =>
      f(editor.view, new KeyboardEvent('keydown', { key: 'Enter' })),
    );
    expect(headingCollapsed(editor)).toBe(true);
    expect(editor.state.doc.textContent).toBe('Titlebodymore');
    const texts: string[] = [];
    editor.state.doc.descendants((n) => {
      if (n.isTextblock) texts.push(n.textContent);
    });
    expect(texts).toEqual(['Title', '', 'body', 'more']);
  });
});

describe('v2 preview controls while expanded', () => {
  it('keeps the heading preview widget', () => {
    const editor = makeCollapsed(2);
    send(editor, { enabled: true });
    expect(
      editor.view.dom.querySelector('.d-block-preview-controls-flat'),
    ).toBeTruthy();
    editor.destroy();
  });
});
