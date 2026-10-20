# TEC-1214: Tabs (Sub-documents) — Technical Spec

> Updated 2026-02-23 to reflect the actual implementation on `tab-feature` branch (PR #435).
> Updated 2026-09-05: tab switching now uses one editor per tab with a warm cache (§2c) and the collab transport is `useSyncManager` (§2a).
> Updated 2026-10-20: §1 rewritten for the flat data model and subtabs (TEC-3246). Later sections still describe the screens without subtabs.

## Overview

Users can create, rename, duplicate, reorder, and switch between multiple tabs within a single dDoc. Each tab has its own content (Y.XmlFragment), per-tab Table of Contents, and per-tab comment filtering. The feature works in solo, collaborative, preview, and version-history modes — and is backward-compatible with existing single-tab documents.

**Package boundary**: `fileverse-ddoc` owns tab UI, CRUD, and persistence (tab state lives in the Y.Doc). `ddocs.new` drives tab selection externally via `tabConfig.defaultTabId` and receives the `onCopyTabLink` callback for deep linking.

---

## 1. Yjs Data Model

> Rewritten 2026-10-20 for subtabs (TEC-3246). The old nested `ddocTabs` map is legacy: it is still read and migrated by the clean-up pass, never written.

All tab state lives inside the single `Y.Doc`, next to the text, as flat top-level roots (`tab-utils.ts`):

```
Y.Doc
├── Y.Array('tabs_order')              tab ids in reading order (subtabs included)
├── Y.Map('tabs_name_registry')        tab id -> name
├── Y.Map('tabs_emoji_registry')       tab id -> emoji | null
├── Y.Map('tabs_state')                'activeTabId' (owner only, written with the 'self' origin)
├── Y.Map('tabs_delete_registry')      tab id -> true for deleted tabs
├── Y.Map('tabs_parent_registry')      subtab id -> parent id (written once, at creation)
├── Y.Map('ddocMeta')                  'schemaVersion'
├── Y.XmlFragment('default')           text of the first tab
└── Y.XmlFragment('<tabId>')           text of every other tab, keyed by tab id
```

A doc without subtabs never has `tabs_parent_registry` written, so it is byte-for-byte what it was before subtabs.

### Key Design Decisions

- **Tab id = fragment key.** The first tab is `'default'`, TipTap's own fragment name.
- **Soft delete, never erase.** Deleting a tab removes its name, emoji and order entry and marks it deleted. Its fragment, and its parent entry, stay in the doc. Ctrl+Z within 10 seconds restores it.
- **A parent never changes.** A subtab gets its parent once, when it is created. Moves only reorder siblings. This rules out loops and keeps depth fixed under concurrent edits.
- **Up to three levels.** A level-3 subtab cannot have subtabs (`MAX_TAB_DEPTH`).
- **Expand/collapse is not in the doc.** It is local view state.

### Reading the tree (`getTabListFromNodes`)

Every screen, export and check reads one list, in reading order (a parent, then its subtabs). Each tab has `parentId`, `depth` and `hasChildren` when the doc has subtabs; a doc without subtabs takes the flat path, unchanged. The same stored data gives the same tree on every device:

| Rule | Meaning |
|------|---------|
| T1 | A tab is live if it is in `tabs_order` with a name. |
| T2 | A tab under a deleted tab is hidden. Its text stays in the doc. |
| T3 | Siblings keep the order of their first appearance in `tabs_order`. |
| T4 | A tab whose parent is unknown (not synced yet, or bad data), or whose parent chain loops, is shown at the top level. Unknown data never hides a tab. |
| T5 | Depth is reported as found; the sidebar caps the indent and exports cap the heading level at 3. |

### Writing (`tab-operations.ts`)

Each action is one Yjs transaction. On a doc without subtabs, each takes exactly the 7.0 writes.

| Action | Writes |
|--------|--------|
| Add tab | Name `Tab N`, emoji, id appended to `tabs_order`. |
| Add subtab | Name `Subtab N` (N = siblings + 1), emoji, parent entry, id right after the parent's last subtab. |
| Move | The tab and its subtabs move as one block in `tabs_order`, only past a sibling. |
| Duplicate | New ids for the whole group, text copied, parents remapped, copies right after the original group. Only the top copy gets " (Copy)". |
| Delete | For the tab and every tab under it: name and emoji removed, deleted mark added, id out of `tabs_order`. Text and parent entries kept. The last top-level tab cannot be deleted. |
| Undo delete | The whole group back at its old positions. |

### Older apps

An app on 7.0.x does not read `tabs_parent_registry`. It shows subtabs as plain tabs in reading order, and its clean-up pass never touches the new root. If it deletes a parent, new apps hide the subtabs too (T2). Nothing it does erases text. Tests: `utils/__tests__/subtab-old-client.test.ts`, against a frozen copy of the 7.0 code in `utils/__tests__/v7/`.

### Backward Compatibility (Migration)

`deriveTabsFromEncodedState` and `syncTabState` (the clean-up pass) build one canonical tab state from every signal in the doc: the flat roots, the legacy `ddocTabs` map, and names with no order entry. They write it back to the flat roots. They never write `tabs_parent_registry`. `mergeTabAwareYjsUpdates` resolves tab state per input before a raw merge, so legacy conflicts cannot lose tabs.

### Persistence

The whole `Y.Doc`, tab roots included, is stored by `y-indexeddb` as a log of small updates (compacted by the package). The host's Dexie row no longer carries the body (TEC-2476). Sync and IPFS publish treat the doc as opaque bytes. The content fingerprint counts every root except the `activeTabId` pointer, so adding, moving or deleting a subtab is a content change and gets published; switching tabs is not.

---

## 2. Hook Architecture

The monolithic `useDdocEditor` (~1006 lines) was split into three focused hooks:

```
useDdocEditor (thin composition layer, ~141 lines)
├── useYjsSetup()      — Y.Doc lifecycle, IndexedDB, sync machine, onChange
├── useTabManager()    — Tab CRUD, Y.Map observers, active tab state
└── useTabEditor()     — TipTap editor, extensions, ToC, content hydration
```

### 2a. `useYjsSetup` — Y.Doc + Collaboration Infrastructure

**File**: `package/hooks/use-yjs-setup.ts` (~128 lines)

Creates the single `Y.Doc` and all sync infrastructure. Persists across tab switches.

**Args**:
```typescript
{
  onChange?, enableIndexeddbSync?, ddocId?,
  enableCollaboration?, onIndexedDbError?,
  onCollabError?, onCollaborationConnectCallback?,
  onCollaborationCommit?, onFetchCommitContent?,
  onCollabSessionTermination?, onUnMergedUpdates?
}
```

**Key behaviors**:
- Creates `new Y.Doc()` once (stable via `useState`)
- Wires up `useSyncManager` (`package/sync-local/`): `SyncManager` drives the state machine in `collabStateMachine.ts` over the WebSocket in `socketClient.ts`
- Attaches `ydoc.on('update')` handler:
  - Skips updates from origin `'self'`
  - Fires `onChange(fullState, chunk)` with **300ms debounce** on full-state encode
  - Chunk is sent immediately per update
- Manages IndexedDB persistence via `initialiseYjsIndexedDbProvider()`

**Returns**:
```typescript
{
  ydoc, onConnect, isReady, terminateSession,
  awareness, hasCollabContentInitialised,
  initialiseYjsIndexedDbProvider,
  refreshYjsIndexedDbProvider
}
```

### 2b. `useTabManager` — Tab CRUD & State

**File**: `package/hooks/use-tab-manager.ts` (~361 lines)

Manages the tab list, active tab state, and all CRUD operations on the Y.Doc.

**Args**:
```typescript
{
  ydoc: Y.Doc,
  initialContent: DdocProps['initialContent'],
  enableCollaboration: boolean,
  isDDocOwner: boolean,
  createDefaultTabIfMissing: boolean,    // false in version/preview mode or non-owner
  shouldSyncActiveTab: boolean,          // false in collab/version/preview mode
  defaultTabId?: string                  // from tabConfig, for deep-linking
}
```

**`shouldSyncActiveTab` logic** (computed in `useDdocEditor`):
```typescript
shouldSyncActiveTab = !isVersionMode && !isPreviewMode && !enableCollaboration && isDDocOwner
```
Active tab is persisted to `ddocTabs.activeTabId` (Y.Text) only for the document owner in non-collab, non-preview, non-version mode. In collab mode, each user tracks their own active tab independently via local React state.

**Initialization flow**:
1. **Hydration** (`useEffect` on `initialContent`): Calls `deriveTabsFromEncodedState` → populates `tabs` state and sets initial `activeTabId`
2. **`defaultTabId` override** (`useEffect`): If provided and matches an existing tab, overrides active tab ID (fires once via `hasInitializedDefaultTabIdRef` guard)
3. **Live Y.Doc observation** (`useEffect`): Observes `ddocTabs` root map + `order` Y.Array for remote changes. On any change, rebuilds `tabs` array from scratch. Also re-observes if the `order` Y.Array reference itself changes.

**CRUD Operations**:

| Operation | Behavior |
|-----------|----------|
| `createTab()` | Generates random base64 ID, creates metadata Y.Map, pushes to order, creates empty Y.XmlFragment. Updates `activeTabId` in Yjs if non-collab. Returns the tab ID. |
| `deleteTab(tabId)` | Removes metadata + order entry. Preserves Y.XmlFragment content (soft-delete). Updates active tab to next or previous neighbor. Throws if last tab. |
| `renameTab(tabId, { newName?, emoji? })` | Updates `name` and/or `emoji` on the tab's metadata Y.Map |
| `duplicateTab(tabId)` | Deep-clones metadata + fragment content via `cloneFragmentContent()`, inserts after original in order, sets as active. Returns new tab ID. |
| `orderTab(destId, movedId)` | Removes `movedId` from current index, inserts at `destId`'s index |
| `setActiveTabId(id)` | Updates local React state. If `shouldSyncActiveTab`, also writes to `ddocTabs.activeTabId` Y.Text inside `transact('self')`. |

**Returns**:
```typescript
{
  tabs, hasTabState, activeTabId, setTabs,
  setActiveTabId, createTab, deleteTab,
  renameTab, duplicateTab, orderTab
}
```

### 2c. `useTabEditor` — TipTap Editor

**File**: `package/hooks/use-tab-editor.tsx` (~1276 lines)

Creates and manages the TipTap editor instance, binding it to the correct Y.XmlFragment for the active tab.

**Tab switching mechanism**: Each tab gets its own TipTap `Editor`. `createEditorForTab(tabId)` builds `new Editor({ extensions: buildExtensionsForTab(tabId) })`; the stack includes `Collaboration.configure({ document: ydoc, field: tabId })`, so every editor is bound to its own Y.XmlFragment for its whole lifetime. `useTabEditorCache` (`package/hooks/use-tab-editor-cache.ts`) keeps the editors of the 4 most recently visited tabs warm (`PREVIOUS_TAB_CACHE_LIMIT`); switching to a warm tab re-activates it, nothing is rebuilt. Inactive editors stay mounted but are made non-editable, blurred and marked `data-ddoc-editor-inactive`. Editors beyond the limit are destroyed and rebuilt on revisit.

> **History**: The original plan called for `key={activeTabId}` to force a full remount. The first implementation kept a single editor and rebuilt its extension stack in-place via `setExtensions`. That was replaced by the per-tab cache above: with one editor, rotating through 3+ tabs forced a full teardown/rebuild on every switch, which on 10k-word tabs was the dominant source of transient garbage (~43k detached DOM nodes per 4-tab rotation vs ~23k with all tabs warm).

**Internal sub-hooks**:
- `useEditorExtension`: Owns the extension configuration refs and exposes `buildExtensionsForTab(tabId)`, which `createEditorForTab` calls once per tab editor.
- `useTocState`: Maintains a `tabToTocCacheRef` that stores ToC items per tab ID. On tab switch, immediately renders from cache, then updates asynchronously on editor changes. ToC updates are deferred by a `requestAnimationFrame` plus a **100ms** timeout.

**Key behaviors**:
- Content hydration: Applies Yjs encoded state (or JSON content) to Y.Doc. Uses `versionId + activeTabId` as hydration key to prevent re-applying.
- Collaboration cursor: Registers `yCursorPlugin(awareness)` via `editor.registerPlugin()` (not as an extension) to avoid editor rebuild when awareness changes.
- Word/char count: 500ms debounce
- Clears `activeCommentId` on tab change
- Destroys all cached tab editors on unmount

**Returns**:
```typescript
{
  editor, ref, slides, setSlides,
  tocItems, setTocItems,
  activeCommentId, setActiveCommentId,
  focusCommentWithActiveId, isContentLoading
}
```

### 2d. `useDdocEditor` — Composition Layer

**File**: `package/use-ddoc-editor.tsx` (~141 lines)

Thin wrapper that composes the three hooks and returns a unified API.

```typescript
const yjsSetup = useYjsSetup({ ... });

const tabManager = useTabManager({
  ydoc: yjsSetup.ydoc,
  initialContent: ddocContent,
  enableCollaboration,
  isDDocOwner: rest.isDDocOwner || false,
  createDefaultTabIfMissing: Boolean(!isVersionMode && !isPreviewMode && rest.isDDocOwner),
  defaultTabId: rest.tabConfig?.defaultTabId,
  shouldSyncActiveTab: Boolean(
    !isVersionMode && !isPreviewMode && !enableCollaboration && rest.isDDocOwner
  ),
});

const tabEditor = useTabEditor({
  ...editorProps,
  activeTabId: tabManager.activeTabId,
  hasTabState: tabManager.hasTabState,
  isVersionMode,
});
```

**Content loading aggregation**:
```typescript
const aggregatedContentLoading =
  enableCollaboration && !collabConfig?.isOwner
    ? tabEditor.isContentLoading || isCollabContentLoading
    : tabEditor.isContentLoading;
```

---

## 3. Component Architecture

```
DdocEditor (forwardRef)
├── useDdocEditor()
├── CommentProvider (activeTabId={activeTabId})
│
├── DocumentOutline (when editor && tabs.length > 0)
│   │
│   ├── Desktop (>1280px): DocumentTabsSidebar
│   │   ├── DndContext + SortableContext (drag-drop via @dnd-kit)
│   │   ├── Toggle button (collapsed: tab count, expanded: full panel)
│   │   ├── "Document tabs" header + "+" create button
│   │   └── DdocTab[] (per tab, each independently observes its Y.Map)
│   │       ├── SortableTabItem → TabItem
│   │       │   ├── TabEmojiPicker (emoji or FileText icon)
│   │       │   ├── Inline rename (TextField on double-click)
│   │       │   ├── Comment count badge
│   │       │   └── TabContextMenu (3-dot popover)
│   │       └── MemorizedToC (collapsible, shown when tab is active + showOutline)
│   │
│   └── Mobile (<=1280px): DocumentMobileTabPanel
│       ├── Expanded (300px bottom sheet): tab list + ToC + X close
│       └── Collapsed (54px pill): active tab name + tab count + popover menu
│
└── Editor area (bound to active tab's Y.XmlFragment via Collaboration extension)
```

### Desktop: `DocumentTabsSidebar`

**File**: `package/components/tabs/document-tabs-sidebar.tsx`

- Absolutely positioned left sidebar, `max-w-[263px]`
- **Portal support**: If `tabSectionContainer` prop is set, renders via `createPortal` into that DOM element (used by version-history UI to inject tabs into a custom container)
- If `isVersionHistoryMode && !tabSectionContainer`, renders nothing
- **Drag-and-drop**: Uses `@dnd-kit` (`DndContext` + `SortableContext` + `DragOverlay`). Drag disabled in preview/version-history mode. `PointerSensor` with 5px activation distance.

**Toggle button states**:
- **Collapsed**: `List` icon + tab count number. On hover, expands to show active tab name.
- **Expanded** (`showTOC = true`): `ChevronLeft` icon, full tab list with per-tab ToC.
- When tabs exist but sidebar is collapsed, button has `color-bg-secondary-hover` background.

**`DdocTab` sub-component**: Each tab independently observes its own Y.Map metadata via `useEffect` + `metadataMap.observe()`. This provides real-time name/emoji/outline updates without full parent re-render during collaboration.

### Mobile: `DocumentMobileTabPanel`

**File**: `package/components/tabs/document-mobile-tab-panel.tsx`

Fixed-position bottom panel with two states:

- **Expanded** (`showContent = true`): 300px tall bottom sheet with scrollable tab list. Shows "Document tabs" header + X close. Each tab rendered with `hideContentMenu={true}` (no context menu). Active tab shows its ToC below.
- **Collapsed**: 54px pill showing FileText icon + active tab name + tab count + popover context menu.

**Current limitations**:
- No "create tab" (`+`) button on mobile
- Collapsed popover context menu items (Rename, Duplicate, Choose emoji, Hide outline) are static divs — not wired to actual handlers
- Copy link works (via `tabConfig.onCopyTabLink`)

### `TabItem`

**File**: `package/components/tabs/tab-item.tsx`

Individual tab row:
- Active state: `color-bg-default-hover` background
- Double-click triggers rename mode (inline `TextField` with Enter/Escape handling, blur-to-save)
- `TabEmojiPicker` for emoji slot (FileText icon when no emoji, actual emoji character when set)
- Comment count badge (shown if > 0, styled as `color-bg-tertiary` pill)
- `TabContextMenu` hidden in version history mode

**Owner menu sections** (3-dot popover):
1. Rename, Duplicate, Choose emoji
2. Copy link, Toggle outline (Show/Hide)
3. Move down (if not last), Move up (if not first)

**Preview mode menu sections**:
1. Copy link, Toggle outline

### `TabEmojiPicker`

**File**: `package/components/tabs/tab-emoji-picker.tsx`

Uses the `frimousse` library (`EmojiPickerPrimitive`). Two states:
- **No emoji**: Shows FileText icon (or SmilePlus when in edit mode). Click opens picker.
- **Has emoji**: Shows a `Popover` with "Choose emoji" / "Clear emoji" options. "Choose emoji" opens the full picker.

Picker panel absolutely positioned below the tab. Separate mobile positioning at 1000px breakpoint.

---

## 4. Comments Integration

### Per-Tab Filtering

**File**: `package/components/inline-comment/context/comment-context.tsx`

Comments are tagged with `tabId` at creation time:
```typescript
const getNewComment = (...): IComment => ({
  id: `comment-${uuid()}`,
  tabId: activeTabId,    // set from current active tab
  ...
});
```

Filtered per-tab:
```typescript
const tabComments = useMemo(
  () => initialComments.filter(
    (comment) => (comment.tabId ?? DEFAULT_TAB_ID) === activeTabId,
  ),
  [initialComments, activeTabId],
);
```

Comments without `tabId` default to `'default'` — backward-compatible with pre-tabs comments.

### Comment Count Badges

Computed in `DdocEditor` from ALL comments (not filtered):
```typescript
const tabCommentCounts = useMemo(() =>
  (initialComments || []).reduce((acc, comment) => {
    if (comment.deleted) return acc;
    const tabId = comment.tabId || DEFAULT_TAB_ID;
    acc[tabId] = (acc[tabId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>),
[initialComments]);
```

Passed through `DocumentOutline` → tab sidebar/mobile panel → tab items for badge display.

---

## 5. Export Support

### `useDdocExport`

**File**: `package/hooks/use-ddoc-export.ts`

Supports both **single-tab** and **all-tabs** export:

- **Single tab**: Delegates to existing `exportOptions` click handlers.
- **All tabs**: For each tab, creates a temporary TipTap editor via `getTemporaryEditor(editor, yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment(tab.id)))`, extracts content, combines, and downloads.

| Format | Multi-tab separator |
|--------|-------------------|
| PDF | `<div data-type="page-break">` between tabs |
| Markdown | `\n\n===\n\n` between tabs |
| HTML | Page-break divs, wrapped in `<!DOCTYPE html>` |
| Text | `\n\n===\n\n` between tabs |

### `DdocExportModal`

**File**: `package/components/export-modal.tsx`

Modal with two `Select` dropdowns:
- **Format**: PDF, Markdown, HTML, Text
- **Tab scope**: "Current tab" + individual tab names (passed as `tabOptions`)

Calls `onExport({ format, tab })` on confirm. `tab === 'all'` triggers multi-tab export.

---

## 6. Props API

### `DdocProps` additions (`package/types.ts`)

```typescript
// Grouped tab configuration
tabConfig?: {
  onCopyTabLink?: (tabId: string) => void;  // "Copy link" context menu callback
  defaultTabId?: string;                      // Initial active tab for deep-linking
};

// Version history integration
versionHistoryState?: {
  enabled: boolean;
  content: string;      // Yjs encoded state for the version
  versionId?: string;   // Hydration key to avoid re-applying
};

// Portal target for version-history tab rendering
tabSectionContainer?: HTMLElement;

// DDoc ownership (drives createDefaultTabIfMissing, shouldSyncActiveTab)
isDDocOwner?: boolean;
```

### What ddocs.new Passes

| Prop | Purpose |
|------|---------|
| `tabConfig.defaultTabId` | Deep-link to a specific tab via URL param (`?tab=<id>`) |
| `tabConfig.onCopyTabLink` | Build + copy shareable URL with tab ID |
| `tabSectionContainer` | Portal target in version-history layout |
| `isDDocOwner` | Controls default tab creation and active tab persistence |

### Existing Props — No Changes Needed

- `onChange` — fires on Y.Doc update (encodes ALL tabs). ddocs.new stores opaque blob.
- `initialContent` — Yjs update format containing all fragments. Applied once to Y.Doc.
- `enableIndexeddbSync` — single IndexedDB provider for entire Y.Doc.
- `enableCollaboration` / `collabConfig` — single WebSocket for entire Y.Doc. Tab metadata and content sync automatically.

---

## 7. File Inventory

### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `package/hooks/use-yjs-setup.ts` | ~128 | Y.Doc lifecycle, IndexedDB, sync machine, onChange |
| `package/hooks/use-tab-manager.ts` | ~361 | Tab CRUD, Y.Map observers, active tab state |
| `package/hooks/use-tab-editor.tsx` | ~1276 | TipTap editor for active tab (extracted from useDdocEditor) |
| `package/hooks/use-ddoc-export.ts` | ~150 | Export logic for single + multi-tab |
| `package/components/tabs/document-tabs-sidebar.tsx` | ~354 | Desktop tab sidebar with DnD |
| `package/components/tabs/document-mobile-tab-panel.tsx` | ~258 | Mobile bottom tab panel |
| `package/components/tabs/tab-item.tsx` | ~364 | Individual tab row + context menu |
| `package/components/tabs/tab-emoji-picker.tsx` | ~100 | Emoji picker using frimousse |
| `package/components/tabs/utils/tab-utils.ts` | ~139 | Y.Doc helpers, migration, clone |
| `package/components/export-modal.tsx` | ~80 | Export modal with format + tab scope |

### Significantly Modified Files

| File | Changes |
|------|---------|
| `package/use-ddoc-editor.tsx` | Refactored from ~1006 lines to ~141 lines. Now composes three hooks. |
| `package/ddoc-editor.tsx` | Wires tab state, renders DocumentOutline with tabs, computes `tabCommentCounts` |
| `package/preview-ddoc-editor.tsx` | Split into content + wrapper, uses `key={editorSessionKey}` (the `versionId` in version-history mode) to remount when the viewed version changes |
| `package/components/toc/document-outline.tsx` | Simplified to router between desktop `DocumentTabsSidebar` and mobile `DocumentMobileTabPanel` |
| `package/components/inline-comment/context/comment-context.tsx` | Per-tab comment filtering via `tabComments` memo, `tabId` on new comments |
| `package/types.ts` | Added `tabConfig`, `versionHistoryState`, `tabSectionContainer`, `isDDocOwner` |
| `package/components/import-export-button.tsx` | Refactored to use `DdocExportModal` with tab-aware export |

### Unchanged (notable)

- `package/sync-local/syncMachine.ts` — syncs whole Y.Doc, tabs included automatically
- `package/extensions/*` — no extension changes; Collaboration `field` param set at runtime
- Presentation mode — works on active editor, presents active tab only

---

## 8. Collaboration Behavior

### What Syncs Automatically (via Y.Doc)

- Tab metadata (names, emoji, showOutline) — via `ddocTabs.tabs` Y.Map
- Tab order — via `ddocTabs.order` Y.Array
- Tab content — via per-tab Y.XmlFragments
- Tab creation/deletion — via Y.Map/Y.Array mutations

### What Does NOT Sync

- **Active tab**: Each collaborator tracks their own active tab locally (React state). The `ddocTabs.activeTabId` Y.Text is only written by the document owner in non-collab mode for persistence across reloads.
- **Awareness `activeTabId`**: Not implemented in current code. Collaborator presence shows name/color but does not indicate which tab they're on.

### Observer Pattern

`useTabManager` observes `ddocTabs` root map + `order` Y.Array. On any remote change:
1. Rebuilds `tabs` array from scratch (iterates `order.toArray()`, reads each tab's metadata)
2. Determines `activeTabId` via: `shouldSyncActiveTab` → read Y.Text, `defaultTabId` → use if valid, else → `'default'`

Additionally, each `DdocTab` component independently observes its own Y.Map metadata for real-time name/emoji updates without full parent re-render.

---

## 9. Edge Cases

### Migration
| Scenario | Behavior |
|----------|----------|
| Legacy doc (no `ddocTabs`) | `deriveTabsFromEncodedState` creates default tab with ID `'default'` pointing to `Y.XmlFragment('default')`. Content preserved. |
| New empty doc (owner, non-collab) | Same migration path, creates empty default tab. |
| Non-owner / collab / preview / version | `createDefaultTabIfMissing = false`. Tabs only appear if encoded state already contains them. |

### Delete
| Scenario | Behavior |
|----------|----------|
| Delete last remaining tab | `deleteTab` throws. UI should hide delete option when `tabs.length <= 1`. |
| Active tab deleted | Falls back to `order[index + 1]` ?? `order[index - 1]`. |
| Soft-delete behavior | Y.XmlFragment content preserved; only metadata + order entry removed. |

### Tab Switching
| Scenario | Behavior |
|----------|----------|
| Switch mechanism | One editor per tab; the 4 most recently visited stay warm, others are rebuilt on revisit. |
| ToC on switch | Served from cache immediately, refreshed asynchronously. |
| Comments on switch | `activeCommentId` cleared. Comment drawer updates to show new tab's comments. |

### Version History
| Scenario | Behavior |
|----------|----------|
| `tabSectionContainer` provided | Tab sidebar portaled into custom container. |
| `isVersionHistoryMode && !tabSectionContainer` | Desktop sidebar renders nothing. |
| Hydration | Uses `versionId + activeTabId` as key to avoid re-applying same content. |

### Deep Linking
| Scenario | Behavior |
|----------|----------|
| `defaultTabId` = valid ID | Activates that tab on load (one-time, ref-guarded). |
| `defaultTabId` = invalid/deleted ID | Falls back to default. |
| No `defaultTabId` | First tab (or persisted active tab if owner). |

---

## 10. Differences from Original Plan

| Aspect | Original Plan | Actual Implementation |
|--------|---------------|----------------------|
| Y.Map key | `'tabsMeta'` | `'ddocTabs'` |
| Tab metadata | `TabMeta` with `fragmentId` field | `Tab` — tab ID IS the fragment key |
| Active tab storage | Not specified in Y.Doc | `Y.Text('activeTabId')` inside `ddocTabs` |
| Tab switching | `key={activeTabId}` forcing full editor remount | One editor per tab, 4 most recent kept warm (`useTabEditorCache`); an earlier build used a single editor with `setExtensions` |
| Hook names | `useYjsDocument`, `useTabsManager`, `useTabEditor` | `useYjsSetup`, `useTabManager`, `useTabEditor` |
| Undo system | In-memory stack + Ctrl+Z interceptor + 10s window | Not implemented |
| Tab switch blocking | `pendingOperationRef` for image upload / AI streaming | Not implemented |
| Awareness `activeTabId` | Broadcast via `awareness.setLocalStateField` | Not implemented |
| Collab delete-blocking | Check awareness for occupied tabs | Not implemented |
| Tab name validation | Max 50 chars, empty rejection | Basic trim + fallback to original, no max length enforcement |
| Max tab count | 20 tabs | No limit enforced |
| Tab ID generation | `nanoid()` | `generateRandomBytes()` + base64 encoding |
| Content cloning (duplicate) | Temp TipTap editors to serialize/deserialize | Direct Y.XmlFragment node cloning via `cloneFragmentContent()` |
| Prop grouping | `tabsConfig?: TabsConfig` (with analytics callbacks) | `tabConfig?: { onCopyTabLink, defaultTabId }` (minimal) |
| Delete UI | Wired to context menu | `deleteTab` exists in hook but NOT wired to any UI component |
| Mobile | Full BottomDrawer with tab CRUD | Fixed bottom panel with limited functionality |
| Export | Active tab only, multi-tab deferred | Full multi-tab export implemented with per-format separators |
| Priority breakdown | P0 MVP → P1 fast-follow → P2 emoji | All implemented together (including drag-drop and emoji) |

---

## 11. Known Issues & Tech Debt

| ID | Priority | Description |
|----|----------|-------------|
| F-68 | P1 | Stale `onChange` ref in `use-yjs-setup.ts` — `useEffect` depends only on `[ydoc]`, closure captures `onChange` at mount time, goes stale on re-render. Fix: wrap in `useRef`. |
| F-02 | P2 | `deriveTabsFromEncodedState` lacks idempotency guard — in collab, two clients opening a legacy doc simultaneously could both create the default tab structure (CRDT-safe but creates duplicate entries). |
| Mobile menu | P2 | Collapsed popover items (Rename, Duplicate, Choose emoji, Hide outline) in `document-mobile-tab-panel.tsx` are static divs with no `onClick` handlers. |
| Mobile create | P2 | No "create tab" (`+`) button on mobile. |
| Delete UI | P2 | `deleteTab` exists in `useTabManager` but is not wired to any UI component (no delete option in context menu). |
| Duplicate observer | P3 | Each `DdocTab` independently observes its Y.Map metadata — duplicates work already done by `useTabManager`'s top-level observer. |
| Direct Y.Map write | P3 | `handleShowOutline` in `DdocTab` writes directly to Y.Map, bypassing `useTabManager.renameTab`. |
| Prop bloat | Tech debt | `DocumentOutlineProps` has 16+ props — consider grouping into sub-objects. |
| `tabSectionContainer` | Tech debt | Raw `HTMLElement` as React prop is an anti-pattern — consider ref or portal pattern. |

---

## 12. What ddocs.new Needs to Change

### Minimal Changes Required

1. **Pass `tabConfig`**:
   ```typescript
   <DdocEditor
     // ... existing 50+ props unchanged ...
     tabConfig={{
       defaultTabId: searchParams.get('tab') || undefined,
       onCopyTabLink: (tabId) => {
         const url = new URL(window.location.href);
         url.searchParams.set('tab', tabId);
         navigator.clipboard.writeText(url.toString());
       },
     }}
   />
   ```

2. **Pass `isDDocOwner`**: Controls whether default tab is auto-created and whether active tab is persisted.

3. **Pass `tabSectionContainer`** (version history only): DOM element for portaling tab sidebar.

### No Changes Needed

- Content persistence (`handleChanges`, `persistDocumentContent`) — unchanged
- Collaboration setup — unchanged
- Comments — `tabId` field auto-persisted, no schema change needed
- Image handlers — unchanged
- Any existing prop values — unchanged

---

## 13. Build & Verify

```bash
npx tsc --noEmit    # TypeScript check
npm run build       # Full build
npm run dev         # Demo app
```
