import type { PageStart, Placement } from './place';

export type PageState = {
  enabled: boolean;
  pageCount: number | null;
  pageStarts: PageStart[];
  placement: Placement | null;
};

export const DISABLED_PAGE_STATE: PageState = {
  enabled: false,
  pageCount: null,
  pageStarts: [],
  placement: null,
};

// Placements are plain data, so a value compare is enough.
const same = (a: unknown, b: unknown) =>
  a === b || JSON.stringify(a) === JSON.stringify(b);

export function createPageStore() {
  let state: PageState = DISABLED_PAGE_STATE;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<PageState>) {
      const keys = Object.keys(next) as (keyof PageState)[];
      if (keys.every((k) => same(state[k], next[k]))) return;
      state = { ...state, ...next };
      listeners.forEach((cb) => cb());
    },
    subscribe(cb: () => void) {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
