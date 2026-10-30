// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { fromUint8Array } from 'js-base64';
import { useTabManager } from './use-tab-manager';
import { getTabsYdocNodes } from '../components/tabs/utils/tab-utils';

const makeContent = (tabNames = ['Tab 1', 'Tab 2']) => {
  const doc = new Y.Doc();
  const nodes = getTabsYdocNodes(doc);
  const tabIds = ['default', 'tab-b', 'tab-c'];
  doc.transact(() => {
    const ids = tabIds.slice(0, tabNames.length);
    nodes.order.push(ids);
    ids.forEach((id, index) => {
      nodes.nameById.set(id, tabNames[index]);
      nodes.emojiById.set(id, null);
      doc.getXmlFragment(id);
    });
    nodes.tabState.set('activeTabId', 'default');
  });
  return fromUint8Array(Y.encodeStateAsUpdate(doc));
};

const setup = ({
  owner,
  collab = false,
  defaultTabId,
  late = false,
  tabNames,
}: {
  owner: boolean;
  collab?: boolean;
  defaultTabId?: string;
  late?: boolean;
  tabNames?: string[];
}) => {
  const ydoc = new Y.Doc();
  const content = makeContent(tabNames);
  const syncActiveTab = owner && !collab;
  const hook = renderHook(
    ({ initialContent }: { initialContent: string | null }) =>
      useTabManager({
        ydoc,
        initialContent,
        enableCollaboration: collab,
        isDDocOwner: owner,
        createDefaultTabIfMissing: syncActiveTab,
        shouldSyncActiveTab: syncActiveTab,
        defaultTabId,
        preferFirstTabOnInit: !owner,
      }),
    { initialProps: { initialContent: late ? null : content } },
  );
  if (late) hook.rerender({ initialContent: content });
  const persistedActiveTabId = () =>
    getTabsYdocNodes(ydoc).tabState.get('activeTabId');
  return { hook, persistedActiveTabId };
};

describe('useTabManager defaultTabId', () => {
  describe.each([false, true])('content arriving late: %s', (late) => {
    it('opens the deep-linked tab for the owner', () => {
      const { hook, persistedActiveTabId } = setup({
        owner: true,
        defaultTabId: 'tab-b',
        late,
      });
      expect(hook.result.current.activeTabId).toBe('tab-b');
      expect(persistedActiveTabId()).toBe('tab-b');
    });

    it('opens the deep-linked tab for a viewer', () => {
      const { hook } = setup({ owner: false, defaultTabId: 'tab-b', late });
      expect(hook.result.current.activeTabId).toBe('tab-b');
    });

    it('ignores a tab id that no longer exists', () => {
      const { hook, persistedActiveTabId } = setup({
        owner: true,
        defaultTabId: 'deleted-tab',
        late,
      });
      expect(hook.result.current.activeTabId).toBe('default');
      expect(persistedActiveTabId()).toBe('default');
    });

    it('does not pull back to the deep-linked tab after a tab change', () => {
      const { hook } = setup({
        owner: true,
        collab: true,
        defaultTabId: 'tab-b',
        late,
      });
      expect(hook.result.current.activeTabId).toBe('tab-b');

      act(() => hook.result.current.setActiveTabId('default'));
      act(() => hook.result.current.renameTab('tab-b', { newName: 'Renamed' }));
      expect(hook.result.current.activeTabId).toBe('default');
    });
  });
});

describe('useTabManager tab names', () => {
  it('does not reuse an existing name after deleting a middle default tab', () => {
    const { hook } = setup({
      owner: true,
      tabNames: ['Tab 1', 'Tab 2', 'Tab 3'],
    });

    act(() => hook.result.current.deleteTab('tab-b'));
    act(() => hook.result.current.createTab());

    expect(hook.result.current.tabs.map((tab) => tab.name)).toEqual([
      'Tab 1',
      'Tab 3',
      'Tab 4',
    ]);
  });

  it('continues after a manually named default tab number', () => {
    const { hook } = setup({
      owner: true,
      tabNames: ['Notes', 'Tab 8'],
    });

    act(() => hook.result.current.createTab());

    expect(hook.result.current.tabs.map((tab) => tab.name)).toEqual([
      'Notes',
      'Tab 8',
      'Tab 9',
    ]);
  });
});
