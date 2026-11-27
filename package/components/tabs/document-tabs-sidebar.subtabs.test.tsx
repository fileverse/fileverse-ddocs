import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { TabSidebar } from './document-tabs-sidebar';
import { Tab } from './utils/tab-utils';

vi.mock('../toc/memorized-toc', () => ({ MemorizedToC: () => null }));

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

const renderSidebar = (
  overrides: Partial<Parameters<typeof TabSidebar>[0]> = {},
) => {
  const props = {
    tabs: tree,
    setTabs: vi.fn(),
    activeTabId: 'plan',
    setActiveTabId: vi.fn(),
    showTOC: true,
    setShowTOC: vi.fn(),
    hasToC: true,
    isPreviewMode: false,
    editor: null as never,
    items: [],
    setItems: vi.fn(),
    createTab: vi.fn(),
    createSubtab: vi.fn(),
    renameTab: vi.fn(),
    duplicateTab: vi.fn(),
    orderTab: vi.fn(),
    deleteTab: vi.fn(),
    ydoc: new Y.Doc(),
    tabCommentCounts: {},
    tabConfig: { enableSubtabs: true },
    ...overrides,
  };
  const view = render(<TabSidebar {...props} />);
  return {
    ...props,
    rerenderWith: (next: Partial<Parameters<typeof TabSidebar>[0]>) =>
      view.rerender(<TabSidebar {...props} {...next} />),
  };
};

const rowNames = () =>
  screen.getAllByTestId(/^tab-name-/).map((element) => element.textContent);

const openMenu = (tabId: string) => {
  const row = screen.getByTestId(`tab-item-${tabId}`);
  fireEvent.mouseEnter(row);
  fireEvent.click(within(row).getByTestId('tab-context-menu-trigger'));
};

describe('desktop sidebar with subtabs', () => {
  it('shows the tree in reading order with arrows', () => {
    renderSidebar();
    expect(rowNames()).toEqual([
      'Research',
      'Interviews',
      'Round 1',
      'Round 2',
      'Plan',
    ]);
    expect(screen.getByTestId('tab-expand-r')).toBeTruthy();
  });

  it('collapses and expands a group, locally', () => {
    const { setTabs } = renderSidebar();
    fireEvent.click(screen.getByTestId('tab-expand-i'));
    expect(rowNames()).toEqual(['Research', 'Interviews', 'Plan']);
    fireEvent.click(screen.getByTestId('tab-expand-i'));
    expect(rowNames()).toHaveLength(5);
    expect(setTabs).not.toHaveBeenCalled();
  });

  it('expands the parents of a tab when you go to it', () => {
    const { rerenderWith } = renderSidebar();
    fireEvent.click(screen.getByTestId('tab-expand-r'));
    expect(rowNames()).toEqual(['Research', 'Plan']);
    rerenderWith({ activeTabId: 'r1' }); // e.g. opened from a link
    expect(rowNames()).toContain('Round 1');
  });

  it('offers Add subtab, except on a level-3 subtab', () => {
    const { createSubtab } = renderSidebar();
    openMenu('i');
    fireEvent.click(screen.getByTestId('tab-menu-add-subtab'));
    expect(createSubtab).toHaveBeenCalledWith('i');
    openMenu('r1');
    expect(screen.queryByTestId('tab-menu-add-subtab')).toBeNull();
  });

  it('hides Add subtab when the host has not switched subtabs on', () => {
    renderSidebar({ tabConfig: {} });
    openMenu('plan');
    expect(screen.queryByTestId('tab-menu-add-subtab')).toBeNull();
    // The existing tree still shows.
    expect(rowNames()).toHaveLength(5);
  });

  it('moves a subtab only among its siblings', () => {
    const { orderTab } = renderSidebar();
    openMenu('r1');
    expect(screen.queryByTestId('tab-menu-move-up')).toBeNull();
    fireEvent.click(screen.getByTestId('tab-menu-move-down'));
    expect(orderTab).toHaveBeenLastCalledWith('r2', 'r1');
    openMenu('plan');
    fireEvent.click(screen.getByTestId('tab-menu-move-up'));
    expect(orderTab).toHaveBeenLastCalledWith('r', 'plan');
  });

  it('warns that a tab with subtabs deletes all of them', () => {
    renderSidebar();
    openMenu('i');
    fireEvent.click(screen.getByTestId('tab-menu-delete-tab'));
    expect(screen.getByText('Delete this tab and all subtabs?')).toBeTruthy();
    expect(
      screen.getByText(
        'This tab and all its content, including subtabs, will be deleted',
      ),
    ).toBeTruthy();
  });

  it('lines the outline up under its own tab at every level', () => {
    renderSidebar({ activeTabId: 'r1' });
    fireEvent.click(screen.getByTestId('tab-item-r1')); // show its outline
    // Level 3 (two indents of 16px) plus the arrow column (24px).
    expect(screen.getByTestId('tab-outline-r1').style.paddingLeft).toBe('56px');
  });

  it('a doc without subtabs keeps the outline where it was', () => {
    renderSidebar({
      tabs: [
        { id: 'a', name: 'A', emoji: null },
        { id: 'b', name: 'B', emoji: null },
      ],
      activeTabId: 'a',
    });
    fireEvent.click(screen.getByTestId('tab-item-a'));
    expect(screen.getByTestId('tab-outline-a').style.paddingLeft).toBe('');
  });

  it('a doc without subtabs shows no arrows and no indent', () => {
    renderSidebar({
      tabs: [
        { id: 'a', name: 'A', emoji: null },
        { id: 'b', name: 'B', emoji: null },
      ],
      activeTabId: 'a',
    });
    expect(screen.queryByTestId('tab-expand-a')).toBeNull();
    expect(rowNames()).toEqual(['A', 'B']);
  });
});

describe('dragging a tab', () => {
  // jsdom has no PointerEvent; the drag sensor needs isPrimary and button.
  if (!window.PointerEvent) {
    class TestPointerEvent extends MouseEvent {
      isPrimary: boolean;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.isPrimary = init.isPrimary ?? true;
      }
    }
    window.PointerEvent = TestPointerEvent as typeof PointerEvent;
  }

  // A press, then a move past the 5px activation distance.
  const dragRow = (tabId: string) => {
    const row = screen.getByTestId(`tab-item-${tabId}`);
    fireEvent.pointerDown(row, {
      button: 0,
      isPrimary: true,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(document, { clientX: 0, clientY: 30 });
  };

  it('starts in the editor', () => {
    renderSidebar();
    dragRow('plan');
    expect(screen.queryByTestId('tab-drag-preview')).not.toBeNull();
  });

  const mockRowRects = () =>
    vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const id = this.dataset.testid;
        const index = tree.findIndex((tab) => id === `tab-item-${tab.id}`);
        return new DOMRect(0, Math.max(0, index) * 50, 200, 40);
      });

  it('does not highlight an invalid drop target', () => {
    const reparentTab = vi.fn(() => ({
      ok: false as const,
      reason: 'third-level' as const,
    }));
    renderSidebar({ reparentTab });
    const rects = mockRowRects();
    try {
      const source = screen.getByTestId('tab-item-plan');
      const target = screen.getByTestId('tab-item-r1');
      fireEvent.pointerDown(source, { button: 0, clientX: 30, clientY: 220 });
      fireEvent.pointerMove(document, { clientX: 30, clientY: 210 });
      fireEvent.pointerMove(document, { clientX: 30, clientY: 120 });
      expect(target.getAttribute('data-drop-intent')).toBe('invalid');
      expect(target.classList.contains('color-bg-default-hover')).toBe(false);
      expect(target.classList.contains('hover:color-bg-default-hover')).toBe(
        false,
      );
      fireEvent.pointerUp(document, { clientX: 30, clientY: 120 });
      expect(reparentTab).toHaveBeenCalledWith('plan', 'r1');
    } finally {
      rects.mockRestore();
    }
  });

  it.each([
    ['before', 101],
    ['after', 139],
  ])(
    'shows an insertion line and moves to another group when dropped %s a row',
    (placement, y) => {
      const reparentTab = vi.fn(() => ({ ok: true as const, parentId: 'i' }));
      const { orderTab } = renderSidebar({ reparentTab });
      const rects = mockRowRects();
      try {
        const source = screen.getByTestId('tab-item-plan');
        const target = screen.getByTestId('tab-item-r1');
        fireEvent.pointerDown(source, { button: 0, clientX: 30, clientY: 220 });
        fireEvent.pointerMove(document, { clientX: 30, clientY: 210 });
        fireEvent.pointerMove(document, { clientX: 30, clientY: y });
        expect(target.getAttribute('data-drop-intent')).toBe(placement);
        fireEvent.pointerUp(document, { clientX: 30, clientY: y });
        expect(reparentTab).toHaveBeenCalledWith('plan', 'r1', placement);
        expect(orderTab).not.toHaveBeenCalled();
      } finally {
        rects.mockRestore();
      }
    },
  );

  it('places the line after the last visible descendant at the target parent’s level', () => {
    const reparentTab = vi.fn(() => ({ ok: true as const, parentId: null }));
    renderSidebar({ reparentTab });
    const rects = mockRowRects();
    try {
      const source = screen.getByTestId('tab-item-plan');
      fireEvent.pointerDown(source, { button: 0, clientX: 30, clientY: 220 });
      fireEvent.pointerMove(document, { clientX: 30, clientY: 210 });
      fireEvent.pointerMove(document, { clientX: 30, clientY: 39 });
      expect(
        screen.getByTestId('tab-item-r').getAttribute('data-drop-intent'),
      ).toBeNull();
      const lastChild = screen.getByTestId('tab-item-r2');
      expect(lastChild.getAttribute('data-drop-intent')).toBe('after');
      expect(lastChild.style.getPropertyValue('--tab-drop-indent')).toBe('0px');

      fireEvent.pointerMove(document, { clientX: 30, clientY: 51 });
      const firstChild = screen.getByTestId('tab-item-i');
      expect(firstChild.getAttribute('data-drop-intent')).toBe('before');
      expect(firstChild.style.getPropertyValue('--tab-drop-indent')).toBe(
        '16px',
      );
      fireEvent.pointerUp(document, { clientX: 30, clientY: 51 });
      expect(reparentTab).toHaveBeenCalledWith('plan', 'i', 'before');
    } finally {
      rects.mockRestore();
    }
  });

  it.each([
    ['a viewer', { isPreviewMode: true }],
    ['version history', { isVersionHistoryMode: true }],
  ])('never starts for %s', (_label, mode) => {
    renderSidebar(mode);
    dragRow('plan');
    expect(screen.queryByTestId('tab-drag-preview')).toBeNull();
  });
});

describe('row hover', () => {
  it('colours a row on hover at every level', () => {
    renderSidebar();
    ['r', 'i', 'r1', 'plan'].forEach((tabId) =>
      expect(screen.getByTestId(`tab-item-${tabId}`).className).toContain(
        'hover:color-bg-default-hover',
      ),
    );
  });
});

describe('Move into and Move out menu', () => {
  it('opens eligible destinations with the keyboard without switching tabs', () => {
    const reparentTab = vi.fn(() => ({ ok: true as const, parentId: 'i' }));
    const { setActiveTabId } = renderSidebar({ reparentTab });
    const trigger = within(screen.getByTestId('tab-item-plan')).getByRole(
      'button',
      { name: 'Tab options' },
    );
    fireEvent.keyDown(trigger, { key: 'Enter' });
    const submenu = screen.getByTestId('tab-menu-move-into');
    fireEvent.keyDown(submenu, { key: 'ArrowRight' });
    expect(screen.queryByRole('menuitem', { name: 'Round 1' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Interviews' })).not.toBeNull();
    expect(reparentTab).not.toHaveBeenCalled();
    expect(setActiveTabId).not.toHaveBeenCalled();
  });

  it('offers Move out by itself when there is no other destination', () => {
    const reparentTab = vi.fn(() => ({ ok: true as const, parentId: null }));
    renderSidebar({ reparentTab, tabs: tree.slice(0, -1), activeTabId: 'i' });
    const trigger = within(screen.getByTestId('tab-item-i')).getByRole(
      'button',
      { name: 'Tab options' },
    );
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(screen.queryByTestId('tab-menu-move-into')).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Move out' })).not.toBeNull();
  });
});
