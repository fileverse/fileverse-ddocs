import { describe, it, expect, afterEach } from 'vitest';
import {
  destroyTracked,
  pressEnter,
  startOf,
} from '../caret-marks/test-helpers';
import { sharedList, listAtSelection } from './shared';
import {
  makeListEditor,
  shape,
  flatShape,
  caretIn,
  rangeOver,
  selectionText,
  selectNode,
  expectValid,
} from './test-helpers';

afterEach(destroyTracked);

const NESTED =
  '<ul><li><p>aa</p></li><li><p>bb</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';
const LIST3 = '<ul><li><p>aa</p></li><li><p>bb</p></li><li><p>cc</p></li></ul>';

describe.each([1, 2])('list toggle helpers (schema v%i)', (version) => {
  it('sharedList finds the innermost list containing both ends', () => {
    const { editor } = makeListEditor(version, NESTED);
    rangeOver(editor, 'xx', 'yy');
    let { $from, $to } = editor.state.selection;
    expect(sharedList($from, $to)?.node.firstChild?.textContent).toBe('xx');

    rangeOver(editor, 'xx', 'cc');
    ({ $from, $to } = editor.state.selection);
    expect(sharedList($from, $to)?.node.firstChild?.textContent).toBe('aa');

    editor.commands.setContent('<p>aa</p><ul><li><p>bb</p></li></ul>');
    rangeOver(editor, 'aa', 'bb');
    ({ $from, $to } = editor.state.selection);
    expect(sharedList($from, $to)).toBeNull();
  });

  it('listAtSelection names the list and item node a toggle-off acts on', () => {
    const { editor } = makeListEditor(
      version,
      '<ul data-type="taskList"><li data-type="taskItem"><p>aa</p></li></ul><p>bb</p>',
    );
    caretIn(editor, 'aa');
    expect(listAtSelection(editor.state)).toEqual({
      listType: 'taskList',
      itemType: 'taskItem',
    });
    caretIn(editor, 'bb');
    expect(listAtSelection(editor.state)).toBeNull();
  });

  it('listAtSelection agrees on a NodeSelection of a whole item', () => {
    const { editor } = makeListEditor(version, LIST3);
    selectNode(editor, 'listItem', 'cc');
    expect(listAtSelection(editor.state)).toEqual({
      listType: 'bulletList',
      itemType: 'listItem',
    });
  });
});

describe.each([1, 2])('list toggle refusals (schema v%i)', (version) => {
  const PARKED = [
    ['paragraph + list', '<p>aa</p><ul><li><p>bb</p></li></ul>', 'aa', 'bb'],
    [
      'two lists',
      '<ul><li><p>aa</p></li></ul><ol><li><p>bb</p></li></ol>',
      'aa',
      'bb',
    ],
    ['hr in range', '<p>aa</p><hr><p>bb</p>', 'aa', 'bb'],
  ] as const;

  it.each(PARKED)('%s → false, document unchanged', (_label, html, a, b) => {
    const { editor } = makeListEditor(version, html);
    rangeOver(editor, a, b);
    const before = shape(editor);
    expect(editor.commands.toggleBulletList()).toBe(false);
    expect(shape(editor)).toBe(before);
    expect(editor.can().toggleBulletList()).toBe(false);
    expect(shape(editor)).toBe(before);
  });

  it('a refused toggle cancels the whole chain, including an earlier deleteRange', () => {
    const { editor } = makeListEditor(
      version,
      '<p>/aa</p><ul><li><p>bb</p></li></ul>',
    );
    rangeOver(editor, '/aa', 'bb');
    const before = shape(editor);
    const slash = startOf(editor, '/aa');
    const ok = editor
      .chain()
      .focus()
      .deleteRange({ from: slash, to: slash + 1 })
      .toggleBulletList()
      .run();
    expect(ok).toBe(false);
    expect(shape(editor)).toBe(before);
  });

  it('wraps a single paragraph', () => {
    const { editor } = makeListEditor(version, '<p>aa</p><p>bb</p>');
    caretIn(editor, 'aa');
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(flatShape(editor)).toBe('ul(li(p("aa"))) p("bb")');
    expectValid(editor, version);
  });
});

describe.each([1, 2])('wrap (schema v%i)', (version) => {
  it.each([
    ['bullet', 'toggleBulletList', 'ul(li(p("aa"))) p("bb")'],
    ['numbered', 'toggleOrderedList', 'ol(li(p("aa"))) p("bb")'],
    ['checklist', 'toggleTaskList', 'tl(ti(p("aa"))) p("bb")'],
  ] as const)('caret in a paragraph → %s', (_label, command, expected) => {
    const { editor } = makeListEditor(version, '<p>aa</p><p>bb</p>');
    caretIn(editor, 'aa');
    expect(editor.commands[command]()).toBe(true);
    expect(flatShape(editor)).toBe(expected);
    expectValid(editor, version);
  });

  it('a range over paragraph + heading + paragraph becomes one list of three items', () => {
    const { editor } = makeListEditor(
      version,
      '<p>aa</p><h2 style="text-align:center">bb</h2><p>cc</p>',
    );
    rangeOver(editor, 'aa', 'cc');
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa")) li(p{textAlign=center}("bb")) li(p("cc"))) p()',
    );
    expect(selectionText(editor)).toBe('a|bb|c');
    expectValid(editor, version);
  });

  it('the same range to a checklist', () => {
    const { editor } = makeListEditor(version, '<p>aa</p><h2>bb</h2><p>cc</p>');
    rangeOver(editor, 'aa', 'cc');
    expect(editor.commands.toggleTaskList()).toBe(true);
    expect(flatShape(editor)).toBe(
      'tl(ti(p("aa")) ti(p("bb")) ti(p("cc"))) p()',
    );
    expectValid(editor, version);
  });

  it('joins a same-type list before, after, and on both sides', () => {
    const { editor } = makeListEditor(
      version,
      '<ul><li><p>aa</p></li></ul><p>bb</p><ul><li><p>cc</p></li></ul>',
    );
    caretIn(editor, 'bb');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa")) li(p("bb")) li(p("cc"))) p()',
    );
    expectValid(editor, version);

    editor.commands.setContent('<ul><li><p>aa</p></li></ul><p>bb</p>');
    caretIn(editor, 'bb');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe('ul(li(p("aa")) li(p("bb"))) p()');
    expectValid(editor, version);

    editor.commands.setContent('<p>bb</p><ul><li><p>cc</p></li></ul>');
    caretIn(editor, 'bb');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe('ul(li(p("bb")) li(p("cc"))) p()');
    expectValid(editor, version);

    editor.commands.setContent('<ol><li><p>aa</p></li></ol><p>bb</p>');
    caretIn(editor, 'bb');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toBe('ol(li(p("aa"))) ul(li(p("bb"))) p()');
    expectValid(editor, version);
  });

  it('wraps inside a blockquote and inside a table cell', () => {
    const { editor } = makeListEditor(
      version,
      '<blockquote><p>aa</p><p>bb</p></blockquote>',
    );
    rangeOver(editor, 'aa', 'bb');
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(flatShape(editor)).toBe('bq(ul(li(p("aa")) li(p("bb")))) p()');
    expectValid(editor, version);

    editor.commands.setContent(
      '<table><tr><td><p>aa</p><p>bb</p></td><td><p>cc</p></td></tr></table>',
    );
    rangeOver(editor, 'aa', 'bb');
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(flatShape(editor)).toContain('ul(li(p("aa")) li(p("bb")))');
    expect(flatShape(editor)).toContain('p("cc")');
    expectValid(editor, version);
  });

  it('wraps two paragraphs inside one column', () => {
    const { editor } = makeListEditor(version, '<p>zz</p>');
    caretIn(editor, 'zz');
    editor.commands.setColumns(2);
    editor.commands.insertContent('aa');
    pressEnter(editor);
    editor.commands.insertContent('bb');
    rangeOver(editor, 'aa', 'bb');
    expect(editor.commands.toggleBulletList()).toBe(true);
    // "bb"'s empty line got an explicit caretMarks stamp from pressEnter
    // (caret-marks feature, unrelated to list wrap); insertContent never clears it.
    expect(flatShape(editor)).toContain(
      'col(ul(li(p("aa")) li(p{caretMarks=[]}("bb"))))',
    );
    expectValid(editor, version);
  });

  it('can() agrees with execution on a multi-block range', () => {
    const { editor } = makeListEditor(version, '<p>aa</p><p>bb</p><p>cc</p>');
    rangeOver(editor, 'aa', 'cc');
    const before = shape(editor);
    expect(editor.can().toggleBulletList()).toBe(true);
    expect(shape(editor)).toBe(before);
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa")) li(p("bb")) li(p("cc"))) p()',
    );
    expectValid(editor, version);
  });
});
