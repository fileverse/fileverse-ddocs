import { describe, it, expect, afterEach } from 'vitest';
import { destroyTracked, startOf } from '../caret-marks/test-helpers';
import { sharedList, listAtSelection } from './shared';
import {
  makeListEditor,
  shape,
  flatShape,
  caretIn,
  rangeOver,
  expectValid,
} from './test-helpers';

afterEach(destroyTracked);

const NESTED =
  '<ul><li><p>aa</p></li><li><p>bb</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';

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

  it('still wraps a single paragraph (stock path for now)', () => {
    const { editor } = makeListEditor(version, '<p>aa</p><p>bb</p>');
    caretIn(editor, 'aa');
    expect(editor.commands.toggleBulletList()).toBe(true);
    expect(flatShape(editor)).toBe('ul(li(p("aa"))) p("bb")');
    expectValid(editor, version);
  });
});
