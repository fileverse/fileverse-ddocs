import { Editor } from '@tiptap/core';
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap';
import type * as Y from 'yjs';

export interface TabCursorPosition {
  relAnchor: Y.RelativePosition | null;
  relHead: Y.RelativePosition | null;
  absAnchor: number;
  absHead: number;
  docGuid: string | null;
}

export interface TabPositionEntry {
  cursor?: TabCursorPosition;
  scrollTop?: number;
  interacted: boolean;
}

// Session-only by design (docs/adr/tab-position-restore.md): module-level so it
// survives editor teardown/remount, gone on reload.
const tabPositionStore = new Map<string, TabPositionEntry>();

export const getTabPositionKey = (ddocId: string | undefined, tabId: string) =>
  `${ddocId ?? 'ddoc'}::${tabId}`;

const getOrCreateEntry = (key: string): TabPositionEntry => {
  let entry = tabPositionStore.get(key);
  if (!entry) {
    entry = { interacted: false };
    tabPositionStore.set(key, entry);
  }
  return entry;
};

export const markTabInteracted = (key: string) => {
  getOrCreateEntry(key).interacted = true;
};

export const hasTabInteraction = (key: string) =>
  tabPositionStore.get(key)?.interacted ?? false;

// Q9: cursors recorded before the first real user interaction are ignored so
// autofocus/default selections never shadow the scroll fallback.
export const recordTabCursor = (key: string, cursor: TabCursorPosition) => {
  const entry = tabPositionStore.get(key);
  if (!entry?.interacted) return false;
  entry.cursor = cursor;
  return true;
};

export const recordTabScrollFallback = (key: string, scrollTop: number) => {
  getOrCreateEntry(key).scrollTop = scrollTop;
};

export const getTabPosition = (key: string) => tabPositionStore.get(key);

export const clearTabPositionStore = () => tabPositionStore.clear();

export const captureCursorPosition = (
  editor: Editor,
): TabCursorPosition | null => {
  if (editor.isDestroyed) return null;
  const { state } = editor;
  const { anchor, head } = state.selection;
  const syncState = ySyncPluginKey.getState(state);
  if (syncState?.binding) {
    try {
      return {
        relAnchor: absolutePositionToRelativePosition(
          anchor,
          syncState.type,
          syncState.binding.mapping,
        ),
        relHead: absolutePositionToRelativePosition(
          head,
          syncState.type,
          syncState.binding.mapping,
        ),
        absAnchor: anchor,
        absHead: head,
        docGuid: syncState.doc?.guid ?? null,
      };
    } catch {
      // fall through to absolute-only
    }
  }
  return {
    relAnchor: null,
    relHead: null,
    absAnchor: anchor,
    absHead: head,
    docGuid: null,
  };
};

export const resolveCursorPosition = (
  editor: Editor,
  cursor: TabCursorPosition,
): { anchor: number; head: number } | null => {
  const maxPos = editor.state.doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, maxPos));
  const syncState = ySyncPluginKey.getState(editor.state);

  // A cursor captured against a different Y.Doc must not fall back to its
  // foreign absolute offset — degrade to the scroll/top rungs instead.
  if (
    cursor.docGuid &&
    syncState?.doc?.guid &&
    cursor.docGuid !== syncState.doc.guid
  ) {
    return null;
  }

  if (syncState?.binding && cursor.relAnchor && cursor.relHead) {
    try {
      const anchor = relativePositionToAbsolutePosition(
        syncState.doc,
        syncState.type,
        cursor.relAnchor,
        syncState.binding.mapping,
      );
      const head = relativePositionToAbsolutePosition(
        syncState.doc,
        syncState.type,
        cursor.relHead,
        syncState.binding.mapping,
      );
      if (anchor !== null && head !== null) {
        return { anchor: clamp(anchor), head: clamp(head) };
      }
    } catch {
      // corrupted position — fall back to clamped absolute
    }
  }
  return { anchor: clamp(cursor.absAnchor), head: clamp(cursor.absHead) };
};

export const computeCenteredScrollTop = ({
  caretTop,
  containerTop,
  containerClientHeight,
  currentScrollTop,
}: {
  caretTop: number;
  containerTop: number;
  containerClientHeight: number;
  currentScrollTop: number;
}) =>
  Math.max(
    0,
    currentScrollTop + (caretTop - containerTop) - containerClientHeight / 2,
  );
