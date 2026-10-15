import { describe, expect, it, vi } from 'vitest';
import { createStatsPublisher } from './stats-publisher';

describe('createStatsPublisher', () => {
  it('emits nothing before the first debounce tick', () => {
    const emit = vi.fn();
    const stats = createStatsPublisher(emit);
    stats.beginTab(null);
    stats.publish({ selectedWords: 3 });
    expect(emit).not.toHaveBeenCalled();
  });

  it('emits the whole snapshot on the first tick', () => {
    const emit = vi.fn();
    const stats = createStatsPublisher(emit);
    stats.beginTab(null);
    stats.publish({ selectedWords: 3 });
    stats.publish({ words: 10, characters: 50 }, { tick: true });
    expect(emit.mock.calls).toEqual([
      [{ words: 10, characters: 50, selectedWords: 3, pages: null }],
    ]);
  });

  it('emits again only when a field changes', () => {
    const emit = vi.fn();
    const stats = createStatsPublisher(emit);
    stats.beginTab(null);
    stats.publish({ words: 10, characters: 50 }, { tick: true });
    stats.publish({ words: 10, characters: 50 }, { tick: true });
    stats.publish({ pages: 2 });
    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit.mock.calls[1][0].pages).toBe(2);
  });

  it('switches pages to the new tab cache, or null, at that tab first tick', () => {
    const emit = vi.fn();
    const stats = createStatsPublisher(emit);
    stats.beginTab(null);
    stats.publish({ words: 10, characters: 50 }, { tick: true });
    stats.publish({ pages: 4 });
    stats.beginTab(null);
    expect(emit).toHaveBeenCalledTimes(2);
    stats.publish({ words: 1, characters: 5 }, { tick: true });
    expect(emit.mock.calls[2][0]).toEqual({
      words: 1,
      characters: 5,
      selectedWords: 0,
      pages: null,
    });
    stats.beginTab(4);
    stats.publish({ words: 10, characters: 50 }, { tick: true });
    expect(emit.mock.calls[3][0].pages).toBe(4);
  });
});
