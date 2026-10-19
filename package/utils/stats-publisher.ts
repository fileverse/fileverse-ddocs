import type { DdocStats } from '../types';

const FIELDS = ['words', 'characters', 'selectedWords', 'pages'] as const;

export const createStatsPublisher = (emit: (stats: DdocStats) => void) => {
  let current: DdocStats = {
    words: 0,
    characters: 0,
    selectedWords: 0,
    pages: null,
  };
  let emitted: DdocStats | null = null;
  let started = false;

  const flush = () => {
    if (!started) return;
    if (emitted && FIELDS.every((key) => emitted![key] === current[key])) {
      return;
    }
    emitted = current;
    emit(current);
  };

  return {
    // Called when a tab becomes active; nothing is emitted until its first tick.
    beginTab(pages: number | null) {
      started = false;
      current = { ...current, selectedWords: 0, pages };
    },
    publish(patch: Partial<DdocStats>, options?: { tick?: boolean }) {
      current = { ...current, ...patch };
      if (options?.tick) started = true;
      flush();
    },
  };
};
