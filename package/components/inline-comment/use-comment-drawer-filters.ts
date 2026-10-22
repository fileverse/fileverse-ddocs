import { useCallback, useState } from 'react';
import type { IComment } from '../../extensions/comment';
import type { Tab } from '../tabs/utils/tab-utils';
import {
  DEFAULT_TAB_ID,
  DEFAULT_TAB_NAME,
  MAX_TAB_DEPTH,
} from '../tabs/utils/tab-utils';
import { ALL_TABS_OPTION_ID } from './comment-drawer-constants';

export const commentTypeOptions = [
  { id: 'all', label: 'All types' },
  { id: 'active', label: 'Active' },
  { id: 'resolved', label: 'Resolved' },
];

interface UseCommentDrawerFiltersProps {
  activeTabId: string;
  comments: IComment[];
  tabs: Tab[];
}

export const useCommentDrawerFilters = ({
  activeTabId,
  comments,
  tabs,
}: UseCommentDrawerFiltersProps) => {
  const [commentType, setCommentType] = useState('active');
  const [tab, setTab] = useState(ALL_TABS_OPTION_ID);
  const [isCommentTypeSelectOpen, setIsCommentTypeSelectOpen] = useState(false);
  const [isTabSelectOpen, setIsTabSelectOpen] = useState(false);

  const resolvedTabs =
    tabs.length > 0
      ? tabs
      : [{ id: DEFAULT_TAB_ID, name: DEFAULT_TAB_NAME, emoji: null }];
  const tabList = [
    { id: ALL_TABS_OPTION_ID, label: 'All tabs' },
    // Tabs come in reading order; a subtab carries its depth for the indent.
    ...resolvedTabs.map((tabOption) => ({
      id: tabOption.id,
      label: tabOption.name,
      depth: Math.min(tabOption.depth ?? 1, MAX_TAB_DEPTH),
    })),
  ];
  const tabNameById = Object.fromEntries(
    resolvedTabs.map((tabOption) => [tabOption.id, tabOption.name]),
  );
  const selectedCommentTabId = tab === ALL_TABS_OPTION_ID ? activeTabId : tab;
  const selectedTabLabel =
    tabList.find((tabOption) => tabOption.id === tab)?.label ??
    DEFAULT_TAB_NAME;

  const filteredComments = comments.filter((comment) => {
    const commentTabId = comment.tabId || DEFAULT_TAB_ID;
    const matchesTab = tab === ALL_TABS_OPTION_ID || commentTabId === tab;

    if (!matchesTab || comment.deleted) {
      return false;
    }

    if (commentType === 'active') {
      return !comment.resolved;
    }

    if (commentType === 'resolved') {
      return Boolean(comment.resolved);
    }

    return true;
  });

  const sectionLabel =
    commentType === 'resolved'
      ? 'Resolved'
      : commentType === 'all'
        ? 'All comments'
        : 'Active';

  const handleCommentTypeSelectOpenChange = useCallback((open: boolean) => {
    setIsCommentTypeSelectOpen(open);

    if (open) {
      setIsTabSelectOpen(false);
    }
  }, []);

  const handleTabSelectOpenChange = useCallback((open: boolean) => {
    setIsTabSelectOpen(open);

    if (open) {
      setIsCommentTypeSelectOpen(false);
    }
  }, []);

  const resetFilters = useCallback(() => {
    // Reset both filters so the empty state can always recover
    // to the full drawer list instead of staying tab-scoped.
    setCommentType('all');
    setTab(ALL_TABS_OPTION_ID);
  }, []);

  const closeFilterSelects = useCallback(() => {
    setIsCommentTypeSelectOpen(false);
    setIsTabSelectOpen(false);
  }, []);

  return {
    closeFilterSelects,
    commentType,
    commentTypeOptions,
    filteredComments,
    handleCommentTypeSelectOpenChange,
    handleTabSelectOpenChange,
    isCommentTypeSelectOpen,
    isTabSelectOpen,
    resetFilters,
    sectionLabel,
    selectedCommentTabId,
    selectedTab: tab,
    selectedTabLabel,
    setCommentType,
    setTab,
    tabList,
    tabNameById,
  };
};
