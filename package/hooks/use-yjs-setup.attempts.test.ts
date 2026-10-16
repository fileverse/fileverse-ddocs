// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// Overlapping calls to initialiseYjsIndexedDbProvider (the host refreshes on
// tab focus and from its save-error retry). Every provider is counted, so the
// tests can say how many were attached to the doc at once.
const providers = vi.hoisted(() => ({
  all: [] as Array<{ _destroyed: boolean }>,
  maxLive: 0,
}));
vi.mock('y-indexeddb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('y-indexeddb')>();
  class CountedPersistence extends actual.IndexeddbPersistence {
    constructor(name: string, doc: Y.Doc) {
      super(name, doc);
      providers.all.push(this);
      const live = providers.all.filter((p) => !p._destroyed).length;
      providers.maxLive = Math.max(providers.maxLive, live);
    }
  }
  return { ...actual, IndexeddbPersistence: CountedPersistence };
});

// Hooks into the real store functions, set per test.
const store = vi.hoisted(() => ({
  onRepairStart: null as null | (() => void),
  repairDelayMs: 0,
  healthyReadsToFake: 0,
}));
vi.mock('../persistence/ddoc-persistence', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../persistence/ddoc-persistence')>();
  return {
    ...actual,
    readDdocContent: vi.fn(
      async (...args: Parameters<typeof actual.readDdocContent>) => {
        if (store.healthyReadsToFake > 0) {
          // Stands in for a slow but healthy load still running at the check.
          store.healthyReadsToFake -= 1;
          return { ddocId: args[0], status: 'available', encodedState: '' };
        }
        return actual.readDdocContent(...args);
      },
    ),
    repairDdocContent: vi.fn(
      async (...args: Parameters<typeof actual.repairDdocContent>) => {
        const onStart = store.onRepairStart;
        store.onRepairStart = null;
        onStart?.();
        if (store.repairDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, store.repairDelayMs),
          );
        }
        return actual.repairDdocContent(...args);
      },
    ),
  };
});

import { IndexeddbPersistence } from 'y-indexeddb';
import { useYjsSetup } from './use-yjs-setup';

const ID = 'ddoc-yjs-attempts';

// y-indexeddb leaves its replay failure unhandled; that is the case under test.
const swallow = () => {};
beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  process.on('unhandledRejection', swallow);
  await seedCorruptStore();
  providers.all.length = 0;
  providers.maxLive = 0;
});
afterEach(() => {
  process.off('unhandledRejection', swallow);
  store.onRepairStart = null;
  store.repairDelayMs = 0;
  store.healthyReadsToFake = 0;
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

const rowCount = () =>
  new Promise<number>((resolve) => {
    const request = indexedDB.open(ID);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction('updates').objectStore('updates').count();
      count.onsuccess = () => {
        db.close();
        resolve(count.result);
      };
    };
  });

const render = (onIndexedDbError: (error: Error) => void = vi.fn()) =>
  renderHook(() =>
    useYjsSetup({
      enableIndexeddbSync: true,
      ddocId: ID,
      onIndexedDbError,
      indexeddbStallCheckMs: 50,
    }),
  );

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('useYjsSetup overlapping IndexedDB attempts', () => {
  it('keeps one provider when refreshed while the stall check waits', async () => {
    const hook = render();
    await act(async () => {
      const first = hook.result.current.initialiseYjsIndexedDbProvider();
      await wait(5);
      const second = hook.result.current.refreshYjsIndexedDbProvider();
      await Promise.all([first, second]);
    });

    expect(providers.maxLive).toBe(1);
    expect(hook.result.current.isIndexeddbSynced).toBe(true);
    expect(hook.result.current.ydoc.getText('body').toString()).toBe('hello');
    await wait(50);
    const before = await rowCount();
    act(() => {
      hook.result.current.ydoc.getText('body').insert(0, 'X');
    });
    await wait(50);
    expect((await rowCount()) - before).toBe(1);
  });

  it('ends synced when refreshed while a repair is running', async () => {
    // The refresh lands as the first call starts repairing, and the repair
    // takes a moment (a real store open). The newer call must not attach to
    // the store until that repair is done.
    store.repairDelayMs = 20;
    const hook = render();
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    store.onRepairStart = () => {
      second = hook.result.current.refreshYjsIndexedDbProvider();
    };
    await act(async () => {
      first = hook.result.current.initialiseYjsIndexedDbProvider();
      await first;
      await second;
    });

    expect(hook.result.current.isIndexeddbSynced).toBe(true);
    expect(providers.maxLive).toBe(1);
    expect(hook.result.current.ydoc.getText('body').toString()).toBe('hello');
  });

  it('lets a superseded call finish while it waits on a slow load', async () => {
    // Every check reads healthy until the last fresh attach, which then waits
    // with no limit (a slow but healthy load).
    store.healthyReadsToFake = 3;
    const hook = render();
    let firstDone = false;
    let secondDone = false;
    await act(async () => {
      void hook.result.current
        .initialiseYjsIndexedDbProvider()
        .then(() => (firstDone = true));
      // Past the last check: the first call now waits for the provider.
      await wait(500);
      await hook.result.current
        .refreshYjsIndexedDbProvider()
        .then(() => (secondDone = true));
    });

    expect(firstDone).toBe(true);
    expect(secondDone).toBe(true);
    expect(hook.result.current.isIndexeddbSynced).toBe(true);
    expect(providers.maxLive).toBe(1);
  });

  it('keeps one provider when the host refreshes from inside onIndexedDbError', async () => {
    let hook: ReturnType<typeof render> | null = null;
    const onIndexedDbError = vi.fn(() => {
      void hook?.result.current.refreshYjsIndexedDbProvider();
    });
    hook = render(onIndexedDbError);
    await act(async () => {
      await hook!.result.current.initialiseYjsIndexedDbProvider();
      await wait(300);
    });

    expect(providers.maxLive).toBe(1);
    expect(hook.result.current.isIndexeddbSynced).toBe(true);
  });

  it('attaches afresh when a provider stalls on a store that reads fine', async () => {
    // The provider's replay failed on the bad row, but the check reads the
    // store as healthy (another tab repaired it in between, say). Waiting on
    // that provider would never end.
    store.healthyReadsToFake = 1;
    const hook = render();
    await act(async () => {
      await Promise.race([
        hook.result.current.initialiseYjsIndexedDbProvider(),
        wait(3000).then(() => {
          throw new Error('initialise hung');
        }),
      ]);
    });

    expect(hook.result.current.isIndexeddbSynced).toBe(true);
    expect(hook.result.current.ydoc.getText('body').toString()).toBe('hello');
    expect(providers.maxLive).toBe(1);
  });

  it('keeps working when the host error callback throws', async () => {
    const onIndexedDbError = vi.fn(() => {
      throw new Error('host bug');
    });
    const hook = render(onIndexedDbError);
    await act(async () => {
      await hook.result.current.initialiseYjsIndexedDbProvider();
    });
    expect(onIndexedDbError).toHaveBeenCalledTimes(1);
    expect(hook.result.current.isIndexeddbSynced).toBe(true);
    expect(hook.result.current.ydoc.getText('body').toString()).toBe('hello');

    // Later calls still work.
    await act(async () => {
      await expect(
        hook.result.current.refreshYjsIndexedDbProvider(),
      ).resolves.toBeUndefined();
    });
    expect(hook.result.current.isIndexeddbSynced).toBe(true);
  });

  it('settles a superseded call only once the doc is loaded', async () => {
    // A healthy store this time.
    globalThis.indexedDB = new IDBFactory();
    const doc = new Y.Doc();
    doc.getText('body').insert(0, 'stored text');
    const seeded = new IndexeddbPersistence(ID, doc);
    await seeded.whenSynced;
    await seeded.destroy();

    const hook = render();
    const textWhenSettled: string[] = [];
    await act(async () => {
      const first = hook.result.current
        .initialiseYjsIndexedDbProvider()
        .then(() =>
          textWhenSettled.push(
            hook.result.current.ydoc.getText('body').toString(),
          ),
        );
      const second = hook.result.current
        .refreshYjsIndexedDbProvider()
        .then(() =>
          textWhenSettled.push(
            hook.result.current.ydoc.getText('body').toString(),
          ),
        );
      await Promise.all([first, second]);
    });

    // The host's loading state ends when the first call settles; the doc
    // must be there by then.
    expect(textWhenSettled).toEqual(['stored text', 'stored text']);
  });

  it('still reports a repair when a newer call has taken over', async () => {
    const onIndexedDbError = vi.fn();
    const hook = render(onIndexedDbError);
    store.onRepairStart = () => {
      void hook.result.current.refreshYjsIndexedDbProvider();
    };
    await act(async () => {
      await hook.result.current.initialiseYjsIndexedDbProvider();
      await wait(300);
    });

    expect(onIndexedDbError).toHaveBeenCalledTimes(1);
    expect(onIndexedDbError.mock.calls[0][0]).toMatchObject({
      name: 'DdocStoreRepaired',
      message: expect.stringMatching(/dropped 1 unreadable/),
    });
  });
});
