import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  ySyncPluginKey,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap';
import {
  caretTo,
  destroyTracked,
  makeEditor,
  nativeDelete,
  startOf,
  track,
  type,
} from '../caret-marks/test-helpers';
import {
  addComment,
  makeListEditor,
  resolvedAnchors,
} from '../list-toggle/test-helpers';
import {
  createCommentAnchorPointFromEditor,
  resolveSuggestionAddPointInState,
} from './comment-decoration-plugin';
import {
  captureCursorPosition,
  resolveCursorPosition,
} from '../../utils/tab-position-memory';

// Probes for TIPTAP_UPGRADE.md §5.10.1: y-tiptap 3.0.6–3.0.9 resolved an
// item-based position at absolute ≤ 1 to null. The first text position is 1
// in v2 and 2 in v1 (dBlock). Rule: Keep.

afterEach(destroyTracked);

const HTML = '<p>Hello</p><p>World</p>';
const FIRST_TEXT_POS: Record<number, number> = { 1: 2, 2: 1 };

describe.each([1, 2])('schema v%i', (version) => {
  const firstTextPos = FIRST_TEXT_POS[version];

  it('has the first text position the probes assume', () => {
    const { editor } = makeListEditor(version, HTML);
    expect(startOf(editor, 'Hello')).toBe(firstTextPos);
  });

  it('keeps a comment on "ello" after deleting "H"', () => {
    const h = makeListEditor(version, HTML);
    addComment(h, 'c1', 'ello');
    nativeDelete(h.editor, firstTextPos, firstTextPos + 1);
    expect(resolvedAnchors(h)).toBe('c1:ello');
  });

  it('resolves a point anchor at the first text position', () => {
    const { editor } = makeListEditor(version, HTML);
    const points = ([1, -1] as const).map((assoc) => {
      const relative = createCommentAnchorPointFromEditor(
        editor,
        firstTextPos,
        assoc,
      );
      expect(relative).not.toBeNull();
      return resolveSuggestionAddPointInState(
        { id: 's1', resolved: false, deleted: false, ...relative! },
        editor.state,
        [],
      );
    });
    expect(points).toEqual([firstTextPos, firstTextPos]);
  });

  it('keeps a comment spanning the first character when typing before it', () => {
    const h = makeListEditor(version, HTML);
    addComment(h, 'c1', 'Hel');
    caretTo(h.editor, firstTextPos);
    type(h.editor, 'x');
    expect(h.editor.state.doc.textContent).toBe('xHelloWorld');
    // anchorFrom is index 0 of the text with assoc -1, so it stays at the
    // text start and the range takes in the typed x.
    expect(resolvedAnchors(h)).toBe('c1:xHel');
  });

  it('restores a caret at the first text position after a tab remount', () => {
    const ydoc = new Y.Doc();
    const first = makeEditor(version, HTML, { ydoc });
    caretTo(first, firstTextPos);
    const cursor = captureCursorPosition(first)!;
    first.destroy();

    const editor = track(makeEditor(version, null, { ydoc }));
    expect(editor.state.doc.textContent).toBe('HelloWorld');
    // resolveCursorPosition falls back to the absolute offset, so read the
    // Yjs path directly to prove the relative position resolves.
    const sync = ySyncPluginKey.getState(editor.state);
    expect(
      relativePositionToAbsolutePosition(
        sync.doc,
        sync.type,
        cursor.relAnchor!,
        sync.binding.mapping,
      ),
    ).toBe(firstTextPos);
    expect(resolveCursorPosition(editor, cursor)).toEqual({
      anchor: firstTextPos,
      head: firstTextPos,
    });
  });
});
