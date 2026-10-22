// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { IComment } from '../../extensions/comment';
import { useCommentDrawerFilters } from './use-comment-drawer-filters';

const tree = [
  { id: 'r', name: 'Research', emoji: null, parentId: null, depth: 1 },
  { id: 'i', name: 'Interviews', emoji: null, parentId: 'r', depth: 2 },
  { id: 'r1', name: 'Round 1', emoji: null, parentId: 'i', depth: 3 },
  { id: 'plan', name: 'Plan', emoji: null, parentId: null, depth: 1 },
];

const comment = (id: string, tabId: string) =>
  ({ id, tabId, resolved: false, deleted: false }) as unknown as IComment;

describe('comments drawer tab filter with subtabs', () => {
  it('lists tabs in reading order with their depth', () => {
    const { result } = renderHook(() =>
      useCommentDrawerFilters({ activeTabId: 'r', comments: [], tabs: tree }),
    );
    expect(result.current.tabList.map((o) => [o.label, o.depth])).toEqual([
      ['All tabs', undefined],
      ['Research', 1],
      ['Interviews', 2],
      ['Round 1', 3],
      ['Plan', 1],
    ]);
  });

  it('a doc without subtabs lists every tab at depth 1', () => {
    const { result } = renderHook(() =>
      useCommentDrawerFilters({
        activeTabId: 'a',
        comments: [],
        tabs: [
          { id: 'a', name: 'A', emoji: null },
          { id: 'b', name: 'B', emoji: null },
        ],
      }),
    );
    expect(result.current.tabList.slice(1).map((o) => o.depth)).toEqual([1, 1]);
  });

  it('filtering by a tab shows its own comments only, as for tabs today', () => {
    const comments = [
      comment('c1', 'r'),
      comment('c2', 'i'),
      comment('c3', 'r1'),
    ];
    const { result } = renderHook(() =>
      useCommentDrawerFilters({ activeTabId: 'r', comments, tabs: tree }),
    );
    act(() => result.current.setTab('i'));
    expect(result.current.filteredComments.map((c) => c.id)).toEqual(['c2']);
  });
});
