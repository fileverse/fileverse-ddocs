// The tab writes of use-tab-manager.ts at package 7.0.0 (5cbca5fc), lifted out of
// the hook into plain functions with the same transactions. Used only by tests
// to play an older app. Do not edit.
import * as Y from 'yjs';
import {
  DEFAULT_TAB_ID,
  cloneFragmentContent,
  getActiveTabIdFromNodes,
  getTabMetadata,
  getTabsYdocNodes,
} from './v7-tab-utils';

export interface V7DeleteSnapshot {
  tabId: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
}

export const v7CreateTab = (
  ydoc: Y.Doc,
  tabId: string,
  shouldSyncActiveTab = false,
) => {
  const tabNodes = getTabsYdocNodes(ydoc);
  const tabOrder = tabNodes.order;
  const newTab = { name: `Tab ${tabOrder.length + 1}`, emoji: null, id: tabId };
  ydoc.transact(() => {
    tabNodes.nameById.set(newTab.id, newTab.name);
    tabNodes.emojiById.set(newTab.id, newTab.emoji);
    ydoc.getXmlFragment(newTab.id);
    if (shouldSyncActiveTab) tabNodes.tabState.set('activeTabId', tabId);
    tabOrder.push([newTab.id]);
  });
  return tabId;
};

export const v7DeleteTab = (
  ydoc: Y.Doc,
  tabId: string,
  shouldSyncActiveTab = false,
): { snapshot: V7DeleteSnapshot | null; fallbackId: string | null } => {
  const tabNodes = getTabsYdocNodes(ydoc);
  const { order: tabOrder } = tabNodes;
  if (tabOrder.length <= 1) {
    throw new Error('Cannot delete the last remaining tab');
  }
  const index = tabOrder.toArray().indexOf(tabId);
  if (index === -1) throw new Error('Tab not found in order');
  const tabMeta = getTabMetadata(tabNodes, tabId);
  const snapshot = tabMeta
    ? { tabId, name: tabMeta.name, emoji: tabMeta.emoji, orderIndex: index }
    : null;
  const currentActive = getActiveTabIdFromNodes(tabNodes) || '';
  const needsFallback = currentActive === tabId;
  const fallbackId = needsFallback
    ? (tabOrder.get(index + 1) ?? tabOrder.get(index - 1) ?? DEFAULT_TAB_ID)
    : null;
  ydoc.transact(() => {
    tabNodes.nameById.delete(tabId);
    tabNodes.emojiById.delete(tabId);
    tabNodes.deletedById.set(tabId, true);
    if (needsFallback && fallbackId && shouldSyncActiveTab) {
      tabNodes.tabState.set('activeTabId', fallbackId);
    }
    tabOrder.delete(index, 1);
  });
  return { snapshot, fallbackId };
};

export const v7RestoreDeletedTab = (
  ydoc: Y.Doc,
  snapshot: V7DeleteSnapshot,
  shouldSyncActiveTab = false,
) => {
  const tabNodes = getTabsYdocNodes(ydoc);
  const { order: tabOrder } = tabNodes;
  if (tabNodes.nameById.has(snapshot.tabId)) return false;
  ydoc.transact(() => {
    tabNodes.deletedById.delete(snapshot.tabId);
    tabNodes.nameById.set(snapshot.tabId, snapshot.name);
    tabNodes.emojiById.set(snapshot.tabId, snapshot.emoji);
    ydoc.getXmlFragment(snapshot.tabId);
    const insertIndex = Math.min(snapshot.orderIndex, tabOrder.length);
    tabOrder.insert(insertIndex, [snapshot.tabId]);
    if (shouldSyncActiveTab) {
      tabNodes.tabState.set('activeTabId', snapshot.tabId);
    }
  });
  return true;
};

export const v7DuplicateTab = (
  ydoc: Y.Doc,
  tabId: string,
  newTabId: string,
  shouldSyncActiveTab = false,
) => {
  const tabNodes = getTabsYdocNodes(ydoc);
  const { order: tabOrder } = tabNodes;
  const originalMeta = getTabMetadata(tabNodes, tabId);
  if (!originalMeta) return undefined;
  ydoc.transact(() => {
    const originalFragment = ydoc.getXmlFragment(tabId);
    const newFragment = ydoc.getXmlFragment(newTabId);
    const clonedNodes = cloneFragmentContent(originalFragment);
    if (clonedNodes.length > 0) newFragment.insert(0, clonedNodes);
    const index = tabOrder.toArray().indexOf(tabId);
    tabOrder.insert(index + 1, [newTabId]);
    tabNodes.nameById.set(newTabId, `${originalMeta.name} (Copy)`);
    tabNodes.emojiById.set(newTabId, originalMeta.emoji);
    if (shouldSyncActiveTab) tabNodes.tabState.set('activeTabId', newTabId);
  });
  return newTabId;
};

export const v7OrderTab = (
  ydoc: Y.Doc,
  destinationTabId: string,
  movedTabId: string,
) => {
  const { order: tabOrder } = getTabsYdocNodes(ydoc);
  const currentOrder = tabOrder.toArray();
  const oldIndex = currentOrder.indexOf(movedTabId);
  const newIndex = currentOrder.indexOf(destinationTabId);
  if (oldIndex === -1 || newIndex === -1) return;
  ydoc.transact(() => {
    tabOrder.delete(oldIndex, 1);
    tabOrder.insert(newIndex, [movedTabId]);
  });
};
