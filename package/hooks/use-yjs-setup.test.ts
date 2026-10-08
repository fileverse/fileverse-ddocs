// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { useYjsSetup } from './use-yjs-setup';

const ID = 'ddoc-yjs-setup';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const rowCount = () =>
  new Promise<number>((resolve, reject) => {
    const request = indexedDB.open(ID);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db
        .transaction('updates', 'readonly')
        .objectStore('updates')
        .count();
      count.onsuccess = () => {
        db.close();
        resolve(count.result);
      };
    };
  });

const setup = (onIndexedDbError = vi.fn()) => {
  const hook = renderHook(() =>
    useYjsSetup({ enableIndexeddbSync: true, ddocId: ID, onIndexedDbError }),
  );
  return { hook, onIndexedDbError };
};

const initialise = async (hook: ReturnType<typeof setup>['hook']) => {
  await act(async () => {
    await hook.result.current.initialiseYjsIndexedDbProvider();
  });
};

describe('useYjsSetup IndexedDB lifecycle', () => {
  it('detaches when the database is deleted elsewhere, and edits keep working', async () => {
    const { hook, onIndexedDbError } = setup();
    await initialise(hook);

    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(ID);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    expect(onIndexedDbError).toHaveBeenCalledTimes(1);
    expect(() =>
      act(() => {
        hook.result.current.ydoc.getText('body').insert(0, 'still editing');
      }),
    ).not.toThrow();
    expect(hook.result.current.ydoc.getText('body').toString()).toBe(
      'still editing',
    );
  });

  it('uses the latest onIndexedDbError after re-render', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const hook = renderHook(
      ({ onIndexedDbError }) =>
        useYjsSetup({
          enableIndexeddbSync: true,
          ddocId: ID,
          onIndexedDbError,
        }),
      { initialProps: { onIndexedDbError: first } },
    );
    await initialise(hook);
    hook.rerender({ onIndexedDbError: second });

    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(ID);
      request.onsuccess = () => resolve();
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('compacts a bloated store on load', async () => {
    // Five earlier opens, each storing a full copy of the doc.
    const source = new Y.Doc();
    source.getText('body').insert(0, 'lorem ipsum '.repeat(500));
    for (let i = 0; i < 5; i++) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
      const persistence = new IndexeddbPersistence(ID, doc);
      await persistence.whenSynced;
      await persistence.destroy();
    }
    expect(await rowCount()).toBe(5);

    const { hook } = setup();
    await initialise(hook);
    await waitFor(async () => expect(await rowCount()).toBe(1));
    expect(hook.result.current.ydoc.getText('body').toString()).toBe(
      source.getText('body').toString(),
    );
  });
});
