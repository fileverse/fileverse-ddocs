import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import { CellSelection } from '@tiptap/pm/tables';
import {
  destroyTracked,
  makeEditor,
  startOf,
  track,
} from '../caret-marks/test-helpers';

// Probes for the prosemirror-tables refresh (1.8.1 -> 1.8.5): cell selection,
// row/column insert and delete, merge and split, including cells that are
// already merged. Each grid cell reads `text` or `text[colspan x rowspan]`.

const TABLE =
  '<table><tbody>' +
  '<tr><td><p>a1</p></td><td><p>b1</p></td><td><p>c1</p></td></tr>' +
  '<tr><td><p>a2</p></td><td><p>b2</p></td><td><p>c2</p></td></tr>' +
  '<tr><td><p>a3</p></td><td><p>b3</p></td><td><p>c3</p></td></tr>' +
  '</tbody></table>';

const grid = (editor: Editor) => {
  const rows: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'tableRow') return;
    const cells: string[] = [];
    node.forEach((cell) => {
      const { colspan, rowspan } = cell.attrs;
      const span = colspan > 1 || rowspan > 1 ? `[${colspan}x${rowspan}]` : '';
      cells.push(`${cell.textContent}${span}`);
    });
    rows.push(cells.join(' | '));
  });
  return rows.join(' / ');
};

const cellPos = (editor: Editor, text: string) => {
  const $pos = editor.state.doc.resolve(startOf(editor, text));
  for (let d = $pos.depth; d > 0; d -= 1) {
    if ($pos.node(d).type.name === 'tableCell') return $pos.before(d);
  }
  throw new Error(`no cell for ${text}`);
};

const selectCells = (editor: Editor, from: string, to: string) => {
  const { state } = editor;
  editor.view.dispatch(
    state.tr.setSelection(
      CellSelection.create(
        state.doc,
        cellPos(editor, from),
        cellPos(editor, to),
      ),
    ),
  );
};

const caretIn = (editor: Editor, text: string) =>
  editor.commands.setTextSelection(startOf(editor, text) + 1);

const defineSuite = (version: number) => {
  describe(`schema v${version}`, () => {
    afterEach(destroyTracked);

    const open = () => track(makeEditor(version, TABLE));

    it('inserts and deletes rows and columns', () => {
      const editor = open();
      caretIn(editor, 'b2');
      expect(editor.commands.addRowAfter()).toBe(true);
      expect(editor.commands.addColumnBefore()).toBe(true);
      const grown = grid(editor);
      caretIn(editor, 'a3');
      expect(editor.commands.deleteRow()).toBe(true);
      caretIn(editor, 'c1');
      expect(editor.commands.deleteColumn()).toBe(true);
      expect({ grown, shrunk: grid(editor) }).toMatchSnapshot();
    });

    it('merges a rectangle and splits it again', () => {
      const editor = open();
      selectCells(editor, 'a1', 'b2');
      expect(editor.can().mergeCells()).toBe(true);
      expect(editor.commands.mergeCells()).toBe(true);
      const merged = grid(editor);
      caretIn(editor, 'a1');
      expect(editor.commands.splitCell()).toBe(true);
      expect({ merged, split: grid(editor) }).toMatchSnapshot();
    });

    it('merges a selection that touches an already merged cell', () => {
      const editor = open();
      selectCells(editor, 'a1', 'b1');
      editor.commands.mergeCells();
      selectCells(editor, 'a1', 'a2');
      const outcome = {
        before: grid(editor),
        selection: editor.state.selection.toJSON().type,
        canMerge: editor.can().mergeCells(),
        merged: editor.commands.mergeCells(),
        after: grid(editor),
      };
      expect(outcome).toMatchSnapshot();
    });

    it('keeps a CellSelection over a merged cell after a row insert', () => {
      const editor = open();
      selectCells(editor, 'a1', 'b2');
      editor.commands.mergeCells();
      caretIn(editor, 'c1');
      editor.commands.addRowAfter();
      selectCells(editor, 'a1', 'a1');
      expect({
        grid: grid(editor),
        selection: editor.state.selection.toJSON().type,
      }).toMatchSnapshot();
    });
  });
};

describe('table commands (prosemirror-tables refresh)', () => {
  defineSuite(1);
  defineSuite(2);
});
