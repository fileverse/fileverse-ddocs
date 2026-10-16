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
  DDOC_STORE_REPAIRED,
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

/**
 * How many times a provider that stalled on a readable store is replaced
 * before the load is treated as slow but healthy and waited for.
 */
const MAX_FRESH_ATTACHES = 2;

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

  // The provider attached to this doc. After it detaches or fails it stays
  // here (destroyed) rather than going back to null: the update handler below
  // ignores updates whose origin is this provider (its replay), and a null
  // here would also match every update made without an origin, so after a
  // detach those edits would stop reaching the host.
  const yjsIndexeddbProviderRef = useRef<IndexeddbPersistence | null>(null);
  const stopWatchingIndexeddbRef = useRef<(() => void) | null>(null);
  // The latest call to initialiseYjsIndexedDbProvider. A newer call
  // supersedes it: the older call stops waiting at once, drops what it
  // attached, and finishes a repair or delete it already started; the newer
  // call waits for that before touching the store. So only one call works on
  // the store at a time, and two providers are never attached to one doc.
  const latestIndexeddbAttemptRef = useRef<{
    supersede: () => void;
    done: Promise<void>;
  } | null>(null);
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

  const initialiseYjsIndexedDbProvider = useCallback((): Promise<void> => {
    const previous = latestIndexeddbAttemptRef.current;
    previous?.supersede();

    let isLatest = true;
    let resolveSuperseded: () => void = () => {};
    const superseded = new Promise<'superseded'>((resolve) => {
      resolveSuperseded = () => resolve('superseded');
    });
    // The provider this call attached last. destroy() detaches it from the
    // doc at once; only closing its connection waits, so it is never awaited.
    const own: { provider: IndexeddbPersistence | null } = { provider: null };
    const dropOwn = () => {
      void own.provider?.destroy().catch(() => {});
    };
    // A host callback that throws must not end this call, or every later call
    // waiting on it.
    const report = (error: Error) => {
      try {
        onIndexedDbErrorRef.current?.(error);
      } catch (callbackError) {
        console.error('onIndexedDbError threw:', callbackError);
      }
    };

    const run = async (): Promise<void> => {
      // Repairs, reads and deletes are bounded by their own timeouts; every
      // wait on a provider ends when this call is superseded. So this always
      // settles, and it never rejects.
      await previous?.done.catch(() => {});
      if (!isLatest) return;
      stopWatchingIndexeddbRef.current?.();
      stopWatchingIndexeddbRef.current = null;
      // May already be destroyed (detached, or failed to open).
      void yjsIndexeddbProviderRef.current?.destroy().catch(() => {});
      if (!enableIndexeddbSync || !ddocId) {
        setIsIndexeddbSynced(true);
        return;
      }
      setIsIndexeddbSynced(false);

      const attach = () => {
        const attached = new IndexeddbPersistence(ddocId, ydoc);
        // Capture the provider before sync resolves so origin checks can detect IndexedDB replay.
        yjsIndexeddbProviderRef.current = attached;
        own.provider = attached;
        return attached;
      };
      // A wait that loses to `superseded` may still reject later (the open
      // fails); mark it handled so that is not an unhandled rejection.
      const handled = <T>(promise: Promise<T>) => {
        promise.catch(() => {});
        return promise;
      };
      const waitOrStall = (attached: IndexeddbPersistence) =>
        // Rejects if the database cannot be opened (plain whenSynced would hang).
        Promise.race([
          handled(waitForIndexeddbSyncOrStall(attached, indexeddbStallCheckMs)),
          superseded,
        ]);
      // Attach and wait. If the provider has not synced after the stall
      // check, read the store. Corrupt: y-indexeddb hit a row it cannot apply
      // and will never finish, so the caller repairs it. Readable: give a slow
      // load one more check; if the provider has still not synced, its replay
      // has failed for good (the store was repaired, or its connection closed,
      // after it started), so attach afresh. After a few fresh attaches it is
      // a slow but healthy load: keep waiting.
      const load = async (): Promise<'synced' | 'corrupt' | 'superseded'> => {
        for (let fresh = 0; ; fresh += 1) {
          const attached = attach();
          const outcome = await waitOrStall(attached);
          if (outcome !== 'stalled') return outcome;
          const stored = await readDdocContent(ddocId);
          if (!isLatest) return 'superseded';
          if (stored.status === 'corrupt') return 'corrupt';
          if (fresh >= MAX_FRESH_ATTACHES) {
            return Promise.race([
              handled(waitForIndexeddbSync(attached)).then(
                () => 'synced' as const,
              ),
              superseded,
            ]);
          }
          if (stored.status !== 'missing') {
            const again = await waitOrStall(attached);
            if (again !== 'stalled') return again;
          }
          if (!isLatest) return 'superseded';
          dropOwn();
        }
      };

      try {
        let loaded = await load();
        if (loaded === 'superseded') return dropOwn();
        if (loaded === 'corrupt') {
          dropOwn();
          // Drop the rows y-indexeddb cannot apply, then attach again.
          const repair = await repairDdocContent(ddocId);
          // No updates store, so no stored rows to keep: start a new
          // database from what the editor holds.
          const removed =
            repair.status === 'corrupt'
              ? (await deleteDdocContent(ddocId)).status
              : null;
          // Tell the host when the store was changed, even if a newer call
          // has taken over: rows are gone either way.
          if (repair.status === 'repaired') {
            report(
              Object.assign(
                new Error(
                  `dDoc IndexedDB store was corrupt; dropped ${repair.droppedRows} unreadable row(s)`,
                ),
                { name: DDOC_STORE_REPAIRED },
              ),
            );
          } else if (repair.status === 'corrupt') {
            report(
              Object.assign(
                new Error(
                  removed === 'deleted'
                    ? 'dDoc IndexedDB store had no updates store; started a new one'
                    : `dDoc IndexedDB store had no updates store; deleting it is ${removed}, a new one starts once it is gone`,
                ),
                { name: DDOC_STORE_REPAIRED },
              ),
            );
          }
          // Also covers a host that refreshed from inside onIndexedDbError.
          if (!isLatest) return;
          if (
            repair.status === 'timed-out' ||
            repair.status === 'unavailable'
          ) {
            throw (
              repair.error ??
              new Error(`dDoc IndexedDB repair failed (${repair.status})`)
            );
          }
          loaded = await load();
          if (loaded === 'superseded') return dropOwn();
          if (loaded === 'corrupt') {
            // Still unreadable after the repair: give up on the store rather
            // than wait forever. Editing continues in memory.
            throw new Error(
              'dDoc IndexedDB store is still corrupt after repair',
            );
          }
        }

        const syncedProvider = own.provider;
        if (!syncedProvider || !isLatest) return dropOwn();
        stopWatchingIndexeddbRef.current = watchIndexeddbConnection(
          syncedProvider,
          {
            onError: (error) => {
              console.error('IndexedDB persistence failed:', error);
              report(error);
            },
            onDetached: () => {
              if (yjsIndexeddbProviderRef.current === syncedProvider) {
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
        dropOwn();
        if (!isLatest) return;
        console.error('IndexedDB initialization failed:', error);
        setIsIndexeddbSynced(true);
        report(error instanceof Error ? error : new Error(String(error)));
        // Don't rethrow - allow editor to continue without persistence
      }
    };

    const done = run().catch((error: unknown) => {
      console.error('IndexedDB initialization failed:', error);
    });
    latestIndexeddbAttemptRef.current = {
      supersede: () => {
        isLatest = false;
        resolveSuperseded();
      },
      done,
    };
    // The caller waits until the store is loaded or given up, whichever call
    // ends up doing it: a call superseded by a refresh settles with the
    // refresh, not before the doc is loaded.
    const settledForCaller = async () => {
      let current = done;
      for (;;) {
        await current;
        const latest = latestIndexeddbAttemptRef.current?.done;
        if (!latest || latest === current) return;
        current = latest;
      }
    };
    return settledForCaller();
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
