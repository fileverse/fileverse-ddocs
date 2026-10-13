import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { Node } from '@tiptap/pm/model';
import { insertCommands } from '../../utils/insert-commands';
import { getSuggestionItems } from '../slash-command/slash-command-utils';
import {
  destroyTracked,
  endOf,
  makeEditor,
  startOf,
  track,
} from '../caret-marks/test-helpers';

afterEach(destroyTracked);

const findColumns = (editor: Editor) => {
  let columns: Node | undefined;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'columns') columns = node;
  });
  if (!columns) throw new Error('Columns not found');
  return columns;
};

describe.each([1, 2])('column insertion (schema v%i)', (schemaVersion) => {
  describe.each([2, 3])('%i columns', (count) => {
    const insert = (editor: Editor) =>
      insertCommands[count === 2 ? 'columns2' : 'columns3'](editor);

    const expectLayout = (editor: Editor, text: string) => {
      expect(editor.state.doc.check()).toBeUndefined();
      const columns = findColumns(editor);
      expect(columns.childCount).toBe(count);
      expect(columns.firstChild?.textContent).toBe(text);
      for (let i = 1; i < count; i++) {
        expect(columns.child(i).textContent).toBe('');
      }
      const { $from } = editor.state.selection;
      expect($from.parent.isTextblock).toBe(true);
      expect(
        Array.from({ length: $from.depth }, (_, i) => $from.node(i + 1)),
      ).toContainEqual(columns.firstChild);
    };

    it('preserves the current paragraph, its formatting, and surrounding text', () => {
      const editor = track(
        makeEditor(
          schemaVersion,
          '<p>Before</p><p style="text-align: right">Catatan <strong>rapat</strong>.</p><p>After</p>',
        ),
      );
      editor.commands.setTextSelection(endOf(editor, 'rapat'));
      const paragraph = editor.state.selection.$from.parent.toJSON();

      insert(editor);

      expectLayout(editor, 'Catatan rapat.');
      let preserved: Node | undefined;
      findColumns(editor).firstChild?.descendants((node) => {
        if (node.type.name === 'paragraph') preserved = node;
      });
      expect(preserved?.toJSON()).toEqual(paragraph);
      expect(editor.state.doc.textContent).toBe('BeforeCatatan rapat.After');
    });

    it.each([false, true])(
      'preserves a multi-paragraph selection (backward: %s)',
      (backward) => {
        const editor = track(
          makeEditor(
            schemaVersion,
            '<p>Before</p><p>Alpha</p><p>Bravo</p><p>After</p>',
          ),
        );
        const from = startOf(editor, 'Alpha') + 1;
        const to = endOf(editor, 'Bravo') - 1;
        editor.commands.setTextSelection(
          backward ? { from: to, to: from } : { from, to },
        );
        insert(editor);
        expectLayout(editor, 'AlphaBravo');
        expect(editor.state.doc.textContent).toBe('BeforeAlphaBravoAfter');
      },
    );

    it('still inserts usable columns in an empty paragraph', () => {
      const editor = track(makeEditor(schemaVersion));
      insert(editor);
      expectLayout(editor, '');
      editor.commands.insertContent('New text');
      expect(findColumns(editor).firstChild?.textContent).toBe('New text');
    });

    it('removes only the slash trigger and preserves the surrounding paragraph', () => {
      const editor = track(
        makeEditor(schemaVersion, '<p>Notes /column suffix</p>'),
      );
      const range = {
        from: startOf(editor, '/column'),
        to: endOf(editor, '/column'),
      };
      editor.commands.setTextSelection(range.to);
      const item = getSuggestionItems({ query: 'column', editor }).find(
        (suggestion) => suggestion.title === `${count} Columns`,
      );
      expect(item).toBeDefined();
      item!.command({ editor, range });
      expectLayout(editor, 'Notes  suffix');
      expect(editor.state.doc.textContent).toBe('Notes  suffix');
    });
  });
});
