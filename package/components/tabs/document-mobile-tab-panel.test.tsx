import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import { DocumentMobileTabPanel } from './document-mobile-tab-panel';

const baseProps = {
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
    const { getByTestId } = render(<DocumentMobileTabPanel {...baseProps} />);
    const panel = getByTestId('mobile-tab-panel');
    expect(panel.className).toContain('fixed');
    expect(panel.style.bottom).not.toBe('');
  });

  it('portals into the slot when contained', () => {
    const slot = document.body.appendChild(document.createElement('div'));
    const { container } = render(
      <DocumentMobileTabPanel
        {...baseProps}
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
        {...baseProps}
        layout="contained"
        tabPanelSlot={null}
      />,
    );
    expect(container.innerHTML).toBe('');
  });
});
