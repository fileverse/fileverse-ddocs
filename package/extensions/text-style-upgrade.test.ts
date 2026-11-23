import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { TextStyle } from '@tiptap/extension-text-style';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { ExtendedTextStyle } from './text-style';
import { destroyTracked, track, selectText } from './caret-marks/test-helpers';

// Guard for TIPTAP_UPGRADE.md §6 R1: `ExtendedTextStyle` overrides
// `removeEmptyTextStyle` (a backport of Tiptap 3.30.3). Without it, unsetting
// one run's colour inside a wrapper (v1 dBlock, list item, quote) strips the
// textStyle from every run in that wrapper (TEC-3016). The `it.fails` cases use
// the stock 3.11 command; they must start passing exactly when R1 can be removed.

afterEach(destroyTracked);

const STOCK_TEXT_STYLE = TextStyle.extend({
  addAttributes: ExtendedTextStyle.config.addAttributes,
});

const mount = (schemaVersion: number, html: string, stock: boolean) => {
  const extensions = (
    getHeadlessExtensions({ schemaVersion }) as AnyExtension[]
  ).map((extension) =>
    stock && extension.name === 'textStyle' ? STOCK_TEXT_STYLE : extension,
  );
  expect(extensions.filter((e) => e.name === 'textStyle')).toHaveLength(1);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = track(
    new Editor({ element, extensions, textDirection: 'auto' }),
  );
  editor.commands.setContent(html);
  return editor;
};

const RUNS =
  '<span style="color: rgb(255, 0, 0)">red</span><span style="color: rgb(0, 0, 255)">blue</span>';
const SHAPES = {
  paragraph: `<p>${RUNS}</p>`,
  'list item': `<ul><li><p>${RUNS}</p></li></ul>`,
  blockquote: `<blockquote><p>${RUNS}</p></blockquote>`,
} as const;

const colourOf = (editor: Editor, text: string) => {
  let colour: unknown = 'run not found';
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes(text)) {
      colour =
        node.marks.find((m) => m.type.name === 'textStyle')?.attrs.color ??
        null;
    }
  });
  return colour;
};

const unsetFirstRun = (editor: Editor) => {
  selectText(editor, 'red');
  editor.chain().unsetColor().run();
};

describe.each([1, 2])('unsetColor keeps sibling runs, R1 (schema v%i)', (v) => {
  describe.each(Object.entries(SHAPES))('in a %s', (_shape, html) => {
    it('with the ExtendedTextStyle override', () => {
      const editor = mount(v, html, false);
      unsetFirstRun(editor);
      expect(colourOf(editor, 'blue')).toBe('rgb(0, 0, 255)');
      expect(colourOf(editor, 'red')).toBeNull();
    });
  });
});

// A v2 top-level paragraph is itself a textblock, which stock skips, so only
// the wrappers lose their runs there. v1 wraps every paragraph in a dBlock.
describe('stock removeEmptyTextStyle (no override), R1', () => {
  const stockKeepsBlue = (v: number, html: string) => {
    const editor = mount(v, html, true);
    unsetFirstRun(editor);
    expect(colourOf(editor, 'blue')).toBe('rgb(0, 0, 255)');
  };

  it('v2 paragraph is safe without the override', () => {
    stockKeepsBlue(2, SHAPES.paragraph);
  });

  it.fails('v1 dBlock wipes the sibling run', () => {
    stockKeepsBlue(1, SHAPES.paragraph);
  });
  it.fails('v1 list item wipes the sibling run', () => {
    stockKeepsBlue(1, SHAPES['list item']);
  });
  it.fails('v2 list item wipes the sibling run', () => {
    stockKeepsBlue(2, SHAPES['list item']);
  });
  it.fails('v1 blockquote wipes the sibling run', () => {
    stockKeepsBlue(1, SHAPES.blockquote);
  });
  it.fails('v2 blockquote wipes the sibling run', () => {
    stockKeepsBlue(2, SHAPES.blockquote);
  });
});
