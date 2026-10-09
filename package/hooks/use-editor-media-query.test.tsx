import { act, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { createEditorWidthStore } from '../utils/editor-width-store';
import {
  EditorWidthContext,
  useEditorMediaQuery,
} from './use-editor-media-query';

let windowMatches = true;

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    get matches() {
      return windowMatches;
    },
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
});

const withStore = (store: ReturnType<typeof createEditorWidthStore>) => ({
  wrapper: ({ children }: { children: React.ReactNode }) => (
    <EditorWidthContext.Provider value={store}>
      {children}
    </EditorWidthContext.Provider>
  ),
});

describe('useEditorMediaQuery', () => {
  it('follows the window when there is no editor root', () => {
    windowMatches = true;
    const { result } = renderHook(() =>
      useEditorMediaQuery('(max-width: 1280px)'),
    );
    expect(result.current).toBe(true);
  });

  it('follows the window until the root has been measured', () => {
    windowMatches = true;
    const store = createEditorWidthStore();
    const { result } = renderHook(
      () => useEditorMediaQuery('(max-width: 1280px)'),
      withStore(store),
    );
    expect(result.current).toBe(true);
  });

  it('follows the root width, not the window', () => {
    windowMatches = false;
    const store = createEditorWidthStore();
    store.set(500);
    const { result } = renderHook(
      () => useEditorMediaQuery('(max-width: 1280px)'),
      withStore(store),
    );
    expect(result.current).toBe(true);
    act(() => store.set(1400));
    expect(result.current).toBe(false);
  });

  it('keeps max-width inclusive and min-width inclusive', () => {
    const store = createEditorWidthStore();
    store.set(1280);
    const max = renderHook(
      () => useEditorMediaQuery('(max-width:1280px)'),
      withStore(store),
    );
    const min = renderHook(
      () => useEditorMediaQuery('(min-width: 1280px)'),
      withStore(store),
    );
    expect(max.result.current).toBe(true);
    expect(min.result.current).toBe(true);
  });

  it('re-renders only when its own result flips', () => {
    const store = createEditorWidthStore();
    store.set(500);
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useEditorMediaQuery('(max-width: 960px)');
    }, withStore(store));
    const settled = renders;
    act(() => store.set(700));
    expect(renders).toBe(settled);
    act(() => store.set(1000));
    expect(renders).toBe(settled + 1);
  });

  it('accepts a store directly, for callers above the provider', () => {
    windowMatches = false;
    const store = createEditorWidthStore();
    store.set(500);
    const { result } = renderHook(() =>
      useEditorMediaQuery('(max-width: 960px)', store),
    );
    expect(result.current).toBe(true);
  });

  it('falls back to the window for a query it cannot parse', () => {
    windowMatches = true;
    const store = createEditorWidthStore();
    store.set(500);
    const { result } = renderHook(
      () => useEditorMediaQuery('(orientation: landscape)'),
      withStore(store),
    );
    expect(result.current).toBe(true);
  });
});
