// @vitest-environment jsdom
import { beforeEach, describe, expect, it, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import {
  captureCursorPosition,
  clearTabPositionStore,
  computeCenteredScrollTop,
  getTabPosition,
  getTabPositionKey,
  hasTabInteraction,
  markTabInteracted,
  recordTabCursor,
  recordTabScrollFallback,
  resolveCursorPosition,
} from './tab-position-memory';

const createTabEditor = (ydoc: Y.Doc, field: string) =>
  new Editor({ extensions: getHeadlessExtensions({ ydoc, field }) });

describe('tab position store', () => {
  beforeEach(() => clearTabPositionStore());

  it('builds keys from ddocId and tabId with a fallback ddoc segment', () => {
    expect(getTabPositionKey('doc-1', 'tab-a')).toBe('doc-1::tab-a');
    expect(getTabPositionKey(undefined, 'tab-a')).toBe('ddoc::tab-a');
  });

  it('rejects cursor recordings until the tab is marked interacted (Q9)', () => {
    const key = getTabPositionKey('doc-1', 'tab-a');
    const cursor = {
      relAnchor: null,
      relHead: null,
      absAnchor: 5,
      absHead: 5,
      docGuid: null,
    };
    expect(recordTabCursor(key, cursor)).toBe(false);
    expect(getTabPosition(key)?.cursor).toBeUndefined();

    markTabInteracted(key);
    expect(hasTabInteraction(key)).toBe(true);
    expect(recordTabCursor(key, cursor)).toBe(true);
    expect(getTabPosition(key)?.cursor).toEqual(cursor);
  });

  it('records the scroll fallback regardless of interaction', () => {
    const key = getTabPositionKey('doc-1', 'tab-a');
    recordTabScrollFallback(key, 480);
    expect(getTabPosition(key)?.scrollTop).toBe(480);
    expect(getTabPosition(key)?.interacted).toBe(false);
  });
});

describe('capture/resolve cursor positions', () => {
  let ydoc: Y.Doc | null = null;
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    ydoc?.destroy();
    editor = null;
    ydoc = null;
  });

  it('round-trips a selection through relative positions', () => {
    ydoc = new Y.Doc();
    editor = createTabEditor(ydoc, 'tab-a');
    editor.commands.insertContent('hello world, this is tab a');
    editor.commands.setTextSelection(8);

    const cursor = captureCursorPosition(editor);
    expect(cursor).not.toBeNull();
    expect(cursor!.relAnchor).not.toBeNull();
    expect(cursor!.absHead).toBe(8);

    expect(resolveCursorPosition(editor, cursor!)).toEqual({
      anchor: 8,
      head: 8,
    });
  });

  it('relative positions survive edits made before the caret', () => {
    ydoc = new Y.Doc();
    editor = createTabEditor(ydoc, 'tab-a');
    editor.commands.insertContent('hello world');
    editor.commands.setTextSelection(8);
    const charAtCursor = editor.state.doc.textBetween(8, 9);
    const cursor = captureCursorPosition(editor);

    // Simulate an edit landing while the tab is "hidden".
    editor.commands.insertContentAt(1, 'XXXX');

    const resolved = resolveCursorPosition(editor, cursor!);
    expect(resolved!.head).toBeGreaterThan(8); // shifted forward, not stale
    expect(
      editor.state.doc.textBetween(resolved!.head, resolved!.head + 1),
    ).toBe(charAtCursor); // still points at the same character
  });

  it('clamps to the document when relative resolution is unavailable', () => {
    ydoc = new Y.Doc();
    editor = createTabEditor(ydoc, 'tab-a');
    editor.commands.insertContent('short');

    const stale = {
      relAnchor: null,
      relHead: null,
      absAnchor: 10_000,
      absHead: 10_000,
      docGuid: null,
    };
    const resolved = resolveCursorPosition(editor, stale);
    const maxPos = editor.state.doc.content.size;
    expect(resolved!.anchor).toBe(maxPos);
    expect(resolved!.head).toBe(maxPos);
  });

  it('refuses to resolve a cursor captured against a different Y.Doc', () => {
    ydoc = new Y.Doc();
    editor = createTabEditor(ydoc, 'tab-a');
    editor.commands.insertContent('doc one');
    editor.commands.setTextSelection(4);
    const cursor = captureCursorPosition(editor);
    expect(cursor!.docGuid).not.toBeNull();

    const otherYdoc = new Y.Doc();
    const otherEditor = createTabEditor(otherYdoc, 'tab-a');
    otherEditor.commands.insertContent('doc two');
    expect(resolveCursorPosition(otherEditor, cursor!)).toBeNull();
    otherEditor.destroy();
    otherYdoc.destroy();
  });
});

describe('computeCenteredScrollTop', () => {
  it('centers the caret in the container', () => {
    expect(
      computeCenteredScrollTop({
        caretTop: 900,
        containerTop: 100,
        containerClientHeight: 600,
        currentScrollTop: 250,
      }),
    ).toBe(250 + 800 - 300);
  });

  it('never returns a negative offset', () => {
    expect(
      computeCenteredScrollTop({
        caretTop: 110,
        containerTop: 100,
        containerClientHeight: 600,
        currentScrollTop: 0,
      }),
    ).toBe(0);
  });
});
