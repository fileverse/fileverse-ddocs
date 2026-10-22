import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentMobileTabPanel } from './document-mobile-tab-panel';
import { Tab } from './utils/tab-utils';

vi.mock('../toc/memorized-toc', () => ({ MemorizedToC: () => null }));

// Research > Interviews > Round 1, Round 2; then Plan.
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
    id: 'plan',
    name: 'Plan',
    emoji: null,
    parentId: null,
    depth: 1,
    hasChildren: false,
  },
];

const renderPanel = (
  overrides: Partial<Parameters<typeof DocumentMobileTabPanel>[0]> = {},
  { openList = true } = {},
) => {
  const props = {
    tabs: tree,
    setTabs: vi.fn(),
    activeTabId: 'plan',
    setActiveTabId: vi.fn(),
    editor: null as never,
    items: [],
    setItems: vi.fn(),
    renameTab: vi.fn(),
    createTab: vi.fn(),
    createSubtab: vi.fn(),
    duplicateTab: vi.fn(),
    orderTab: vi.fn(),
    deleteTab: vi.fn(),
    tabCommentCounts: {},
    isPreviewMode: false,
    isVersionHistoryMode: false,
    tabConfig: { enableSubtabs: true },
    ...overrides,
  };
  render(<DocumentMobileTabPanel {...props} />);
  if (openList) fireEvent.click(screen.getByText('Tap to see all'));
  return props;
};

const rowNames = () =>
  screen.getAllByTestId(/^tab-name-/).map((element) => element.textContent);

const openMenu = (tabId: string) =>
  fireEvent.click(
    within(screen.getByTestId(`tab-item-${tabId}`)).getByTestId(
      'tab-context-menu-trigger',
    ),
  );

describe('mobile tab panel with subtabs', () => {
  it('lists the tree in reading order, indented, with arrows', () => {
    renderPanel();
    expect(rowNames()).toEqual([
      'Research',
      'Interviews',
      'Round 1',
      'Round 2',
      'Plan',
    ]);
    expect(screen.getByTestId('tab-expand-r')).toBeTruthy();
  });

  it('collapses a group', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('tab-expand-i'));
    expect(rowNames()).toEqual(['Research', 'Interviews', 'Plan']);
  });

  it('adds a subtab from a row menu, except under a level-3 subtab', () => {
    const { createSubtab } = renderPanel();
    openMenu('i');
    fireEvent.click(screen.getByTestId('tab-menu-add-subtab'));
    expect(createSubtab).toHaveBeenCalledWith('i');
    openMenu('r1');
    expect(screen.queryByTestId('tab-menu-add-subtab')).toBeNull();
  });

  it('adds a subtab under the open tab from the bar menu', () => {
    const { createSubtab } = renderPanel({}, { openList: false });
    fireEvent.click(screen.getByTestId('tab-context-menu-trigger'));
    fireEvent.click(screen.getByTestId('tab-menu-add-subtab'));
    expect(createSubtab).toHaveBeenCalledWith('plan');
  });

  it('hides Add subtab when the host has not switched subtabs on', () => {
    renderPanel({ tabConfig: {} });
    openMenu('plan');
    expect(screen.queryByTestId('tab-menu-add-subtab')).toBeNull();
    expect(rowNames()).toHaveLength(5); // the existing tree still shows
  });

  it('moves a subtab only among its siblings', () => {
    const { orderTab } = renderPanel();
    openMenu('r1');
    expect(screen.queryByTestId('tab-menu-move-up')).toBeNull();
    fireEvent.click(screen.getByTestId('tab-menu-move-down'));
    expect(orderTab).toHaveBeenLastCalledWith('r2', 'r1');
    openMenu('plan');
    fireEvent.click(screen.getByTestId('tab-menu-move-up'));
    expect(orderTab).toHaveBeenLastCalledWith('r', 'plan');
  });

  it('warns that deleting a tab with subtabs deletes them too', () => {
    renderPanel();
    openMenu('i');
    fireEvent.click(screen.getByTestId('tab-menu-delete-tab'));
    expect(screen.getByText('Delete this tab and all subtabs?')).toBeTruthy();
  });

  it('keeps the plain delete wording for a tab without subtabs', () => {
    renderPanel();
    openMenu('plan');
    fireEvent.click(screen.getByTestId('tab-menu-delete-tab'));
    expect(screen.getByText('Delete this tab?')).toBeTruthy();
  });

  it('never offers to delete the last top-level tab', () => {
    renderPanel({
      tabs: [
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
      ],
      activeTabId: 'only',
    });
    openMenu('only');
    expect(screen.queryByTestId('tab-menu-delete-tab')).toBeNull();
    openMenu('sub');
    expect(screen.getByTestId('tab-menu-delete-tab')).toBeTruthy();
  });
});
