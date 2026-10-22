// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { fromUint8Array } from 'js-base64';
import { useTabManager } from './use-tab-manager';
import { getTabsYdocNodes } from '../components/tabs/utils/tab-utils';
import {
  createSubtabInDoc,
  deleteTabInDoc,
} from '../components/tabs/utils/tab-operations';

const toastMock = vi.hoisted(() => vi.fn());
vi.mock('@fileverse/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@fileverse/ui')>()),
  toast: toastMock,
}));

/*
 * The hook around the tab operations: which tab is open after each action,
 * undo with Ctrl+Z, and the notice when someone else deletes your tab.
 *
 *   Research (default)
 *     Interviews (i)
 *       Round 1 (r1)
 *   Plan (plan)
 */

const makeContent = () => {
  const doc = new Y.Doc();
  const nodes = getTabsYdocNodes(doc);
  doc.transact(() => {
    nodes.order.push(['default', 'plan']);
    nodes.nameById.set('default', 'Research');
    nodes.nameById.set('plan', 'Plan');
    nodes.emojiById.set('default', null);
    nodes.emojiById.set('plan', null);
    nodes.tabState.set('activeTabId', 'default');
  });
  createSubtabInDoc(doc, 'default', 'i', false);
  createSubtabInDoc(doc, 'i', 'r1', false);
  return fromUint8Array(Y.encodeStateAsUpdate(doc));
};

const setup = ({ owner }: { owner: boolean }) => {
  const ydoc = new Y.Doc();
  const flushPendingUpdate = vi.fn();
  const syncActiveTab = owner;
  const initialContent = makeContent(); // built once, as the editor receives it
  const hook = renderHook(() =>
    useTabManager({
      ydoc,
      initialContent,
      enableCollaboration: !owner,
      isDDocOwner: owner,
      createDefaultTabIfMissing: syncActiveTab,
      shouldSyncActiveTab: syncActiveTab,
      flushPendingUpdate,
    }),
  );
  return { hook, ydoc, flushPendingUpdate };
};

const pressUndo = () =>
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
    );
  });

const tabIds = (hook: ReturnType<typeof setup>['hook']) =>
  hook.result.current.tabs.map((tab) => tab.id);

beforeEach(() => toastMock.mockClear());

describe.each([true, false])(
  'useTabManager with subtabs (owner: %s)',
  (owner) => {
    it('shows the tree and opens a new subtab', () => {
      const { hook, flushPendingUpdate } = setup({ owner });
      expect(tabIds(hook)).toEqual(['default', 'i', 'r1', 'plan']);
      let newId: string | null = null;
      act(() => {
        newId = hook.result.current.createSubtab('plan');
      });
      expect(newId).not.toBeNull();
      expect(hook.result.current.activeTabId).toBe(newId);
      expect(tabIds(hook)).toEqual(['default', 'i', 'r1', 'plan', newId]);
      expect(flushPendingUpdate).toHaveBeenCalled();
    });

    it('does nothing for a subtab under a level-3 tab', () => {
      const { hook, flushPendingUpdate } = setup({ owner });
      act(() => {
        expect(hook.result.current.createSubtab('r1')).toBeNull();
      });
      expect(tabIds(hook)).toHaveLength(4);
      expect(flushPendingUpdate).not.toHaveBeenCalled();
    });

    it('deleting the open subtab opens its parent, with no notice', () => {
      const { hook } = setup({ owner });
      act(() => hook.result.current.setActiveTabId('r1'));
      act(() => hook.result.current.deleteTab('i'));
      expect(hook.result.current.activeTabId).toBe('default');
      expect(tabIds(hook)).toEqual(['default', 'plan']);
      expect(toastMock).not.toHaveBeenCalled();
    });

    it('Ctrl+Z within 10 seconds brings the whole group back', () => {
      const { hook } = setup({ owner });
      act(() => hook.result.current.deleteTab('i'));
      expect(tabIds(hook)).toEqual(['default', 'plan']);
      pressUndo();
      expect(tabIds(hook)).toEqual(['default', 'i', 'r1', 'plan']);
      expect(hook.result.current.activeTabId).toBe('i');
    });

    it('Ctrl+Z after 10 seconds does not restore', () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        const { hook } = setup({ owner });
        act(() => hook.result.current.deleteTab('i'));
        vi.setSystemTime(Date.now() + 10_001);
        pressUndo();
        expect(tabIds(hook)).toEqual(['default', 'plan']);
      } finally {
        vi.useRealTimers();
      }
    });

    it('moves only among siblings', () => {
      const { hook } = setup({ owner });
      act(() => hook.result.current.orderTab('default', 'plan'));
      expect(tabIds(hook)).toEqual(['plan', 'default', 'i', 'r1']);
      act(() => hook.result.current.orderTab('plan', 'r1')); // across groups
      expect(tabIds(hook)).toEqual(['plan', 'default', 'i', 'r1']);
    });

    it('duplicates a group and opens the copy', () => {
      const { hook } = setup({ owner });
      act(() => {
        hook.result.current.duplicateTab('i');
      });
      const tabs = hook.result.current.tabs;
      expect(tabs.map((t) => t.depth)).toEqual([1, 2, 3, 2, 3, 1]);
      expect(hook.result.current.activeTabId).toBe(tabs[3].id);
      expect(tabs[3].name).toBe('Subtab 1 (Copy)');
    });
  },
);

describe('when someone else deletes your tab', () => {
  it('falls back to the nearest remaining parent and shows a notice', () => {
    const { hook, ydoc } = setup({ owner: false });
    act(() => hook.result.current.setActiveTabId('r1'));

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
    deleteTabInDoc(peer, 'i', 'i', false);
    act(() => {
      Y.applyUpdate(
        ydoc,
        Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc)),
      );
    });

    expect(hook.result.current.activeTabId).toBe('default');
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'This tab was deleted' }),
    );
  });

  it('a subtab added while someone deletes its parent is left, with a notice', () => {
    const { hook, ydoc } = setup({ owner: false });
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));

    // Under the first tab, so after the delete the hidden subtab is the first
    // id in the order list.
    let newId: string | null = null;
    act(() => {
      newId = hook.result.current.createSubtab('default');
    });
    expect(hook.result.current.activeTabId).toBe(newId);

    deleteTabInDoc(peer, 'default', 'default', false);
    act(() => {
      Y.applyUpdate(
        ydoc,
        Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc)),
      );
    });

    // The new subtab is still in the order list, but hidden under the deleted
    // tab, so it must not stay open.
    expect(tabIds(hook)).not.toContain(newId);
    expect(tabIds(hook)).toContain(hook.result.current.activeTabId);
    expect(toastMock).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+Z does not open a tab whose parent someone deleted meanwhile', () => {
    const { hook, ydoc } = setup({ owner: false });
    act(() => hook.result.current.setActiveTabId('r1'));
    act(() => hook.result.current.deleteTab('r1')); // opens its parent, i

    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc));
    deleteTabInDoc(peer, 'i', 'i', false);
    act(() => {
      Y.applyUpdate(
        ydoc,
        Y.encodeStateAsUpdate(peer, Y.encodeStateVector(ydoc)),
      );
    });
    pressUndo();

    expect(tabIds(hook)).not.toContain('r1');
    expect(tabIds(hook)).toContain(hook.result.current.activeTabId);
  });

  it('no notice when a collaborator opens a doc whose first tab is not "default"', () => {
    const server = new Y.Doc();
    const nodes = getTabsYdocNodes(server);
    server.transact(() => {
      nodes.order.push(['abc', 'plan']);
      nodes.nameById.set('abc', 'First');
      nodes.nameById.set('plan', 'Plan');
      nodes.emojiById.set('abc', null);
      nodes.emojiById.set('plan', null);
    });
    createSubtabInDoc(server, 'plan', 'q4', false);

    const ydoc = new Y.Doc();
    const flushPendingUpdate = vi.fn(); // built once, or every render loops
    const hook = renderHook(() =>
      useTabManager({
        ydoc,
        initialContent: null,
        enableCollaboration: true,
        isDDocOwner: false,
        createDefaultTabIfMissing: false,
        shouldSyncActiveTab: false,
        flushPendingUpdate,
      }),
    );
    act(() => {
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(server));
    });

    expect(hook.result.current.activeTabId).toBe('abc');
    expect(toastMock).not.toHaveBeenCalled();
  });
});
