import { fromUint8Array, toUint8Array } from 'js-base64';
import * as Y from 'yjs';

export interface Tab {
  id: string;
  name: string;
  emoji: string | null;
  // Set only when the doc has subtabs. A missing value means a top-level tab
  // with no subtabs, which is every tab of a doc without subtabs.
  parentId?: string | null;
  depth?: number;
  hasChildren?: boolean;
}

export interface TabsYdocNodes {
  order: Y.Array<string>;
  nameById: Y.Map<string>;
  emojiById: Y.Map<string | null>;
  tabState: Y.Map<unknown>;
  deletedById: Y.Map<boolean>;
  // Subtab id -> parent id. Written once when the subtab is created.
  parentById: Y.Map<string>;
}

export interface SyncedTabsYdocNodes extends TabsYdocNodes {
  didWrite: boolean;
}

interface TabStateSnapshot {
  order: string[];
  names: Map<string, string>;
  emojis: Map<string, string | null>;
  activeTabId: string | null;
  deletedIds: Set<string>;
  hasData: boolean;
}

interface ResolvedTabState {
  order: string[];
  names: Map<string, string>;
  emojis: Map<string, string | null>;
  activeTabId: string | null;
  deletedIds: Set<string>;
}

interface TabSyncOptions {
  createDefaultTabIfMissing?: boolean;
}

export const DEFAULT_TAB_ID = 'default';
export const DEFAULT_TAB_NAME = 'Tab 1';

export const LEGACY_ROOT_KEY = 'ddocTabs';
export const ORDER_ROOT_KEY = 'tabs_order';
export const NAME_ROOT_KEY = 'tabs_name_registry';
export const EMOJI_ROOT_KEY = 'tabs_emoji_registry';
export const STATE_ROOT_KEY = 'tabs_state';
export const DELETED_ROOT_KEY = 'tabs_delete_registry';
export const ACTIVE_TAB_STATE_KEY = 'activeTabId';
export const PARENT_ROOT_KEY = 'tabs_parent_registry';
// A level-3 subtab cannot have subtabs.
export const MAX_TAB_DEPTH = 3;

/**
 * The heading level of a tab's title in exports: 1 for a tab, 2 or 3 for a
 * subtab, so an exported file keeps the tree. Deeper data stays at 3.
 */
export const getTabHeadingLevel = (tab: Pick<Tab, 'depth'>) =>
  Math.min(Math.max(tab.depth ?? 1, 1), MAX_TAB_DEPTH);

// New schema: every shared tab structure is a deterministic top-level Yjs type.
function getTabsNodesV2(doc: Y.Doc) {
  return {
    order: doc.getArray<string>(ORDER_ROOT_KEY),
    nameById: doc.getMap<string>(NAME_ROOT_KEY),
    emojiById: doc.getMap<string | null>(EMOJI_ROOT_KEY),
    tabState: doc.getMap<unknown>(STATE_ROOT_KEY),
    // Soft-deleted tabs keep their fragment for undo and late peer updates.
    // This tombstone stops self-heal from resurrecting deleted tabs from stale tab metadata.
    deletedById: doc.getMap<boolean>(DELETED_ROOT_KEY),
    // Reading a root that was never written adds nothing to the doc, so a doc
    // without subtabs stays byte-for-byte the same.
    parentById: doc.getMap<string>(PARENT_ROOT_KEY),
  };
}

function decodeInitialState(
  yjsEncodedState: string | string[] | null | undefined,
  doc: Y.Doc,
) {
  if (!yjsEncodedState) return;

  try {
    if (Array.isArray(yjsEncodedState)) {
      const parsed = yjsEncodedState.map((content) => toUint8Array(content));
      Y.applyUpdate(doc, Y.mergeUpdates(parsed), 'self');
      return;
    }

    Y.applyUpdate(doc, toUint8Array(yjsEncodedState), 'self');
  } catch (err) {
    console.log(err);
  }
}

function getStringArrayValues(source: Y.Array<string> | null): string[] {
  if (!source) {
    return [];
  }

  return source
    .toArray()
    .filter((value): value is string => typeof value === 'string');
}

function getLegacyTabSnapshot(doc: Y.Doc): TabStateSnapshot {
  const legacyRoot = doc.getMap(LEGACY_ROOT_KEY);
  const orderNode = legacyRoot.get('order');
  const tabsNode = legacyRoot.get('tabs');
  const activeTabNode = legacyRoot.get('activeTabId');

  const order = getStringArrayValues(
    orderNode instanceof Y.Array ? orderNode : null,
  );
  const names = new Map<string, string>();
  const emojis = new Map<string, string | null>();

  if (tabsNode instanceof Y.Map) {
    tabsNode.forEach((value, tabId) => {
      if (!(value instanceof Y.Map) || typeof tabId !== 'string') return;

      const nameValue = value.get('name');
      const emojiValue = value.get('emoji');

      if (typeof nameValue === 'string') {
        names.set(tabId, nameValue);
      }

      if (typeof emojiValue === 'string' || emojiValue === null) {
        emojis.set(tabId, emojiValue);
      }
    });
  }

  return {
    order,
    names,
    emojis,
    activeTabId:
      activeTabNode instanceof Y.Text ? activeTabNode.toString() || null : null,
    deletedIds: new Set<string>(),
    hasData:
      order.length > 0 ||
      names.size > 0 ||
      emojis.size > 0 ||
      (activeTabNode instanceof Y.Text && activeTabNode.length > 0),
  };
}

function getTabSnapshotV2(doc: Y.Doc): TabStateSnapshot {
  const tabNodesV2 = getTabsNodesV2(doc);
  const names = new Map<string, string>();
  const emojis = new Map<string, string | null>();
  const deletedIds = new Set<string>();

  tabNodesV2.nameById.forEach((value, tabId) => {
    if (typeof value === 'string') {
      names.set(tabId, value);
    }
  });

  tabNodesV2.emojiById.forEach((value, tabId) => {
    if (typeof value === 'string' || value === null) {
      emojis.set(tabId, value);
    }
  });

  tabNodesV2.deletedById.forEach((value, tabId) => {
    if (value === true) {
      deletedIds.add(tabId);
    }
  });

  const activeValue = tabNodesV2.tabState.get(ACTIVE_TAB_STATE_KEY);
  const activeTabId = typeof activeValue === 'string' ? activeValue : null;

  return {
    order: getStringArrayValues(tabNodesV2.order),
    names,
    emojis,
    activeTabId,
    deletedIds,
    hasData:
      tabNodesV2.order.length > 0 ||
      tabNodesV2.nameById.size > 0 ||
      tabNodesV2.emojiById.size > 0 ||
      tabNodesV2.deletedById.size > 0 ||
      activeTabId !== null,
  };
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  values.forEach((value) => {
    if (seen.has(value)) return;
    seen.add(value);
    result.push(value);
  });

  return result;
}

function getFallbackTabName(index: number) {
  return index === 0 ? DEFAULT_TAB_NAME : `Tab ${index + 1}`;
}

function getTabIdsFromSnaphot(
  tabSnapshotV2: TabStateSnapshot,
  legacySnapshot: TabStateSnapshot,
) {
  return dedupe([
    ...tabSnapshotV2.order,
    ...legacySnapshot.order,
    ...Array.from(tabSnapshotV2.names.keys()),
    ...Array.from(tabSnapshotV2.emojis.keys()),
    ...Array.from(legacySnapshot.names.keys()),
    ...Array.from(legacySnapshot.emojis.keys()),
  ]);
}

function mergeResolvedTabState(
  baseState: ResolvedTabState,
  inputStates: ResolvedTabState[],
): ResolvedTabState {
  const deletedIds = new Set<string>(baseState.deletedIds);

  inputStates.forEach((state) => {
    state.deletedIds.forEach((tabId) => deletedIds.add(tabId));
  });

  // Initialize order (filter out deleted tabs)
  const orderSet = new Set<string>();
  const recoveredOrder: string[] = [];

  baseState.order.forEach((tabId) => {
    if (!deletedIds.has(tabId) && !orderSet.has(tabId)) {
      orderSet.add(tabId);
      recoveredOrder.push(tabId);
    }
  });

  // Initialize metadata maps (filtered)
  const names = new Map<string, string>();
  const emojis = new Map<string, string | null>();

  baseState.names.forEach((name, tabId) => {
    if (!deletedIds.has(tabId)) {
      names.set(tabId, name);
    }
  });

  baseState.emojis.forEach((emoji, tabId) => {
    if (!deletedIds.has(tabId)) {
      emojis.set(tabId, emoji);
    }
  });

  // Merge in missing data from inputs
  inputStates.forEach((state) => {
    state.order.forEach((tabId) => {
      if (deletedIds.has(tabId)) return;

      // Ensure tab exists in final order
      if (!orderSet.has(tabId)) {
        orderSet.add(tabId);
        recoveredOrder.push(tabId);
      }

      // Fill missing name
      if (!names.has(tabId) && state.names.has(tabId)) {
        names.set(tabId, state.names.get(tabId) ?? DEFAULT_TAB_NAME);
      }

      // Fill missing emoji
      if (!emojis.has(tabId)) {
        emojis.set(
          tabId,
          state.emojis.has(tabId) ? (state.emojis.get(tabId) ?? null) : null,
        );
      }
    });
  });

  // Ensure every tab has valid metadata
  recoveredOrder.forEach((tabId, index) => {
    if (!names.has(tabId)) {
      names.set(tabId, getFallbackTabName(index));
    }

    if (!emojis.has(tabId) || emojis.get(tabId) === undefined) {
      emojis.set(tabId, null);
    }
  });

  /**
   * Resolve active tab:
   * - Prefer base state first (most recent local view)
   * - Fall back to inputs
   * - Always ensure it exists and is not deleted
   */
  const activeTabCandidates = [
    baseState.activeTabId,
    ...inputStates.map((state) => state.activeTabId),
  ];

  const activeTabId =
    activeTabCandidates.find(
      (tabId): tabId is string =>
        !!tabId && orderSet.has(tabId) && !deletedIds.has(tabId),
    ) ??
    recoveredOrder[0] ??
    null;

  return {
    order: recoveredOrder,
    names,
    emojis,
    activeTabId,
    deletedIds,
  };
}

function resolveTabState(
  tabSnapshotV2: TabStateSnapshot,
  legacySnapshot: TabStateSnapshot,
  options?: TabSyncOptions,
): ResolvedTabState {
  // Build one canonical tab view from every recoverable signal in the doc.
  // This is the self-heal step:
  // prefer flat-schema data,
  // fall back to legacy nested metadata,
  // ignore tombstoned tabs,
  // and return a normalized state that can be written back to the flat roots.

  const createDefaultTabIfMissing = options?.createDefaultTabIfMissing ?? false;
  const deletedIds = new Set<string>(tabSnapshotV2.deletedIds);
  const tabIdsFromSnapshot = getTabIdsFromSnaphot(
    tabSnapshotV2,
    legacySnapshot,
  ).filter((tabId) => !deletedIds.has(tabId));

  const resolvedOrder = dedupe([
    ...tabSnapshotV2.order,
    ...legacySnapshot.order,
  ]);

  tabIdsFromSnapshot.forEach((tabId) => {
    if (!resolvedOrder.includes(tabId)) {
      resolvedOrder.push(tabId);
    }
  });

  if (resolvedOrder.length === 0 && createDefaultTabIfMissing) {
    resolvedOrder.push(DEFAULT_TAB_ID);
  }

  const names = new Map<string, string>();
  const emojis = new Map<string, string | null>();

  resolvedOrder.forEach((tabId, index) => {
    const name =
      tabSnapshotV2.names.get(tabId) ??
      legacySnapshot.names.get(tabId) ??
      getFallbackTabName(index);
    const emoji = tabSnapshotV2.emojis.has(tabId)
      ? (tabSnapshotV2.emojis.get(tabId) ?? null)
      : legacySnapshot.emojis.has(tabId)
        ? (legacySnapshot.emojis.get(tabId) ?? null)
        : null;

    names.set(tabId, name);
    emojis.set(tabId, emoji);
  });

  const activeTabCandidates = [
    tabSnapshotV2.activeTabId,
    legacySnapshot.activeTabId,
  ];
  const activeTabId =
    activeTabCandidates.find(
      (tabId): tabId is string => !!tabId && resolvedOrder.includes(tabId),
    ) ??
    resolvedOrder[0] ??
    null;

  return {
    order: resolvedOrder,
    names,
    emojis,
    activeTabId,
    deletedIds,
  };
}

function arraysEqual(current: string[], next: string[]) {
  if (current.length !== next.length) return false;
  return current.every((value, index) => value === next[index]);
}

function syncYArrayValues(array: Y.Array<string>, nextValues: string[]) {
  const currentValues = getStringArrayValues(array);
  if (arraysEqual(currentValues, nextValues)) {
    return false;
  }

  if (array.length > 0) {
    array.delete(0, array.length);
  }

  if (nextValues.length > 0) {
    array.insert(0, nextValues);
  }

  return true;
}

function syncMapScalarValue(
  map: Y.Map<unknown>,
  key: string,
  nextValue: string | null,
) {
  const currentValue = map.get(key);

  if (nextValue === null) {
    if (currentValue === undefined) return false;
    map.delete(key);
    return true;
  }

  if (currentValue === nextValue) return false;
  map.set(key, nextValue);
  return true;
}

function syncMapEntries<T>(map: Y.Map<T>, nextValuesById: Map<string, T>) {
  let changed = false;

  Array.from(map.keys()).forEach((tabId) => {
    if (!nextValuesById.has(tabId)) {
      map.delete(tabId);
      changed = true;
    }
  });

  nextValuesById.forEach((value, tabId) => {
    if (map.get(tabId) === value) return;
    map.set(tabId, value);
    changed = true;
  });

  return changed;
}

function applyResolvedTabState(
  doc: Y.Doc,
  resolvedTabState: ResolvedTabState,
  transactionOrigin: unknown = 'self',
) {
  const tabNodesV2 = getTabsNodesV2(doc);
  let didWrite = false;
  const deletedTabIds = new Map(
    Array.from(resolvedTabState.deletedIds, (tabId) => [tabId, true] as const),
  );

  doc.transact(() => {
    // Fragments stay keyed by tab id, so ensure every resolved tab is addressable.
    resolvedTabState.order.forEach((tabId) => {
      doc.getXmlFragment(tabId);
    });

    didWrite =
      syncYArrayValues(tabNodesV2.order, resolvedTabState.order) || didWrite;
    didWrite =
      syncMapEntries(tabNodesV2.nameById, resolvedTabState.names) || didWrite;
    didWrite =
      syncMapEntries(tabNodesV2.emojiById, resolvedTabState.emojis) || didWrite;
    didWrite =
      syncMapScalarValue(
        tabNodesV2.tabState,
        ACTIVE_TAB_STATE_KEY,
        resolvedTabState.activeTabId,
      ) || didWrite;
    didWrite =
      syncMapEntries(tabNodesV2.deletedById, deletedTabIds) || didWrite;
  }, transactionOrigin);

  return didWrite;
}

function getResolvedTabStateForDoc(doc: Y.Doc, options?: TabSyncOptions) {
  const tabSnapshotV2 = getTabSnapshotV2(doc);
  const legacySnapshot = getLegacyTabSnapshot(doc);
  const resolvedTabState = resolveTabState(
    tabSnapshotV2,
    legacySnapshot,
    options,
  );

  return {
    tabSnapshotV2,
    legacySnapshot,
    resolvedTabState,
  };
}

export function syncTabState(
  doc: Y.Doc,
  options?: TabSyncOptions,
  transactionOrigin: unknown = 'self',
) {
  const { resolvedTabState } = getResolvedTabStateForDoc(doc, options);
  return applyResolvedTabState(doc, resolvedTabState, transactionOrigin);
}

export function deriveTabsFromEncodedState(
  yjsEncodedState: string | string[] | null | undefined,
  doc: Y.Doc,
  options?: TabSyncOptions,
) {
  decodeInitialState(yjsEncodedState, doc);

  const didWrite = syncTabState(doc, {
    ...options,
    createDefaultTabIfMissing: options?.createDefaultTabIfMissing ?? true,
  });
  const tabNodesV2 = getTabsNodesV2(doc);

  return {
    tabList: getTabListFromNodes(tabNodesV2),
    activeTabId: getActiveTabIdFromNodes(tabNodesV2) || DEFAULT_TAB_ID,
    didWrite,
  };
}

export function getTabsYdocNodes(doc: Y.Doc): TabsYdocNodes {
  return getTabsNodesV2(doc);
}

export function syncTabStateAndGetNodes(
  doc: Y.Doc,
  options?: TabSyncOptions,
  transactionOrigin: unknown = 'self',
): SyncedTabsYdocNodes {
  const didWrite = syncTabState(doc, options, transactionOrigin);

  return {
    ...getTabsNodesV2(doc),
    didWrite,
  };
}

export function mergeTabAwareYjsUpdates(
  encodedUpdates: string[],
  options?: TabSyncOptions,
) {
  // Resolve tab state from each input independently (pre-merge recovery)
  // This allows us to recover tabs that would otherwise be lost when legacy nested ddocTabs structures conflict during the raw Yjs merge.
  const resolvedStatesPerUpdate = encodedUpdates.map((update) => {
    const tempDoc = new Y.Doc();
    decodeInitialState(update, tempDoc);

    return getResolvedTabStateForDoc(tempDoc, options).resolvedTabState;
  });

  // Merge raw Yjs updates
  const mergedDoc = new Y.Doc();
  decodeInitialState(encodedUpdates, mergedDoc);

  // Resolve tab state from merged doc (may already have lost legacy data)
  const { resolvedTabState: mergedDocState } = getResolvedTabStateForDoc(
    mergedDoc,
    options,
  );

  // Combine merged result with per-update recovered states
  const finalResolvedState = mergeResolvedTabState(
    mergedDocState,
    resolvedStatesPerUpdate,
  );

  // Write final canonical state into flat schema
  applyResolvedTabState(mergedDoc, finalResolvedState);

  return fromUint8Array(Y.encodeStateAsUpdate(mergedDoc));
}

export function getActiveTabIdFromNodes(
  tabNodes: Pick<TabsYdocNodes, 'tabState'>,
) {
  const activeValue = tabNodes.tabState.get(ACTIVE_TAB_STATE_KEY);
  return typeof activeValue === 'string' ? activeValue : null;
}

export function getTabMetadata(
  tabNodes: Pick<TabsYdocNodes, 'nameById' | 'emojiById'>,
  tabId: string,
) {
  if (!tabNodes.nameById.has(tabId)) {
    return null;
  }

  return {
    name: tabNodes.nameById.get(tabId) ?? DEFAULT_TAB_NAME,
    emoji: tabNodes.emojiById.has(tabId)
      ? (tabNodes.emojiById.get(tabId) ?? null)
      : null,
  };
}

/**
 * The tab list every screen and export reads, in reading order: a parent, then
 * its subtabs. A doc without subtabs takes the flat path, unchanged since 7.0.
 *
 * The tree rules, the same on every device for the same stored data:
 * T1 a tab is live if it is in the order list with a name;
 * T2 a tab under a deleted tab is hidden (its text stays in the doc);
 * T3 siblings keep the order of their first appearance in tabs_order;
 * T4 a tab whose parent is unknown, or whose parent chain loops, is shown at
 *    the top level, so bad or half-synced data never hides a tab;
 * T5 depth is reported as found; the sidebar caps the indent.
 */
export function getTabListFromNodes(
  tabNodes: Pick<TabsYdocNodes, 'order' | 'nameById' | 'emojiById'> &
    Partial<Pick<TabsYdocNodes, 'parentById' | 'deletedById'>>,
): Tab[] {
  const flatTabs = getFlatTabList(tabNodes);
  const parentById = tabNodes.parentById;
  if (!parentById || parentById.size === 0) return flatTabs;
  return buildTabTree(flatTabs, parentById, tabNodes.deletedById);
}

function buildTabTree(
  flatTabs: Tab[],
  parentById: Y.Map<string>,
  deletedById: Y.Map<boolean> | undefined,
): Tab[] {
  const deletedIds = new Set<string>();
  deletedById?.forEach((value, tabId) => {
    if (value === true) deletedIds.add(tabId);
  });
  const parentOf = (tabId: string) => {
    const parentId = parentById.get(tabId);
    return typeof parentId === 'string' && parentId !== tabId ? parentId : null;
  };

  // T2: walk the stored chain; stop at a loop.
  const isUnderDeletedTab = (tabId: string) => {
    const seen = new Set([tabId]);
    let parentId = parentOf(tabId);
    while (parentId && !seen.has(parentId)) {
      if (deletedIds.has(parentId)) return true;
      seen.add(parentId);
      parentId = parentOf(parentId);
    }
    return false;
  };

  const visibleTabs = flatTabs.filter((tab) => !isUnderDeletedTab(tab.id));
  const visibleIds = new Set(visibleTabs.map((tab) => tab.id));

  // T4: the parent must be shown, and the chain above must not lead back here.
  const shownParentOf = (tabId: string) => {
    const parentId = parentOf(tabId);
    if (!parentId || !visibleIds.has(parentId)) return null;
    const seen = new Set<string>();
    let ancestorId: string | null = parentId;
    while (ancestorId && visibleIds.has(ancestorId) && !seen.has(ancestorId)) {
      if (ancestorId === tabId) return null;
      seen.add(ancestorId);
      ancestorId = parentOf(ancestorId);
    }
    return parentId;
  };

  // T3: children keep their order of appearance.
  const ROOT = '';
  const childrenOf = new Map<string, Tab[]>();
  visibleTabs.forEach((tab) => {
    const key = shownParentOf(tab.id) ?? ROOT;
    const siblings = childrenOf.get(key);
    if (siblings) siblings.push(tab);
    else childrenOf.set(key, [tab]);
  });

  // Every shown tab is reached from the top: a tab gets a parent only when
  // that parent's chain does not lead back to it, so there is no loop left.
  const result: Tab[] = [];
  const visit = (parentKey: string, depth: number) => {
    childrenOf.get(parentKey)?.forEach((tab) => {
      result.push({
        ...tab,
        parentId: parentKey === ROOT ? null : parentKey,
        depth,
        hasChildren: (childrenOf.get(tab.id)?.length ?? 0) > 0,
      });
      visit(tab.id, depth + 1);
    });
  };
  visit(ROOT, 1);
  return result;
}

function getFlatTabList(
  tabNodes: Pick<TabsYdocNodes, 'order' | 'nameById' | 'emojiById'>,
): Tab[] {
  const seen = new Set<string>();
  return getStringArrayValues(tabNodes.order)
    .filter((tabId) => {
      if (seen.has(tabId)) return false;
      seen.add(tabId);
      return true;
    })
    .map((tabId) => {
      const tabMetadata = getTabMetadata(
        tabNodes as Pick<TabsYdocNodes, 'nameById' | 'emojiById'>,
        tabId,
      );
      if (!tabMetadata) return null;

      return {
        id: tabId,
        name: tabMetadata.name,
        emoji: tabMetadata.emoji,
      };
    })
    .filter((tab): tab is Tab => tab !== null);
}

export function cloneFragmentContent(
  fragment: Y.XmlFragment,
): (Y.XmlElement | Y.XmlText)[] {
  return fragment
    .toArray()
    .map((item) => {
      if (item instanceof Y.XmlElement || item instanceof Y.XmlText) {
        return item.clone();
      }

      return null;
    })
    .filter((node): node is Y.XmlElement | Y.XmlText => node !== null);
}
