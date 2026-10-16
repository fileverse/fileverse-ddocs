// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { DdocContentRepairResult } from '../persistence/ddoc-persistence';
import { useYjsSetup } from './use-yjs-setup';

// The repair is replaced per test; everything else is the real module.
const repair = vi.hoisted(() => ({
  result: null as DdocContentRepairResult | null,
}));
vi.mock('../persistence/ddoc-persistence', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../persistence/ddoc-persistence')>();
  return {
    ...actual,
    repairDdocContent: vi.fn(async (ddocId: string) =>
      repair.result
        ? { ...repair.result, ddocId }
        : actual.repairDdocContent(ddocId),
    ),
  };
});

const ID = 'ddoc-repair-failure';

// y-indexeddb leaves its replay failure unhandled; that is the case under test.
const swallow = () => {};
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  process.on('unhandledRejection', swallow);
});
afterEach(() => {
  process.off('unhandledRejection', swallow);
  repair.result = null;
});

const seedCorruptStore = async () => {
  const doc = new Y.Doc();
  doc.getText('body').insert(0, 'hello');
  const persistence = new IndexeddbPersistence(ID, doc);
  await persistence.whenSynced;
  await persistence.destroy();
  await new Promise<void>((resolve) => {
    const request = indexedDB.open(ID);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('updates', 'readwrite');
      tx.objectStore('updates').add(new Uint8Array([255, 1, 2, 3, 9, 9]));
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
    };
  });
};

const initialise = async () => {
  const onIndexedDbError = vi.fn();
  const hook = renderHook(() =>
    useYjsSetup({
      enableIndexeddbSync: true,
      ddocId: ID,
      onIndexedDbError,
      indexeddbStallCheckMs: 50,
    }),
  );
  await act(async () => {
    // Must settle: before the fix a failed repair left this waiting forever.
    await Promise.race([
      hook.result.current.initialiseYjsIndexedDbProvider(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('initialise hung')), 2000),
      ),
    ]);
  });
  return { hook, onIndexedDbError };
};

describe('useYjsSetup when the corrupt store cannot be repaired', () => {
  it.each(['timed-out', 'unavailable'] as const)(
    'gives up on the store when the repair is %s, and keeps editing in memory',
    async (status) => {
      await seedCorruptStore();
      repair.result = {
        ddocId: ID,
        status,
        droppedRows: 0,
        error: new Error(`repair ${status}`),
      };

      const { hook, onIndexedDbError } = await initialise();

      expect(hook.result.current.isIndexeddbSynced).toBe(true);
      expect(onIndexedDbError).toHaveBeenCalledTimes(1);
      expect(onIndexedDbError.mock.calls[0][0].message).toBe(
        `repair ${status}`,
      );
      expect(() =>
        act(() => {
          hook.result.current.ydoc.getText('body').insert(0, 'typing');
        }),
      ).not.toThrow();
    },
  );

  it('gives up when the store is still corrupt after the repair', async () => {
    await seedCorruptStore();
    // The repair says it is fine but leaves the bad row in place.
    repair.result = { ddocId: ID, status: 'healthy', droppedRows: 0 };

    const { hook, onIndexedDbError } = await initialise();

    expect(hook.result.current.isIndexeddbSynced).toBe(true);
    // Nothing was changed by the repair, so the only report is the give-up.
    expect(onIndexedDbError.mock.calls.map(([error]) => error.message)).toEqual(
      ['dDoc IndexedDB store is still corrupt after repair'],
    );
  });
});
