import { afterEach, describe, expect, it } from 'vitest';
import { Editor, type ChainedCommands } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

const makeEditor = (schemaVersion: number, html: string) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({
      ydoc: new Y.Doc(),
      schemaVersion,
    }) as AnyExtension[],
    textDirection: 'auto',
  });
  editor.commands.setContent(html);
  return editor;
};

// [text, color, fontSize, fontFamily] per text run
const runs = (editor: Editor) => {
  const out: Array<[string, unknown, unknown, unknown]> = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const { attrs } = node.marks.find((m) => m.type.name === 'textStyle') ?? {};
    out.push([
      node.text!,
      attrs?.color || null,
      attrs?.fontSize || null,
      attrs?.fontFamily || null,
    ]);
  });
  return out;
};

const RED = 'rgb(255, 0, 0)';
const PARAGRAPH =
  '<p><span style="font-size: 18px; font-family: serif">Hello </span>' +
  `<span style="color: ${RED}; font-size: 30px">red </span>plain</p>`;

describe.each([
  ['v1 paragraph', 1, PARAGRAPH],
  ['v2 paragraph', 2, PARAGRAPH],
  ['v2 list item', 2, `<ul><li>${PARAGRAPH}</li></ul>`],
])('text style over a whole %s', (_label, schemaVersion, html) => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  const applyToAll = (command: (chain: ChainedCommands) => ChainedCommands) => {
    editor = makeEditor(schemaVersion, html);
    editor.commands.selectAll();
    command(editor.chain().focus()).run();
    return runs(editor);
  };

  it('setFontSize keeps each run colour and family', () => {
    expect(applyToAll((c) => c.setFontSize('24px'))).toEqual([
      ['Hello ', null, '24px', 'serif'],
      ['red ', RED, '24px', null],
      ['plain', null, '24px', null],
    ]);
  });

  it('unsetFontSize keeps each run colour and family', () => {
    expect(applyToAll((c) => c.unsetFontSize())).toEqual([
      ['Hello ', null, null, 'serif'],
      ['red ', RED, null, null],
      ['plain', null, null, null],
    ]);
  });

  it('setFontFamily keeps each run colour and size', () => {
    expect(applyToAll((c) => c.setFontFamily('Georgia, serif'))).toEqual([
      ['Hello ', null, '18px', 'Georgia, serif'],
      ['red ', RED, '30px', 'Georgia, serif'],
      ['plain', null, null, 'Georgia, serif'],
    ]);
  });

  it('unsetFontFamily keeps each run colour and size', () => {
    expect(applyToAll((c) => c.unsetFontFamily())).toEqual([
      ['Hello ', null, '18px', null],
      ['red ', RED, '30px', null],
      ['plain', null, null, null],
    ]);
  });

  it('unsetColor keeps each run size and family', () => {
    expect(applyToAll((c) => c.unsetColor())).toEqual([
      ['Hello ', null, '18px', 'serif'],
      ['red ', null, '30px', null],
      ['plain', null, null, null],
    ]);
  });
});

// TEC-3016: unsetting one run's colour must not wipe the textStyle of the
// other runs in the same wrapper (Tiptap 3.30.3 `removeEmptyTextStyle`).
const TWO_RUNS = `<span style="color: ${RED}">red</span><span style="color: rgb(0, 0, 255)">blue</span>`;
describe.each([
  ['v1 paragraph (dBlock)', 1, `<p>${TWO_RUNS}</p>`],
  ['v1 list item', 1, `<ul><li><p>${TWO_RUNS}</p></li></ul>`],
  ['v2 list item', 2, `<ul><li><p>${TWO_RUNS}</p></li></ul>`],
  ['v1 quote', 1, `<blockquote><p>${TWO_RUNS}</p></blockquote>`],
  ['v2 quote', 2, `<blockquote><p>${TWO_RUNS}</p></blockquote>`],
])('unsetColor on one run in a %s', (_label, schemaVersion, html) => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('keeps the other run coloured', () => {
    editor = makeEditor(schemaVersion, html);
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from === -1 && node.text === 'red') from = pos;
    });
    editor.commands.setTextSelection({ from, to: from + 3 });
    editor.chain().unsetColor().run();
    expect(runs(editor).map(([text, color]) => [text, color])).toEqual([
      ['red', null],
      ['blue', 'rgb(0, 0, 255)'],
    ]);
  });
});
