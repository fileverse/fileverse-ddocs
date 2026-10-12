// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { fromUint8Array } from 'js-base64';
import { useTabManager } from './use-tab-manager';
import { getTabsYdocNodes } from '../components/tabs/utils/tab-utils';

const makeContent = () => {
  const doc = new Y.Doc();
  const nodes = getTabsYdocNodes(doc);
  doc.transact(() => {
    nodes.order.push(['default', 'tab-b']);
    nodes.nameById.set('default', 'Tab 1');
    nodes.nameById.set('tab-b', 'Tab 2');
    nodes.emojiById.set('default', null);
    nodes.emojiById.set('tab-b', null);
    nodes.tabState.set('activeTabId', 'default');
    doc.getXmlFragment('default');
    doc.getXmlFragment('tab-b');
  });
  return fromUint8Array(Y.encodeStateAsUpdate(doc));
};

const setup = ({
  owner,
  collab = false,
  defaultTabId,
  late = false,
}: {
  owner: boolean;
  collab?: boolean;
  defaultTabId?: string;
  late?: boolean;
}) => {
  const ydoc = new Y.Doc();
  const content = makeContent();
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
