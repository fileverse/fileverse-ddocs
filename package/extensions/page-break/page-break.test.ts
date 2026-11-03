import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';

const makeEditor = (schemaVersion: number) =>
  new Editor({
    extensions: getHeadlessExtensions({
      ydoc: new Y.Doc(),
      schemaVersion,
    }) as AnyExtension[],
    textDirection: 'auto',
  });

const topLevelTypes = (editor: Editor) => {
  const types: string[] = [];
  editor.state.doc.forEach((node) => {
    types.push(
      node.type.name === 'dBlock'
        ? (node.firstChild?.type.name ?? 'dBlock')
        : node.type.name,
    );
  });
  return types;
};

const stripIds = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (key, v) =>
      key === 'blockId' || key === 'id' ? undefined : v,
    ),
  );

const countNodes = (editor: Editor, name: string) => {
  let n = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === name) n++;
  });
  return n;
};

const placeCaretAtEnd = (editor: Editor, text: string) => {
  let end: number | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (end === null && node.isText && node.text === text) {
      end = pos + node.nodeSize;
    }
  });
  if (end === null) throw new Error(`"${text}" not found`);
  editor.chain().focus().setTextSelection(end).run();
};

describe.each([
  ['v1', 1],
  ['v2', 2],
])('insertPageBreakAtCaret — %s', (_label, schemaVersion) => {
  let editor: Editor;
  let reference: Editor;
  afterEach(() => {
    editor?.destroy();
    reference?.destroy();
  });

  it('caret in a paragraph: same result as setPageBreak', () => {
    const html = '<p>one</p><p>two</p>';
    editor = makeEditor(schemaVersion);
    reference = makeEditor(schemaVersion);
    editor.commands.setContent(html);
    reference.commands.setContent(html);
    placeCaretAtEnd(editor, 'one');
    placeCaretAtEnd(reference, 'one');
    expect(editor.commands.insertPageBreakAtCaret()).toBe(true);
    reference.commands.setPageBreak();
    expect(stripIds(editor.getJSON())).toEqual(stripIds(reference.getJSON()));
    expect(editor.state.selection.from).toBe(reference.state.selection.from);
    expect(topLevelTypes(editor)).toContain('pageBreak');
  });

  it('caret in a list item: break after the list, list intact', () => {
    editor = makeEditor(schemaVersion);
    editor.commands.setContent(
      '<ul><li><p>a</p></li><li><p>b</p></li></ul><p>after</p>',
    );
    placeCaretAtEnd(editor, 'a');
    expect(editor.commands.insertPageBreakAtCaret()).toBe(true);
    expect(topLevelTypes(editor)).toEqual([
      'bulletList',
      'pageBreak',
      'paragraph',
    ]);
    expect(countNodes(editor, 'listItem')).toBe(2);
    expect(editor.state.selection.$head.parent.textContent).toBe('after');
  });

  it('caret in a table cell: break after the table, table intact', () => {
    editor = makeEditor(schemaVersion);
    editor.commands.setContent(
      '<table><tbody><tr><td><p>x</p></td><td><p>y</p></td></tr></tbody></table><p>after</p>',
    );
    placeCaretAtEnd(editor, 'x');
    expect(editor.commands.insertPageBreakAtCaret()).toBe(true);
    expect(topLevelTypes(editor)).toEqual(['table', 'pageBreak', 'paragraph']);
    expect(countNodes(editor, 'tableCell')).toBe(2);
    expect(editor.state.selection.$head.parent.textContent).toBe('after');
  });

  it('last block is a list: a new empty paragraph after the break holds the caret', () => {
    editor = makeEditor(schemaVersion);
    editor.commands.setContent('<ul><li><p>a</p></li></ul>');
    placeCaretAtEnd(editor, 'a');
    expect(editor.commands.insertPageBreakAtCaret()).toBe(true);
    expect(topLevelTypes(editor)).toEqual([
      'bulletList',
      'pageBreak',
      'paragraph',
    ]);
    const { $head } = editor.state.selection;
    expect($head.parent.type.name).toBe('paragraph');
    expect($head.parent.textContent).toBe('');
    expect(countNodes(editor, 'listItem')).toBe(1);
  });

  it('in a code block: returns false and changes nothing', () => {
    editor = makeEditor(schemaVersion);
    editor.commands.setContent('<pre><code>code</code></pre><p>after</p>');
    placeCaretAtEnd(editor, 'code');
    const before = editor.getJSON();
    expect(editor.commands.insertPageBreakAtCaret()).toBe(false);
    expect(editor.getJSON()).toEqual(before);
  });
});
