# Tab Position Restore (TEC-2710) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switching doc tabs returns the user to their last cursor/scroll position in that tab instead of resetting to the top.

**Architecture:** A session-only module-level position store keyed by `(ddocId, tabId)` holds each tab's last cursor (as Yjs relative positions) and a scroll-offset fallback. A new hook wires capture (continuous `selectionUpdate` + one scrollTop read at switch time) and restore (in the pre-paint layout effect that today zeroes `scrollTop`). `DdocEditor` swaps its hard reset for the hook and routes all tab switches through the hook's wrapped setter.

**Tech Stack:** React 18 hooks, Tiptap v2 (`@tiptap/react`, `@tiptap/pm/state`), `@tiptap/y-tiptap` (ySyncPluginKey, relative-position conversion), Yjs, Vitest + jsdom + @testing-library/react.

**Spec:** `docs/adr/tab-position-restore.md` (decision record — fallback ladder, lifetime, Q1–Q12 decisions). Ticket: TEC-2710.

## Global Constraints

- Session-only: nothing written to the Y.Doc, localStorage, or IndexedDB. Positions die on reload. (ADR "Lifetime & keying")
- Cursor is primary; scroll offset is a once-at-hide fallback; empty store → `scrollTop = 0` (today's behavior, preserves ghost-layout fix #532). No continuous scroll listener anywhere.
- A cursor counts only after the first pointerdown/keydown in that tab's editor (Q9) — autofocus/default selections must never be recorded.
- Auto-focus on restore: desktop only (`!isNativeMobile`), never touch (Q3).
- Disabled surfaces: `versionHistoryState.enabled` and `isPresentationMode` keep the old reset-to-top behavior (Q10). `PreviewDdocEditor` is untouched.
- Package-internal only: no new props in `DdocProps`, no new imperative ref methods (Q6).
- Do NOT modify `use-tab-editor-cache.ts` (force-blur/LRU logic) or `use-tab-manager.ts`.
- Repo conventions: no code comments for trivial lines; needed comments ≤3 lines. NO git commits — the user commits themselves. Run `npm test` (vitest) for suites; lint with `npm run lint` only in the final task (it auto-fixes repo-wide, keep the diff clean).

## Reference facts (verified against the codebase)

- Bug site: `package/ddoc-editor.tsx:385-392` — `useLayoutEffect` sets `editorScrollContainerRef.current.scrollTop = 0` on `[activeTabId]`.
- In `DdocEditor` scope at that point: `ddocId` (prop), `editor`, `isContentLoading`, `ydoc`, `activeTabId`, `setActiveTabId` (destructured from `useDdocEditor` at ~lines 284–312), `isNativeMobile` (from `useResponsive()` ~line 259), `isPresentationMode` (prop), `rest.versionHistoryState?.enabled` (used at line ~699).
- All user-driven tab switches flow through that one destructured `setActiveTabId`: sidebar (`document-tabs-sidebar.tsx`), mobile panel (`document-mobile-tab-panel.tsx`), `CommentDrawer onTabChange` (`ddoc-editor.tsx:1416`). Shadowing the name wraps them all.
- Inactive cached editors carry `data-ddoc-editor-inactive="true"` on `editor.view.dom` (set in `use-tab-editor-cache.ts` before `DdocEditor`'s own layout effects run — safe to use as a stale-commit guard).
- Relative-position pattern to mirror: `package/extensions/comment/comment-decoration-plugin.ts:70-135, 238-256` — `ySyncPluginKey.getState(state)` → `{ doc, type, binding }` → `absolutePositionToRelativePosition(pos, type, binding.mapping)` / `relativePositionToAbsolutePosition(doc, type, rel, binding.mapping)`, all from `@tiptap/y-tiptap`.
- Scroll container resolver: `package/utils/get-editor-scroll-container.ts` default export `getEditorScrollContainer({ targetElement, editorRoot })` — handles Split View and fallbacks.
- Test precedent for Yjs-bound editors in jsdom: `package/utils/apply-tabbed-template.test.ts` — `new Editor({ extensions: getHeadlessExtensions({ ydoc, field }) })` from `package/hooks/use-headless-editor`.
- Collaboration extension is always on (solo too), so the y-sync binding exists in every tab editor.
- Explicit-navigation flows (heading links, comment focus) scroll via `requestAnimationFrame` + fresh rect measurement AFTER our pre-paint restore, so they win naturally — no suppression mechanism needed (Q11 satisfied by ordering).

---

### Task 1: Position store + pure capture/resolve utils

**Files:**
- Create: `package/utils/tab-position-memory.ts`
- Test: `package/utils/tab-position-memory.test.ts`

**Interfaces:**
- Consumes: `getHeadlessExtensions` (tests only), `@tiptap/y-tiptap` conversion fns.
- Produces (Task 2 relies on these exact names/signatures):
  - `getTabPositionKey(ddocId: string | undefined, tabId: string): string`
  - `markTabInteracted(key: string): void`
  - `hasTabInteraction(key: string): boolean`
  - `recordTabCursor(key: string, cursor: TabCursorPosition): boolean` (returns false + no-ops when the key has no interaction)
  - `recordTabScrollFallback(key: string, scrollTop: number): void`
  - `getTabPosition(key: string): TabPositionEntry | undefined`
  - `clearTabPositionStore(): void`
  - `captureCursorPosition(editor: Editor): TabCursorPosition | null`
  - `resolveCursorPosition(editor: Editor, cursor: TabCursorPosition): { anchor: number; head: number }`
  - `computeCenteredScrollTop({ caretTop, containerTop, containerClientHeight, currentScrollTop }): number`
  - types `TabCursorPosition { relAnchor: Y.RelativePosition | null; relHead: Y.RelativePosition | null; absAnchor: number; absHead: number }`, `TabPositionEntry { cursor?: TabCursorPosition; scrollTop?: number; interacted: boolean }`

- [ ] **Step 1: Write the failing tests**

```ts
// package/utils/tab-position-memory.test.ts
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
    const cursor = { relAnchor: null, relHead: null, absAnchor: 5, absHead: 5 };
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
    const cursor = captureCursorPosition(editor);

    // Simulate an edit landing while the tab is "hidden".
    editor.commands.insertContentAt(1, 'XXXX');

    const resolved = resolveCursorPosition(editor, cursor!);
    expect(resolved.head).toBe(12); // shifted by the 4 inserted chars
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
    };
    const resolved = resolveCursorPosition(editor, stale);
    const maxPos = editor.state.doc.content.size;
    expect(resolved.anchor).toBe(maxPos);
    expect(resolved.head).toBe(maxPos);
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run package/utils/tab-position-memory.test.ts`
Expected: FAIL — cannot resolve `./tab-position-memory`.

- [ ] **Step 3: Implement the module**

```ts
// package/utils/tab-position-memory.ts
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
}

export interface TabPositionEntry {
  cursor?: TabCursorPosition;
  scrollTop?: number;
  interacted: boolean;
}

// Session-only by design (docs/adr/tab-position-restore.md): module-level so it
// survives editor teardown/remount, gone on reload.
const tabPositionStore = new Map<string, TabPositionEntry>();

export const getTabPositionKey = (
  ddocId: string | undefined,
  tabId: string,
) => `${ddocId ?? 'ddoc'}::${tabId}`;

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
      };
    } catch {
      // fall through to absolute-only
    }
  }
  return { relAnchor: null, relHead: null, absAnchor: anchor, absHead: head };
};

export const resolveCursorPosition = (
  editor: Editor,
  cursor: TabCursorPosition,
): { anchor: number; head: number } => {
  const maxPos = editor.state.doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, maxPos));
  const syncState = ySyncPluginKey.getState(editor.state);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run package/utils/tab-position-memory.test.ts`
Expected: PASS (7 tests).

Note for the round-trip test: `getHeadlessExtensions({ ydoc, field })` includes the Collaboration extension, and `new Editor(...)` constructs its EditorView immediately, so `ySyncPluginKey.getState(state).binding` is live in jsdom (same setup `apply-tabbed-template.test.ts` relies on). If `relAnchor` unexpectedly comes back null, the binding is missing — debug the extension setup rather than weakening the assertion.

---

### Task 2: `useTabPositionMemory` hook

**Files:**
- Create: `package/hooks/use-tab-position-memory.ts`
- Test: `package/hooks/use-tab-position-memory.test.tsx`

**Interfaces:**
- Consumes (from Task 1, exact names): `getTabPositionKey`, `markTabInteracted`, `recordTabCursor`, `recordTabScrollFallback`, `getTabPosition`, `captureCursorPosition`, `resolveCursorPosition`, `computeCenteredScrollTop`; plus default export `getEditorScrollContainer` from `../utils/get-editor-scroll-container`.
- Produces (Task 3 relies on this exact shape):
  - `useTabPositionMemory(args: UseTabPositionMemoryArgs): { switchTab: (id: string) => void }`
  - `UseTabPositionMemoryArgs { editor: Editor | null; activeTabId: string; ddocId?: string; setActiveTabId: (id: string) => void; isContentLoading: boolean; isNativeMobile: boolean; disabled: boolean }`

- [ ] **Step 1: Write the failing tests**

```tsx
// package/hooks/use-tab-position-memory.test.tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { getHeadlessExtensions } from './use-headless-editor';
import { useTabPositionMemory } from './use-tab-position-memory';
import {
  clearTabPositionStore,
  getTabPositionKey,
  markTabInteracted,
  recordTabScrollFallback,
} from '../utils/tab-position-memory';

const buildProps = (
  editor: Editor,
  activeTabId: string,
  setActiveTabId: (id: string) => void,
  overrides: Partial<Parameters<typeof useTabPositionMemory>[0]> = {},
) => ({
  editor,
  activeTabId,
  ddocId: 'doc-1',
  setActiveTabId,
  isContentLoading: false,
  isNativeMobile: false,
  disabled: false,
  ...overrides,
});

describe('useTabPositionMemory', () => {
  let ydoc: Y.Doc;
  let container: HTMLDivElement;
  let editorA: Editor;
  let editorB: Editor;

  beforeEach(() => {
    clearTabPositionStore();
    ydoc = new Y.Doc();
    container = document.createElement('div');
    container.setAttribute('data-editor-scroll-container', 'true');
    // jsdom reports 0 dimensions; getEditorScrollContainer requires
    // clientHeight > 0 to pick the explicit container.
    Object.defineProperty(container, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    Object.defineProperty(container, 'scrollHeight', {
      value: 2000,
      configurable: true,
    });
    document.body.appendChild(container);
    editorA = new Editor({
      extensions: getHeadlessExtensions({ ydoc, field: 'tab-a' }),
    });
    editorB = new Editor({
      extensions: getHeadlessExtensions({ ydoc, field: 'tab-b' }),
    });
    container.appendChild(editorA.view.dom);
    container.appendChild(editorB.view.dom);
    editorA.commands.insertContent('content for tab a, long enough to click');
    editorB.commands.insertContent('content for tab b');
  });

  afterEach(() => {
    editorA.destroy();
    editorB.destroy();
    ydoc.destroy();
    container.remove();
  });

  it('delegates the switch and restores the scroll fallback for cursorless tabs', () => {
    const setActiveTabId = vi.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorA, 'tab-a', setActiveTabId) },
    );

    container.scrollTop = 480;
    result.current.switchTab('tab-b');
    expect(setActiveTabId).toHaveBeenCalledWith('tab-b');

    rerender(buildProps(editorB, 'tab-b', setActiveTabId));
    expect(container.scrollTop).toBe(0); // nothing stored for tab-b yet

    result.current.switchTab('tab-a');
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(container.scrollTop).toBe(480); // no cursor in tab-a → fallback
  });

  it('restores the recorded cursor selection after interaction', () => {
    const setActiveTabId = vi.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorA, 'tab-a', setActiveTabId) },
    );

    editorA.view.dom.dispatchEvent(new Event('pointerdown'));
    editorA.commands.setTextSelection(8); // fires selectionUpdate → recorded

    result.current.switchTab('tab-b');
    rerender(buildProps(editorB, 'tab-b', setActiveTabId));

    // Simulate what teardown/autofocus does to the hidden editor's selection.
    editorA.commands.setTextSelection(1);

    result.current.switchTab('tab-a');
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(editorA.state.selection.head).toBe(8);
  });

  it('ignores selections made without user interaction (Q9)', () => {
    const setActiveTabId = vi.fn();
    const { result, rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      { initialProps: buildProps(editorA, 'tab-a', setActiveTabId) },
    );

    editorA.commands.setTextSelection(8); // no pointerdown/keydown first
    container.scrollTop = 300;

    result.current.switchTab('tab-b');
    rerender(buildProps(editorB, 'tab-b', setActiveTabId));
    editorA.commands.setTextSelection(1);

    result.current.switchTab('tab-a');
    rerender(buildProps(editorA, 'tab-a', setActiveTabId));
    expect(editorA.state.selection.head).toBe(1); // NOT restored
    expect(container.scrollTop).toBe(300); // fallback used instead
  });

  it('keeps the old reset-to-top behavior when disabled', () => {
    const setActiveTabId = vi.fn();
    const key = getTabPositionKey('doc-1', 'tab-a');
    markTabInteracted(key);
    recordTabScrollFallback(key, 480);

    const { rerender } = renderHook(
      (props: Parameters<typeof useTabPositionMemory>[0]) =>
        useTabPositionMemory(props),
      {
        initialProps: buildProps(editorB, 'tab-b', setActiveTabId, {
          disabled: true,
        }),
      },
    );

    container.scrollTop = 250;
    rerender(buildProps(editorA, 'tab-a', setActiveTabId, { disabled: true }));
    expect(container.scrollTop).toBe(0); // stored 480 ignored
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run package/hooks/use-tab-position-memory.test.tsx`
Expected: FAIL — cannot resolve `./use-tab-position-memory`.

- [ ] **Step 3: Implement the hook**

```ts
// package/hooks/use-tab-position-memory.ts
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import getEditorScrollContainer from '../utils/get-editor-scroll-container';
import {
  captureCursorPosition,
  computeCenteredScrollTop,
  getTabPosition,
  getTabPositionKey,
  markTabInteracted,
  recordTabCursor,
  recordTabScrollFallback,
  resolveCursorPosition,
} from '../utils/tab-position-memory';

export interface UseTabPositionMemoryArgs {
  editor: Editor | null;
  activeTabId: string;
  ddocId?: string;
  setActiveTabId: (id: string) => void;
  isContentLoading: boolean;
  isNativeMobile: boolean;
  disabled: boolean;
}

const SCROLL_CONTAINER_SELECTOR = '[data-editor-scroll-container="true"]';

const isInactiveEditorDom = (editor: Editor) =>
  editor.view?.dom?.getAttribute('data-ddoc-editor-inactive') === 'true';

const resolveContainer = (editor: Editor | null) => {
  const dom = editor && !editor.isDestroyed ? editor.view?.dom : null;
  if (dom) {
    return getEditorScrollContainer({ targetElement: dom, editorRoot: dom });
  }
  return document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR);
};

// Replaces the hard `scrollTop = 0` reset on tab switch (TEC-2710) with the
// ADR fallback ladder: cursor → captured scrollTop → top.
// See docs/adr/tab-position-restore.md.
export const useTabPositionMemory = ({
  editor,
  activeTabId,
  ddocId,
  setActiveTabId,
  isContentLoading,
  isNativeMobile,
  disabled,
}: UseTabPositionMemoryArgs) => {
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const ddocIdRef = useRef(ddocId);
  ddocIdRef.current = ddocId;

  useEffect(() => {
    if (disabled || !editor || editor.isDestroyed) return;
    const dom = editor.view?.dom;
    if (!dom) return;

    const handleInteraction = () => {
      markTabInteracted(
        getTabPositionKey(ddocIdRef.current, activeTabIdRef.current),
      );
    };
    const handleSelectionUpdate = () => {
      if (editor.isDestroyed || isInactiveEditorDom(editor)) return;
      const cursor = captureCursorPosition(editor);
      if (cursor) {
        recordTabCursor(
          getTabPositionKey(ddocIdRef.current, activeTabIdRef.current),
          cursor,
        );
      }
    };

    dom.addEventListener('pointerdown', handleInteraction);
    dom.addEventListener('keydown', handleInteraction);
    editor.on('selectionUpdate', handleSelectionUpdate);
    return () => {
      dom.removeEventListener('pointerdown', handleInteraction);
      dom.removeEventListener('keydown', handleInteraction);
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, disabled]);

  const switchTab = useCallback(
    (nextTabId: string) => {
      const currentTabId = activeTabIdRef.current;
      if (
        !disabled &&
        editor &&
        !editor.isDestroyed &&
        currentTabId &&
        nextTabId !== currentTabId
      ) {
        // Must read before React commits the incoming panel — the shared
        // container's scrollTop gets clamped by the new content height.
        const container = resolveContainer(editor);
        if (container) {
          recordTabScrollFallback(
            getTabPositionKey(ddocIdRef.current, currentTabId),
            container.scrollTop,
          );
        }
      }
      setActiveTabId(nextTabId);
    },
    [editor, disabled, setActiveTabId],
  );

  useLayoutEffect(() => {
    if (!activeTabId) return;
    const container = resolveContainer(editor);

    if (disabled || isContentLoading || !editor || editor.isDestroyed) {
      if (container) container.scrollTop = 0;
      return;
    }
    // Commit where activeTabId changed but `editor` is still the outgoing
    // instance; the cache re-renders synchronously and this re-runs.
    if (isInactiveEditorDom(editor)) return;

    const entry = getTabPosition(getTabPositionKey(ddocId, activeTabId));

    if (entry?.cursor) {
      const { anchor, head } = resolveCursorPosition(editor, entry.cursor);
      const { doc, tr } = editor.state;
      const selection = TextSelection.between(
        doc.resolve(anchor),
        doc.resolve(head),
      );
      editor.view.dispatch(
        tr.setSelection(selection).setMeta('addToHistory', false),
      );
      if (!isNativeMobile) {
        editor.commands.focus(null, { scrollIntoView: false });
      }
      if (container) {
        try {
          const coords = editor.view.coordsAtPos(selection.head);
          const rect = container.getBoundingClientRect();
          container.scrollTop = computeCenteredScrollTop({
            caretTop: coords.top,
            containerTop: rect.top,
            containerClientHeight: container.clientHeight,
            currentScrollTop: container.scrollTop,
          });
        } catch {
          // coordsAtPos throws pre-layout; keep current scroll
        }
      }
      return;
    }

    if (entry?.scrollTop !== undefined && container) {
      container.scrollTop = entry.scrollTop;
      return;
    }

    if (container) container.scrollTop = 0;
    // Keyed to tab switches only: isContentLoading flips must not re-run this
    // and yank the scroll mid-session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, editor]);

  return { switchTab };
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run package/hooks/use-tab-position-memory.test.tsx`
Expected: PASS (4 tests).

jsdom notes if a test misbehaves: `scrollTop` is a plain settable property in jsdom (no layout clamping — which is why the fallback assertions work); `coordsAtPos` may throw there, which the try/catch absorbs, leaving `scrollTop` untouched on the cursor path — assertions on the cursor test check selection, not scroll, for exactly this reason.

- [ ] **Step 5: Run both new suites together**

Run: `npx vitest run package/utils/tab-position-memory.test.ts package/hooks/use-tab-position-memory.test.tsx`
Expected: PASS (11 tests).

---

### Task 3: Wire into `DdocEditor` (replace the hard reset)

**Files:**
- Modify: `package/ddoc-editor.tsx` (destructure at ~line 300, effect at ~lines 385-392)

**Interfaces:**
- Consumes: `useTabPositionMemory` / `UseTabPositionMemoryArgs` from Task 2.
- Produces: no API change — `setActiveTabId` keeps its name and `(id: string) => void` shape for all JSX consumers (lines ~929, ~1416, ~1689).

- [ ] **Step 1: Rename the raw setter in the `useDdocEditor` destructure**

At ~line 300, change:

```tsx
      setActiveTabId,
```

to:

```tsx
      setActiveTabId: setActiveTabIdRaw,
```

- [ ] **Step 2: Replace the reset effect with the hook**

Add the import at the top of the file:

```tsx
import { useTabPositionMemory } from './hooks/use-tab-position-memory';
```

Replace the block at ~lines 382-392:

```tsx
    // All tabs share a single scroll container (editorScrollContainerRef), so
    // its scrollTop carries over between tabs. On switch, reset the active tab's
    // canvas to the top. useLayoutEffect runs before paint to avoid a flash.
    useLayoutEffect(() => {
      const el = editorScrollContainerRef.current;
      if (!el) return;
      el.scrollTop = 0;
    }, [activeTabId]);
```

with:

```tsx
    // All tabs share one scroll container; on switch, land on the user's last
    // position in the incoming tab (TEC-2710, docs/adr/tab-position-restore.md)
    // instead of hard-resetting to the top.
    const { switchTab: setActiveTabId } = useTabPositionMemory({
      editor,
      activeTabId,
      ddocId,
      setActiveTabId: setActiveTabIdRaw,
      isContentLoading,
      isNativeMobile,
      disabled:
        Boolean(rest.versionHistoryState?.enabled) ||
        Boolean(isPresentationMode),
    });
```

If `useLayoutEffect` has no other usage left in the file, drop it from the React import (check with `grep -n "useLayoutEffect" package/ddoc-editor.tsx`).

- [ ] **Step 3: Verify every switch site routes through the wrapper**

Run: `grep -n "setActiveTabIdRaw\|setActiveTabId" package/ddoc-editor.tsx`
Expected: `setActiveTabIdRaw` appears exactly twice (destructure + hook arg); all other `setActiveTabId` references (JSX props at ~929, ~1416, ~1689) sit BELOW the hook call so they resolve to the wrapped `switchTab`. Also confirm no reference to `setActiveTabId` exists between the destructure and the hook call (it would hit the TDZ) — the typecheck in Step 4 catches this too.

- [ ] **Step 4: Typecheck and run the full test suite**

Run: `npx tsc --noEmit && npm test`
Expected: tsc clean; full suite green (598 pre-existing + 11 new).

- [ ] **Step 5: Manual QA in the demo app**

Run: `npm run dev`, open the demo, apply the fanfic tabbed template (multiple tabs).
Verify each ADR behavior:
1. Writer flow: click into ¶ mid-doc in tab 1, switch to tab 2, back → caret restored, centered, editor focused (desktop).
2. Reader flow: scroll tab 2 without clicking, switch away and back → scroll offset restored.
3. Fresh tab: first visit in the session still opens at top.
4. Close/reopen tab within session → position survives; reload page → positions gone.
5. >4 tabs: rotate through 5+ tabs, return to the first (rebuilt editor) → position restored.
6. Mobile viewport (devtools touch emulation): switch back → position restored, keyboard does NOT pop.
7. Cross-tab comment click (CommentDrawer) → lands on the comment thread, not the stored position.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: clean (note it auto-fixes; check `git diff` afterwards for unrelated churn and revert any).

