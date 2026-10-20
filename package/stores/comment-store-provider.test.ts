import { describe, expect, it } from 'vitest';
import type { IComment } from '../extensions/comment';
import { createCommentStore } from './comment-store';
import { createCommentTimestampLookup } from './comment-store-provider';

describe('comment timestamp lookup', () => {
  it('reuses timestamps across state updates and refreshes on comment changes', () => {
    const store = createCommentStore();
    const getTimestamps = createCommentTimestampLookup();
    const createdAt = new Date('2026-10-20T12:00:00Z');
    const comment = { id: 'first', createdAt } as IComment;

    store.getState().setInitialComments([comment]);
    const firstTabComments = store.getState().tabComments;
    const firstLookup = getTimestamps(firstTabComments);
    expect(firstLookup.get('first')).toBe(createdAt);

    store.getState().setIsCommentActive(true);
    expect(store.getState().tabComments).toBe(firstTabComments);
    expect(getTimestamps(store.getState().tabComments)).toBe(firstLookup);

    const updatedAt = new Date('2026-10-20T13:00:00Z');
    store.getState().setInitialComments([{ ...comment, createdAt: updatedAt }]);
    const updatedLookup = getTimestamps(store.getState().tabComments);
    expect(updatedLookup).not.toBe(firstLookup);
    expect(updatedLookup.get('first')).toBe(updatedAt);
    expect(getTimestamps(store.getState().tabComments)).toBe(updatedLookup);

    store.getState().setActiveTabId('another-tab');
    const otherTabLookup = getTimestamps(store.getState().tabComments);
    expect(otherTabLookup).not.toBe(updatedLookup);
    expect(otherTabLookup.has('first')).toBe(false);
  });
});
