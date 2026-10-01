import { describe, it, expect, afterEach } from 'vitest';
import { destroyTracked, undoManager } from '../caret-marks/test-helpers';
import {
  makeListEditor,
  flatShape,
  shape,
  caretIn,
  rangeOver,
  setAttrs,
  addComment,
  decorated,
  resolvedAnchors,
  expectValid,
} from './test-helpers';

afterEach(destroyTracked);

// The Yjs UndoManager groups by captureTimeout; real waits keep steps separate
// (see caret-marks-undo.test.ts).
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

const LIST3 = '<ul><li><p>aa</p></li><li><p>bb</p></li><li><p>cc</p></li></ul>';
const NESTED =
  '<ul><li><p>aa</p></li><li><p>bb</p><ul><li><p>xx</p></li><li><p>yy</p></li></ul></li><li><p>cc</p></li></ul>';

const commentAll = (harness: ReturnType<typeof makeListEditor>) => {
  addComment(harness, 'ca', 'aa');
  addComment(harness, 'cb', 'bb');
  addComment(harness, 'cc', 'cc');
};

// The ProseMirror layer: no step covers anchored text, so the comment store
// never classifies a comment as deleted and the mapped range stays exact.
describe.each([1, 2])(
  'comment anchors, ProseMirror layer (schema v%i)',
  (version) => {
    it('survive a toggle off of the middle item', () => {
      const harness = makeListEditor(version, LIST3);
      commentAll(harness);
      caretIn(harness.editor, 'bb');
      harness.editor.commands.toggleBulletList();
      expect(decorated(harness.editor)).toBe('ca:aa cb:bb cc:cc');
      expectValid(harness.editor, version);
    });

    it('survive a toggle off of a whole list with a sub-list', () => {
      const harness = makeListEditor(version, NESTED);
      commentAll(harness);
      addComment(harness, 'cx', 'xx');
      rangeOver(harness.editor, 'aa', 'cc');
      harness.editor.commands.toggleBulletList();
      expect(decorated(harness.editor)).toBe('ca:aa cb:bb cc:cc cx:xx');
      expectValid(harness.editor, version);
    });

    it('survive both retypes and a wrap', () => {
      const harness = makeListEditor(version, LIST3);
      commentAll(harness);
      rangeOver(harness.editor, 'aa', 'bb');
      harness.editor.commands.toggleTaskList();
      expect(decorated(harness.editor)).toBe('ca:aa cb:bb cc:cc');
      expectValid(harness.editor, version);
      caretIn(harness.editor, 'cc');
      harness.editor.commands.toggleOrderedList();
      expect(decorated(harness.editor)).toBe('ca:aa cb:bb cc:cc');
      expectValid(harness.editor, version);

      const wrap = makeListEditor(version, '<p>aa</p><p>bb</p><p>cc</p>');
      commentAll(wrap);
      rangeOver(wrap.editor, 'aa', 'cc');
      wrap.editor.commands.toggleBulletList();
      expect(decorated(wrap.editor)).toBe('ca:aa cb:bb cc:cc');
      expectValid(wrap.editor, version);
    });

    it('a suggestion anchor survives a toggle off', () => {
      const harness = makeListEditor(version, LIST3);
      addComment(harness, 's1', 'bb', {
        isSuggestion: true,
        suggestionType: 'replace',
        originalContent: 'bb',
        suggestedContent: 'BB',
      });
      caretIn(harness.editor, 'bb');
      harness.editor.commands.toggleBulletList();
      expect(decorated(harness.editor)).toBe('s1:bb');
      expectValid(harness.editor, version);
    });
  },
);

describe.each([1, 2])('caretMarks survival (schema v%i)', (version) => {
  it('survives a wrap, a retype to checklist, and a toggle off', () => {
    const { editor } = makeListEditor(version, '<p>aa</p><p>bb</p>');
    setAttrs(editor, 'paragraph', 'aa', { caretMarks: '[{"type":"bold"}]' });

    caretIn(editor, 'aa');
    editor.commands.toggleBulletList();
    expect(flatShape(editor)).toContain('caretMarks=[{"type":"bold"}]');
    expectValid(editor, version);

    caretIn(editor, 'aa');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toContain('caretMarks=[{"type":"bold"}]');
    expectValid(editor, version);

    caretIn(editor, 'aa');
    editor.commands.toggleTaskList();
    expect(flatShape(editor)).toContain('caretMarks=[{"type":"bold"}]');
    expectValid(editor, version);
  });
});

describe.each([1, 2])('undo, redo and the shortcut (schema v%i)', (version) => {
  it.each([
    [
      'wrap',
      '<p>aa</p><p>bb</p><p>cc</p>',
      (e: import('@tiptap/react').Editor) => {
        rangeOver(e, 'aa', 'cc');
        e.commands.toggleBulletList();
      },
    ],
    [
      'toggle off',
      NESTED,
      (e: import('@tiptap/react').Editor) => {
        caretIn(e, 'bb');
        e.commands.toggleBulletList();
      },
    ],
    [
      'retype',
      LIST3,
      (e: import('@tiptap/react').Editor) => {
        rangeOver(e, 'aa', 'bb');
        e.commands.toggleTaskList();
      },
    ],
  ])('%s is one undo step, and redo restores it', (_label, html, act) => {
    const { editor } = makeListEditor(version, html);
    undoManager(editor).stopCapturing();
    const before = shape(editor);
    act(editor);
    const after = shape(editor);
    expect(after).not.toBe(before);
    expect(editor.commands.undo()).toBe(true);
    expect(shape(editor)).toBe(before);
    expect(editor.commands.redo()).toBe(true);
    expect(shape(editor)).toBe(after);
    expectValid(editor, version);
  });

  it('anchors survive undo of a toggle off', async () => {
    const harness = makeListEditor(version, LIST3);
    commentAll(harness);
    undoManager(harness.editor).stopCapturing();
    await settle();
    caretIn(harness.editor, 'bb');
    harness.editor.commands.toggleBulletList();
    await settle();
    harness.editor.commands.undo();
    await settle();
    expect(decorated(harness.editor)).toBe('ca:aa cb:bb cc:cc');
    expectValid(harness.editor, version);
  });

  it('Mod-Shift-8 reaches the engine', () => {
    const { editor } = makeListEditor(version, '<p>aa</p><p>bb</p><p>cc</p>');
    rangeOver(editor, 'aa', 'cc');
    // keyboardShortcut() replays via a remapped capture that mangles a
    // multi-step transaction; dispatch the real keydown instead (jsdom is
    // not a Mac, so Mod is Ctrl).
    const handled = editor.view.someProp('handleKeyDown', (f) =>
      f(
        editor.view,
        new KeyboardEvent('keydown', {
          key: '8',
          code: 'Digit8',
          ctrlKey: true,
          shiftKey: true,
        }),
      ),
    );
    expect(handled).toBe(true);
    expect(flatShape(editor)).toBe(
      'ul(li(p("aa")) li(p("bb")) li(p("cc"))) p()',
    );
    expectValid(editor, version);
  });
});

// KNOWN GAP (TEC-3181, docs/LIST_TOGGLE.md §2): y-prosemirror re-creates the
// Yjs subtree on any node type change, so the RelativePositions inside die.
// These flip to "expected to fail but passed" once TEC-3181 re-anchors them.
describe.each([1, 2])(
  'comment anchors, Yjs layer (TEC-3181, schema v%i)',
  (version) => {
    it('the instrument: typing keeps the Yjs anchors', () => {
      const harness = makeListEditor(version, LIST3);
      commentAll(harness);
      caretIn(harness.editor, 'bb');
      harness.editor.commands.insertContent('X');
      expect(resolvedAnchors(harness)).toBe('ca:aa cb:bb cc:cc');
    });

    it.fails('retype to numbered keeps the Yjs anchors', () => {
      const harness = makeListEditor(version, LIST3);
      commentAll(harness);
      caretIn(harness.editor, 'bb');
      harness.editor.commands.toggleOrderedList();
      expect(resolvedAnchors(harness)).toBe('ca:aa cb:bb cc:cc');
    });

    it.fails('wrap keeps the Yjs anchors', () => {
      const harness = makeListEditor(version, '<p>aa</p><p>bb</p><p>cc</p>');
      commentAll(harness);
      rangeOver(harness.editor, 'aa', 'cc');
      harness.editor.commands.toggleBulletList();
      expect(resolvedAnchors(harness)).toBe('ca:aa cb:bb cc:cc');
    });

    it.fails('toggle off of the middle item keeps the Yjs anchors', () => {
      const harness = makeListEditor(version, LIST3);
      commentAll(harness);
      caretIn(harness.editor, 'bb');
      harness.editor.commands.toggleBulletList();
      expect(resolvedAnchors(harness)).toBe('ca:aa cb:bb cc:cc');
    });

    it.fails('redo of a toggle off keeps the Yjs anchors', async () => {
      const harness = makeListEditor(version, LIST3);
      commentAll(harness);
      undoManager(harness.editor).stopCapturing();
      await settle();
      caretIn(harness.editor, 'bb');
      harness.editor.commands.toggleBulletList();
      await settle();
      harness.editor.commands.undo();
      await settle();
      harness.editor.commands.redo();
      await settle();
      expect(resolvedAnchors(harness)).toBe('ca:aa cb:bb cc:cc');
    });
  },
);
