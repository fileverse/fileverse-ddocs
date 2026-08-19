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

  // Wrapping a spaced paragraph into a list used to leave the margin on the
  // paragraph and give the new item none. Nothing could then reach it —
  // setParagraphSpacing and both readers skip a paragraph inside a listItem —
  // so the gap was invisible to the dialog and setting spacing on the item
  // stacked a second gap on top of it.
  it('moves spacing onto the item when a paragraph is wrapped into a list', () => {
    const editor = makeEditor(version, '<p>one</p>');
    cursorInto(editor, 'one');
    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });

    editor.commands.toggleBulletList();

    expect(blocks(editor, 'listItem')[0]).toMatchObject({
      spaceBefore: 12,
      spaceAfter: 8,
    });
    expect(blocks(editor)[0]).toMatchObject({
      spaceBefore: null,
      spaceAfter: null,
    });
  });

  // The margin has to be gone from the DOM too, not just re-homed: two
  // elements each carrying 12pt is the doubled gap that was reported.
  it('renders the list gap once, on the item', () => {
    const editor = makeEditor(version, '<p>one</p>');
    cursorInto(editor, 'one');
    editor.commands.setParagraphSpacing({ spaceBefore: 12 });
    editor.commands.toggleBulletList();

    const html = editor.getHTML();

    expect(html.match(/margin-top: 12pt/g)).toHaveLength(1);
    expect(/<li[^>]*margin-top: 12pt/.test(html)).toBe(true);
  });

  // Documents already saved in the broken state have to come good. setContent
  // is how a dDoc opens and it replaces the whole doc in one step, so the
  // range-bounded normalisation covers the entire document on load.
  it('heals a document whose margin is already on the inner paragraph', () => {
    const editor = makeEditor(
      version,
      '<ul><li><p style="margin-top: 12pt; margin-bottom: 8pt">one</p></li></ul>',
    );

    expect(blocks(editor, 'listItem')[0]).toMatchObject({
      spaceBefore: 12,
      spaceAfter: 8,
    });
    expect(blocks(editor)[0]).toMatchObject({
      spaceBefore: null,
      spaceAfter: null,
    });
  });

  // The item's own value is the one the dialog reads back, so it must not be
  // overwritten by a stale attribute on the paragraph inside it.
  it('keeps the item value when both carry one', () => {
    const editor = makeEditor(
      version,
      '<ul><li style="margin-top: 30pt"><p style="margin-top: 12pt">one</p></li></ul>',
    );

    expect(blocks(editor, 'listItem')[0]).toMatchObject({ spaceBefore: 30 });
    expect(blocks(editor)[0]).toMatchObject({ spaceBefore: null });
  });

  // An item can hold more than one paragraph. The two that sit against the
  // item's own edges are the first and the last, so they are the sources.
  it('takes before from the first paragraph and after from the last', () => {
    const editor = makeEditor(
      version,
      '<ul><li><p style="margin-top: 12pt">one</p>' +
        '<p style="margin-bottom: 20pt">two</p></li></ul>',
    );

    expect(blocks(editor, 'listItem')[0]).toMatchObject({
      spaceBefore: 12,
      spaceAfter: 20,
    });
  });

  // An item can hold interior spacing that a listItem simply cannot express:
  // the gap BETWEEN its two paragraphs is neither the item's top nor its
  // bottom edge. Lifting only the edges and clearing everything else would
  // delete these two values on every open, silently and irreversibly, since
  // the normalisation runs over the whole document on load.
  it('leaves interior spacing alone in a multi-paragraph item', () => {
    const editor = makeEditor(
      version,
      '<ul><li><p style="margin-bottom: 5pt">one</p>' +
        '<p style="margin-top: 7pt">two</p></li></ul>',
    );

    expect(blocks(editor)[0]).toMatchObject({ spaceAfter: 5 });
    expect(blocks(editor)[1]).toMatchObject({ spaceBefore: 7 });
    expect(blocks(editor, 'listItem')[0]).toMatchObject({
      spaceBefore: null,
      spaceAfter: null,
    });
  });

  // "Last paragraph" is not the same as "the item's last child". When the item
  // ends in a nested list, that paragraph's bottom gap separates it from its
  // OWN sublist — moving it to the item would push it below the whole sublist.
  it('does not lift a bottom gap out of an item ending in a nested list', () => {
    const editor = makeEditor(
      version,
      '<ul><li><p style="margin-bottom: 12pt">one</p>' +
        '<ul><li><p>two</p></li></ul></li></ul>',
    );

    expect(blocks(editor)[0]).toMatchObject({ spaceAfter: 12 });
    expect(blocks(editor, 'listItem')[0]).toMatchObject({ spaceAfter: null });
  });

  // Splitting a spaced item carries the spacing to the new item, the same way
  // paragraph → paragraph does. The normalisation must not undo that.
  it('still carries item spacing across a split', () => {
    const editor = makeEditor(version, '<ul><li><p>one</p></li></ul>');
    cursorInto(editor, 'one');
    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });
    editor.commands.setTextSelection(editor.state.selection.from + 2);

    editor.commands.splitListItem('listItem');

    const items = blocks(editor, 'listItem');
    expect(items).toHaveLength(2);
    expect(items[1]).toMatchObject({ spaceBefore: 12, spaceAfter: 8 });
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
