import { describe, it, expect, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { createPageStore } from '../extensions/pagination/page-store';
import { getExactPageCount, subscribePagesCount } from './use-tab-editor';

const setup = () => {
  const store = createPageStore();
  const editor = { storage: { pagination: { store } } } as unknown as Editor;
  const onCount = vi.fn();
  const onInexact = vi.fn();
  const off = subscribePagesCount(editor, onCount, onInexact);
  return { store, editor, onCount, onInexact, off };
};

describe('subscribePagesCount', () => {
  it('publishes the store count immediately, then each change', () => {
    const { store, onCount } = setup();
    store.set({ enabled: true, pageCount: 7 });
    expect(onCount).toHaveBeenLastCalledWith(7);
    store.set({ pageCount: 8 });
    expect(onCount).toHaveBeenLastCalledWith(8);
  });

  it('does not republish an unchanged count', () => {
    const { store, onCount } = setup();
    store.set({ enabled: true, pageCount: 7 });
    store.set({ pageStarts: [] });
    store.set({ placement: null });
    expect(onCount).toHaveBeenCalledTimes(1);
  });

  it('skips a null count and signals the fallback when it goes away', () => {
    const { store, onCount, onInexact } = setup();
    store.set({ enabled: true, pageCount: null });
    expect(onCount).not.toHaveBeenCalled();
    expect(onInexact).not.toHaveBeenCalled();
    store.set({ pageCount: 3 });
    store.set({ pageCount: null });
    expect(onInexact).toHaveBeenCalledTimes(1);
  });

  it('signals the counter path to resume when Pages turns off', () => {
    const { store, onInexact } = setup();
    store.set({ enabled: true, pageCount: 7 });
    store.set({ enabled: false, pageCount: null });
    expect(onInexact).toHaveBeenCalledTimes(1);
  });

  it('stops after unsubscribe and tolerates editors without pagination', () => {
    const { store, onCount, off } = setup();
    off();
    store.set({ enabled: true, pageCount: 2 });
    expect(onCount).not.toHaveBeenCalled();
    const bare = { storage: {} } as unknown as Editor;
    expect(getExactPageCount(bare)).toBeNull();
    expect(subscribePagesCount(bare, vi.fn(), vi.fn())).toBeTypeOf('function');
  });

  it('getExactPageCount is null while disabled', () => {
    const { store, editor } = setup();
    store.set({ enabled: false, pageCount: 5 });
    expect(getExactPageCount(editor)).toBeNull();
    store.set({ enabled: true });
    expect(getExactPageCount(editor)).toBe(5);
  });
});
