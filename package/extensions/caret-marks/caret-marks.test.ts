import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { CaretMarks } from './caret-marks';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  caretTo,
  caretBlock,
  createdBlock,
  textblocks,
  stampBlock,
  stampOf,
  storedMarkNames,
  typedMarks,
  typedTextStyle,
} from './test-helpers';

afterEach(destroyTracked);

describe.each([1, 2])('Rule A1 — explicit stamp (schema v%i)', (version) => {
  it('stamps an empty line the user formats, and typing gets the marks', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('stamps "[]" when the user clears the pending marks on an empty line', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('fills the legacy font into an explicit stamp and nulls the legacy attrs', () => {
    const editor = track(
      makeEditor(version, '<p style="font-size: 32px"></p>'),
    );
    editor.commands.toggleBold();
    const { node } = caretBlock(editor);
    expect(node.attrs.fontSize).toBeNull();
    const stamp = JSON.parse(stampOf(node)!);
    expect(stamp).toHaveLength(2);
    expect(stamp).toEqual(
      expect.arrayContaining([
        { type: 'bold' },
        {
          type: 'textStyle',
          attrs: expect.objectContaining({ fontSize: '32px' }),
        },
      ]),
    );
    expect(typedMarks(editor)).toEqual(['bold', 'textStyle']);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('never stamps a non-empty block', () => {
    const editor = track(makeEditor(version, '<p>abc</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBeNull();
    expect(typedMarks(editor)).toEqual(['bold']);
  });
});

describe.each([1, 2])('Rule B — restore on entry (schema v%i)', (version) => {
  it('restores a stamp when the caret enters the empty line', () => {
    const editor = track(makeEditor(version, '<p></p><p>abc</p>'));
    // setContent leaves the caret at the end of the document.
    caretTo(editor, textblocks(editor)[0].pos + 1);
    editor.commands.toggleBold();
    caretTo(editor, endOf(editor, 'abc'));
    expect(storedMarkNames(editor)).toBeNull();
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('keeps "[]" cleared even next to bold text', () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    const empty = textblocks(editor)[1];
    stampBlock(editor, empty.pos, '[]');
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it('falls back to the legacy font attrs of a never-stamped line, without a doc write', () => {
    const editor = track(
      makeEditor(version, '<p>abc</p><p style="font-family: Georgia"></p>'),
    );
    caretTo(editor, endOf(editor, 'abc'));
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(typedTextStyle(editor)?.fontFamily).toBe('Georgia');
  });

  it("falls back to the previous block's end marks for a never-stamped, attr-less line", () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(stampOf(caretBlock(editor).node)).toBeNull();
  });

  it('is tagged: a restore never counts as the user formatting the line', () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(editor.state.doc.eq(before)).toBe(true);
  });
});

describe('Rule C — pending marks survive appended steps (schema v2)', () => {
  const orders: [string, (extensions: AnyExtension[]) => AnyExtension[]][] = [
    ['production order', (extensions) => extensions],
    [
      'CaretMarks registered after BlockId',
      (extensions) => [
        ...extensions.filter((e) => e.name !== 'caretMarks'),
        CaretMarks,
      ],
    ],
  ];

  it.each(orders)(
    're-sets marks that blockIdAssign$ wiped (%s)',
    (_label, reorder) => {
      const custom = track(
        new Editor({
          element: document.body.appendChild(document.createElement('div')),
          extensions: reorder(
            getHeadlessExtensions({ schemaVersion: 2 }) as AnyExtension[],
          ),
          textDirection: 'auto',
        }),
      );
      custom.commands.setContent('<p><strong>A</strong>B</p>');
      caretTo(custom, endOf(custom, 'A'));
      // A raw split followed by a declaration: blockIdAssign$ appends a
      // setNodeMarkup for the new block, which nulls storedMarks.
      const tr = custom.state.tr.split(custom.state.selection.from);
      tr.setStoredMarks([custom.schema.marks.bold.create()]);
      custom.view.dispatch(tr);
      expect(createdBlock(custom).node.attrs.blockId).toBeTruthy();
      expect(storedMarkNames(custom)).toEqual(['bold']);
      expect(typedMarks(custom)).toEqual(['bold']);
      expect(createdBlock(custom).node.textContent).toBe('xB');
    },
  );
});
