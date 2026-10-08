import * as Y from 'yjs';
import type { IndexeddbPersistence } from 'y-indexeddb';

// Ported from fileverse-dsheet src/persistence-compaction.ts (c6f5179).

const UPDATES_STORE = 'updates';

/**
 * Below this many already-replayed rows the store is left alone. A normal
 * open leaves two or three (the previous compacted row, the last session's
 * edits and y-indexeddb's attach row), so rewriting the full doc then would
 * buy little.
 */
export const DEFAULT_COMPACTION_MIN_ROWS = 3;

/**
 * y-indexeddb appends a copy of the doc every time a provider attaches, and
 * only trims after 500 rows. The editor applies the consumer's initialContent
 * before attaching, so each open stores a FULL copy of the doc and every load
 * replays them all.
 *
 * During sync y-indexeddb applies every stored row to the doc and then sets
 * `_dbref` to one past the last key. Every row below `_dbref` is therefore
 * already in `persistence.doc`, so those rows are replaced with a single
 * `encodeStateAsUpdate(doc)` without reading or merging them. Rows at or above
 * `_dbref` (later edits, writes from another tab) are never touched.
 *
 * Runs in ONE readwrite transaction: any failure rolls back to the original
 * rows. Returns the number of rows replaced (0 when nothing was compacted).
 */
export const compactDdocPersistence = async (
  persistence: IndexeddbPersistence,
  minRows = DEFAULT_COMPACTION_MIN_ROWS,
): Promise<number> => {
  // `_destroyed`, `_dbref` and `_dbsize` are y-indexeddb internals (typed in
  // its d.ts, pinned exactly in package.json). Each is checked before use, so
  // a rename degrades to "no compaction", never to data loss.
  const threshold = Math.max(2, minRows);
  if (persistence._destroyed) return 0;
  await persistence.whenSynced;
  if (persistence._destroyed) return 0;
  const db = persistence.db;
  if (!db || !db.objectStoreNames.contains(UPDATES_STORE)) return 0;

  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(UPDATES_STORE, 'readwrite');
    const store = tx.objectStore(UPDATES_STORE);
    let replaced = 0;
    // `tx.error` is still null when `onerror` fires, and an exception thrown
    // in a request callback only surfaces as a generic AbortError. Keep the
    // first real error and reject with it once the transaction has aborted.
    let failure: unknown = null;
    const fail = (error: unknown) => {
      failure ??= error;
      try {
        tx.abort();
      } catch {
        // Already finished or aborting.
      }
    };

    // Cheap first request: by the time its callback runs, this transaction
    // is active, so y-indexeddb's sync transaction (which sets `_dbref` after
    // emitting 'synced') has finished. Reading `_dbref` right after
    // `whenSynced` could see the stale initial value.
    const totalReq = store.count();
    totalReq.onsuccess = () => {
      try {
        const dbref = persistence._dbref;
        if (typeof dbref !== 'number' || !Number.isFinite(dbref)) return;
        if (totalReq.result < threshold) return;
        const staleRange = IDBKeyRange.upperBound(dbref, true);
        const staleReq = store.count(staleRange);
        staleReq.onsuccess = () => {
          try {
            const stale = staleReq.result;
            if (stale < threshold) return;
            store.add(Y.encodeStateAsUpdate(persistence.doc));
            store.delete(staleRange);
            replaced = stale;
          } catch (error) {
            fail(error);
          }
        };
      } catch (error) {
        fail(error);
      }
    };

    tx.onerror = (event) => {
      failure ??= (event.target as IDBRequest | null)?.error ?? null;
    };
    tx.onabort = () => {
      reject(failure ?? tx.error ?? new Error('compaction aborted'));
    };
    tx.oncomplete = () => {
      // Adjust by the delta instead of assigning a count: edits made while
      // this transaction ran already did `++_dbsize` for rows that land after
      // it, and assigning would drop them. The worst case either way is a
      // y-indexeddb trim slightly later than 500 rows.
      if (replaced > 0 && typeof persistence._dbsize === 'number') {
        persistence._dbsize = Math.max(1, persistence._dbsize - replaced + 1);
      }
      resolve(replaced);
    };
  });
};
