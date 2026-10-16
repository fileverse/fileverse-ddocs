// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory, IDBVersionChangeEvent } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  waitForIndexeddbSync,
  watchIndexeddbConnection,
} from './provider-lifecycle';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const ID = 'ddoc-lifecycle';

const openProvider = async () => {
  const persistence = new IndexeddbPersistence(ID, new Y.Doc());
  await waitForIndexeddbSync(persistence);
  return persistence;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('waitForIndexeddbSync', () => {
  it('resolves once the provider has synced', async () => {
    const persistence = await openProvider();
    expect(persistence.synced).toBe(true);
    await persistence.destroy();
  });

  it('rejects when the database cannot be opened', async () => {
    const error = new Error('open failed');
    const fake = {
      whenSynced: new Promise(() => {}),
      _db: Promise.reject(error),
    } as unknown as IndexeddbPersistence;
    await expect(waitForIndexeddbSync(fake)).rejects.toBe(error);
  });
});

describe('watchIndexeddbConnection', () => {
  const watch = (persistence: IndexeddbPersistence) => {
    const onError = vi.fn();
    const onDetached = vi.fn();
    const stop = watchIndexeddbConnection(persistence, { onError, onDetached });
    return { onError, onDetached, stop };
  };

  it('reports a write that fails and aborts its transaction', async () => {
    const persistence = await openProvider();
    const { onError, onDetached } = watch(persistence);

    // Same path as a quota error: the request fails, the transaction aborts,
    // and `abort` bubbles to the database.
    const db = persistence.db as IDBDatabase;
    const first = db.transaction('updates', 'readwrite');
    first.objectStore('updates').add(new Uint8Array([0, 0]), 999);
    await settle();
    const second = db.transaction('updates', 'readwrite');
    second.objectStore('updates').add(new Uint8Array([0, 0]), 999);
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].name).toBe('ConstraintError');
    expect(onDetached).not.toHaveBeenCalled();
    await persistence.destroy();
  });

  it('reports an abort without an error', async () => {
    const persistence = await openProvider();
    const { onError } = watch(persistence);

    (persistence.db as IDBDatabase).transaction('updates', 'readwrite').abort();
    await settle();

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    await persistence.destroy();
  });

  it('detaches on versionchange so the delete can proceed', async () => {
    const persistence = await openProvider();
    const { onError, onDetached } = watch(persistence);

    await new Promise<void>((resolve) => {
      indexedDB.deleteDatabase(ID).onsuccess = () => resolve();
    });

    expect(onDetached).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(persistence._destroyed).toBe(true);
    expect(() => persistence.doc.getText('body').insert(0, 'x')).not.toThrow();
  });

  it('detaches when the browser closes the connection', async () => {
    const persistence = await openProvider();
    const { onError, onDetached } = watch(persistence);

    const db = persistence.db as IDBDatabase;
    db.close();
    // fake-indexeddb only dispatches its own event objects; any of them
    // carries the type. A browser fires a plain `close` Event here.
    db.dispatchEvent(new IDBVersionChangeEvent('close'));

    expect(onDetached).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    // Without the detach, y-indexeddb throws InvalidStateError here.
    expect(() => persistence.doc.getText('body').insert(0, 'x')).not.toThrow();
  });

  it('stops listening when told to', async () => {
    const persistence = await openProvider();
    const { onError, stop } = watch(persistence);
    stop();

    (persistence.db as IDBDatabase).transaction('updates', 'readwrite').abort();
    await settle();

    expect(onError).not.toHaveBeenCalled();
    await persistence.destroy();
  });
});
