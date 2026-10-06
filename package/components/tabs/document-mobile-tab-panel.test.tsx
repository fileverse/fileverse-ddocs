import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentMobileTabPanel } from './document-mobile-tab-panel';

vi.mock('../toc/memorized-toc', () => ({ MemorizedToC: () => null }));

const tabs = [
  { id: 'a', name: 'First', emoji: null },
  { id: 'b', name: 'Second', emoji: null },
  { id: 'c', name: 'Third', emoji: null },
];

const renderPanel = (
  overrides: Partial<Parameters<typeof DocumentMobileTabPanel>[0]> = {},
) => {
  const props = {
    tabs,
    setTabs: vi.fn(),
    activeTabId: 'a',
    setActiveTabId: vi.fn(),
    editor: null as never,
    items: [],
    setItems: vi.fn(),
    renameTab: vi.fn(),
    createTab: vi.fn(),
    duplicateTab: vi.fn(),
    orderTab: vi.fn(),
    deleteTab: vi.fn(),
    tabCommentCounts: {},
    isPreviewMode: false,
    isVersionHistoryMode: false,
    ...overrides,
  };
  render(<DocumentMobileTabPanel {...props} />);
  fireEvent.click(screen.getByText('Tap to see all'));
  return props;
};

const openMenu = (tabId: string) =>
  fireEvent.click(
    within(screen.getByTestId(`tab-item-${tabId}`)).getByTestId(
      'tab-context-menu-trigger',
    ),
  );

describe('DocumentMobileTabPanel all-tabs view', () => {
  it('shows a menu on every row, not only the active one', () => {
    renderPanel();
    expect(screen.getAllByTestId('tab-context-menu-trigger')).toHaveLength(3);
  });

  it('moves a non-active tab up and down', () => {
    const { orderTab, setActiveTabId } = renderPanel();
    openMenu('b');
    fireEvent.click(screen.getByTestId('tab-menu-move-up'));
    expect(orderTab).toHaveBeenLastCalledWith('a', 'b');
    openMenu('b');
    fireEvent.click(screen.getByTestId('tab-menu-move-down'));
    expect(orderTab).toHaveBeenLastCalledWith('c', 'b');
    expect(setActiveTabId).not.toHaveBeenCalled();
  });

  it('hides the move that is not possible at either end', () => {
    renderPanel();
    openMenu('a');
    expect(screen.queryByTestId('tab-menu-move-up')).toBeNull();
    expect(screen.getByTestId('tab-menu-move-down')).toBeTruthy();
  });

  it('renames the tapped row', () => {
    const { renameTab } = renderPanel();
    openMenu('b');
    fireEvent.click(screen.getByTestId('tab-menu-rename'));
    const input = screen.getByTestId('tab-rename-input');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(renameTab).toHaveBeenCalledWith('b', { newName: 'Renamed' });
  });

  it('confirms before deleting the tapped row', () => {
    const { deleteTab } = renderPanel();
    openMenu('c');
    fireEvent.click(screen.getByTestId('tab-menu-delete-tab'));
    expect(deleteTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tab' }));
    expect(deleteTab).toHaveBeenCalledWith('c');
  });

  it('offers no delete when one tab is left', () => {
    renderPanel({ tabs: [tabs[0]] });
    openMenu('a');
    expect(screen.queryByTestId('tab-menu-delete-tab')).toBeNull();
  });
});
