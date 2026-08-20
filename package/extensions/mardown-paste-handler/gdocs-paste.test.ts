import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';

/**
 * TEC-2701 D1: pasting several paragraphs from Google Docs dropped the block
 * attributes (line height, spacing, alignment) of the FIRST one only.
 *
 * The clipboard is fine — all three paragraphs parse with the right values.
 * The loss is ProseMirror's open slice: `openStart > 0` merges the first
 * pasted block's inline content into the block at the cursor, which keeps its
 * own attributes. Later blocks arrive as whole nodes and are unaffected.
 *
 * Not caused by paragraph spacing — line height predates it and shows the same
 * loss — but found while testing it, and spacing rides on the same mechanism.
 */

// jsdom has no ClipboardEvent, and the package's handlePaste reads
// event.clipboardData before ProseMirror ever sees the HTML.
//
// getData MUST return '' for anything it is not asked to serve. A fake that
// answers every type feeds the plain text to @tiptap/extension-code-block's
// `vscode-editor-data` probe, which JSON.parses it and throws — a failure of
// the double, not of the product, and one that hides the real behaviour.
class FakeClipboardEvent extends Event {
  clipboardData: {
    getData: (type: string) => string;
    types: string[];
    files: never[];
    items: never[];
  };
  constructor(type: string, html: string, text: string) {
    super(type, { bubbles: true, cancelable: true });
    this.clipboardData = {
      types: ['text/html', 'text/plain'],
      files: [],
      items: [],
      getData: (t: string) => {
        if (t === 'text/html') return html;
        if (t === 'text/plain') return text;
        return '';
      },
    };
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ClipboardEvent ??= Event;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).DragEvent ??= Event;
  // jsdom implements no hit testing, and prosemirror-view's drop handler calls
  // posAtCoords -> elementFromPoint. Returning null makes it bail cleanly
  // instead of throwing; the drop itself is not what these tests assert.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document as any).elementFromPoint ??= () => null;
});

/** What Google Docs actually puts on the clipboard: a guid-tagged <b> wrapper
 *  and line-height as a unitless ratio. */
const gdocs = (style: string) =>
  [
    '<meta charset="utf-8">',
    '<b style="font-weight:normal" id="docs-internal-guid-abc">',
    ...['one', 'two', 'three'].map(
      (t) => `<p dir="ltr" style="${style}"><span>${t}</span></p>`,
    ),
    '</b>',
  ].join('');

const LINE_HEIGHT = 'line-height:1.8;margin-top:0pt;margin-bottom:0pt;';
const SPACING = 'line-height:1.8;margin-top:18pt;margin-bottom:6pt;';

const mounted: Editor[] = [];
afterEach(() => mounted.splice(0).forEach((editor) => editor.destroy()));

const mount = (schemaVersion: number, content?: string) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
    textDirection: 'auto',
  });
  if (content) editor.commands.setContent(content);
  mounted.push(editor);
  return editor;
};

// Real clipboards carry text/plain beside the HTML, and handlePaste inspects
// it first — so the tests use it. (Plain text that looks like markdown routes
// into the markdown branch instead and never reaches this path; see the
// limitation noted in docs/PARAGRAPH_SPACING.md.)
const PLAIN = 'one\ntwo\nthree';

const paste = (editor: Editor, html: string) =>
  editor.view.pasteHTML(
    html,
    new FakeClipboardEvent('paste', html, PLAIN) as never,
  );

/** Attributes of every paragraph that has text, in document order. */
const paragraphs = (editor: Editor) => {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'paragraph' && node.textContent) {
      found.push({ text: node.textContent, ...node.attrs });
    }
  });
  return found;
};

describe.each([1, 2])('Google Docs paste on schema v%i', (version) => {
  it('keeps the line height on the FIRST pasted paragraph', () => {
    const editor = mount(version);
    editor.commands.focus();

    paste(editor, gdocs(LINE_HEIGHT));

    const pasted = paragraphs(editor);
    expect(pasted.map((p) => p.text)).toEqual(['one', 'two', 'three']);
    // 1.8 stored as a percentage; the bug left this one at the 138% default.
    expect(pasted.map((p) => p.lineHeight)).toEqual(['180%', '180%', '180%']);
  });

  it('keeps spacing on the first paragraph too, not just line height', () => {
    const editor = mount(version);
    editor.commands.focus();

    paste(editor, gdocs(SPACING));

    expect(paragraphs(editor)[0]).toMatchObject({
      text: 'one',
      spaceBefore: 18,
      spaceAfter: 6,
    });
  });

  it('keeps it when pasting onto an empty line below existing content', () => {
    const editor = mount(version, '<p>existing</p><p></p>');
    // cursor into the trailing empty paragraph
    let at = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && !node.textContent) at = pos + 1;
    });
    editor.commands.setTextSelection(at);

    paste(editor, gdocs(LINE_HEIGHT));

    const pasted = paragraphs(editor).filter((p) => p.text !== 'existing');
    expect(pasted.map((p) => p.lineHeight)).toEqual(['180%', '180%', '180%']);
  });

  // transformPasted is ProseMirror's DROP hook too (prosemirror-view
  // editHandlers.drop, which for an external drop resolves its context from
  // the MOUSE via parseFromClipboard(..., $mouse) — not from the caret).
  // Overriding openStart there splits whatever paragraph the pointer landed
  // in, and a caret resting in a trailing empty paragraph is the most common
  // state there is.
  //
  // jsdom cannot complete a real drop (no document.elementFromPoint, so
  // posAtCoords throws), so this covers the two halves that ARE reachable:
  // the drop event sets the guard, and transformPasted honours it. That
  // ProseMirror calls transformPasted during a drop at all is established
  // from its source, not here.
  it('suppresses the openStart override while a drop is in flight', () => {
    const editor = mount(version, '<p>hello world</p><p></p>');
    let emptyAt = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && !node.textContent)
        emptyAt = pos + 1;
    });
    editor.commands.setTextSelection(emptyAt);

    const drop = new FakeClipboardEvent('drop', '', '');
    Object.defineProperty(drop, 'dataTransfer', { value: drop.clipboardData });
    editor.view.dom.dispatchEvent(drop);

    // Same tick as the drop: the guard is still set, so the paste behaves as
    // it would mid-drop — merged, attributes taken from the target block.
    paste(editor, gdocs(LINE_HEIGHT));

    expect(paragraphs(editor)[1]).toMatchObject({
      text: 'one',
      lineHeight: '138%',
    });
  });

  it('applies again once the drop has been handled', async () => {
    const editor = mount(version, '<p>hello world</p><p></p>');
    let emptyAt = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && !node.textContent)
        emptyAt = pos + 1;
    });
    editor.commands.setTextSelection(emptyAt);

    const drop = new FakeClipboardEvent('drop', '', '');
    Object.defineProperty(drop, 'dataTransfer', { value: drop.clipboardData });
    editor.view.dom.dispatchEvent(drop);
    await Promise.resolve(); // the queueMicrotask that clears the guard

    paste(editor, gdocs(LINE_HEIGHT));

    expect(paragraphs(editor)[1]).toMatchObject({
      text: 'one',
      lineHeight: '180%',
    });
  });

  // An empty heading is a block the user deliberately made. Letting the pasted
  // paragraph become it would silently discard the level.
  it('does not turn an empty heading into a paragraph', () => {
    const editor = mount(version, '<p>existing</p><h1></h1>');
    let at = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') at = pos + 1;
    });
    editor.commands.setTextSelection(at);

    paste(editor, gdocs(LINE_HEIGHT));

    const headings: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') headings.push(node.textContent);
    });
    expect(headings).toEqual(['one']);
  });

  // Pasting over a fully selected paragraph leaves the same empty target, and
  // lost the same attributes, so it needs the same treatment.
  it('carries attributes when pasting over a selected paragraph', () => {
    const editor = mount(version, '<p>replace me</p>');
    let from = 1;
    let to = 1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent) {
        from = pos + 1;
        to = pos + 1 + node.content.size;
      }
    });
    editor.commands.setTextSelection({ from, to });

    paste(editor, gdocs(LINE_HEIGHT));

    const pasted = paragraphs(editor);
    expect(pasted.map((p) => p.text)).toEqual(['one', 'two', 'three']);
    expect(pasted.map((p) => p.lineHeight)).toEqual(['180%', '180%', '180%']);
  });

  // The attribute assertions above read paragraphs at ANY depth and skip empty
  // ones, so a stray blank block, or content landing nested inside a list or
  // table, would leave them all green. Pin the shape once per schema.
  it('produces exactly three top-level blocks, nothing stray', () => {
    const editor = mount(version);
    editor.commands.focus();

    paste(editor, gdocs(LINE_HEIGHT));

    const top: string[] = [];
    editor.state.doc.forEach((node) => top.push(node.type.name));
    // v1 wraps each block in a dBlock; v2 is flat.
    expect(top).toEqual(
      version === 1
        ? ['dBlock', 'dBlock', 'dBlock']
        : ['paragraph', 'paragraph', 'paragraph'],
    );
  });

  // The deliberate boundary: with text at the cursor you are continuing a
  // sentence, so ProseMirror's merge is the right behaviour and the merged
  // block keeps the attributes it already had.
  it('still merges into a paragraph that has text', () => {
    const editor = mount(version, '<p>existing</p>');
    editor.commands.focus('end');

    paste(editor, gdocs(LINE_HEIGHT));

    const first = paragraphs(editor)[0];
    expect(first.text).toBe('existingone');
    expect(first.lineHeight).toBe('138%');
  });
});
