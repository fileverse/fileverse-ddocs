import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import { destroyTracked, startOf } from '../caret-marks/test-helpers';
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
