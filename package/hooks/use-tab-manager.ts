import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Editor } from '@tiptap/react';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { DdocProps } from '../types';
import {
  DEFAULT_TAB_ID,
  deriveTabsFromEncodedState,
  getActiveTabIdFromNodes,
  getTabListFromNodes,
  getTabsYdocNodes,
  LEGACY_ROOT_KEY,
  syncTabStateAndGetNodes,
  Tab,
} from '../components/tabs/utils/tab-utils';
import {
  createSubtabInDoc,
  deleteTabInDoc,
  DeletedTabSnapshot,
  duplicateTabInDoc,
  moveTabInDoc,
  restoreDeletedTabsInDoc,
} from '../components/tabs/utils/tab-operations';
import { generateRandomBytes } from '@fileverse/crypto/utils';
import { fromUint8Array } from 'js-base64';
import { toast } from '@fileverse/ui';
import { useTabMetadataHistory } from './use-tab-metadata-history';

const UNDO_WINDOW_MS = 10_000; // 10 seconds

interface DeleteSnapshot {
  // The deleted tab first, then every tab that was under it.
  tabs: DeletedTabSnapshot[];
  timestamp: number;
}

interface UseTabManagerArgs {
  ydoc: Y.Doc;
  initialContent: DdocProps['initialContent'];
  enableCollaboration?: boolean;
  isDDocOwner: boolean;
  /** Overrides the derived "brand-new document" (see DdocProps.isNewDocument). */
  isNewDocument?: boolean;
  createDefaultTabIfMissing: boolean;
  shouldSyncActiveTab: boolean;
  defaultTabId?: string;
  // Viewers should land on the first tab instead of inheriting whatever the
  // owner last persisted into Yjs tabState.activeTabId. Opt-in per caller.
  preferFirstTabOnInit?: boolean;
  onVersionHistoryActiveTabChange?: (tabId: string | null) => void;
  getEditor?: () => Editor | null;
  flushPendingUpdate?: () => void;
}

export const getNewTabId = () => {
  return fromUint8Array(generateRandomBytes(5), true);
};

// A deep-linked tab that no longer exists must not become the active tab.
// An empty list means the tabs are not known yet, so the id is kept.
const resolveDefaultTabId = (
  defaultTabId: string | undefined,
  tabList: Tab[],
) =>
  defaultTabId &&
  (tabList.length === 0 || tabList.some((tab) => tab.id === defaultTabId))
    ? defaultTabId
    : undefined;

export const useTabManager = ({
  ydoc,
  initialContent,
  enableCollaboration,
  isDDocOwner,
  isNewDocument,
  createDefaultTabIfMissing,
  shouldSyncActiveTab,
  defaultTabId,
  preferFirstTabOnInit,
  onVersionHistoryActiveTabChange,
  flushPendingUpdate,
  getEditor,
}: UseTabManagerArgs) => {
  const isInitialContentResolved =
    enableCollaboration || initialContent !== null;
  const hasSavedInitialMigrationRef = useRef(false);
  const isNewDdoc =
    isNewDocument ?? (isDDocOwner && !enableCollaboration && !initialContent);
  const flushTabUpdate = useCallback(() => {
    if (isNewDdoc) return;
    flushPendingUpdate?.();
  }, [isNewDdoc, flushPendingUpdate]);

  // Hydrate tabs before the first editor render so the correct fragment is chosen.
  const initialTabState = useMemo(() => {
    if (!ydoc) {
      return {
        tabList: [] as Tab[],
        activeTabId: DEFAULT_TAB_ID,
        didWrite: false,
      };
    }

    if (!isInitialContentResolved) {
      return {
        tabList: [] as Tab[],
        activeTabId: DEFAULT_TAB_ID,
        didWrite: false,
      };
    }
    if (initialContent || isNewDdoc) {
      const derivedTabState = deriveTabsFromEncodedState(
        initialContent as string,
        ydoc,
        {
          createDefaultTabIfMissing,
        },
      );

      const shouldPersistInitialHydration =
        derivedTabState.didWrite &&
        !hasSavedInitialMigrationRef.current &&
        !isNewDdoc;

      // A brand-new empty doc bootstraps its default tab locally, but that
      // should not look like a meaningful user edit to consumer onChange handlers.
      if (shouldPersistInitialHydration) {
        hasSavedInitialMigrationRef.current = true;
        flushPendingUpdate?.();
      }

      return derivedTabState;
    }
    return {
      tabList: [] as Tab[],
      activeTabId: DEFAULT_TAB_ID,
      didWrite: false,
    };
  }, [
    ydoc,
    initialContent,
    isNewDdoc,
    isDDocOwner,
    enableCollaboration,
    createDefaultTabIfMissing,
    isInitialContentResolved,
  ]);

  const initialDefaultTabId = resolveDefaultTabId(
    defaultTabId,
    initialTabState.tabList,
  );
  // The deep link is applied once; later tab changes must not pull back to it.
  const appliedDefaultTabIdRef = useRef(
    initialTabState.tabList.length > 0 ? initialDefaultTabId : undefined,
  );

  const [activeTabId, _setActiveTabId] = useState(
    initialDefaultTabId ||
      (preferFirstTabOnInit
        ? (initialTabState.tabList[0]?.id ?? initialTabState.activeTabId)
        : initialTabState.activeTabId),
  );
  const [tabs, setTabs] = useState<Tab[]>(initialTabState.tabList);
  const hasTabState = useMemo(() => tabs.length > 0, [tabs]);
  const lastDeleteRef = useRef<DeleteSnapshot | null>(null);
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;

  // initialContent can arrive later than the first render.
  const hasHydratedRef = useRef(initialTabState.tabList.length > 0);
  useEffect(() => {
    if (hasHydratedRef.current || initialTabState.tabList.length === 0) return;
    hasHydratedRef.current = true;
    setTabs(initialTabState.tabList);
    if (shouldSyncActiveTab) {
      const validDefaultTabId = resolveDefaultTabId(
        defaultTabId,
        initialTabState.tabList,
      );
      appliedDefaultTabIdRef.current = validDefaultTabId;
      const newActiveId = validDefaultTabId || initialTabState.activeTabId;
      activeTabIdRef.current = newActiveId;
      _setActiveTabId(newActiveId);
    } else if (preferFirstTabOnInit && !defaultTabId) {
      const firstTabId = initialTabState.tabList[0]?.id;
      if (firstTabId) {
        activeTabIdRef.current = firstTabId;
        _setActiveTabId(firstTabId);
      }
    }
  }, [
    initialTabState,
    shouldSyncActiveTab,
    defaultTabId,
    preferFirstTabOnInit,
  ]);
  const {
    applyRename,
    undo: undoTabMetadataChange,
    redo: redoTabMetadataChange,
  } = useTabMetadataHistory(ydoc);
  useEffect(() => {
    const nextTabId = activeTabId || null;
    onVersionHistoryActiveTabChange?.(nextTabId);
  }, [activeTabId, onVersionHistoryActiveTabChange]);

  const setActiveTabId = useCallback(
    (id: string) => {
      if (!ydoc || id === activeTabId) return;

      if (!shouldSyncActiveTab || !isInitialContentResolved) {
        _setActiveTabId(id);
        return;
      }

      const tabNodes = getTabsYdocNodes(ydoc);
      // 'self' origin prevents onChange from firing in use-yjs-setup.ts,
      // which would otherwise persist the full Yjs state to IndexedDB and
      // trick the onchain-sync publish loop into seeing "changed" content
      // on every tab switch even without any real edits.
      ydoc.transact(() => {
        tabNodes.tabState.set('activeTabId', id);
      }, 'self');
      _setActiveTabId(id);
    },
    [activeTabId, ydoc, shouldSyncActiveTab, isInitialContentResolved],
  );

  useEffect(() => {
    if (!ydoc || !isInitialContentResolved) return;

    const syncedTabNodes = syncTabStateAndGetNodes(ydoc, {
      createDefaultTabIfMissing,
    });
    if (syncedTabNodes.didWrite) {
      flushTabUpdate();
    }

    // Keep persisted active tab aligned with the local tab when persistence is enabled.
    if (shouldSyncActiveTab) {
      const syncedId = getActiveTabIdFromNodes(syncedTabNodes);
      if (syncedId !== activeTabIdRef.current) {
        ydoc.transact(() => {
          syncedTabNodes.tabState.set('activeTabId', activeTabIdRef.current);
        }, 'self');
      }
    }

    const tabNodes = getTabsYdocNodes(ydoc);

    const applyTabList = (
      currentTabNodes: Pick<
        typeof syncedTabNodes,
        | 'order'
        | 'nameById'
        | 'emojiById'
        | 'tabState'
        | 'parentById'
        | 'deletedById'
      > = syncedTabNodes,
      isRemoteChange = false,
    ) => {
      const tabList = getTabListFromNodes(currentTabNodes);
      const currentOrder = currentTabNodes.order.toArray();
      const isDefaultIdValid = defaultTabId
        ? currentOrder.includes(defaultTabId)
        : false;

      setTabs(tabList);

      const syncedId = getActiveTabIdFromNodes(currentTabNodes);
      const firstTabId =
        currentOrder.length > 0 ? currentOrder[0] : DEFAULT_TAB_ID;

      if (shouldSyncActiveTab) {
        const nextActiveTabId = syncedId || firstTabId;
        _setActiveTabId((prev) =>
          prev === nextActiveTabId ? prev : nextActiveTabId,
        );
      } else if (
        defaultTabId &&
        isDefaultIdValid &&
        appliedDefaultTabIdRef.current !== defaultTabId
      ) {
        appliedDefaultTabIdRef.current = defaultTabId;
        _setActiveTabId((prev) =>
          prev === defaultTabId ? prev : defaultTabId,
        );
      } else {
        // Validate current tab still exists (peer may have deleted it).
        // A deleted subtab falls back to its nearest remaining parent.
        const validTabIds = new Set(tabList.map((t) => t.id));
        _setActiveTabId((prev) => {
          if (validTabIds.has(prev)) return prev;
          const seen = new Set<string>([prev]);
          let ancestorId = currentTabNodes.parentById.get(prev);
          while (ancestorId && !seen.has(ancestorId)) {
            if (validTabIds.has(ancestorId)) break;
            seen.add(ancestorId);
            ancestorId = currentTabNodes.parentById.get(ancestorId);
          }
          const nextId =
            ancestorId && validTabIds.has(ancestorId) ? ancestorId : firstTabId;
          if (
            isRemoteChange &&
            currentTabNodes.parentById.size > 0 &&
            prev !== nextId
          ) {
            toast({
              title: 'This tab was deleted',
              description: 'Someone else deleted the tab you were in.',
            });
          }
          return nextId;
        });
      }
    };

    const handleTabListChange = (
      _event: unknown,
      transaction: Y.Transaction,
    ) => {
      applyTabList(getTabsYdocNodes(ydoc), !transaction.local);
    };

    const legacyRoot = ydoc.getMap(LEGACY_ROOT_KEY);
    const handleLegacyTabStateChange = () => {
      const syncedLegacyTabNodes = syncTabStateAndGetNodes(
        ydoc,
        {
          createDefaultTabIfMissing,
        },
        enableCollaboration ? 'legacy-collab-migration' : 'self',
      );

      applyTabList(syncedLegacyTabNodes);
    };

    // Watch flat roots directly after the initial migration/self-heal pass.
    // Keep a legacy observer as well so collaborative old-arch updates can be
    // migrated after the initial effect has already attached.
    applyTabList(syncedTabNodes);
    tabNodes.order.observe(handleTabListChange);
    tabNodes.nameById.observe(handleTabListChange);
    tabNodes.emojiById.observe(handleTabListChange);
    tabNodes.tabState.observe(handleTabListChange);
    tabNodes.deletedById.observe(handleTabListChange);
    tabNodes.parentById.observe(handleTabListChange);
    legacyRoot.observeDeep(handleLegacyTabStateChange);

    return () => {
      tabNodes.order.unobserve(handleTabListChange);
      tabNodes.nameById.unobserve(handleTabListChange);
      tabNodes.emojiById.unobserve(handleTabListChange);
      tabNodes.tabState.unobserve(handleTabListChange);
      tabNodes.deletedById.unobserve(handleTabListChange);
      tabNodes.parentById.unobserve(handleTabListChange);
      legacyRoot.unobserveDeep(handleLegacyTabStateChange);
    };
  }, [
    ydoc,
    defaultTabId,
    shouldSyncActiveTab,
    enableCollaboration,
    isInitialContentResolved,
    createDefaultTabIfMissing,
    flushPendingUpdate,
  ]);

  const createTab = useCallback(() => {
    const tabNodes = getTabsYdocNodes(ydoc);
    const tabOrder = tabNodes.order;

    const tabId = getNewTabId();
    const newTab: Tab = {
      name: `Tab ${tabOrder.length + 1}`,
      emoji: null,
      id: tabId,
    };

    ydoc.transact(() => {
      tabNodes.nameById.set(newTab.id, newTab.name);
      tabNodes.emojiById.set(newTab.id, newTab.emoji);
      ydoc.getXmlFragment(newTab.id);

      if (shouldSyncActiveTab) {
        tabNodes.tabState.set('activeTabId', tabId);
      }

      tabOrder.push([newTab.id]);
    });

    // React state: always switch to the new tab locally
    _setActiveTabId(tabId);

    // Flush immediately so the new tab is persisted before a potential refresh
    flushPendingUpdate?.();

    return tabId;
  }, [shouldSyncActiveTab, ydoc, flushPendingUpdate]);

  const createSubtab = useCallback(
    (parentId: string) => {
      const tabId = createSubtabInDoc(
        ydoc,
        parentId,
        getNewTabId(),
        shouldSyncActiveTab,
      );
      if (!tabId) return null;
      _setActiveTabId(tabId);
      flushPendingUpdate?.();
      return tabId;
    },
    [shouldSyncActiveTab, ydoc, flushPendingUpdate],
  );

  const deleteTab = useCallback(
    (tabId: string) => {
      const { snapshots, fallbackId } = deleteTabInDoc(
        ydoc,
        tabId,
        activeTabIdRef.current,
        shouldSyncActiveTab,
      );
      // Keep enough to restore the whole group inside the undo window.
      lastDeleteRef.current =
        snapshots.length > 0
          ? { tabs: snapshots, timestamp: Date.now() }
          : null;
      if (fallbackId) {
        _setActiveTabId(fallbackId);
      }
      // Flush immediately so the deletion is persisted before a potential refresh
      flushPendingUpdate?.();
    },
    [ydoc, shouldSyncActiveTab, flushPendingUpdate],
  );

  const restoreDeletedTab = useCallback(() => {
    const snapshot = lastDeleteRef.current;
    if (!snapshot) return false;
    if (Date.now() - snapshot.timestamp > UNDO_WINDOW_MS) {
      lastDeleteRef.current = null;
      return false;
    }

    // Guard inside: tabs already restored (e.g. by a collab peer) are skipped.
    const restored = restoreDeletedTabsInDoc(
      ydoc,
      snapshot.tabs,
      shouldSyncActiveTab,
    );
    lastDeleteRef.current = null;
    if (!restored) return false;

    _setActiveTabId(snapshot.tabs[0].tabId);
    flushPendingUpdate?.();

    return true;
  }, [ydoc, shouldSyncActiveTab, flushPendingUpdate]);

  const isYjsUndoStackEmpty = useCallback(() => {
    const editor = getEditor?.();

    if (!editor || editor.isDestroyed) {
      return true;
    }

    const undoState = yUndoPluginKey.getState(editor.state);
    const undoManager = undoState?.undoManager;

    if (!undoManager) {
      return true;
    }

    return undoManager.undoStack.length === 0;
  }, [getEditor]);

  // Capture-phase Ctrl+Z/Y interceptor for tab delete undo and metadata undo/redo.
  // Fires before TipTap; falls through to editor undo when no tab-level action applies.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === 'z' &&
        !e.shiftKey
      ) {
        const snapshot = lastDeleteRef.current;
        if (snapshot && Date.now() - snapshot.timestamp <= UNDO_WINDOW_MS) {
          e.preventDefault();
          e.stopPropagation();
          restoreDeletedTab();
          return;
        }

        if (isYjsUndoStackEmpty() && undoTabMetadataChange()) {
          e.preventDefault();
          e.stopPropagation();
        }
        // Otherwise: let event bubble to TipTap for normal content undo
      }

      if (
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === 'y' ||
          (e.key.toLowerCase() === 'z' && e.shiftKey))
      ) {
        if (redoTabMetadataChange()) {
          e.preventDefault();
          e.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [
    isYjsUndoStackEmpty,
    redoTabMetadataChange,
    restoreDeletedTab,
    undoTabMetadataChange,
  ]);

  const renameTab = useCallback(
    (
      tabId: string,
      { newName, emoji }: { newName?: string; emoji?: string },
    ) => {
      const result = applyRename({ tabId, newName, emoji });
      if (result.tabNotFound) {
        toast({
          title: 'Rename tab error',
          description: `Tab not found.`,
        });
      }
      // Flush immediately so the rename is persisted before a potential refresh
      flushPendingUpdate?.();
    },
    [applyRename, flushPendingUpdate],
  );

  const duplicateTab = useCallback(
    (tabId: string) => {
      const newTabId = duplicateTabInDoc(
        ydoc,
        tabId,
        getNewTabId,
        shouldSyncActiveTab,
      );
      if (!newTabId) {
        console.warn('Duplicate aborted: tab does not exist', tabId);
        return;
      }

      _setActiveTabId(newTabId);
      flushPendingUpdate?.();

      return newTabId;
    },
    [ydoc, shouldSyncActiveTab, flushPendingUpdate],
  );

  const orderTab = useCallback(
    (destinationTabId: string, movedTabId: string) => {
      if (moveTabInDoc(ydoc, destinationTabId, movedTabId)) {
        flushPendingUpdate?.();
      }
    },
    [ydoc, flushPendingUpdate],
  );

  return {
    tabs,
    hasTabState,
    activeTabId,
    setTabs,
    setActiveTabId,
    createTab,
    createSubtab,
    deleteTab,
    renameTab,
    duplicateTab,
    orderTab,
  };
};
