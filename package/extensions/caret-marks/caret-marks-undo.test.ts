import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  caretTo,
  caretBlock,
  createdBlock,
  textblocks,
  stampOf,
  storedMarkNames,
  typedMarks,
  type,
  pressEnter,
  undoManager,
} from './test-helpers';

afterEach(destroyTracked);

// v1's dBlock Enter chains `focus()`, which scrolls the caret into view from a
// requestAnimationFrame — reached only here, because these tests await real
// timers, and jsdom leaves window.scrollBy unimplemented.
window.scrollBy = () => {};

// The UndoManager merges everything inside a 500ms window into one item.
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each([1, 2])('undo / redo (schema v%i)', (version) => {
  it('undoes and redoes Enter together with its stamp', async () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p>'));
    await settle();
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    await settle();
    expect(textblocks(editor).length).toBe(2);
    expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');

    editor.commands.undo();
    await settle(150);
    expect(textblocks(editor).length).toBe(1);
    expect(undoManager(editor).redoStack.length).toBe(1);

    editor.commands.redo();
    await settle(150);
    expect(textblocks(editor).length).toBe(2);
    expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');
  });

  it('round-trips format-then-clear on an empty line', async () => {
    const editor = track(makeEditor(version, '<p></p>'));
    await settle();
    editor.commands.toggleBold();
    await settle();
    editor.commands.toggleBold();
    await settle();
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    editor.commands.undo();
    await settle(150);
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    editor.commands.redo();
    await settle(150);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
  });

  it('keeps redo after an undo that empties the document', async () => {
    const editor = track(makeEditor(version, '<p></p>'));
    await settle();
    type(editor, 'abc');
    await settle();
    editor.commands.undo();
    await settle(150);
    expect(editor.state.doc.textContent).toBe('');
    expect(undoManager(editor).redoStack.length).toBe(1);
    editor.commands.redo();
    await settle(150);
    expect(editor.state.doc.textContent).toBe('abc');
  });
});

describe.each([1, 2])('collaborator pair (schema v%i)', (version) => {
  const pair = () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = track(makeEditor(version, '<p></p>', { ydoc: docA }));
    const b = track(makeEditor(version, null, { ydoc: docB }));
    const sync = () => {
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    };
    sync();
    return { a, b, sync };
  };

  it('a stamp written by one client renders the same empty-line font on the other', () => {
    const { a, b, sync } = pair();
    a.commands.setFontSize('24px');
    sync();
    const p = b.view.dom.querySelector('p') as HTMLParagraphElement;
    expect(p.style.fontSize).toBe('24px');
    expect(stampOf(textblocks(b)[0].node)).toContain('24px');
  });

  it('a remote update while the caret is on an empty line adds no local history item', () => {
    const { a, b, sync } = pair();
    b.commands.setTextSelection(textblocks(b)[0].pos + 1);
    const before = undoManager(b).undoStack.length;
    a.commands.setFontSize('24px');
    sync();
    expect(undoManager(b).undoStack.length).toBe(before);
    expect(storedMarkNames(b)).toEqual(['textStyle']);
    expect(typedMarks(b)).toEqual(['textStyle']);
  });
});
