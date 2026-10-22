// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DocumentOutline } from './document-outline';
import { Tab } from '../tabs/utils/tab-utils';

vi.mock('./memorized-toc', () => ({ MemorizedToC: () => null }));

const tabs: Tab[] = [
  { id: 'a', name: 'Alpha', emoji: null },
  { id: 'b', name: 'Beta', emoji: null },
];

const renderOutline = (tabSectionContainer?: HTMLElement) =>
  render(
    <DocumentOutline
      editor={null as never}
      hasToC
      items={[]}
      setItems={vi.fn()}
      showTOC
      setShowTOC={vi.fn()}
      isPreviewMode
      tabs={tabs}
      setTabs={vi.fn()}
      activeTabId="a"
      setActiveTabId={vi.fn()}
      createTab={vi.fn()}
      renameTab={vi.fn()}
      duplicateTab={vi.fn()}
      orderTab={vi.fn()}
      ydoc={new Y.Doc()}
      tabCommentCounts={{}}
      tabSectionContainer={tabSectionContainer}
      isVersionHistoryMode
    />,
  );

describe('version history tabs on a narrow window (1280px or less)', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width:1280px'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("fills the host's tab column when the host gives one", () => {
    const column = document.createElement('div');
    document.body.appendChild(column);
    renderOutline(column);

    const sidebar = within(column).getByTestId('tab-sidebar');
    expect(within(sidebar).getByText('Beta')).toBeTruthy();
    expect(screen.queryByTestId('mobile-tab-panel')).toBeNull();
    column.remove();
  });

  it('shows the phone panel when there is no column', () => {
    renderOutline();
    expect(screen.queryByTestId('tab-sidebar')).toBeNull();
    expect(screen.getByTestId('mobile-tab-panel')).toBeTruthy();
  });
});
