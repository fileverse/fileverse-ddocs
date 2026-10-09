import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';
import { useMediaQuery } from 'usehooks-ts';
import type { EditorWidthStore } from '../utils/editor-width-store';

export const EditorWidthContext = createContext<EditorWidthStore | null>(null);

const WIDTH_QUERY = /^\s*\(\s*(min|max)-width\s*:\s*([\d.]+)px\s*\)\s*$/;
const subscribeToNothing = () => () => {};

// Same query strings as useMediaQuery, answered from the editor root's width
// (docs/DROP_IN_EDITOR.md §2.9). Outside a root it is the window, as before.
export const useEditorMediaQuery = (
  query: string,
  store?: EditorWidthStore,
): boolean => {
  const contextStore = useContext(EditorWidthContext);
  const activeStore = store ?? contextStore;
  const windowMatches = useMediaQuery(query);

  const parsed = useMemo(() => {
    const match = WIDTH_QUERY.exec(query);
    return match
      ? { bound: match[1] as 'min' | 'max', px: Number(match[2]) }
      : null;
  }, [query]);

  const getSnapshot = useCallback((): boolean | null => {
    const width = activeStore?.get() ?? null;
    if (width === null || !parsed) return null;
    return parsed.bound === 'max' ? width <= parsed.px : width >= parsed.px;
  }, [activeStore, parsed]);

  const editorMatches = useSyncExternalStore(
    activeStore ? activeStore.subscribe : subscribeToNothing,
    getSnapshot,
    () => null,
  );

  return editorMatches ?? windowMatches;
};
