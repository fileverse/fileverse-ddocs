import * as Y from 'yjs';
import {
  DEFAULT_TAB_ID,
  MAX_TAB_DEPTH,
  Tab,
  cloneFragmentContent,
  getActiveTabIdFromNodes,
  getTabListFromNodes,
  getTabMetadata,
  getTabsYdocNodes,
} from './tab-utils';

/*
 * Every tab write, as one Yjs transaction on the doc. A doc without subtabs
 * takes the same writes as 7.0 (the flat branch of each function), so its
 * bytes, fingerprint and behaviour do not change until a subtab is added.
 */

export interface DeletedTabSnapshot {
  tabId: string;
  name: string;
  emoji: string | null;
  orderIndex: number;
}

const hasSubtabs = (doc: Y.Doc) => getTabsYdocNodes(doc).parentById.size > 0;

export const getTabTree = (doc: Y.Doc): Tab[] =>
  getTabListFromNodes(getTabsYdocNodes(doc));

const depthOf = (tab: Tab | undefined) => tab?.depth ?? 1;

/** The tab and every tab shown under it, in reading order. */
export const getSubtreeIds = (tabs: Tab[], tabId: string): string[] => {
  const index = tabs.findIndex((tab) => tab.id === tabId);
  if (index === -1) return [];
  const rootDepth = depthOf(tabs[index]);
  const ids = [tabId];
  for (let i = index + 1; i < tabs.length; i++) {
    if (depthOf(tabs[i]) <= rootDepth) break;
    ids.push(tabs[i].id);
  }
  return ids;
};

export const canAddSubtab = (tab: Tab | undefined) =>
  Boolean(tab) && depthOf(tab) < MAX_TAB_DEPTH;

/** Removes the first occurrence of each id, highest index first. */
const removeFromOrder = (order: Y.Array<string>, ids: string[]) => {
  const current = order.toArray();
  const indexes = ids
    .map((id) => current.indexOf(id))
    .filter((index) => index !== -1)
    .sort((a, b) => b - a);
  indexes.forEach((index) => order.delete(index, 1));
};

/** Index just after the last id of the block in the current order. */
const indexAfterBlock = (order: Y.Array<string>, blockIds: string[]) => {
  const current = order.toArray();
  const last = Math.max(-1, ...blockIds.map((id) => current.indexOf(id)));
  return last === -1 ? current.length : last + 1;
};

/**
 * Adds already-named tabs as siblings of `tabId`, right after its block. A
 * top-level tab keeps the 7.0 write: the new tabs go at the end.
 */
export const insertSiblingTabsInDoc = (
  doc: Y.Doc,
  tabId: string,
  newTabIds: string[],
) => {
  const tabNodes = getTabsYdocNodes(doc);
  const parentId = tabNodes.parentById.get(tabId);
  doc.transact(() => {
    if (parentId === undefined) {
      tabNodes.order.push(newTabIds);
      return;
    }
    const block = getSubtreeIds(getTabListFromNodes(tabNodes), tabId);
    newTabIds.forEach((id) => tabNodes.parentById.set(id, parentId));
    tabNodes.order.insert(indexAfterBlock(tabNodes.order, block), newTabIds);
  });
};

export const createSubtabInDoc = (
  doc: Y.Doc,
  parentId: string,
  newTabId: string,
  shouldSyncActiveTab: boolean,
): string | null => {
  const tabNodes = getTabsYdocNodes(doc);
  const tabs = getTabListFromNodes(tabNodes);
  const parent = tabs.find((tab) => tab.id === parentId);
  if (!parent || !canAddSubtab(parent)) return null;

  const parentBlock = getSubtreeIds(tabs, parentId);
  const siblingCount = tabs.filter((tab) => tab.parentId === parentId).length;

  doc.transact(() => {
    tabNodes.nameById.set(newTabId, `Subtab ${siblingCount + 1}`);
    tabNodes.emojiById.set(newTabId, null);
    tabNodes.parentById.set(newTabId, parentId);
    doc.getXmlFragment(newTabId);
    if (shouldSyncActiveTab) tabNodes.tabState.set('activeTabId', newTabId);
    tabNodes.order.insert(indexAfterBlock(tabNodes.order, parentBlock), [
      newTabId,
    ]);
  });
  return newTabId;
};

/**
 * Moves `movedTabId` (with its subtabs) to the place of `destinationTabId`.
 * Only between siblings: a destination under another parent is ignored.
 */
export const moveTabInDoc = (
  doc: Y.Doc,
  destinationTabId: string,
  movedTabId: string,
): boolean => {
  const tabNodes = getTabsYdocNodes(doc);
  const { order } = tabNodes;

  if (!hasSubtabs(doc)) {
    // A doc without subtabs: the 7.0 writes, unchanged.
    const currentOrder = order.toArray();
    const oldIndex = currentOrder.indexOf(movedTabId);
    const newIndex = currentOrder.indexOf(destinationTabId);
    if (oldIndex === -1 || newIndex === -1) return false;
    doc.transact(() => {
      order.delete(oldIndex, 1);
      order.insert(newIndex, [movedTabId]);
    });
    return true;
  }

  const tabs = getTabListFromNodes(tabNodes);
  const moved = tabs.find((tab) => tab.id === movedTabId);
  const destination = tabs.find((tab) => tab.id === destinationTabId);
  if (!moved || !destination || moved.id === destination.id) return false;
  if ((moved.parentId ?? null) !== (destination.parentId ?? null)) return false;

  const movedBlock = getSubtreeIds(tabs, movedTabId);
  const destinationBlock = getSubtreeIds(tabs, destinationTabId);
  const movingDown =
    tabs.findIndex((tab) => tab.id === destinationTabId) >
    tabs.findIndex((tab) => tab.id === movedTabId);

  doc.transact(() => {
    removeFromOrder(order, movedBlock);
    const insertAt = movingDown
      ? indexAfterBlock(order, destinationBlock)
      : Math.max(0, order.toArray().indexOf(destinationTabId));
    order.insert(insertAt, movedBlock);
  });
  return true;
};

export const duplicateTabInDoc = (
  doc: Y.Doc,
  tabId: string,
  createId: () => string,
  shouldSyncActiveTab: boolean,
): string | undefined => {
  const tabNodes = getTabsYdocNodes(doc);
  const { order } = tabNodes;
  const originalMeta = getTabMetadata(tabNodes, tabId);
  if (!originalMeta) return undefined;

  if (!hasSubtabs(doc)) {
    // A doc without subtabs: the 7.0 writes, unchanged.
    const newTabId = createId();
    doc.transact(() => {
      const originalFragment = doc.getXmlFragment(tabId);
      const newFragment = doc.getXmlFragment(newTabId);
      const clonedNodes = cloneFragmentContent(originalFragment);
      if (clonedNodes.length > 0) newFragment.insert(0, clonedNodes);
      const index = order.toArray().indexOf(tabId);
      order.insert(index + 1, [newTabId]);
      tabNodes.nameById.set(newTabId, `${originalMeta.name} (Copy)`);
      tabNodes.emojiById.set(newTabId, originalMeta.emoji);
      if (shouldSyncActiveTab) tabNodes.tabState.set('activeTabId', newTabId);
    });
    return newTabId;
  }

  const tabs = getTabListFromNodes(tabNodes);
  const block = getSubtreeIds(tabs, tabId);
  if (block.length === 0) return undefined;
  const newIdByOldId = new Map(block.map((id) => [id, createId()]));
  const rootParentId = tabNodes.parentById.get(tabId);
  const newRootId = newIdByOldId.get(tabId)!;

  doc.transact(() => {
    block.forEach((oldId) => {
      const newId = newIdByOldId.get(oldId)!;
      const meta = getTabMetadata(tabNodes, oldId);
      const cloned = cloneFragmentContent(doc.getXmlFragment(oldId));
      const newFragment = doc.getXmlFragment(newId);
      if (cloned.length > 0) newFragment.insert(0, cloned);
      tabNodes.nameById.set(
        newId,
        oldId === tabId
          ? `${originalMeta.name} (Copy)`
          : (meta?.name ?? 'Subtab'),
      );
      tabNodes.emojiById.set(newId, meta?.emoji ?? null);
      const parentId =
        oldId === tabId ? rootParentId : tabNodes.parentById.get(oldId);
      if (typeof parentId === 'string') {
        tabNodes.parentById.set(newId, newIdByOldId.get(parentId) ?? parentId);
      }
    });
    order.insert(
      indexAfterBlock(order, block),
      block.map((id) => newIdByOldId.get(id)!),
    );
    if (shouldSyncActiveTab) tabNodes.tabState.set('activeTabId', newRootId);
  });
  return newRootId;
};

export interface DeleteTabResult {
  snapshots: DeletedTabSnapshot[];
  /** The tab to open if the deleted tab, or one under it, was open. */
  fallbackId: string | null;
}

/**
 * Soft-deletes the tab and every tab under it: name and emoji removed, a
 * deleted mark added, the id taken out of the order. Text and parent entries
 * are kept, so undo can rebuild the group and nothing is erased.
 */
export const deleteTabInDoc = (
  doc: Y.Doc,
  tabId: string,
  activeTabId: string,
  shouldSyncActiveTab: boolean,
): DeleteTabResult => {
  const tabNodes = getTabsYdocNodes(doc);
  const { order } = tabNodes;

  if (!hasSubtabs(doc)) {
    // A doc without subtabs: the 7.0 writes, unchanged.
    if (order.length <= 1) {
      throw new Error('Cannot delete the last remaining tab');
    }
    const index = order.toArray().indexOf(tabId);
    if (index === -1) throw new Error('Tab not found in order');
    const meta = getTabMetadata(tabNodes, tabId);
    const currentActive = getActiveTabIdFromNodes(tabNodes) || '';
    const needsFallback = currentActive === tabId;
    const fallbackId = needsFallback
      ? (order.get(index + 1) ?? order.get(index - 1) ?? DEFAULT_TAB_ID)
      : null;
    doc.transact(() => {
      tabNodes.nameById.delete(tabId);
      tabNodes.emojiById.delete(tabId);
      tabNodes.deletedById.set(tabId, true);
      if (needsFallback && fallbackId && shouldSyncActiveTab) {
        tabNodes.tabState.set('activeTabId', fallbackId);
      }
      order.delete(index, 1);
    });
    return {
      snapshots: meta
        ? [{ tabId, name: meta.name, emoji: meta.emoji, orderIndex: index }]
        : [],
      fallbackId,
    };
  }

  const tabs = getTabListFromNodes(tabNodes);
  const tab = tabs.find((candidate) => candidate.id === tabId);
  if (!tab) throw new Error('Tab not found in order');
  const topLevelTabs = tabs.filter((candidate) => !candidate.parentId);
  if (!tab.parentId && topLevelTabs.length <= 1) {
    throw new Error('Cannot delete the last remaining tab');
  }

  const block = getSubtreeIds(tabs, tabId);
  const currentOrder = order.toArray();
  const snapshots = block.map((id) => {
    const meta = getTabMetadata(tabNodes, id);
    return {
      tabId: id,
      name: meta?.name ?? 'Subtab',
      emoji: meta?.emoji ?? null,
      orderIndex: currentOrder.indexOf(id),
    };
  });

  // X3: an open subtab falls back to its parent; a top-level tab to the next
  // top-level tab, else the previous one, as before.
  // The caller's open tab first: in collaboration the stored pointer is not
  // kept per person.
  const activeId = activeTabId || getActiveTabIdFromNodes(tabNodes) || '';
  let fallbackId: string | null = null;
  if (block.includes(activeId)) {
    if (tab.parentId) {
      fallbackId = tab.parentId;
    } else {
      const topIndex = topLevelTabs.findIndex((t) => t.id === tabId);
      fallbackId =
        topLevelTabs[topIndex + 1]?.id ??
        topLevelTabs[topIndex - 1]?.id ??
        DEFAULT_TAB_ID;
    }
  }

  doc.transact(() => {
    block.forEach((id) => {
      tabNodes.nameById.delete(id);
      tabNodes.emojiById.delete(id);
      tabNodes.deletedById.set(id, true);
    });
    if (fallbackId && shouldSyncActiveTab) {
      tabNodes.tabState.set('activeTabId', fallbackId);
    }
    removeFromOrder(order, block);
  });
  return { snapshots, fallbackId };
};

/** Undo of deleteTabInDoc: brings the whole group back where it was. */
export const restoreDeletedTabsInDoc = (
  doc: Y.Doc,
  snapshots: DeletedTabSnapshot[],
  shouldSyncActiveTab: boolean,
): boolean => {
  const tabNodes = getTabsYdocNodes(doc);
  const { order } = tabNodes;
  const toRestore = snapshots.filter(
    (snapshot) => !tabNodes.nameById.has(snapshot.tabId),
  );
  if (toRestore.length === 0) return false;
  const rootId = snapshots[0].tabId;

  doc.transact(() => {
    [...toRestore]
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .forEach((snapshot) => {
        tabNodes.deletedById.delete(snapshot.tabId);
        tabNodes.nameById.set(snapshot.tabId, snapshot.name);
        tabNodes.emojiById.set(snapshot.tabId, snapshot.emoji);
        doc.getXmlFragment(snapshot.tabId);
        const insertIndex = Math.min(
          Math.max(snapshot.orderIndex, 0),
          order.length,
        );
        order.insert(insertIndex, [snapshot.tabId]);
      });
    if (shouldSyncActiveTab) tabNodes.tabState.set('activeTabId', rootId);
  });
  return true;
};
