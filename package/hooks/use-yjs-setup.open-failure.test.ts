// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// y-indexeddb whose database never opens: `_db` rejects and `whenSynced`
// never settles, exactly as the real provider behaves when
// `indexedDB.open` fails. (The real one also leaves an internal rejection
// unhandled, which is why this case uses a stand-in.)
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    _db = Promise.reject(new DOMException('denied', 'UnknownError'));
    whenSynced = new Promise(() => {});
    db = null;
    destroy = vi.fn(() => Promise.resolve());
    constructor() {
      this._db.catch(() => {});
    }
  },
}));

const { useYjsSetup } = await import('./use-yjs-setup');

describe('useYjsSetup open failure', () => {
  it('reports it and stops waiting instead of hanging', async () => {
    const onIndexedDbError = vi.fn();
    const { result } = renderHook(() =>
      useYjsSetup({
        enableIndexeddbSync: true,
        ddocId: 'ddoc-open-failure',
        onIndexedDbError,
      }),
    );

    await act(async () => {
      await result.current.initialiseYjsIndexedDbProvider();
    });

    expect(result.current.isIndexeddbSynced).toBe(true);
    expect(onIndexedDbError).toHaveBeenCalledTimes(1);
    expect(onIndexedDbError.mock.calls[0][0]).toBeInstanceOf(Error);
  });
});
