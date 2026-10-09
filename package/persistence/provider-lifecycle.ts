import type { IndexeddbPersistence } from 'y-indexeddb';

const toError = (error: unknown, fallback: string) =>
  error instanceof Error
    ? error
    : new Error(error == null ? fallback : String(error));

/**
 * y-indexeddb's `whenSynced` resolves only on its 'synced' event. If
 * `indexedDB.open` rejects, it never settles and nothing reports the failure.
 * Reject on an open failure so the caller's error path runs.
 */
export const waitForIndexeddbSync = (
  persistence: IndexeddbPersistence,
): Promise<void> =>
  new Promise((resolve, reject) => {
    persistence.whenSynced.then(() => resolve(), reject);
    persistence._db.catch(reject);
  });

/**
 * Like `waitForIndexeddbSync`, but resolves `stalled` if the provider has not
 * synced after `stallMs`, so the caller can check why. The underlying wait is
 * not cancelled; wait again to keep waiting.
 */
export const waitForIndexeddbSyncOrStall = (
  persistence: IndexeddbPersistence,
  stallMs: number,
): Promise<'synced' | 'stalled'> =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('stalled'), stallMs);
    waitForIndexeddbSync(persistence).then(
      () => {
        clearTimeout(timer);
        resolve('synced');
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

type WatchOptions = {
  /** Called for every failed write and for a lost connection. */
  onError: (error: Error) => void;
  /** Called once the provider has been detached from the doc. */
  onDetached: () => void;
};

/**
 * Watch a synced provider's connection for the failures y-indexeddb itself
 * ignores:
 *
 * - A failed write aborts its transaction, and `abort` bubbles to the
 *   database. y-indexeddb never looks, so quota errors and the like are lost.
 * - The browser can close the connection (site data cleared, storage
 *   pressure: `close`), and a delete from another tab waits on it
 *   (`versionchange`). After either, y-indexeddb's update handler throws
 *   InvalidStateError into the next edit. Destroy the provider instead: it
 *   unsubscribes from doc updates before closing, so editing continues in
 *   memory, and a pending delete can proceed.
 *
 * Returns a function that removes the listeners.
 */
export const watchIndexeddbConnection = (
  persistence: IndexeddbPersistence,
  { onError, onDetached }: WatchOptions,
): (() => void) => {
  const db = persistence.db;
  if (!db) return () => {};

  const handleAbort = (event: Event) => {
    const transaction = event.target as IDBTransaction | null;
    onError(toError(transaction?.error, 'dDoc IndexedDB write was aborted'));
  };

  let detached = false;
  const detach = (reason: string) => {
    if (detached) return;
    detached = true;
    stop();
    void persistence.destroy().catch(() => {});
    onDetached();
    onError(new Error(reason));
  };
  const handleClose = () =>
    detach('dDoc IndexedDB connection was closed by the browser');
  const handleVersionChange = () =>
    detach('dDoc IndexedDB database was deleted or upgraded elsewhere');

  const stop = () => {
    db.removeEventListener('abort', handleAbort);
    db.removeEventListener('close', handleClose);
    db.removeEventListener('versionchange', handleVersionChange);
  };

  db.addEventListener('abort', handleAbort);
  db.addEventListener('close', handleClose);
  db.addEventListener('versionchange', handleVersionChange);
  return stop;
};
