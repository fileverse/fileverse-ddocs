import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { readSpacingSelection } from '../utils/typography';

/**
 * The core behaviours run against both real schemas.
 *
 * Every paragraph-spacing bug found so far was v1-only and shipped green,
 * because the tests that covered the behaviour used a StarterKit-only editor.
 * v1 nests blocks twice (dBlock row > div > block) and handles Enter itself,
 * so it diverges from v2 in exactly the places this feature touches. Editors
 * are mounted because that is how the editor really runs.
 */
const mounted: Editor[] = [];

const makeEditor = (schemaVersion: number, content: string) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
    textDirection: 'auto',
  });
  // Collaboration owns the doc, so content is set after construction.
  editor.commands.setContent(content);
  mounted.push(editor);
  return editor;
};

/** Put the cursor inside the given text, wherever the schema nests it. */
const cursorInto = (editor: Editor, text: string) => {
  let at = 1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) at = pos + 1;
  });
  editor.commands.setTextSelection(at);
};

const blocks = (editor: Editor, type = 'paragraph') => {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === type) found.push(node.attrs);
  });
  return found;
};

afterEach(() => mounted.splice(0).forEach((editor) => editor.destroy()));

describe.each([1, 2])('paragraph spacing on schema v%i', (version) => {
  it('sets spacing on the block under the cursor', () => {
    const editor = makeEditor(version, '<p>one</p><p>two</p>');
    cursorInto(editor, 'one');

    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });

    expect(blocks(editor)[0]).toMatchObject({ spaceBefore: 12, spaceAfter: 8 });
    expect(blocks(editor)[1]).toMatchObject({
      spaceBefore: null,
      spaceAfter: null,
    });
  });

  it('keeps 0 distinct from unset', () => {
    const editor = makeEditor(version, '<p>one</p>');
    cursorInto(editor, 'one');

    editor.commands.setParagraphSpacing({ spaceBefore: 0 });

    expect(blocks(editor)[0].spaceBefore).toBe(0);
    expect(editor.getHTML()).toContain('margin-top: 0pt');
  });

  it('spaces the list item, not the paragraph inside it', () => {
    const editor = makeEditor(version, '<ul><li><p>item</p></li></ul>');
    editor.commands.selectAll();

    editor.commands.setParagraphSpacing({ spaceBefore: 12 });

    expect(blocks(editor, 'listItem')[0].spaceBefore).toBe(12);
    expect(blocks(editor)[0].spaceBefore).toBeNull();
  });

  it('clears both attributes with unsetParagraphSpacing', () => {
    const editor = makeEditor(version, '<p>one</p>');
    cursorInto(editor, 'one');
    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });

    editor.commands.unsetParagraphSpacing();

    expect(blocks(editor)[0]).toMatchObject({
      spaceBefore: null,
      spaceAfter: null,
    });
  });

  it('reads back what it wrote', () => {
    const editor = makeEditor(version, '<p>one</p>');
    cursorInto(editor, 'one');
    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });

    expect(readSpacingSelection(editor)).toMatchObject({
      spaceBefore: 12,
      spaceAfter: 8,
    });
  });

  it('reports mixed when the selected blocks disagree', () => {
    const editor = makeEditor(version, '<p>one</p><p>two</p>');
    cursorInto(editor, 'one');
    editor.commands.setParagraphSpacing({ spaceBefore: 12 });
    editor.commands.selectAll();

    expect(readSpacingSelection(editor).spaceBefore).toBe('mixed');
  });

  // Serialising and re-parsing is how spacing survives export, paste and
  // import, so render and parse have to agree — including on 0, which is
  // falsy and easy to drop accidentally.
  it('survives a getHTML / setContent round trip, including 0', () => {
    const editor = makeEditor(version, '<p>one</p>');
    cursorInto(editor, 'one');
    editor.commands.setParagraphSpacing({ spaceBefore: 0, spaceAfter: 8 });

    const reopened = makeEditor(version, editor.getHTML());

    expect(blocks(reopened)[0]).toMatchObject({
      spaceBefore: 0,
      spaceAfter: 8,
    });
  });
});
