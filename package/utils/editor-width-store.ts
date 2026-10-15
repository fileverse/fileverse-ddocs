export type EditorWidthStore = {
  get(): number | null;
  set(width: number): void;
  subscribe(listener: () => void): () => void;
};

export const createEditorWidthStore = (): EditorWidthStore => {
  let width: number | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => width,
    set(next) {
      if (next === width) return;
      width = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
