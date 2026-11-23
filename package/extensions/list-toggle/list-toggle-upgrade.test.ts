import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  destroyTracked,
  endOf,
  pressKey,
  startOf,
} from '../caret-marks/test-helpers';
import {
  addComment,
  caretIn,
  expectValid,
  makeListEditor,
  resolvedAnchors,
  shape,
} from './test-helpers';

// Probes for TIPTAP_UPGRADE.md §5.1, §5.2, §5.3 and §5.16 (list Delete). They
// pin 3.11's behaviour through the real keydown chain; a bump that changes
// one is decided in the spec, never by `vitest -u`.

afterEach(destroyTracked);

const LIST3 = '<ul><li><p>aa</p></li><li><p>bb</p></li><li><p>cc</p></li></ul>';
const SUBLIST =
  '<ul><li><p>aa</p></li><li><p>bb</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';
const BRANCHING =
  '<ul><li><p>aa</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';

const TASK = (checked: boolean) =>
  `<ul data-type="taskList"><li data-type="taskItem" data-checked="${checked}"><p>aa</p></li></ul>`;
const TWO_TASKS =
  '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>aa</p></li><li data-type="taskItem" data-checked="true"><p>bb</p></li></ul>';
const AFTER = {
  bullet: '<ul><li><p>aa</p></li></ul><p>pp</p>',
  ordered: '<ol><li><p>aa</p></li></ol><p>pp</p>',
  task: `${TASK(false)}<p>pp</p>`,
};

const pressShiftTab = (editor: Editor) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Tab',
    shiftKey: true,
    bubbles: true,
    cancelable: true,
  });
  return (
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
  );
};

const caretAtStart = (editor: Editor, text: string) =>
  editor.commands.setTextSelection(startOf(editor, text));

const nodesOf = (editor: Editor, ...types: string[]) => {
  const found: ProseMirrorNode[] = [];
  editor.state.doc.descendants((node, _pos, parent) => {
    if (!types.includes(node.type.name)) return;
    if (node.type.name !== 'paragraph' || parent?.type.name === 'listItem') {
      found.push(node);
    }
  });
  return found;
};

describe.each([1, 2])('list Enter, §5.1 (schema v%i)', (version) => {
  it.each([true, false])(
    'Enter at the start of a task item (checked=%s) gives each half its own checked',
    (checked) => {
      const { editor } = makeListEditor(version, TASK(checked));
      caretAtStart(editor, 'aa');
      expect(pressKey(editor, 'Enter')).toBe(true);
      const items = nodesOf(editor, 'taskItem').map(
        (item) => `${item.textContent || '(empty)'}:${item.attrs.checked}`,
      );
      expect(items).toMatchSnapshot();
      expectValid(editor, version);
    },
  );

  it('Enter at the start of an item keeps paragraph attrs and BlockId unique', () => {
    const { editor } = makeListEditor(
      version,
      '<ul><li><p style="font-family: Georgia; font-size: 24px">aa</p></li></ul>',
    );
    caretAtStart(editor, 'aa');
    expect(pressKey(editor, 'Enter')).toBe(true);

    const paragraphs = nodesOf(editor, 'paragraph');
    expect(
      paragraphs.map(
        (p) =>
          `${p.textContent || '(empty)'} font=${p.attrs.fontFamily}/${p.attrs.fontSize} caretMarks=${p.attrs.caretMarks}`,
      ),
    ).toMatchSnapshot();

    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.attrs.blockId) ids.push(node.attrs.blockId);
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toMatchSnapshot();
    expect(shape(editor)).toMatchSnapshot();
    expectValid(editor, version);
  });
});

describe.each([1, 2])('list Backspace, §5.2 (schema v%i)', (version) => {
  it.each([
    ['without a sublist', LIST3, 'bb'],
    ['with a sublist', SUBLIST, 'bb'],
    ['last item after a sublist', SUBLIST, 'cc'],
  ])('at the start of a non-first item, %s', (_name, html, text) => {
    const { editor } = makeListEditor(version, html);
    caretAtStart(editor, text);
    const handled = pressKey(editor, 'Backspace');
    expect({ handled, shape: shape(editor) }).toMatchSnapshot();
    expectValid(editor, version);
  });

  // Our Backspace handler only takes offset 0 of an item's first paragraph, so
  // these reach upstream's handleBackspace; anchors are the §5.16 check.
  it.each([
    [
      'offset 0 of a second paragraph in a non-first item',
      '<ul><li><p>aa</p></li><li><p>bb</p><p>cc</p></li></ul>',
      (editor: Editor) => caretAtStart(editor, 'cc'),
    ],
    [
      'a range spanning two items',
      LIST3,
      (editor: Editor) =>
        editor.commands.setTextSelection({
          from: endOf(editor, 'aa') - 1,
          to: startOf(editor, 'bb') + 1,
        }),
    ],
    [
      'offset 0 of a paragraph right after a list',
      '<ul><li><p>aa</p></li><li><p>bb</p></li></ul><p>pp</p>',
      (editor: Editor) => caretAtStart(editor, 'pp'),
    ],
  ])('reaching upstream: %s', (_name, html, place) => {
    const h = makeListEditor(version, html);
    ['aa', 'bb', 'cc', 'pp'].forEach((text) => {
      try {
        addComment(h, `c${text}`, text);
      } catch {
        // text not in this fixture
      }
    });
    place(h.editor);
    const handled = pressKey(h.editor, 'Backspace');
    expect({
      handled,
      shape: shape(h.editor),
      anchors: resolvedAnchors(h),
    }).toMatchSnapshot();
    expectValid(h.editor, version);
  });
});

describe.each([1, 2])('list Delete, §5.2 and §5.16 (schema v%i)', (version) => {
  it('at the end of an item followed by a branching nested sublist', () => {
    const h = makeListEditor(version, BRANCHING);
    addComment(h, 'ca', 'aa');
    addComment(h, 'cx', 'xx');
    addComment(h, 'cy', 'yy');
    caretIn(h.editor, 'aa');
    const handled = pressKey(h.editor, 'Delete');
    expect({
      handled,
      shape: shape(h.editor),
      anchors: resolvedAnchors(h),
    }).toMatchSnapshot();
    expectValid(h.editor, version);
  });

  it('at the end of an item with no sublist', () => {
    const h = makeListEditor(version, LIST3);
    addComment(h, 'ca', 'aa');
    addComment(h, 'cb', 'bb');
    caretIn(h.editor, 'aa');
    const handled = pressKey(h.editor, 'Delete');
    expect({
      handled,
      shape: shape(h.editor),
      anchors: resolvedAnchors(h),
    }).toMatchSnapshot();
    expectValid(h.editor, version);
  });

  it('with a selection starting at an item end', () => {
    const h = makeListEditor(version, LIST3);
    addComment(h, 'ca', 'aa');
    addComment(h, 'cb', 'bb');
    addComment(h, 'cc', 'cc');
    h.editor.commands.setTextSelection({
      from: endOf(h.editor, 'aa'),
      to: startOf(h.editor, 'bb') + 1,
    });
    expect(h.editor.state.selection.empty).toBe(false);
    const handled = pressKey(h.editor, 'Delete');
    expect({
      handled,
      shape: shape(h.editor),
      anchors: resolvedAnchors(h),
    }).toMatchSnapshot();
    expectValid(h.editor, version);
  });
});

describe.each([1, 2])('Tab and Shift-Tab, §5.3 (schema v%i)', (version) => {
  it.each(Object.entries(AFTER))(
    'Tab at offset 0 of a paragraph right after a %s list',
    (_name, html) => {
      const { editor } = makeListEditor(version, html);
      caretAtStart(editor, 'pp');
      const handled = pressKey(editor, 'Tab');
      expect({ handled, shape: shape(editor) }).toMatchSnapshot();
      expectValid(editor, version);
    },
  );

  it.each(Object.entries(AFTER))(
    'Shift-Tab at offset 0 of a paragraph right after a %s list',
    (_name, html) => {
      const { editor } = makeListEditor(version, html);
      caretAtStart(editor, 'pp');
      const handled = pressShiftTab(editor);
      expect({ handled, shape: shape(editor) }).toMatchSnapshot();
      expectValid(editor, version);
    },
  );

  it.each([
    ['a later item', LIST3, 'bb'],
    ['the first item', LIST3, 'aa'],
    ['a later task item', TWO_TASKS, 'bb'],
  ])('Tab inside %s', (_name, html, text) => {
    const { editor } = makeListEditor(version, html);
    caretAtStart(editor, text);
    const handled = pressKey(editor, 'Tab');
    expect({ handled, shape: shape(editor) }).toMatchSnapshot();
    expectValid(editor, version);
  });

  it.each([
    ['a nested item', SUBLIST, 'yy'],
    ['a top-level item', LIST3, 'bb'],
  ])('Shift-Tab inside %s', (_name, html, text) => {
    const { editor } = makeListEditor(version, html);
    caretAtStart(editor, text);
    const handled = pressShiftTab(editor);
    expect({ handled, shape: shape(editor) }).toMatchSnapshot();
    expectValid(editor, version);
  });
});
