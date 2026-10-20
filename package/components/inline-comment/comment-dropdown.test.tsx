import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentDropdown } from './comment-dropdown';
import {
  CommentStoreContext,
  createCommentStore,
} from '../../stores/comment-store';

vi.mock('../../stores/comment-store-provider', () => ({
  useCommentRefs: () => ({ dropdownRef: { current: null } }),
}));

describe('CommentDropdown', () => {
  it('shows a fresh draft over a resolved active thread', () => {
    const store = createCommentStore();
    store.setState({ isCommentActive: true, isCommentResolved: true });

    render(
      <CommentStoreContext.Provider value={store}>
        <CommentDropdown />
      </CommentStoreContext.Provider>,
    );

    expect(screen.getByTestId('comment-dropdown-input')).toBeTruthy();
    expect(
      screen.getByTestId('comment-dropdown-send').hasAttribute('disabled'),
    ).toBe(true);
  });

  it('keeps the new-draft dropdown closed over an unresolved active thread', () => {
    const store = createCommentStore();
    store.setState({ isCommentActive: true, isCommentResolved: false });

    render(
      <CommentStoreContext.Provider value={store}>
        <CommentDropdown />
      </CommentStoreContext.Provider>,
    );

    expect(screen.queryByTestId('comment-dropdown-input')).toBeNull();
  });
});
