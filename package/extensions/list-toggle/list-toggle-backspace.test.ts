import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import { destroyTracked, endOf, startOf } from '../caret-marks/test-helpers';
import {
  makeListEditor,
  flatShape,
  caretIn,
  rangeOver,
  addComment,
  decorated,
  resolvedAnchors,
  expectValid,
} from './test-helpers';

afterEach(destroyTracked);

const LIST3 = '<ul><li><p>aa</p></li><li><p>bb</p></li><li><p>cc</p></li></ul>';
const NESTED =
  '<ul><li><p>aa</p></li><li><p>bb</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';
const EMPTY_NESTED_MIDDLE =
  '<ol><li><p>main</p><ol><li><p>s1</p></li><li><p></p></li><li><p>s3</p></li><li><p>s4</p></li></ol></li></ol>';

/** A real keydown, so the keymap priority over dBlock and ListKeymap is exercised. */
const pressBackspace = (editor: Editor) =>
  editor.view.someProp('handleKeyDown', (f) =>
    f(
      editor.view,
      new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace' }),
    ),
  );

const backspaceAtStartOf = (editor: Editor, text: string) => {
  editor.commands.setTextSelection(startOf(editor, text));
  return pressBackspace(editor);
};

/** Caret in the first empty paragraph that is a list item's child. */
const caretInEmptyItem = (editor: Editor) => {
  let found = -1;
  editor.state.doc.descendants((node, pos, parent) => {
    if (found !== -1) return false;
    if (node.type.name === 'paragraph' && node.content.size === 0 && parent) {
      if (['listItem', 'taskItem'].includes(parent.type.name)) found = pos + 1;
    }
  });
  if (found === -1) throw new Error('no empty item');
  editor.commands.setTextSelection(found);
};

describe.each([1, 2])(
  'Backspace at the start of an item (schema v%i)',
  (version) => {
    it('un-bullets the last item in place', () => {
      const { editor } = makeListEditor(version, LIST3);
      expect(backspaceAtStartOf(editor, 'cc')).toBe(true);
      expect(flatShape(editor)).toBe('ul(li(p("aa")) li(p("bb"))) p("cc") p()');
      expect(editor.state.selection.from).toBe(startOf(editor, 'cc'));
      expectValid(editor, version);
    });

    it('un-bullets a middle item, splitting the list', () => {
      const { editor } = makeListEditor(version, LIST3);
      expect(backspaceAtStartOf(editor, 'bb')).toBe(true);
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa"))) p("bb") ul(li(p("cc"))) p()',
      );
      expectValid(editor, version);
    });

    it('un-bullets the first item', () => {
      const { editor } = makeListEditor(version, LIST3);
      expect(backspaceAtStartOf(editor, 'aa')).toBe(true);
      expect(flatShape(editor)).toBe('p("aa") ul(li(p("bb")) li(p("cc"))) p()');
      expectValid(editor, version);
    });

    it('un-bullets an empty middle item', () => {
      const { editor } = makeListEditor(
        version,
        '<ul><li><p>aa</p></li><li><p></p></li><li><p>cc</p></li></ul>',
      );
      caretInEmptyItem(editor);
      expect(pressBackspace(editor)).toBe(true);
      expect(flatShape(editor)).toBe('ul(li(p("aa"))) p() ul(li(p("cc"))) p()');
      expectValid(editor, version);
    });

    it('outdents a nested item', () => {
      const { editor } = makeListEditor(version, NESTED);
      expect(backspaceAtStartOf(editor, 'yy')).toBe(true);
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa")) li(p("bb") ul(li(p("xx")))) li(p("yy")) li(p("cc"))) p()',
      );
      expectValid(editor, version);
    });

    // Outdenting would re-parent s3/s4 under the empty item, and a second
    // press would hoist them to the top level.
    it('deletes an empty middle nested item, keeping the items after it nested', () => {
      const { editor } = makeListEditor(version, EMPTY_NESTED_MIDDLE);
      caretInEmptyItem(editor);
      expect(pressBackspace(editor)).toBe(true);
      expect(flatShape(editor)).toBe(
        'ol(li(p("main") ol(li(p("s1")) li(p("s3")) li(p("s4"))))) p()',
      );
      expect(editor.state.selection.from).toBe(endOf(editor, 's1'));
      expectValid(editor, version);
    });

    it('deletes an empty first nested item, caret to the end of the outer line', () => {
      const { editor } = makeListEditor(
        version,
        '<ol><li><p>main</p><ol><li><p></p></li><li><p>s2</p></li></ol></li></ol>',
      );
      caretInEmptyItem(editor);
      expect(pressBackspace(editor)).toBe(true);
      expect(flatShape(editor)).toBe('ol(li(p("main") ol(li(p("s2"))))) p()');
      expect(editor.state.selection.from).toBe(endOf(editor, 'main'));
      expectValid(editor, version);
    });

    it('deletes an empty nested checklist item the same way', () => {
      const { editor } = makeListEditor(version, '<p>aa</p><p></p><p>cc</p>');
      rangeOver(editor, 'aa', 'cc');
      editor.commands.toggleTaskList();
      editor.commands.setTextSelection(endOf(editor, 'aa') + 4);
      editor.commands.sinkListItem('taskItem');
      editor.commands.setTextSelection(startOf(editor, 'cc'));
      editor.commands.sinkListItem('taskItem');
      expect(flatShape(editor)).toBe(
        'tl(ti(p("aa") tl(ti(p()) ti(p("cc"))))) p()',
      );
      caretInEmptyItem(editor);
      expect(pressBackspace(editor)).toBe(true);
      expect(flatShape(editor)).toBe('tl(ti(p("aa") tl(ti(p("cc"))))) p()');
      expect(editor.state.selection.from).toBe(endOf(editor, 'aa'));
      expectValid(editor, version);
    });

    it('still outdents an empty last nested item', () => {
      const { editor } = makeListEditor(
        version,
        '<ol><li><p>main</p><ol><li><p>s1</p></li><li><p></p></li></ol></li></ol>',
      );
      caretInEmptyItem(editor);
      expect(pressBackspace(editor)).toBe(true);
      expect(flatShape(editor)).toBe(
        'ol(li(p("main") ol(li(p("s1")))) li(p())) p()',
      );
      expectValid(editor, version);
    });

    it('still outdents a non-empty middle nested item', () => {
      const { editor } = makeListEditor(
        version,
        '<ol><li><p>main</p><ol><li><p>s1</p></li><li><p>s2</p></li><li><p>s3</p></li></ol></li></ol>',
      );
      expect(backspaceAtStartOf(editor, 's2')).toBe(true);
      expect(flatShape(editor)).toBe(
        'ol(li(p("main") ol(li(p("s1")))) li(p("s2") ol(li(p("s3"))))) p()',
      );
      expectValid(editor, version);
    });

    it('still outdents an empty nested item that holds its own sub-list', () => {
      const { editor } = makeListEditor(
        version,
        '<ol><li><p>main</p><ol><li><p></p><ol><li><p>deep</p></li></ol></li><li><p>s2</p></li></ol></li></ol>',
      );
      caretInEmptyItem(editor);
      expect(pressBackspace(editor)).toBe(true);
      expect(flatShape(editor)).toBe(
        'ol(li(p("main")) li(p() ol(li(p("deep")) li(p("s2"))))) p()',
      );
      expectValid(editor, version);
    });

    it('keeps comments on the items after a deleted empty nested item', () => {
      const harness = makeListEditor(version, EMPTY_NESTED_MIDDLE);
      addComment(harness, 's3', 's3');
      caretInEmptyItem(harness.editor);
      expect(pressBackspace(harness.editor)).toBe(true);
      expect(decorated(harness.editor)).toBe('s3:s3');
      expect(resolvedAnchors(harness)).toBe('s3:s3');
    });

    it('un-checks a checklist item the same way', () => {
      const { editor } = makeListEditor(version, '<p>aa</p><p>bb</p>');
      rangeOver(editor, 'aa', 'bb');
      editor.commands.toggleTaskList();
      expect(backspaceAtStartOf(editor, 'bb')).toBe(true);
      expect(flatShape(editor)).toBe('tl(ti(p("aa"))) p("bb") p()');
      expectValid(editor, version);
    });

    it('leaves a caret inside the text to the default handlers', () => {
      const { editor } = makeListEditor(version, LIST3);
      caretIn(editor, 'cc');
      pressBackspace(editor);
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa")) li(p("bb")) li(p("cc"))) p()',
      );
    });

    it('leaves a range selection to the default handlers', () => {
      const { editor } = makeListEditor(version, LIST3);
      rangeOver(editor, 'bb', 'cc');
      pressBackspace(editor);
      expect(flatShape(editor)).toBe('ul(li(p("aa")) li(p("bc"))) p()');
    });

    it('keeps the ProseMirror-level comment range on the item', () => {
      const harness = makeListEditor(version, LIST3);
      addComment(harness, 'cc', 'cc');
      expect(backspaceAtStartOf(harness.editor, 'cc')).toBe(true);
      expect(decorated(harness.editor)).toBe('cc:cc');
      expectValid(harness.editor, version);
    });

    // TEC-3181: the lifted paragraph is re-created in Yjs, so its anchor dies.
    it.fails('keeps the Yjs comment anchor on the item', () => {
      const harness = makeListEditor(version, LIST3);
      addComment(harness, 'cc', 'cc');
      backspaceAtStartOf(harness.editor, 'cc');
      expect(resolvedAnchors(harness)).toBe('cc:cc');
    });
  },
);
