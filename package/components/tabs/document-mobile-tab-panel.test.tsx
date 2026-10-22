import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
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

  it('renames the tapped row from a modal', () => {
    const { renameTab } = renderPanel();
    openMenu('b');
    fireEvent.click(screen.getByTestId('tab-menu-rename'));
    expect(screen.queryByTestId('tab-rename-input')).toBeNull();
    expect(screen.getByText('Rename tab')).toBeTruthy();
    const input = screen.getByTestId('tab-rename-modal-input');
    expect((input as HTMLInputElement).value).toBe('Second');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(renameTab).toHaveBeenCalledWith('b', { newName: 'Renamed' });
  });

  it('renames the active tab from the collapsed bar menu in a modal', () => {
    const { renameTab } = renderPanel();
    fireEvent.click(screen.getByTestId('mobile-tab-close'));
    fireEvent.click(screen.getByTestId('tab-context-menu-trigger'));
    fireEvent.click(screen.getByTestId('tab-menu-rename'));
    const input = screen.getByTestId('tab-rename-modal-input');
    expect((input as HTMLInputElement).value).toBe('First');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(renameTab).toHaveBeenCalledWith('a', { newName: 'Renamed' });
  });

  it('cancelling the rename modal changes nothing', () => {
    const { renameTab } = renderPanel();
    openMenu('b');
    fireEvent.click(screen.getByTestId('tab-menu-rename'));
    fireEvent.change(screen.getByTestId('tab-rename-modal-input'), {
      target: { value: 'Renamed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(renameTab).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tab-rename-modal-input')).toBeNull();
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

const layoutProps = {
  tabs: [{ id: 'default', name: 'Tab 1' }],
  setTabs: () => {},
  activeTabId: 'default',
  setActiveTabId: () => {},
  editor: {} as Editor,
  items: [],
  setItems: () => {},
  renameTab: () => {},
  createTab: () => {},
  duplicateTab: () => {},
  tabCommentCounts: {},
  isPreviewMode: false,
  isVersionHistoryMode: false,
} as unknown as React.ComponentProps<typeof DocumentMobileTabPanel>;

describe('DocumentMobileTabPanel layout', () => {
  it('stays fixed to the viewport by default', () => {
    const { getByTestId } = render(<DocumentMobileTabPanel {...layoutProps} />);
    const panel = getByTestId('mobile-tab-panel');
    expect(panel.className).toContain('fixed');
    expect(panel.style.bottom).not.toBe('');
  });

  it('portals into the slot when contained', () => {
    const slot = document.body.appendChild(document.createElement('div'));
    const { container } = render(
      <DocumentMobileTabPanel
        {...layoutProps}
        layout="contained"
        tabPanelSlot={slot}
      />,
    );
    expect(
      container.querySelector('[data-testid="mobile-tab-panel"]'),
    ).toBeNull();
    const panel = slot.querySelector<HTMLElement>(
      '[data-testid="mobile-tab-panel"]',
    )!;
    expect(panel.className).toContain('absolute');
    expect(panel.className).not.toContain('fixed');
    expect(panel.style.bottom).toBe('');
  });

  it('renders nothing when contained and the slot is not attached', () => {
    const { container } = render(
      <DocumentMobileTabPanel
        {...layoutProps}
        layout="contained"
        tabPanelSlot={null}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
