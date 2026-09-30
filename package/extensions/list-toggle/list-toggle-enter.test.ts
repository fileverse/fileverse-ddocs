import { afterEach, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import {
  destroyTracked,
  endOf,
  makeEditor,
  pressEnter,
  track,
  type,
  undoManager,
} from '../caret-marks/test-helpers';
import { expectValid, flatShape } from './test-helpers';

afterEach(destroyTracked);

const NESTED = '<ul><li><p>aa</p><ul><li><p>xx</p></li></ul></li></ul>';
const SPACING = '{spaceBefore=6,spaceAfter=12}';

/** The nested list with spacing on every item, the caret in a new empty item after xx. */
const emptyNestedItem = (version: number) => {
  const editor = track(makeEditor(version, NESTED));
  editor.commands.setTextSelection({
    from: 1,
    to: editor.state.doc.content.size - 1,
  });
  editor.commands.setParagraphSpacing({ spaceBefore: 6, spaceAfter: 12 });
  editor.commands.setTextSelection(endOf(editor, 'xx'));
  pressEnter(editor);
  return editor;
};

const listShape = (editor: Editor) =>
  flatShape(editor).replace(/ p(\{[^}]*\})?\(\)$/, '');

describe.each([1, 2])('Enter out of a nested list (schema v%i)', (version) => {
  it('moves the empty item out one level with its spacing', () => {
    const editor = emptyNestedItem(version);
    pressEnter(editor);
    expect(listShape(editor)).toBe(
      `ul(li${SPACING}(p("aa") ul(li${SPACING}(p("xx")))) li${SPACING}(p{caretMarks=[]}()))`,
    );
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
    expectValid(editor, version);
  });

  it('keeps the spacing on the items typed after it', () => {
    const editor = emptyNestedItem(version);
    pressEnter(editor);
    type(editor, 'nn');
    pressEnter(editor);
    type(editor, 'mm');
    expect(listShape(editor)).toBe(
      `ul(li${SPACING}(p("aa") ul(li${SPACING}(p("xx")))) li${SPACING}(p{caretMarks=[]}("nn")) li${SPACING}(p{caretMarks=[]}("mm")))`,
    );
  });

  it('splits the empty line off an item with other content, which stays nested (PR597-1)', () => {
    const editor = track(
      makeEditor(
        version,
        '<ul><li><p>parent</p><ul><li><p>content</p><p></p></li></ul></li></ul>',
      ),
    );
    editor.commands.setTextSelection({
      from: 1,
      to: editor.state.doc.content.size - 1,
    });
    editor.commands.setParagraphSpacing({ spaceBefore: 6, spaceAfter: 12 });
    editor.commands.setTextSelection(endOf(editor, 'content') + 2);
    pressEnter(editor);
    expect(listShape(editor).replace(/\{caretMarks=[^}]*\}/g, '')).toBe(
      `ul(li${SPACING}(p("parent") ul(li${SPACING}(p("content")))) li${SPACING}(p()))`,
    );
    expect(editor.state.selection.$from.parent.content.size).toBe(0);
    expectValid(editor, version);
  });

  it('does the same for a checklist item with other content', () => {
    const editor = track(
      makeEditor(
        version,
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>parent</p><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>content</p><p></p></li></ul></li></ul>',
      ),
    );
    editor.commands.setTextSelection(endOf(editor, 'content') + 2);
    pressEnter(editor);
    expect(listShape(editor).replace(/\{caretMarks=[^}]*\}/g, '')).toBe(
      'tl(ti(p("parent") tl(ti(p("content")))) ti(p()))',
    );
    expectValid(editor, version);
  });

  it('undoes in one step', () => {
    const editor = emptyNestedItem(version);
    const before = flatShape(editor);
    undoManager(editor).stopCapturing();
    pressEnter(editor);
    editor.commands.undo();
    expect(flatShape(editor)).toBe(before);
  });
});
