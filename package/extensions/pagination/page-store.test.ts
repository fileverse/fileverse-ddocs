import { createPageStore } from './page-store';
import type { Placement } from './place';

const placement = (pageCount: number): Placement => ({
  breaks: [{ kind: 'before', pos: 10 }],
  pageStarts: [{ kind: 'before', pos: 10 }],
  pageCount,
  spacers: [{ kind: 'block', pos: 9, height: 120, page: 2, print: true }],
});

describe('createPageStore', () => {
  it('starts disabled with no count', () => {
    expect(createPageStore().get()).toEqual({
      enabled: false,
      pageCount: null,
      pageStarts: [],
      placement: null,
    });
  });

  it('notifies on change and returns a new snapshot', () => {
    const store = createPageStore();
    const cb = vi.fn();
    store.subscribe(cb);
    const before = store.get();
    store.set({ enabled: true, pageCount: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(store.get()).not.toBe(before);
    expect(store.get()).toMatchObject({ enabled: true, pageCount: 2 });
  });

  it('does not notify and keeps the same object when nothing changed', () => {
    const store = createPageStore();
    store.set({
      enabled: true,
      pageCount: 2,
      placement: placement(2),
      pageStarts: placement(2).pageStarts,
    });
    const snap = store.get();
    const cb = vi.fn();
    store.subscribe(cb);
    // Equal by value, new objects: still no change.
    store.set({
      pageCount: 2,
      placement: placement(2),
      pageStarts: [{ kind: 'before', pos: 10 }],
    });
    store.set({});
    expect(cb).not.toHaveBeenCalled();
    expect(store.get()).toBe(snap);
    store.set({ placement: placement(3) });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe stops notifications', () => {
    const store = createPageStore();
    const cb = vi.fn();
    const off = store.subscribe(cb);
    off();
    store.set({ pageCount: 4 });
    expect(cb).not.toHaveBeenCalled();
  });
});
