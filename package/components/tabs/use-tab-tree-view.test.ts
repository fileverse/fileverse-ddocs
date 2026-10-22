// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { Tab } from './utils/tab-utils';
import { deleteTabDialogCopy, useTabTreeView } from './use-tab-tree-view';

// Research > Interviews > Round 1, Round 2; Survey under Research; Plan.
const tree: Tab[] = [
  {
    id: 'r',
    name: 'Research',
    emoji: null,
    parentId: null,
    depth: 1,
    hasChildren: true,
  },
  {
    id: 'i',
    name: 'Interviews',
    emoji: null,
    parentId: 'r',
    depth: 2,
    hasChildren: true,
  },
  {
    id: 'r1',
    name: 'Round 1',
    emoji: null,
    parentId: 'i',
    depth: 3,
    hasChildren: false,
  },
  {
    id: 'r2',
    name: 'Round 2',
    emoji: null,
    parentId: 'i',
    depth: 3,
    hasChildren: false,
  },
  {
    id: 's',
    name: 'Survey',
    emoji: null,
    parentId: 'r',
    depth: 2,
    hasChildren: false,
  },
  {
    id: 'plan',
    name: 'Plan',
    emoji: null,
    parentId: null,
    depth: 1,
    hasChildren: false,
  },
];
const flat: Tab[] = [
  { id: 'a', name: 'A', emoji: null },
  { id: 'b', name: 'B', emoji: null },
];

const view = (props: { tabs?: Tab[]; activeTabId?: string; ddocId?: string }) =>
  renderHook(
    ({ tabs, activeTabId, ddocId }) =>
      useTabTreeView({ tabs, activeTabId, ddocId }),
    {
      initialProps: {
        tabs: props.tabs ?? tree,
        activeTabId: props.activeTabId ?? 'plan',
        ddocId: props.ddocId,
      },
    },
  );

const ids = (tabs: Tab[]) => tabs.map((tab) => tab.id);

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('useTabTreeView', () => {
  it('a doc without subtabs: every row visible, no arrows, no indent', () => {
    const { result } = view({ tabs: flat, activeTabId: 'a' });
    expect(ids(result.current.visibleTabs)).toEqual(['a', 'b']);
    expect(result.current.expandStateOf(flat[0])).toBeUndefined();
    expect(result.current.indentOf(flat[1])).toBe(0);
  });

  it('collapsing a group hides everything under it', () => {
    const { result } = view({});
    act(() => result.current.toggleExpand('r'));
    expect(ids(result.current.visibleTabs)).toEqual(['r', 'plan']);
    expect(result.current.expandStateOf(tree[0])).toBe('collapsed');
    expect(result.current.expandStateOf(tree[5])).toBe('leaf');
    act(() => result.current.toggleExpand('r'));
    expect(result.current.visibleTabs).toHaveLength(6);
  });

  it('expands the parents of the tab you go to', () => {
    const hook = view({});
    act(() => hook.result.current.toggleExpand('r'));
    act(() => hook.result.current.toggleExpand('i'));
    hook.rerender({ tabs: tree, activeTabId: 'r1', ddocId: undefined });
    expect(ids(hook.result.current.visibleTabs)).toContain('r1');
  });

  it('remembers collapsed groups per document in this browser', () => {
    const first = view({ ddocId: 'doc-1' });
    act(() => first.result.current.toggleExpand('i'));
    first.unmount();

    const again = view({ ddocId: 'doc-1' });
    expect(ids(again.result.current.visibleTabs)).not.toContain('r1');
    const other = view({ ddocId: 'doc-2' });
    expect(ids(other.result.current.visibleTabs)).toContain('r1');
  });

  it('still works when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = view({ ddocId: 'doc-1' });
    act(() => result.current.toggleExpand('r'));
    expect(ids(result.current.visibleTabs)).toEqual(['r', 'plan']);
  });

  it('knows each tab’s siblings, and nothing across groups', () => {
    const { result } = view({});
    const [, interviews, round1, round2, survey, plan] = tree;
    expect(result.current.previousSiblingOf(round1)).toBeUndefined();
    expect(result.current.nextSiblingOf(round1)?.id).toBe('r2');
    expect(result.current.nextSiblingOf(round2)).toBeUndefined();
    expect(result.current.nextSiblingOf(interviews)?.id).toBe('s');
    expect(result.current.previousSiblingOf(survey)?.id).toBe('i');
    expect(result.current.previousSiblingOf(plan)?.id).toBe('r');
  });

  it('can always delete a subtab, but not the last top-level tab', () => {
    const lone: Tab[] = [
      {
        id: 'only',
        name: 'Only',
        emoji: null,
        parentId: null,
        depth: 1,
        hasChildren: true,
      },
      {
        id: 'sub',
        name: 'Sub',
        emoji: null,
        parentId: 'only',
        depth: 2,
        hasChildren: false,
      },
    ];
    const { result } = view({ tabs: lone, activeTabId: 'only' });
    expect(result.current.canDelete(lone[0])).toBe(false);
    expect(result.current.canDelete(lone[1])).toBe(true);
  });

  it('offers Add subtab up to level 2 only, and caps the indent at level 3', () => {
    const { result } = view({});
    expect(result.current.canAddSubtabTo(tree[0])).toBe(true);
    expect(result.current.canAddSubtabTo(tree[1])).toBe(true);
    expect(result.current.canAddSubtabTo(tree[2])).toBe(false);
    expect(result.current.indentOf(tree[2])).toBe(32);
    expect(
      result.current.indentOf({ ...tree[2], depth: 5 }), // bad data, rule T5
    ).toBe(32);
  });

  it('words the delete dialog for a tab with subtabs', () => {
    expect(deleteTabDialogCopy(tree[0]).title).toBe(
      'Delete this tab and all subtabs?',
    );
    expect(deleteTabDialogCopy(tree[5]).title).toBeUndefined();
  });
});
