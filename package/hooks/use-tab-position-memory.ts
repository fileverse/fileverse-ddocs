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
      if (editor.isDestroyed || isInactiveEditorDom(editor)) return;
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
      const resolved = resolveCursorPosition(editor, entry.cursor);
      if (resolved) {
        const { anchor, head } = resolved;
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
