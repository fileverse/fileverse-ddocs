import { useState, useEffect, useRef, useCallback } from 'react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useSyncManager } from '../sync-local/useSyncManager';
import { fromUint8Array } from 'js-base64';
import {
  CollaborationProps,
  CollabServices,
  CollabCallbacks,
} from '../sync-local/types';
import { DdocProps } from '../types';
import { compactDdocPersistence } from '../persistence/compaction';
import {
  waitForIndexeddbSync,
  waitForIndexeddbSyncOrStall,
  watchIndexeddbConnection,
} from '../persistence/provider-lifecycle';
import {
  deleteDdocContent,
  readDdocContent,
  repairDdocContent,
} from '../persistence/ddoc-persistence';

interface UseYjsSetupArgs {
  onChange?: DdocProps['onChange'];
  onLocalChange?: DdocProps['onLocalChange'];
  enableIndexeddbSync?: boolean;
  ddocId?: string;
  collaboration?: CollaborationProps;
  onCollaboratorChange?: DdocProps['onCollaboratorChange'];
  onIndexedDbError?: (error: Error) => void;
  /**
   * How long to wait for y-indexeddb before checking whether the store is
   * corrupt. Internal; tests shorten it.
   */
  indexeddbStallCheckMs?: number;
}

/**
 * One stored row y-indexeddb cannot apply makes its replay throw and never
 * finish, so the editor would wait forever. After this long without a sync,
 * the store is checked; a healthy but slow store is left to finish.
 */
const INDEXEDDB_STALL_CHECK_MS = 5_000;

export const useYjsSetup = ({
  onChange,
  onLocalChange,
  enableIndexeddbSync,
  ddocId,
  collaboration,
  onCollaboratorChange,
  onIndexedDbError,
  indexeddbStallCheckMs = INDEXEDDB_STALL_CHECK_MS,
}: UseYjsSetupArgs) => {
  const [ydoc] = useState(new Y.Doc());
  const [isIndexeddbSynced, setIsIndexeddbSynced] =
    useState(!enableIndexeddbSync);

  const collabEnabled = collaboration?.enabled === true;
  const services: CollabServices | undefined = collabEnabled
    ? collaboration.services
    : undefined;
  const callbacks: CollabCallbacks | undefined = collabEnabled
    ? { ...collaboration.on, onCollaboratorsChange: onCollaboratorChange }
    : undefined;

  const yjsIndexeddbProviderRef = useRef<IndexeddbPersistence | null>(null);
  const stopWatchingIndexeddbRef = useRef<(() => void) | null>(null);
  // Connection listeners outlive renders; read the latest callback.
  const onIndexedDbErrorRef = useRef(onIndexedDbError);
  useEffect(() => {
    onIndexedDbErrorRef.current = onIndexedDbError;
  }, [onIndexedDbError]);

  const {
    connect,
    disconnect,
    isReady,
    isSyncing,
    terminateSession,
    updateTitle,
    awareness,
    hasCollabContentInitialised,
    state: collabState,
  } = useSyncManager({
    ydoc,
    services,
    callbacks,
    onLocalUpdate: onChange,
    onLocalChange,
    ignoredOrigins: [yjsIndexeddbProviderRef],
  });

  const initialiseYjsIndexedDbProvider = useCallback(async () => {
    stopWatchingIndexeddbRef.current?.();
    stopWatchingIndexeddbRef.current = null;
    const provider = yjsIndexeddbProviderRef.current;
    if (provider) {
      await provider.destroy();
    }
    if (enableIndexeddbSync && ddocId) {
      setIsIndexeddbSynced(false);
      let newYjsIndexeddbProvider: IndexeddbPersistence | null = null;
      try {
        const attach = () => {
          const attached = new IndexeddbPersistence(ddocId, ydoc);
          // Capture the provider before sync resolves so origin checks can detect IndexedDB replay.
          yjsIndexeddbProviderRef.current = attached;
          return attached;
        };
        newYjsIndexeddbProvider = attach();
        // Wait for the database to be ready and synced. Rejects if the
        // database cannot be opened (plain whenSynced would hang).
        const outcome = await waitForIndexeddbSyncOrStall(
          newYjsIndexeddbProvider,
          indexeddbStallCheckMs,
        );
        if (outcome === 'stalled') {
          const stored = await readDdocContent(ddocId);
          if (stored.status === 'corrupt') {
            // Drop the rows y-indexeddb cannot apply, then attach again.
            const repair = await repairDdocContent(ddocId);
            onIndexedDbErrorRef.current?.(
              new Error(
                `dDoc IndexedDB store was corrupt; dropped ${repair.droppedRows} unreadable row(s)`,
              ),
            );
            await newYjsIndexeddbProvider.destroy().catch(() => {});
            if (repair.status === 'corrupt') {
              // No y-indexeddb stores at all, so nothing readable to keep:
              // start a fresh database from what the editor holds.
              await deleteDdocContent(ddocId);
            }
            newYjsIndexeddbProvider = attach();
          }
          await waitForIndexeddbSync(newYjsIndexeddbProvider);
        }
        const syncedProvider = newYjsIndexeddbProvider;
        stopWatchingIndexeddbRef.current = watchIndexeddbConnection(
          syncedProvider,
          {
            onError: (error) => {
              console.error('IndexedDB persistence failed:', error);
              onIndexedDbErrorRef.current?.(error);
            },
            onDetached: () => {
              if (yjsIndexeddbProviderRef.current === syncedProvider) {
                yjsIndexeddbProviderRef.current = null;
                stopWatchingIndexeddbRef.current = null;
              }
            },
          },
        );
        setIsIndexeddbSynced(true);
        // Collapse rows already replayed into the doc (the full copy each
        // open stores, previous sessions' edits) into one, in the background.
        void compactDdocPersistence(syncedProvider).catch((error: unknown) => {
          console.warn('IndexedDB compaction failed:', error);
        });
      } catch (error) {
        console.error('IndexedDB initialization failed:', error);
        if (yjsIndexeddbProviderRef.current === newYjsIndexeddbProvider) {
          yjsIndexeddbProviderRef.current = null;
        }
        void newYjsIndexeddbProvider?.destroy().catch(() => {});
        setIsIndexeddbSynced(true);
        onIndexedDbErrorRef.current?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        // Don't rethrow - allow editor to continue without persistence
      }
    } else {
      setIsIndexeddbSynced(true);
    }
  }, [enableIndexeddbSync, ddocId, ydoc, indexeddbStallCheckMs]);

  const onChangeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Stable ref to onChange so the ydoc handler closure (and any pending
  // debounce) keep working when onChange's identity changes between renders.
  // Without this, the useEffect below re-subscribes on every onChange change,
  // and the cleanup clears any pending debounce — meaning a ydoc update
  // followed by a parent re-render within 300ms silently loses its onChange
  // call. (Specifically observed when accepting a suggestion: the consumer's
  // handleResolveComment writes to Dexie within the debounce window, which
  // triggers liveQuery re-renders that recreate onChange's identity.)
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  // Same reasoning for the argument-free change signal.
  const onLocalChangeRef = useRef(onLocalChange);
  useEffect(() => {
    onLocalChangeRef.current = onLocalChange;
  }, [onLocalChange]);

  // Tell the host the doc changed. The whole document is encoded only for a
  // host that passed `onChange`; `onLocalChange` gets the signal for free.
  const notifyHost = useCallback(
    (chunk: string) => {
      if (onChangeRef.current) {
        onChangeRef.current(fromUint8Array(Y.encodeStateAsUpdate(ydoc)), chunk);
      }
      onLocalChangeRef.current?.();
    },
    [ydoc],
  );

  // Immediately flush any pending debounced onChange.
  // Call this after critical structural changes (tab create/delete/rename/reorder)
  // to ensure persistence happens before a potential page refresh.
  const flushPendingUpdate = useCallback(() => {
    if (onChangeDebounceRef.current) {
      clearTimeout(onChangeDebounceRef.current);
      onChangeDebounceRef.current = null;
    }
    notifyHost('');
  }, [notifyHost]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (update: Uint8Array, origin: any) => {
      if (origin === 'self' || origin === yjsIndexeddbProviderRef.current)
        return;
      // Only a host that asked for the update (`onChange`) needs it encoded.
      const chunk = onChangeRef.current ? fromUint8Array(update) : '';

      // Debounce the expensive full-state encoding.
      // The incremental chunk is tiny and fires immediately via the second arg.
      // The full Y.Doc encoding (first arg) is O(n) and only needed for
      // persistence — batching it avoids encoding on every keystroke.
      if (onChangeDebounceRef.current) {
        clearTimeout(onChangeDebounceRef.current);
      }
      onChangeDebounceRef.current = setTimeout(() => {
        onChangeDebounceRef.current = null;
        notifyHost(chunk);
      }, 300);
    };
    if (ydoc) {
      ydoc.on('update', handler);
    }
    return () => {
      ydoc?.off('update', handler);
      // Intentionally do NOT clear the pending debounce here. The ref-based
      // handler is stable, so re-runs of this effect (which only happen on
      // ydoc change — never in practice) shouldn't cancel in-flight saves.
    };
  }, [ydoc, notifyHost]);

  return {
    ydoc,
    onConnect: connect,
    onDisconnect: disconnect,
    isReady,
    isSyncing,
    terminateSession,
    updateTitle,
    awareness,
    hasCollabContentInitialised,
    isIndexeddbSynced,
    initialiseYjsIndexedDbProvider,
    refreshYjsIndexedDbProvider: initialiseYjsIndexedDbProvider,
    flushPendingUpdate,
    collabState,
  };
};
