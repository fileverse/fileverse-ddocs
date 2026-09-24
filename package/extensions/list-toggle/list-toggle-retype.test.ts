import { describe, it, expect, afterEach } from 'vitest';
import { destroyTracked } from '../caret-marks/test-helpers';
import {
  makeListEditor,
  flatShape,
  selectionText,
  caretIn,
  rangeOver,
  setAttrs,
  selectNode,
  expectValid,
} from './test-helpers';

afterEach(destroyTracked);

const LIST3 = '<ul><li><p>aa</p></li><li><p>bb</p></li><li><p>cc</p></li></ul>';
const NESTED =
  '<ul><li><p>aa</p></li><li><p>bb</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';

describe.each([1, 2])('retype, same item node (schema v%i)', (version) => {
  it('bullet → numbered with a caret retypes the whole list', () => {
    const { editor } = makeListEditor(version, LIST3);
    caretIn(editor, 'bb');
    expect(editor.commands.toggleOrderedList()).toBe(true);
    expect(flatShape(editor)).toBe(
      'ol(li(p("aa")) li(p("bb")) li(p("cc"))) p()',
    );
    expectValid(editor, version);
  });

  it('from a nested item into an outer item retypes the outer list', () => {
    const { editor } = makeListEditor(version, NESTED);
    rangeOver(editor, 'xx', 'cc');
    editor.commands.toggleOrderedList();
    expect(flatShape(editor)).toBe(
      'ol(li(p("aa")) li(p("bb") ul(li(p("xx")) li(p("yy")))) li(p("cc"))) p()',
    );
    expect(selectionText(editor)).toBe('x|yy|c');
    expectValid(editor, version);
  });

  it('can() at the first item agrees with execution', () => {
    const { editor } = makeListEditor(version, LIST3);
    caretIn(editor, 'aa');
    expect(editor.can().toggleOrderedList()).toBe(true);
    expect(editor.commands.toggleOrderedList()).toBe(true);
    expectValid(editor, version);
  });

  it('joins numbered neighbours on both sides', () => {
    const { editor } = makeListEditor(
      version,
      '<ol><li><p>aa</p></li></ol><ul><li><p>bb</p></li></ul><ol><li><p>cc</p></li></ol>',
    );
    caretIn(editor, 'bb');
    editor.commands.toggleOrderedList();
    expect(flatShape(editor)).toBe(
      'ol(li(p("aa")) li(p("bb")) li(p("cc"))) p()',
    );
    expectValid(editor, version);
  });
});

describe.each([1, 2])('retype across item nodes (schema v%i)', (version) => {
  it('two of three bullets → checklist keeps attrs and moves the item gaps onto the paragraphs', () => {
    const { editor } = makeListEditor(
      version,
      '<ul><li><p style="text-align:center">aa</p></li><li><p>bb</p></li><li><p>cc</p></li></ul>',
    );
    setAttrs(editor, 'listItem', 'aa', { spaceAfter: 11 });
    setAttrs(editor, 'paragraph', 'aa', { lineHeight: '200%' });
    rangeOver(editor, 'aa', 'bb');
    expect(editor.commands.toggleTaskList()).toBe(true);
    expect(flatShape(editor)).toBe(
      'tl(ti(p{textAlign=center,lineHeight=200%,spaceAfter=11}("aa")) ti(p("bb"))) ul(li(p("cc"))) p()',
    );
    expect(selectionText(editor)).toBe('a|b');
    expectValid(editor, version);
  });

  it('checklist → bullet with a caret retypes that item only and moves the gaps onto the item', () => {
    const { editor } = makeListEditor(
      version,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p style="text-align:center">aa</p></li><li data-type="taskItem"><p>bb</p></li></ul>',
    );
    setAttrs(editor, 'paragraph', 'aa', { spaceBefore: 1, spaceAfter: 3 });
    caretIn(editor, 'aa');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe(
      'ul(li{spaceBefore=1,spaceAfter=3}(p{textAlign=center}("aa"))) tl(ti(p("bb"))) p()',
    );
    expectValid(editor, version);
  });

  it('an item with a sub-list keeps it; a nested item stays nested; the body is untouched', () => {
    const { editor } = makeListEditor(version, NESTED);
    caretIn(editor, 'bb');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa"))) tl(ti(p("bb") ul(li(p("xx")) li(p("yy"))))) ul(li(p("cc"))) p()',
    );
    expectValid(editor, version);

    editor.commands.setContent(NESTED);
    setAttrs(editor, 'paragraph', 'xx', {
      textAlign: 'center',
      lineHeight: '200%',
    });
    caretIn(editor, 'xx');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa")) li(p("bb") tl(ti(p{textAlign=center,lineHeight=200%}("xx"))) ul(li(p("yy")))) li(p("cc"))) p()',
    );
    expectValid(editor, version);
    caretIn(editor, 'xx');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa")) li(p("bb") ul(li(p{textAlign=center,lineHeight=200%}("xx")) li(p("yy")))) li(p("cc"))) p()',
    );
    expectValid(editor, version);

    editor.commands.setContent(
      '<ul><li><p>bb</p><ul><li><p>xx</p></li></ul><p>b2</p></li></ul>',
    );
    caretIn(editor, 'bb');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toBe(
      'tl(ti(p("bb") ul(li(p("xx"))) p("b2"))) p()',
    );
    expectValid(editor, version);
  });

  it('spacing collisions and round trips', () => {
    const { editor } = makeListEditor(version, NESTED);
    setAttrs(editor, 'listItem', 'bb', { spaceAfter: 7 });
    setAttrs(editor, 'paragraph', 'bb', { spaceAfter: 3 });
    caretIn(editor, 'bb');
    editor.commands.toggleTaskList();
    // the interior gap (3) stays; 7 has no paragraph home and is dropped by policy
    expect(flatShape(editor)).toContain('tl(ti(p{spaceAfter=3}("bb") ul(');
    expectValid(editor, version);
    caretIn(editor, 'bb');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa")) li(p{spaceAfter=3}("bb") ul(li(p("xx")) li(p("yy")))) li(p("cc"))) p()',
    );
    expectValid(editor, version);

    editor.commands.setContent('<ul><li><p>aa</p></li></ul>');
    setAttrs(editor, 'listItem', 'aa', { spaceBefore: 2, spaceAfter: 7 });
    setAttrs(editor, 'paragraph', 'aa', { spaceBefore: 1, spaceAfter: 3 });
    caretIn(editor, 'aa');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toBe(
      'tl(ti(p{spaceBefore=2,spaceAfter=7}("aa"))) p()',
    );
    expectValid(editor, version);
    caretIn(editor, 'aa');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe(
      'ul(li{spaceBefore=2,spaceAfter=7}(p("aa"))) p()',
    );
    expectValid(editor, version);
  });

  it('a NodeSelection on an item retypes exactly that item', () => {
    const { editor } = makeListEditor(version, LIST3);
    selectNode(editor, 'listItem', 'bb');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa"))) tl(ti(p("bb"))) ul(li(p("cc"))) p()',
    );
    expectValid(editor, version);
  });

  it('retype to checklist between numbered lists does not join', () => {
    const { editor } = makeListEditor(
      version,
      '<ol><li><p>aa</p></li></ol><ul><li><p>bb</p></li></ul><ol><li><p>cc</p></li></ol>',
    );
    caretIn(editor, 'bb');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toBe(
      'ol(li(p("aa"))) tl(ti(p("bb"))) ol(li(p("cc"))) p()',
    );
    expectValid(editor, version);
  });
});
