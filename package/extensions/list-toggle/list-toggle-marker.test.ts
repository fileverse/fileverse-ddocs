import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import {
  destroyTracked,
  endOf,
  makeEditor,
  nativeDelete,
  pressEnter,
  startOf,
  track,
} from '../caret-marks/test-helpers';
import { markerFont } from './marker-font';

afterEach(destroyTracked);

/** [name, html, marker font of every list item in document order]. */
const CASES: [string, string, string][] = [
  [
    'a whole item at 12px',
    '<ul><li><p><span style="font-size: 12px">aa</span></p></li><li><p>bb</p></li></ul>',
    '12px/- -/-',
  ],
  [
    'size and family together',
    '<ul><li><p><span style="font-size: 12px; font-family: Georgia">aa</span></p></li></ul>',
    '12px/"georgia"',
  ],
  [
    'one bigger word',
    '<ul><li><p><span style="font-size: 12px">aa </span><span style="font-size: 24px">bb</span></p></li></ul>',
    '-/-',
  ],
  [
    'one size, mixed families',
    '<ul><li><p><span style="font-size: 12px; font-family: Georgia">aa</span> <span style="font-size: 12px; font-family: Arial">bb</span></p></li></ul>',
    '12px/-',
  ],
  [
    'an unmarked space between two formatted words',
    '<ul><li><p><span style="font-size: 12px">b1</span> <span style="font-size: 12px">b2</span></p></li></ul>',
    '12px/-',
  ],
  [
    'one unmarked run',
    '<ul><li><p><span style="font-size: 12px">aa</span>bb</p></li></ul>',
    '-/-',
  ],
  [
    'legacy paragraph attrs',
    '<ul><li><p style="font-size: 12px; font-family: Georgia">aa</p></li></ul>',
    '12px/"georgia"',
  ],
  [
    'a numbered list with nested items',
    '<ol><li><p><span style="font-size: 12px">oo</span></p><ol><li><p>ob</p></li><li><p><span style="font-size: 18px">oc</span></p></li></ol></li></ol>',
    '12px/- -/- 18px/-',
  ],
  [
    'a checklist item',
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p><span style="font-size: 12px">tt</span></p></li></ul>',
    '-/-',
  ],
  [
    'pasted from Google Docs',
    '<ul><li><p><span style="font-size: 11pt; font-family: Arial, sans-serif">Item one</span></p></li></ul>',
    '11pt/"arial", sans-serif',
  ],
  [
    'a relative run over a sized paragraph (M-1)',
    '<ul><li><p style="font-size: 20px"><span style="font-size: 150%">aa</span></p></li></ul>',
    '-/-',
  ],
  [
    'a relative run in a plain paragraph (M-1)',
    '<ul><li><p><span style="font-size: 150%">aa</span></p></li></ul>',
    '150%/-',
  ],
  [
    'an em run in a plain paragraph (M-1)',
    '<ul><li><p><span style="font-size: 1.5em">aa</span></p></li></ul>',
    '1.5em/-',
  ],
  [
    'a relative paragraph size (M-1)',
    '<ul><li><p style="font-size: 150%">aa</p></li></ul>',
    '150%/-',
  ],
  [
    '12px next to 9pt',
    '<ul><li><p><span style="font-size: 12px">aa</span> <span style="font-size: 9pt">bb</span></p></li></ul>',
    '-/-',
  ],
  [
    'a calc() size (M-1)',
    '<ul><li><p><span style="font-size: calc(1em + 2px)">aa</span></p></li></ul>',
    '-/-',
  ],
  [
    'quoted and unquoted "Comic Sans MS" (M-4)',
    '<ul><li><p style="font-family: &quot;Comic Sans MS&quot;"><span style="font-family: &quot;Comic Sans MS&quot;">aa</span> bb</p></li></ul>',
    '-/"comic sans ms"',
  ],
  [
    'a quoted "serif" next to serif (M-4)',
    `<ul><li><p><span style='font-family: "serif"'>aa</span> <span style="font-family: serif">bb</span></p></li></ul>`,
    '-/-',
  ],
  [
    '12px text and an unstyled formula (M-2)',
    '<ul><li><p><span style="font-size: 12px">aa</span> <span data-type="inlineMath" data-latex="x"></span></p></li></ul>',
    '12px/-',
  ],
  [
    'only a formula (M-2)',
    '<ul><li><p><span data-type="inlineMath" data-latex="x"></span></p></li></ul>',
    '-/-',
  ],
];

const fontLabel = (size: string | null, family: string | null) =>
  `${size || '-'}/${family || '-'}`;

/** The marker font `markerFont` reads for every list item, in document order. */
const documentFonts = (editor: Editor) => {
  const fonts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      const { fontSize, fontFamily } = markerFont(node);
      fonts.push(fontLabel(fontSize, fontFamily));
    }
  });
  return fonts.join(' ');
};

/** Replace the textStyle of `text` — for values the HTML parser would normalize. */
const markText = (
  editor: Editor,
  text: string,
  attrs: Record<string, string>,
) =>
  editor.view.dispatch(
    editor.state.tr.addMark(
      startOf(editor, text),
      endOf(editor, text),
      editor.state.schema.marks.textStyle.create(attrs),
    ),
  );

const ITEM_12PX =
  '<ul><li><p><span style="font-size: 12px">aa</span></p></li></ul>';

describe.each([1, 2])('marker font from the document (schema v%i)', (v) => {
  it.each(CASES)('%s', (_name, html, expected) => {
    expect(documentFonts(track(makeEditor(v, html)))).toBe(expected);
  });

  it('treats 12.0px and 12px as one size (M-4)', () => {
    const editor = track(
      makeEditor(
        v,
        '<ul><li><p><span style="font-size: 12px">aa</span> <span style="font-size: 12px">bb</span></p></li></ul>',
      ),
    );
    markText(editor, 'aa', { fontSize: '12.0px' });
    expect(documentFonts(editor)).toBe('12px/-');
  });

  it('ignores a family that would end the inline declaration', () => {
    const editor = track(makeEditor(v, '<ul><li><p>aa</p></li></ul>'));
    markText(editor, 'aa', { fontFamily: 'Georgia; background: red' });
    expect(documentFonts(editor)).toBe('-/-');
  });

  it('gives the empty item Enter creates after a 12px item its stamp', () => {
    const editor = track(makeEditor(v, ITEM_12PX));
    editor.commands.setTextSelection(endOf(editor, 'aa'));
    pressEnter(editor);
    expect(documentFonts(editor)).toBe('12px/- 12px/-');
  });

  it('keeps 12px after deleting the text of a 12px item', () => {
    const editor = track(makeEditor(v, ITEM_12PX));
    nativeDelete(editor, startOf(editor, 'aa'), endOf(editor, 'aa'));
    expect(documentFonts(editor)).toBe('12px/-');
  });
});
