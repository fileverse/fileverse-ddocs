import { useCallback, useEffect, useMemo, useState } from 'react';
import { MAX_TAB_DEPTH, Tab } from './utils/tab-utils';

/*
 * How the tab tree is shown: which rows are visible, what each row may do,
 * and which groups are collapsed. Shared by the desktop sidebar and the mobile
 * panel so both follow the same rules.
 *
 * Collapse state is this person's view only. It never goes in the document; it
 * is remembered in this browser per document (when the doc id is known).
 */

const TOP_LEVEL = '';
const parentKeyOf = (tab: Tab | undefined) => tab?.parentId ?? TOP_LEVEL;
const collapseStorageKey = (ddocId: string) => `ddoc-tab-collapse:${ddocId}`;

const readCollapsed = (ddocId?: string): Set<string> => {
  if (!ddocId) return new Set();
  try {
    const stored = window.localStorage.getItem(collapseStorageKey(ddocId));
    const ids: unknown = stored ? JSON.parse(stored) : [];
    return new Set(
      Array.isArray(ids)
        ? ids.filter((id): id is string => typeof id === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
};

const writeCollapsed = (ddocId: string | undefined, ids: Set<string>) => {
  if (!ddocId) return;
  try {
    const key = collapseStorageKey(ddocId);
    if (ids.size === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify([...ids]));
  } catch {
    // Storage blocked or full: collapse still works for this session.
  }
};

export type TabExpandState = 'expanded' | 'collapsed' | 'leaf';

export interface TabTreeView {
  /** Rows to render, in reading order, without those inside collapsed groups. */
  visibleTabs: Tab[];
  /** Tabs directly under a parent (or at the top level), in reading order. */
  childrenOf: (parentId: string | null) => Tab[];
  /** Arrow state for a row; undefined when the doc has no subtabs at all. */
  expandStateOf: (tab: Tab) => TabExpandState | undefined;
  toggleExpand: (tabId: string) => void;
  expand: (tabId: string) => void;
  /** The tab just before / after this one among its siblings. */
  previousSiblingOf: (tab: Tab) => Tab | undefined;
  nextSiblingOf: (tab: Tab) => Tab | undefined;
  /** The last top-level tab cannot be deleted; a subtab always can. */
  canDelete: (tab: Tab) => boolean;
  /** A subtab can be added unless the tab is already at level 3. */
  canAddSubtabTo: (tab: Tab) => boolean;
  /** Left offset in px for a row at this tab's level. */
  indentOf: (tab: Tab) => number;
}

export const TAB_INDENT_PX = 16;

export const useTabTreeView = ({
  tabs,
  activeTabId,
  ddocId,
}: {
  tabs: Tab[];
  activeTabId: string;
  ddocId?: string;
}): TabTreeView => {
  const tabById = useMemo(
    () => new Map(tabs.map((tab) => [tab.id, tab])),
    [tabs],
  );
  const groups = useMemo(() => {
    const byParent = new Map<string, Tab[]>();
    tabs.forEach((tab) => {
      const key = parentKeyOf(tab);
      const siblings = byParent.get(key);
      if (siblings) siblings.push(tab);
      else byParent.set(key, [tab]);
    });
    return byParent;
  }, [tabs]);
  const hasAnySubtabs = useMemo(
    () => tabs.some((tab) => tab.hasChildren),
    [tabs],
  );

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    readCollapsed(ddocId),
  );
  useEffect(() => {
    setCollapsedIds(readCollapsed(ddocId));
  }, [ddocId]);

  const updateCollapsed = useCallback(
    (update: (previous: Set<string>) => Set<string>) => {
      setCollapsedIds((previous) => {
        const next = update(previous);
        if (next !== previous) writeCollapsed(ddocId, next);
        return next;
      });
    },
    [ddocId],
  );

  const toggleExpand = useCallback(
    (tabId: string) =>
      updateCollapsed((previous) => {
        const next = new Set(previous);
        if (!next.delete(tabId)) next.add(tabId);
        return next;
      }),
    [updateCollapsed],
  );

  const expand = useCallback(
    (tabId: string) =>
      updateCollapsed((previous) => {
        if (!previous.has(tabId)) return previous;
        const next = new Set(previous);
        next.delete(tabId);
        return next;
      }),
    [updateCollapsed],
  );

  // The open tab's parents expand when you arrive at it, including from a
  // link. You can still collapse them yourself afterwards.
  useEffect(() => {
    updateCollapsed((previous) => {
      let next = previous;
      const seen = new Set<string>();
      let parentId = tabById.get(activeTabId)?.parentId;
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        if (next.has(parentId)) {
          if (next === previous) next = new Set(previous);
          next.delete(parentId);
        }
        parentId = tabById.get(parentId)?.parentId;
      }
      return next;
    });
  }, [activeTabId, tabById, updateCollapsed]);

  const visibleTabs = useMemo(() => {
    if (collapsedIds.size === 0) return tabs;
    const hiddenUnder = new Set<string>();
    return tabs.filter((tab) => {
      const parentId = tab.parentId;
      const hidden =
        !!parentId && (collapsedIds.has(parentId) || hiddenUnder.has(parentId));
      if (hidden) hiddenUnder.add(tab.id);
      return !hidden;
    });
  }, [tabs, collapsedIds]);

  const childrenOf = useCallback(
    (parentId: string | null) => groups.get(parentId ?? TOP_LEVEL) ?? [],
    [groups],
  );

  const siblingAt = useCallback(
    (tab: Tab, offset: number) => {
      const siblings = groups.get(parentKeyOf(tab)) ?? [];
      const index = siblings.findIndex((sibling) => sibling.id === tab.id);
      return index === -1 ? undefined : siblings[index + offset];
    },
    [groups],
  );

  const topLevelCount = groups.get(TOP_LEVEL)?.length ?? 0;

  return {
    visibleTabs,
    childrenOf,
    expandStateOf: (tab) =>
      hasAnySubtabs
        ? tab.hasChildren
          ? collapsedIds.has(tab.id)
            ? 'collapsed'
            : 'expanded'
          : 'leaf'
        : undefined,
    toggleExpand,
    expand,
    previousSiblingOf: (tab) => siblingAt(tab, -1),
    nextSiblingOf: (tab) => siblingAt(tab, 1),
    canDelete: (tab) => Boolean(tab.parentId) || topLevelCount > 1,
    canAddSubtabTo: (tab) => (tab.depth ?? 1) < MAX_TAB_DEPTH,
    indentOf: (tab) =>
      Math.min((tab.depth ?? 1) - 1, MAX_TAB_DEPTH - 1) * TAB_INDENT_PX,
  };
};

/** The delete dialog's wording: a tab with subtabs says so. */
export const deleteTabDialogCopy = (tab: Tab | null) =>
  tab?.hasChildren
    ? {
        title: 'Delete this tab and all subtabs?',
        text: 'This tab and all its content, including subtabs, will be deleted',
      }
    : { title: undefined, text: undefined };
