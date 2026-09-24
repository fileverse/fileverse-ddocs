import { describe, it, expect, afterEach } from 'vitest';
import { destroyTracked } from '../caret-marks/test-helpers';
import {
  makeListEditor,
  flatShape,
  selectionText,
  caretIn,
  rangeOver,
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
