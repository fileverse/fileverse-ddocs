import {
  MutableRefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Editor } from '@tiptap/react';

export interface CachedTabEditorRenderEntry {
  tabId: string;
  editor: Editor;
  isActive: boolean;
}

interface CachedTabEditorEntry {
  tabId: string;
  editor: Editor;
}

interface UseTabEditorCacheArgs {
  activeTabId: string;
  tabIds?: string[];
  activeTabIdRef: MutableRefObject<string>;
  activeEditorRef: MutableRefObject<Editor | null>;
  editorRef?: MutableRefObject<Editor | null>;
  readyState: boolean;
  createEditorForTab: (tabId: string) => Editor;
  destroyEditor: (editor: Editor) => void;
}

// Editors for the N most recently visited tabs stay warm; anything beyond is
// destroyed and rebuilt on revisit. At 2, a user rotating through 3+ tabs got
// a full editor teardown+rebuild on EVERY switch — on 10k-word tabs that is
// the dominant source of transient garbage (measured: ~43k detached DOM
// nodes per 4-tab rotation, vs ~23k with all tabs warm, while 4 warm
// 10k-word editors cost only ~1MB heap / ~3k live nodes over 2).
const PREVIOUS_TAB_CACHE_LIMIT = 4;

const setInactiveEditorDOMState = (editor: Editor, isInactive: boolean) => {
  const dom = editor.view?.dom;
  if (!dom) {
    return;
  }

  if (isInactive) {
    dom.setAttribute('data-ddoc-editor-inactive', 'true');
    dom.setAttribute('tabindex', '-1');
    return;
  }

  dom.removeAttribute('data-ddoc-editor-inactive');
  dom.removeAttribute('tabindex');
};

const setEditorEditableState = (editor: Editor, editable: boolean) => {
  if (editor.isDestroyed) {
    return;
  }

  editor.options.editable = editable;
  editor.view.editable = editable;
  editor.view.dom.setAttribute('contenteditable', String(editable));
};

const blurEditorDOM = (editor: Editor) => {
  const dom = editor.view?.dom;
  if (!dom || typeof document === 'undefined') {
    return;
  }

  if (document.activeElement && dom.contains(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
  }

  dom.blur();
};

export const useTabEditorCache = ({
  activeTabId,
  tabIds,
  activeTabIdRef,
  activeEditorRef,
  editorRef,
  readyState,
  createEditorForTab,
  destroyEditor,
}: UseTabEditorCacheArgs) => {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [cachedEditorEntries, setCachedEditorEntries] = useState<
    CachedTabEditorRenderEntry[]
  >([]);
  const cachedEditorsRef = useRef<Map<string, CachedTabEditorEntry>>(new Map());
  const recentTabIdsRef = useRef<string[]>([]);
  const readyStateRef = useRef(readyState);
  readyStateRef.current = readyState;

  const syncCachedEditorRenderEntries = useCallback(() => {
    const currentActiveTabId = activeTabIdRef.current;
    const cache = cachedEditorsRef.current;

    setCachedEditorEntries(
      recentTabIdsRef.current
        .map((tabId) => cache.get(tabId))
        .filter((entry): entry is CachedTabEditorEntry => Boolean(entry))
        .map((entry) => ({
          tabId: entry.tabId,
          editor: entry.editor,
          isActive: entry.tabId === currentActiveTabId,
        })),
    );
  }, [activeTabIdRef]);

  const destroyCachedEditorEntry = useCallback(
    (entry: CachedTabEditorEntry) => {
      destroyEditor(entry.editor);

      if (activeEditorRef.current === entry.editor) {
        activeEditorRef.current = null;
      }
      if (editorRef?.current === entry.editor) {
        editorRef.current = null;
      }
    },
    [activeEditorRef, destroyEditor, editorRef],
  );

  const destroyAllCachedEditors = useCallback(() => {
    cachedEditorsRef.current.forEach((entry) => {
      destroyCachedEditorEntry(entry);
    });
    cachedEditorsRef.current.clear();
    recentTabIdsRef.current = [];
    activeEditorRef.current = null;
    if (editorRef) {
      editorRef.current = null;
    }
    setEditor(null);
    setCachedEditorEntries([]);
  }, [activeEditorRef, destroyCachedEditorEntry, editorRef]);

  const applyCachedEditorActivity = useCallback(() => {
    const currentActiveTabId = activeTabIdRef.current;

    cachedEditorsRef.current.forEach((entry) => {
      const isActive = entry.tabId === currentActiveTabId;
      if (entry.editor.isDestroyed) {
        return;
      }

      setInactiveEditorDOMState(entry.editor, !isActive);

      if (isActive) {
        setEditorEditableState(entry.editor, readyStateRef.current);
        // A mid-session flip to non-editable (edit revoked) must also drop
        // focus — a caret left in the surface reads as still-writable.
        if (!readyStateRef.current) {
          blurEditorDOM(entry.editor);
        }
        return;
      }

      setEditorEditableState(entry.editor, false);
      blurEditorDOM(entry.editor);
    });
  }, [activeTabIdRef]);

  const ensureCachedEditor = useCallback(
    (tabId: string) => {
      const cache = cachedEditorsRef.current;
      let entry = cache.get(tabId);

      if (!entry || entry.editor.isDestroyed) {
        entry = {
          tabId,
          editor: createEditorForTab(tabId),
        };
        cache.set(tabId, entry);
      }

      return entry;
    },
    [createEditorForTab],
  );

  const rememberActiveTab = useCallback((tabId: string) => {
    recentTabIdsRef.current = [
      tabId,
      ...recentTabIdsRef.current.filter((recentTabId) => recentTabId !== tabId),
    ].slice(0, PREVIOUS_TAB_CACHE_LIMIT);
  }, []);

  const pruneCachedEditorsToRecentTabs = useCallback(() => {
    const recentTabIds = new Set(recentTabIdsRef.current);

    cachedEditorsRef.current.forEach((entry, tabId) => {
      if (recentTabIds.has(tabId)) {
        return;
      }

      destroyCachedEditorEntry(entry);
      cachedEditorsRef.current.delete(tabId);
    });
  }, [destroyCachedEditorEntry]);

  const activateCachedEditor = useCallback(
    (tabId: string) => {
      const entry = ensureCachedEditor(tabId);
      rememberActiveTab(tabId);
      pruneCachedEditorsToRecentTabs();

      activeEditorRef.current = entry.editor;
      setEditor((currentEditor) =>
        currentEditor === entry.editor ? currentEditor : entry.editor,
      );
      applyCachedEditorActivity();
      syncCachedEditorRenderEntries();
      return entry.editor;
    },
    [
      activeEditorRef,
      applyCachedEditorActivity,
      ensureCachedEditor,
      pruneCachedEditorsToRecentTabs,
      rememberActiveTab,
      syncCachedEditorRenderEntries,
    ],
  );

  const didInitializeCacheFactoryRef = useRef(false);

  useLayoutEffect(() => {
    if (!didInitializeCacheFactoryRef.current) {
      didInitializeCacheFactoryRef.current = true;
      return;
    }

    const currentActiveTabId = activeTabIdRef.current;
    destroyAllCachedEditors();
    if (currentActiveTabId) {
      activateCachedEditor(currentActiveTabId);
    }
  }, [
    activeTabIdRef,
    activateCachedEditor,
    createEditorForTab,
    destroyAllCachedEditors,
  ]);

  useLayoutEffect(() => {
    if (!activeTabId) {
      destroyAllCachedEditors();
      return;
    }

    activateCachedEditor(activeTabId);
  }, [activeTabId, activateCachedEditor, destroyAllCachedEditors]);

  useLayoutEffect(() => {
    if (!activeTabId) {
      return;
    }

    const activeEntry = cachedEditorsRef.current.get(activeTabId);
    const shouldRepair =
      !activeEntry ||
      activeEntry.editor.isDestroyed ||
      Boolean(editor && (editor.isDestroyed || editor !== activeEntry.editor));

    if (shouldRepair) {
      activateCachedEditor(activeTabId);
    }
  }, [activeTabId, activateCachedEditor, editor]);

  useEffect(() => {
    if (!tabIds || tabIds.length === 0) {
      return;
    }

    const validTabIds = new Set(tabIds);
    let changed = false;

    recentTabIdsRef.current = recentTabIdsRef.current.filter((tabId) =>
      validTabIds.has(tabId),
    );

    cachedEditorsRef.current.forEach((entry, tabId) => {
      if (validTabIds.has(tabId)) {
        return;
      }

      destroyCachedEditorEntry(entry);
      cachedEditorsRef.current.delete(tabId);
      changed = true;
    });

    if (changed) {
      syncCachedEditorRenderEntries();
    }
  }, [destroyCachedEditorEntry, syncCachedEditorRenderEntries, tabIds]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      activeEditorRef.current = editor;
    } else if (!activeTabIdRef.current) {
      activeEditorRef.current = null;
    }
    if (!editorRef) return;
    editorRef.current = editor ?? null;
  }, [activeEditorRef, activeTabIdRef, editor, editorRef]);

  useEffect(() => {
    readyStateRef.current = readyState;
    applyCachedEditorActivity();
  }, [applyCachedEditorActivity, readyState]);

  useEffect(() => {
    return () => {
      destroyAllCachedEditors();
    };
  }, [destroyAllCachedEditors]);

  return {
    editor,
    cachedEditorEntries,
  };
};
