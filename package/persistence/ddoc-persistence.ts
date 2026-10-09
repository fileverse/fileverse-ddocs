import { fromUint8Array, toUint8Array } from 'js-base64';
import * as Y from 'yjs';
import { fingerprintDdocContent } from './content-fingerprint';

/**
 * Read, merge into, delete and fingerprint a dDoc's y-indexeddb database
 * without mounting an editor. The editor's IndexeddbPersistence names the
 * database after the ddocId and stores Yjs updates in the `updates` store;
 * these functions read and write that same layout.
 *
 * Nothing here imports React or the editor, so it is safe to call from app
 * services and workers.
 */

export const DEFAULT_DDOC_PERSISTENCE_TIMEOUT_MS = 8_000;

// y-indexeddb's schema (y-indexeddb.js, IndexeddbPersistence constructor).
const UPDATES_STORE = 'updates';
const CUSTOM_STORE = 'custom';

export type DdocContentStatus =
  | 'available'
  | 'empty'
  | 'missing'
  | 'corrupt'
  | 'timed-out'
  | 'unavailable';

export type DdocContentSnapshot = {
  ddocId: string;
  status: DdocContentStatus;
  /** base64 Yjs update of the whole doc; null unless available or empty. */
  encodedState: string | null;
  error?: Error;
};

export type DdocContentMergeResult = DdocContentSnapshot & {
  /** True when the merge wrote something the database did not have. */
  changed: boolean;
  /** True when the database did not exist and this merge created it. */
  created: boolean;
};

export type DdocContentDeleteResult = {
  ddocId: string;
  status: 'deleted' | 'blocked' | 'unavailable';
  error?: Error;
};

export type DdocPersistenceOptions = {
  timeoutMs?: number;
};

const toError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

const unavailableSnapshot = (
  ddocId: string,
  status: Exclude<DdocContentStatus, 'available' | 'empty'>,
  error?: unknown,
): DdocContentSnapshot => ({
  ddocId,
  status,
  encodedState: null,
  ...(error ? { error: toError(error) } : {}),
});

const snapshotDocument = (ddocId: string, doc: Y.Doc): DdocContentSnapshot => {
  const state = Y.encodeStateAsUpdate(doc);
  return {
    ddocId,
    status: state.length <= 2 ? 'empty' : 'available',
    encodedState: fromUint8Array(state),
  };
};

const hasDdocSchema = (database: IDBDatabase) =>
  database.objectStoreNames.contains(UPDATES_STORE) &&
  database.objectStoreNames.contains(CUSTOM_STORE);

/**
 * A stored row is a Uint8Array. Checked by its tag rather than `instanceof`,
 * which is false for arrays created in another realm (a worker, an iframe, a
 * test environment), and would make a healthy store look corrupt.
 */
const isUpdateBytes = (row: unknown): row is Uint8Array =>
  Object.prototype.toString.call(row) === '[object Uint8Array]';

/** Apply stored rows in key order, the way y-indexeddb replays them. */
const replayRows = (doc: Y.Doc, rows: unknown[] | undefined) => {
  for (const row of rows ?? []) {
    if (!isUpdateBytes(row)) {
      throw new Error('dDoc IndexedDB contains a non-Yjs update');
    }
    Y.applyUpdate(doc, row);
  }
};

const readDatabase = (
  ddocId: string,
  timeoutMs: number,
): Promise<DdocContentSnapshot> =>
  new Promise((resolve) => {
    const doc = new Y.Doc();
    let database: IDBDatabase | null = null;
    let transaction: IDBTransaction | null = null;
    let settled = false;
    let createdByRead = false;

    const finish = (snapshot: DdocContentSnapshot) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database?.close();
      doc.destroy();
      resolve(snapshot);
    };

    const fail = (
      status: Exclude<DdocContentStatus, 'available' | 'empty'>,
      error?: unknown,
    ) => finish(unavailableSnapshot(ddocId, status, error));

    const timeout = setTimeout(() => {
      try {
        transaction?.abort();
      } catch {
        // The transaction may already be complete.
      }
      fail('timed-out', new Error('dDoc IndexedDB read timed out'));
    }, timeoutMs);

    let openRequest: IDBOpenDBRequest;
    try {
      openRequest = indexedDB.open(ddocId);
    } catch (error) {
      fail('unavailable', error);
      return;
    }

    // Opening a name that does not exist creates it. Abort that upgrade so a
    // read never turns a never-opened doc into an empty one.
    openRequest.onupgradeneeded = () => {
      createdByRead = true;
      openRequest.transaction?.abort();
    };
    openRequest.onerror = () => {
      if (createdByRead) {
        finish(unavailableSnapshot(ddocId, 'missing'));
      } else {
        fail('unavailable', openRequest.error);
      }
    };
    openRequest.onsuccess = () => {
      database = openRequest.result;
      if (settled) {
        database.close();
        return;
      }
      if (!hasDdocSchema(database)) {
        fail('corrupt', new Error('dDoc IndexedDB schema is invalid'));
        return;
      }

      try {
        transaction = database.transaction(UPDATES_STORE, 'readonly');
        const request = transaction.objectStore(UPDATES_STORE).getAll();
        request.onerror = () => fail('unavailable', request.error);
        request.onsuccess = () => {
          try {
            replayRows(doc, request.result);
          } catch (error) {
            fail('corrupt', error);
          }
        };
        transaction.oncomplete = () => finish(snapshotDocument(ddocId, doc));
        transaction.onabort = () => {
          if (!settled) fail('unavailable', transaction?.error);
        };
        transaction.onerror = () => {
          if (!settled) fail('unavailable', transaction?.error);
        };
      } catch (error) {
        fail('unavailable', error);
      }
    };
  });

const readFreshSnapshot = async (
  ddocId: string,
  timeoutMs: number,
): Promise<DdocContentSnapshot> => {
  if (typeof indexedDB === 'undefined') {
    return unavailableSnapshot(
      ddocId,
      'unavailable',
      new Error('IndexedDB is unavailable'),
    );
  }

  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  if (factory.databases) {
    try {
      const databases = await factory.databases();
      if (!databases.some((database) => database.name === ddocId)) {
        return unavailableSnapshot(ddocId, 'missing');
      }
    } catch {
      // Safari does not consistently support indexedDB.databases().
    }
  }

  return readDatabase(ddocId, timeoutMs);
};

const pendingReads = new Map<string, Promise<DdocContentSnapshot>>();

/**
 * Read the doc's database as stored: every row replayed in key order, the
 * same thing the editor loads on open. Never creates a database. Concurrent
 * reads of one id share a promise; completed reads are not cached.
 */
export const readDdocContent = (
  ddocId: string,
  options: DdocPersistenceOptions = {},
): Promise<DdocContentSnapshot> => {
  const inFlight = pendingReads.get(ddocId);
  if (inFlight) return inFlight;

  const pending = readFreshSnapshot(
    ddocId,
    options.timeoutMs ?? DEFAULT_DDOC_PERSISTENCE_TIMEOUT_MS,
  ).finally(() => {
    if (pendingReads.get(ddocId) === pending) pendingReads.delete(ddocId);
  });
  pendingReads.set(ddocId, pending);
  return pending;
};

/**
 * Merge a full Yjs state into the doc's database, creating the database if
 * it does not exist. Only the part the database does not already hold is
 * written, as one row, in one readwrite transaction; merging state that is
 * already stored writes nothing.
 *
 * An editor open in another tab sees the new row on its next load. An editor
 * open in this tab does not (its Y.Doc is in memory), so callers with a
 * mounted editor merge into its live doc instead.
 */
export const mergeDdocContent = (
  ddocId: string,
  encodedState: string,
  options: DdocPersistenceOptions = {},
): Promise<DdocContentMergeResult> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DDOC_PERSISTENCE_TIMEOUT_MS;
  const notMerged = (
    status: Exclude<DdocContentStatus, 'available' | 'empty'>,
    error?: unknown,
  ): DdocContentMergeResult => ({
    ...unavailableSnapshot(ddocId, status, error),
    changed: false,
    created: false,
  });

  const incoming = new Y.Doc();
  try {
    Y.applyUpdate(incoming, toUint8Array(encodedState));
  } catch (error) {
    incoming.destroy();
    return Promise.resolve(notMerged('corrupt', error));
  }

  if (typeof indexedDB === 'undefined') {
    incoming.destroy();
    return Promise.resolve(
      notMerged('unavailable', new Error('IndexedDB is unavailable')),
    );
  }

  return new Promise((resolve) => {
    const existing = new Y.Doc();
    let database: IDBDatabase | null = null;
    let transaction: IDBTransaction | null = null;
    let settled = false;
    let changed = false;
    let created = false;
    let failure: {
      status: Exclude<DdocContentStatus, 'available' | 'empty'>;
      error: unknown;
    } | null = null;

    const finish = (result: DdocContentMergeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database?.close();
      existing.destroy();
      incoming.destroy();
      resolve(result);
    };

    const timeout = setTimeout(() => {
      try {
        transaction?.abort();
      } catch {
        // The transaction may already be complete.
      }
      finish(
        notMerged('timed-out', new Error('dDoc IndexedDB merge timed out')),
      );
    }, timeoutMs);

    let openRequest: IDBOpenDBRequest;
    try {
      openRequest = indexedDB.open(ddocId);
    } catch (error) {
      finish(notMerged('unavailable', error));
      return;
    }

    // A merge may create the database. Use exactly y-indexeddb's schema so
    // the editor's IndexeddbPersistence opens it as its own.
    openRequest.onupgradeneeded = () => {
      created = true;
      const upgradeDb = openRequest.result;
      if (!upgradeDb.objectStoreNames.contains(UPDATES_STORE)) {
        upgradeDb.createObjectStore(UPDATES_STORE, { autoIncrement: true });
      }
      if (!upgradeDb.objectStoreNames.contains(CUSTOM_STORE)) {
        upgradeDb.createObjectStore(CUSTOM_STORE);
      }
    };
    openRequest.onerror = () =>
      finish(notMerged('unavailable', openRequest.error));
    openRequest.onsuccess = () => {
      database = openRequest.result;
      if (settled) {
        database.close();
        return;
      }
      if (!hasDdocSchema(database)) {
        finish(
          notMerged('corrupt', new Error('dDoc IndexedDB schema is invalid')),
        );
        return;
      }

      try {
        const tx = database.transaction(UPDATES_STORE, 'readwrite');
        transaction = tx;
        const store = tx.objectStore(UPDATES_STORE);
        const abortWith = (
          status: Exclude<DdocContentStatus, 'available' | 'empty'>,
          error: unknown,
        ) => {
          failure ??= { status, error };
          try {
            tx.abort();
          } catch {
            // Already finished or aborting.
          }
        };

        const request = store.getAll();
        request.onsuccess = () => {
          try {
            replayRows(existing, request.result);
          } catch (error) {
            abortWith('corrupt', error);
            return;
          }

          try {
            const diff = Y.encodeStateAsUpdate(
              incoming,
              Y.encodeStateVector(existing),
            );
            // The diff always carries the incoming delete set, so its size
            // says nothing. Apply it and see whether the doc changed.
            const onUpdate = () => {
              changed = true;
            };
            existing.on('update', onUpdate);
            try {
              Y.applyUpdate(existing, diff);
            } finally {
              existing.off('update', onUpdate);
            }
            if (changed) store.add(diff);
          } catch (error) {
            abortWith('unavailable', error);
          }
        };

        tx.oncomplete = () =>
          finish({ ...snapshotDocument(ddocId, existing), changed, created });
        tx.onabort = () =>
          finish(
            notMerged(
              failure?.status ?? 'unavailable',
              failure?.error ??
                tx.error ??
                new Error('dDoc IndexedDB merge aborted'),
            ),
          );
      } catch (error) {
        finish(notMerged('unavailable', error));
      }
    };
  });
};

export type DdocContentRepairResult = {
  ddocId: string;
  /**
   * `repaired`: bad rows were dropped. `healthy`: nothing to drop, nothing
   * written. `missing`: no database. `corrupt`: the database lacks
   * y-indexeddb's stores, so there are no rows to keep.
   */
  status:
    | 'repaired'
    | 'healthy'
    | 'missing'
    | 'corrupt'
    | 'timed-out'
    | 'unavailable';
  droppedRows: number;
  error?: Error;
};

/** Does this stored row decode as a Yjs update on its own? */
const isValidUpdateRow = (row: unknown): row is Uint8Array => {
  if (!isUpdateBytes(row)) return false;
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, row);
    return true;
  } catch {
    return false;
  } finally {
    scratch.destroy();
  }
};

/**
 * Drop the stored rows that are not valid Yjs updates. One row y-indexeddb
 * cannot apply makes its replay throw and never finish, so an editor waiting
 * for it never loads. Each row is checked on its own; only the bad ones are
 * deleted, in one readwrite transaction, and the good rows are left exactly as
 * they are. Their content is lost, but it was already unreadable. Writes
 * nothing when every row is good. Never creates a database.
 */
export const repairDdocContent = async (
  ddocId: string,
  options: DdocPersistenceOptions = {},
): Promise<DdocContentRepairResult> => {
  const result = (
    status: DdocContentRepairResult['status'],
    droppedRows = 0,
    error?: unknown,
  ): DdocContentRepairResult => ({
    ddocId,
    status,
    droppedRows,
    ...(error ? { error: toError(error) } : {}),
  });

  if (typeof indexedDB === 'undefined') {
    return result('unavailable', 0, new Error('IndexedDB is unavailable'));
  }
  const factory = indexedDB as IDBFactory & {
    databases?: () => Promise<Array<{ name?: string }>>;
  };
  if (factory.databases) {
    try {
      const databases = await factory.databases();
      if (!databases.some((database) => database.name === ddocId)) {
        return result('missing');
      }
    } catch {
      // Safari does not consistently support indexedDB.databases().
    }
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_DDOC_PERSISTENCE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let database: IDBDatabase | null = null;
    let transaction: IDBTransaction | null = null;
    let settled = false;
    let createdByRepair = false;
    let dropped = 0;

    const finish = (value: DdocContentRepairResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      database?.close();
      resolve(value);
    };

    const timeout = setTimeout(() => {
      try {
        transaction?.abort();
      } catch {
        // The transaction may already be complete.
      }
      finish(
        result('timed-out', 0, new Error('dDoc IndexedDB repair timed out')),
      );
    }, timeoutMs);

    let openRequest: IDBOpenDBRequest;
    try {
      openRequest = indexedDB.open(ddocId);
    } catch (error) {
      finish(result('unavailable', 0, error));
      return;
    }
    openRequest.onupgradeneeded = () => {
      createdByRepair = true;
      openRequest.transaction?.abort();
    };
    openRequest.onerror = () =>
      finish(
        createdByRepair
          ? result('missing')
          : result('unavailable', 0, openRequest.error),
      );
    openRequest.onsuccess = () => {
      database = openRequest.result;
      if (settled) {
        database.close();
        return;
      }
      if (!hasDdocSchema(database)) {
        finish(
          result('corrupt', 0, new Error('dDoc IndexedDB schema is invalid')),
        );
        return;
      }

      try {
        const tx = database.transaction(UPDATES_STORE, 'readwrite');
        transaction = tx;
        const store = tx.objectStore(UPDATES_STORE);
        const keysRequest = store.getAllKeys();
        const rowsRequest = store.getAll();
        rowsRequest.onsuccess = () => {
          const keys = keysRequest.result ?? [];
          const rows = rowsRequest.result ?? [];
          rows.forEach((row, index) => {
            if (!isValidUpdateRow(row)) {
              store.delete(keys[index]);
              dropped += 1;
            }
          });
        };
        tx.oncomplete = () =>
          finish(dropped > 0 ? result('repaired', dropped) : result('healthy'));
        tx.onabort = () =>
          finish(
            result(
              'unavailable',
              0,
              tx.error ?? new Error('dDoc IndexedDB repair aborted'),
            ),
          );
      } catch (error) {
        finish(result('unavailable', 0, error));
      }
    };
  });
};

/**
 * Delete the doc's database. Resolves `blocked` when another connection
 * (an editor in another tab, for example) still holds it after the timeout;
 * the browser keeps the delete queued and completes it once that connection
 * closes. A missing database counts as deleted.
 */
export const deleteDdocContent = (
  ddocId: string,
  options: DdocPersistenceOptions = {},
): Promise<DdocContentDeleteResult> => {
  pendingReads.delete(ddocId);
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve({
      ddocId,
      status: 'unavailable',
      error: new Error('IndexedDB is unavailable'),
    });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_DDOC_PERSISTENCE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    let blocked = false;
    const finish = (result: DdocContentDeleteResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const timeout = setTimeout(
      () =>
        finish(
          blocked
            ? {
                ddocId,
                status: 'blocked',
                error: new Error(
                  'dDoc IndexedDB delete is blocked by an open connection',
                ),
              }
            : {
                ddocId,
                status: 'unavailable',
                error: new Error('dDoc IndexedDB delete timed out'),
              },
        ),
      timeoutMs,
    );

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.deleteDatabase(ddocId);
    } catch (error) {
      finish({ ddocId, status: 'unavailable', error: toError(error) });
      return;
    }
    request.onblocked = () => {
      blocked = true;
    };
    request.onsuccess = () => finish({ ddocId, status: 'deleted' });
    request.onerror = () =>
      finish({
        ddocId,
        status: 'unavailable',
        error: toError(request.error ?? 'dDoc IndexedDB delete failed'),
      });
  });
};

/**
 * Short, stable fingerprint of a doc's content (44 characters). Changes on
 * every content edit, including delete-only and formatting-only edits; does
 * not change when only the active tab changes. The same content gives the
 * same fingerprint however the state was produced. See
 * `describeDdocContent` for the rule.
 */
export const getDdocContentFingerprint = async (
  encodedState: string,
): Promise<string> => {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, toUint8Array(encodedState));
    return await fingerprintDdocContent(doc);
  } finally {
    doc.destroy();
  }
};
