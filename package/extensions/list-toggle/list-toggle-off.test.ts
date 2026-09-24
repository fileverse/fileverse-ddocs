import { describe, it, expect, afterEach } from 'vitest';
import { destroyTracked, pressEnter } from '../caret-marks/test-helpers';
import {
  makeListEditor,
  flatShape,
  selectionText,
  caretIn,
  rangeOver,
  setAttrs,
  expectValid,
} from './test-helpers';

afterEach(destroyTracked);

const LIST3 = '<ul><li><p>aa</p></li><li><p>bb</p></li><li><p>cc</p></li></ul>';
const NESTED =
  '<ul><li><p>aa</p></li><li><p>bb</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';

describe.each([1, 2])(
  'toggle off at the list level (schema v%i)',
  (version) => {
    it('lifts the middle item; its sub-list becomes its own list; the next sibling keeps its own', () => {
      const { editor } = makeListEditor(version, NESTED);
      caretIn(editor, 'bb');
      expect(editor.commands.toggleBulletList()).toBe(true);
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa"))) p("bb") ul(li(p("xx")) li(p("yy"))) ul(li(p("cc"))) p()',
      );
      expect(editor.state.selection.$from.parent.textContent).toBe('bb');
      expectValid(editor, version);
    });

    it('keeps an ordered sub-list with its start and a checked task sub-list intact', () => {
      const { editor } = makeListEditor(
        version,
        '<ul><li><p>aa</p></li><li><p>bb</p><ol start="5"><li><p>xx</p></li></ol></li><li><p>cc</p></li></ul>',
      );
      caretIn(editor, 'bb');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa"))) p("bb") ol{start=5}(li(p("xx"))) ul(li(p("cc"))) p()',
      );
      expectValid(editor, version);

      editor.commands.setContent(
        '<ul><li><p>aa</p></li><li><p>bb</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>xx</p></li></ul></li><li><p>cc</p></li></ul>',
      );
      caretIn(editor, 'bb');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa"))) p("bb") tl(ti{checked=true}(p("xx"))) ul(li(p("cc"))) p()',
      );
      expectValid(editor, version);
    });

    it('a range over the first two items lifts both', () => {
      const { editor } = makeListEditor(version, NESTED);
      rangeOver(editor, 'aa', 'bb');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'p("aa") p("bb") ul(li(p("xx")) li(p("yy"))) ul(li(p("cc"))) p()',
      );
      expect(selectionText(editor)).toBe('a|b');
      expectValid(editor, version);
    });

    it('the whole list, the only item, the last item', () => {
      const { editor } = makeListEditor(version, NESTED);
      rangeOver(editor, 'aa', 'cc');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'p("aa") p("bb") ul(li(p("xx")) li(p("yy"))) p("cc") p()',
      );
      expectValid(editor, version);

      editor.commands.setContent('<ul><li><p>aa</p></li></ul>');
      caretIn(editor, 'aa');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe('p("aa") p()');
      expectValid(editor, version);

      editor.commands.setContent(LIST3);
      caretIn(editor, 'cc');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe('ul(li(p("aa")) li(p("bb"))) p("cc") p()');
      expectValid(editor, version);
    });

    it('a range from a nested item into an outer item acts on the outer list', () => {
      const { editor } = makeListEditor(version, NESTED);
      rangeOver(editor, 'xx', 'cc');
      expect(editor.commands.toggleBulletList()).toBe(true);
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa"))) p("bb") ul(li(p("xx")) li(p("yy"))) p("cc") p()',
      );
      expect(selectionText(editor)).toBe('x|yy|c');
      expectValid(editor, version);
    });

    it('every lifted paragraph keeps its item spacing, zero included', () => {
      const { editor } = makeListEditor(version, LIST3);
      setAttrs(editor, 'listItem', 'aa', { spaceAfter: 11 });
      setAttrs(editor, 'listItem', 'bb', { spaceAfter: 22 });
      setAttrs(editor, 'listItem', 'cc', { spaceAfter: 0 });
      rangeOver(editor, 'aa', 'cc');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'p{spaceAfter=11}("aa") p{spaceAfter=22}("bb") p{spaceAfter=0}("cc") p()',
      );
      expectValid(editor, version);
    });

    it('a multi-paragraph item: edges on the first and last paragraph', () => {
      const { editor } = makeListEditor(
        version,
        '<ul><li><p>aa</p></li><li><p>bb</p><p>b2</p></li><li><p>cc</p></li></ul>',
      );
      setAttrs(editor, 'listItem', 'bb', { spaceBefore: 2, spaceAfter: 7 });
      caretIn(editor, 'bb');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa"))) p{spaceBefore=2}("bb") p{spaceAfter=7}("b2") ul(li(p("cc"))) p()',
      );
      expectValid(editor, version);
    });

    it('a nested list between two paragraphs', () => {
      const { editor } = makeListEditor(
        version,
        '<ul><li><p>bb</p><ul><li><p>xx</p></li></ul><p>b2</p></li></ul>',
      );
      caretIn(editor, 'bb');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe('p("bb") ul(li(p("xx"))) p("b2") p()');
      expectValid(editor, version);
    });

    it('the item value wins over the paragraph value at an edge; an interior gap is untouched', () => {
      const { editor } = makeListEditor(version, '<ul><li><p>aa</p></li></ul>');
      setAttrs(editor, 'listItem', 'aa', { spaceAfter: 0 });
      setAttrs(editor, 'paragraph', 'aa', { spaceAfter: 5 });
      caretIn(editor, 'aa');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe('p{spaceAfter=0}("aa") p()');
      expectValid(editor, version);

      editor.commands.setContent(NESTED);
      setAttrs(editor, 'listItem', 'bb', { spaceAfter: 7 });
      setAttrs(editor, 'paragraph', 'bb', { spaceAfter: 3 });
      caretIn(editor, 'bb');
      editor.commands.toggleBulletList();
      // 7 has no paragraph home (the item ends with a sub-list): dropped by policy
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa"))) p{spaceAfter=3}("bb") ul(li(p("xx")) li(p("yy"))) ul(li(p("cc"))) p()',
      );
      expectValid(editor, version);
    });

    it('inside a blockquote and inside a column', () => {
      const { editor } = makeListEditor(
        version,
        '<blockquote><ul><li><p>aa</p><ul><li><p>xx</p></li></ul></li><li><p>bb</p></li></ul></blockquote>',
      );
      caretIn(editor, 'aa');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'bq(p("aa") ul(li(p("xx"))) ul(li(p("bb")))) p()',
      );
      expectValid(editor, version);

      editor.commands.setContent('<p>zz</p>');
      caretIn(editor, 'zz');
      editor.commands.setColumns(2);
      editor.commands.insertContent('aa');
      pressEnter(editor);
      editor.commands.insertContent('bb');
      rangeOver(editor, 'aa', 'bb');
      editor.commands.toggleBulletList();
      caretIn(editor, 'aa');
      editor.commands.toggleBulletList();
      // "bb"'s empty line carries the pressEnter caret-marks stamp (fixture artefact, see wrap test)
      expect(flatShape(editor)).toContain(
        'col(p("aa") ul(li(p{caretMarks=[]}("bb"))))',
      );
      expectValid(editor, version);
    });

    it('never joins after a toggle off', () => {
      const { editor } = makeListEditor(version, NESTED);
      caretIn(editor, 'bb');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toContain(
        'ul(li(p("xx")) li(p("yy"))) ul(li(p("cc")))',
      );
      expectValid(editor, version);
    });
  },
);

describe.each([1, 2])(
  'toggle off inside a nested list (schema v%i)',
  (version) => {
    it('same item node: lifts to the outer list, items after it re-nest', () => {
      const { editor } = makeListEditor(version, NESTED);
      setAttrs(editor, 'listItem', 'xx', { spaceAfter: 7 });
      caretIn(editor, 'xx');
      expect(editor.can().toggleBulletList()).toBe(true);
      expect(editor.commands.toggleBulletList()).toBe(true);
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa")) li(p("bb")) li{spaceAfter=7}(p("xx") ul(li(p("yy")))) li(p("cc"))) p()',
      );
      expectValid(editor, version);

      editor.commands.setContent(NESTED);
      rangeOver(editor, 'xx', 'yy');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa")) li(p("bb")) li(p("xx")) li(p("yy")) li(p("cc"))) p()',
      );
      expectValid(editor, version);
    });

    it('bullets inside a checklist item: unwrapped into the item, spacing on the paragraphs', () => {
      const html =
        '<ul data-type="taskList"><li data-type="taskItem"><p>aa</p><ul><li><p>bb</p></li><li><p>cc</p></li><li><p>dd</p></li></ul></li></ul>';
      const { editor } = makeListEditor(version, html);
      setAttrs(editor, 'listItem', 'bb', { spaceBefore: 2, spaceAfter: 7 });
      caretIn(editor, 'bb');
      expect(editor.can().toggleBulletList()).toBe(true);
      expect(editor.commands.toggleBulletList()).toBe(true);
      expect(flatShape(editor)).toBe(
        'tl(ti(p("aa") p{spaceBefore=2,spaceAfter=7}("bb") ul(li(p("cc")) li(p("dd"))))) p()',
      );
      expectValid(editor, version);

      editor.commands.setContent(html);
      setAttrs(editor, 'listItem', 'bb', { spaceBefore: 2, spaceAfter: 7 });
      setAttrs(editor, 'listItem', 'cc', { spaceBefore: 0, spaceAfter: 3 });
      rangeOver(editor, 'bb', 'cc');
      editor.commands.toggleBulletList();
      expect(flatShape(editor)).toBe(
        'tl(ti(p("aa") p{spaceBefore=2,spaceAfter=7}("bb") p{spaceBefore=0,spaceAfter=3}("cc") ul(li(p("dd"))))) p()',
      );
      expect(selectionText(editor)).toBe('b|c');
      expectValid(editor, version);
    });

    it('a checklist inside a bullet item: unwrapped, the paragraph keeps its own spacing', () => {
      const { editor } = makeListEditor(
        version,
        '<ul><li><p>aa</p><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>bb</p></li><li data-type="taskItem"><p>cc</p></li></ul></li></ul>',
      );
      setAttrs(editor, 'paragraph', 'bb', { spaceBefore: 5, spaceAfter: 6 });
      caretIn(editor, 'bb');
      editor.commands.toggleTaskList();
      expect(flatShape(editor)).toBe(
        'ul(li(p("aa") p{spaceBefore=5,spaceAfter=6}("bb") tl(ti(p("cc"))))) p()',
      );
      expectValid(editor, version);
    });
  },
);
