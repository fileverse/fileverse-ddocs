import { act, renderHook } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { createPageStore } from '../pagination/page-store';
import { MEDIA_RATIO_VAR } from './media-ratio';
import { useMediaRatio } from './use-media-ratio';

const setup = (enabled: boolean) => {
  const store = createPageStore();
  store.set({ enabled });
  const editor = { storage: { pagination: { store } } } as unknown as Editor;
  const box = document.createElement('div');
  box.innerHTML = '<iframe width="600" height="300"></iframe>';
  const ref = { current: box };
  const hook = renderHook(() => useMediaRatio(editor, ref, []));
  return { store, box, hook };
};

describe('useMediaRatio', () => {
  it('leaves the Pageless box untouched', () => {
    const { box } = setup(false);
    expect(box.hasAttribute('style')).toBe(false);
  });

  it('publishes when Pages turns on and removes it when Pages turns off', () => {
    const { store, box } = setup(false);
    act(() => store.set({ enabled: true }));
    expect(box.style.getPropertyValue(MEDIA_RATIO_VAR)).toBe('2');
    act(() => store.set({ enabled: false }));
    expect(box.hasAttribute('style')).toBe(false);
  });

  it('works without the pagination extension', () => {
    const box = document.createElement('div');
    box.innerHTML = '<iframe width="600" height="300"></iframe>';
    const editor = { storage: {} } as unknown as Editor;
    renderHook(() => useMediaRatio(editor, { current: box }, []));
    expect(box.hasAttribute('style')).toBe(false);
  });
});
