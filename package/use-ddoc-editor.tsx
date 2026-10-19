import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DdocProps } from './types';
import { useDocSchemaVersion } from './hooks/use-doc-schema-version';
import { useTabEditor } from './hooks/use-tab-editor';
import { useTabManager } from './hooks/use-tab-manager';
import { useYjsSetup } from './hooks/use-yjs-setup';
import { Editor } from '@tiptap/react';
import type { DBlockRuntimeState } from './extensions/d-block/dblock-runtime';
import { registerFonts } from './utils/font-loader';
import type { EditorWidthStore } from './utils/editor-width-store';

export const useDdocEditor = ({
  isPreviewMode,
  viewerMode,
  initialContent,
  versionHistoryState,
  collaboration,
  onChange,
  onLocalChange,
  isNewDocument,
  onCollaboratorChange,
  onCommentInteraction,
  onError,
  setCharacterCount,
  setWordCount,
  setSelectedWordCount,
  setPageCount,
  onStatsChange,
  ipfsImageUploadFn,
  ddocId,
  enableIndexeddbSync,
  unFocused,
  isFocusMode,
  theme,
  zoomLevel,
  onInvalidContentError,
  ignoreCorruptedData,
  isPresentationMode,
  metadataProxyUrl,
  extensions: externalExtensions,
  onCopyHeadingLink,
  ipfsImageFetchFn,
  fetchV1ImageFn,
  isConnected,
  activeModel,
  maxTokens,
  isAIAgentEnabled,
  onIndexedDbError,
  disableInlineComment,
  initialCommentAnchors,
  isPreviewEditor = false,
  fonts,
  preferredSchemaVersion,
  editorWidthStore,
  onSchemaStampGuard,
  ...rest
}: Partial<DdocProps> & {
  isFocusMode?: boolean;
  isPreviewEditor?: boolean;
  editorWidthStore?: EditorWidthStore;
}) => {
  useEffect(() => {
    registerFonts(fonts ?? []);
  }, [fonts]);

  const [isContentLoading, setIsContentLoading] = useState(true);
  const [isCollabContentLoading, setIsCollabContentLoading] = useState(true);
  const editorRef = useRef<Editor | null>(null);
  const isVersionMode = Boolean(versionHistoryState?.enabled);
  const ddocContent = versionHistoryState?.content ?? initialContent;

  const collabEnabled = collaboration?.enabled === true;
  const isCollaboratorsDoc = Boolean(
    collabEnabled && !collaboration?.connection.isOwner,
  );
  const dBlockRuntimeState = useMemo<DBlockRuntimeState>(
    () => ({
      isPreviewMode: Boolean(isPreviewMode),
      isPresentationMode: Boolean(isPresentationMode),
      isPreviewEditor: Boolean(isPreviewEditor),
      isCollaboratorsDoc,
      isFocusMode: Boolean(isFocusMode),
      // Real value is merged in by ddoc-editor (which knows Split View state).
      isSplitView: false,
    }),
    [
      isCollaboratorsDoc,
      isFocusMode,
      isPresentationMode,
      isPreviewEditor,
      isPreviewMode,
    ],
  );
  const dBlockRuntimeStateRef = useRef(dBlockRuntimeState);
  dBlockRuntimeStateRef.current = dBlockRuntimeState;

  const yjsSetup = useYjsSetup({
    onChange,
    onLocalChange,
    enableIndexeddbSync,
    ddocId,
    collaboration,
    onCollaboratorChange,
    onIndexedDbError,
  });
  // Mounted without a body ('' or none) over a store that may hold one: the
  // doc's schema marker is only known once the store has loaded. An editor
  // bound before that binds with the wrong schema, and the replayed content is
  // rewritten and deleted, then saved back into the store (every tab lost).
  // So the editor is held until the store has synced, and the store load is
  // started here: the editor, which normally starts it, is not built yet.
  const { initialiseYjsIndexedDbProvider } = yjsSetup;
  const isAwaitingStore = Boolean(
    enableIndexeddbSync &&
      ddocId &&
      !collabEnabled &&
      !isVersionMode &&
      ddocContent !== null &&
      !ddocContent &&
      !yjsSetup.isIndexeddbSynced,
  );
  const storeLoadStartedRef = useRef(false);
  useEffect(() => {
    if (!isAwaitingStore || storeLoadStartedRef.current) return;
    storeLoadStartedRef.current = true;
    void initialiseYjsIndexedDbProvider();
  }, [isAwaitingStore, initialiseYjsIndexedDbProvider]);
  // The editor, once built, starts the store load itself; a load started
  // above is not started twice.
  const initialiseYjsIndexedDbProviderForEditor = useCallback(
    () =>
      storeLoadStartedRef.current
        ? Promise.resolve()
        : initialiseYjsIndexedDbProvider(),
    [initialiseYjsIndexedDbProvider],
  );

  const shouldWaitForIndexeddbBeforeCreatingDefaultTab = Boolean(
    enableIndexeddbSync &&
      !collabEnabled &&
      rest.isDDocOwner &&
      !isVersionMode &&
      !isPreviewMode &&
      !ddocContent,
  );

  const shouldSyncActiveTab = Boolean(
    !isVersionMode && !isPreviewMode && !collabEnabled && rest.isDDocOwner,
  );

  // A doc is new only when the host says so. It used to be inferred from
  // "owner, no collab, no body", which is also what an EXISTING doc looks
  // like when the host mounts it before its body is in hand (a stale draft
  // flag, a fresh device, a body-less row). That inference stamped the
  // preferred schema onto an empty Y.Doc, the stamp was persisted into the
  // store ahead of the replay, and the real body then bound with the wrong
  // schema and was deleted (TEC-3272). With no assertion the doc opens with
  // the schema its content carries, v1 for an unmarked doc: slower on big
  // tables, never destructive.
  const isNewDdoc = isNewDocument === true;
  const inferredNew = Boolean(
    rest.isDDocOwner && !collabEnabled && !ddocContent,
  );

  const tabManager = useTabManager({
    ydoc: yjsSetup.ydoc,
    initialContent: ddocContent,
    isNewDocument: isNewDdoc,
    enableCollaboration: collabEnabled,
    isDDocOwner: rest.isDDocOwner || false,
    createDefaultTabIfMissing: Boolean(
      !isVersionMode &&
        !isPreviewMode &&
        rest.isDDocOwner &&
        !collabEnabled &&
        // Wait for y-indexedDB sync before deciding whether an unsaved local doc
        // still needs a default tab, otherwise refresh keeps bootstrapping one.
        (!shouldWaitForIndexeddbBeforeCreatingDefaultTab ||
          yjsSetup.isIndexeddbSynced),
    ),
    defaultTabId: rest.tabConfig?.defaultTabId,
    shouldSyncActiveTab,
    // Viewers (non-owners) should land on the first tab, not whatever the
    // owner last selected, since active-tab is persisted in the shared Yjs doc.
    preferFirstTabOnInit: !rest.isDDocOwner,
    onVersionHistoryActiveTabChange: versionHistoryState?.onActiveTabChange,
    getEditor: () => editorRef.current,
    flushPendingUpdate: yjsSetup.flushPendingUpdate,
  });
  const tabIds = useMemo(
    () => tabManager.tabs.map((tab) => tab.id),
    [tabManager.tabs],
  );

  // Called after useTabManager on purpose: initialContent is decoded into the
  // ydoc synchronously by useTabManager's hydration memo, so the schema marker
  // is already readable here on the very first render.
  const unassertedReportedRef = useRef(false);
  useEffect(() => {
    if (isNewDdoc || !inferredNew || unassertedReportedRef.current) return;
    if (isVersionMode || isPreviewMode) return;
    unassertedReportedRef.current = true;
    onSchemaStampGuard?.({
      kind: 'unasserted-new',
      preferredSchemaVersion: preferredSchemaVersion ?? 1,
    });
  }, [
    isNewDdoc,
    inferredNew,
    isVersionMode,
    isPreviewMode,
    onSchemaStampGuard,
    preferredSchemaVersion,
  ]);

  const { docSchemaVersion, isSchemaUnsupported } = useDocSchemaVersion({
    ydoc: yjsSetup.ydoc,
    isNewDdoc,
    isContentResolved:
      !shouldWaitForIndexeddbBeforeCreatingDefaultTab ||
      yjsSetup.isIndexeddbSynced,
    preferredSchemaVersion,
    onSchemaStampGuard,
  });

  const tabEditor = useTabEditor({
    ydoc: yjsSetup.ydoc,
    editorWidthStore,
    isPreviewMode,
    viewerMode,
    initialContent: ddocContent,
    collaboration,
    versionId: versionHistoryState?.versionId,
    isReady: yjsSetup.isReady,
    awareness: yjsSetup.awareness,
    disableInlineComment,
    isFocusMode,
    onCommentInteraction,
    onError,
    ipfsImageUploadFn,
    metadataProxyUrl,
    onCopyHeadingLink,
    ipfsImageFetchFn,
    fetchV1ImageFn,
    isConnected,
    activeModel,
    maxTokens,
    isAIAgentEnabled,
    setCharacterCount,
    setWordCount,
    setSelectedWordCount,
    setPageCount,
    onStatsChange,
    setIsContentLoading,
    setIsCollabContentLoading,
    unFocused,
    zoomLevel,
    isPresentationMode,
    isContentLoading,
    onInvalidContentError,
    ignoreCorruptedData,
    onConnect: yjsSetup.onConnect,
    onDisconnect: yjsSetup.onDisconnect,
    isIndexeddbSynced: yjsSetup.isIndexeddbSynced,
    hasCollabContentInitialised: yjsSetup.hasCollabContentInitialised,
    initialiseYjsIndexedDbProvider: initialiseYjsIndexedDbProviderForEditor,
    externalExtensions,
    // An empty activeTabId makes useTabEditorCache destroy every editor and
    // create none, so this build never binds y-sync to a newer-schema doc,
    // nor to a doc whose store has not loaded yet (isAwaitingStore, which
    // starts the store load itself so holding the editor cannot deadlock).
    activeTabId:
      isSchemaUnsupported || isAwaitingStore ? '' : tabManager.activeTabId,
    tabIds,
    docSchemaVersion,
    hasTabState: tabManager.hasTabState,
    isVersionMode,
    theme,
    editorRef,
    initialCommentAnchors,
    dBlockRuntimeStateRef,
  });

  // A tab switch is not a content edit, so it is written to Yjs with the
  // 'self' origin and never reaches the consumer's onChange. The blob the
  // consumer hands back as initialContent therefore carries a STALE
  // activeTabId, while IndexedDB (which records every update regardless of
  // origin) carries the true one. The stale tab is applied synchronously and
  // painted, then corrected once IndexedDB syncs — visibly flashing another
  // tab's content for ~100ms. Keep the loading state up over that window so
  // the first thing rendered is the tab the user actually left on.
  //
  // Only the editor CONTENT is withheld; the editor instance is still created
  // (it is what triggers IndexedDB initialisation), so this cannot deadlock.
  const isActiveTabUnsettled = Boolean(
    enableIndexeddbSync &&
      !yjsSetup.isIndexeddbSynced &&
      shouldSyncActiveTab &&
      tabManager.tabs.length > 1,
  );

  const isOwner = collabEnabled ? collaboration.connection.isOwner : true;
  const aggregatedContentLoading =
    (collabEnabled && !isOwner
      ? tabEditor.isContentLoading || isCollabContentLoading
      : tabEditor.isContentLoading) || isActiveTabUnsettled;

  return {
    ...tabEditor,
    ...yjsSetup,
    ydoc: yjsSetup.ydoc,
    awareness: yjsSetup.awareness,
    refreshYjsIndexedDbProvider: yjsSetup.refreshYjsIndexedDbProvider,
    terminateSession: yjsSetup.terminateSession,
    isContentLoading: Boolean(aggregatedContentLoading),
    isSchemaUnsupported,
    docSchemaVersion,
    tabs: tabManager.tabs,
    hasTabState: tabManager.hasTabState,
    dBlockRuntimeState,
    dBlockRuntimeStateRef,
    isVersionMode,
    activeTabId: tabManager.activeTabId,
    setTabs: tabManager.setTabs,
    setActiveTabId: tabManager.setActiveTabId,
    createTab: tabManager.createTab,
    deleteTab: tabManager.deleteTab,
    renameTab: tabManager.renameTab,
    duplicateTab: tabManager.duplicateTab,
    orderTab: tabManager.orderTab,
  };
};
