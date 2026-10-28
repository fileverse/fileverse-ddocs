import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CommentFloatingCard } from '../components/inline-comment/context/types';
import { createCommentStore } from '../stores/comment-store';
import { useHasFloatingComments } from './use-has-floating-comments';

const card = { floatingCardId: 'c1', type: 'draft' } as CommentFloatingCard;

const setup = () => {
  const store = createCommentStore();
  const storeApiRef = { current: store };
  const { result } = renderHook(() => useHasFloatingComments(storeApiRef));
  return { store, result };
};

describe('useHasFloatingComments', () => {
  it('is false when the tab has no floating cards', () => {
    const { store, result } = setup();
    act(() => store.setState({ isDesktopFloatingEnabled: true }));
    expect(result.current).toBe(false);
  });

  it('is true once a card shows and false when it goes', () => {
    const { store, result } = setup();
    act(() =>
      store.setState({ isDesktopFloatingEnabled: true, floatingCards: [card] }),
    );
    expect(result.current).toBe(true);
    act(() => store.setState({ floatingCards: [] }));
    expect(result.current).toBe(false);
  });

  it('is false while desktop floating is disabled', () => {
    const { store, result } = setup();
    act(() =>
      store.setState({
        isDesktopFloatingEnabled: false,
        floatingCards: [card],
      }),
    );
    expect(result.current).toBe(false);
  });

  it('is false without a store', () => {
    const { result } = renderHook(() =>
      useHasFloatingComments({ current: null }),
    );
    expect(result.current).toBe(false);
  });
});
