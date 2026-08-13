import { useEffect, useMemo, useRef, useState } from 'react';
import { DdocProps } from './types';
import { useDocSchemaVersion } from './hooks/use-doc-schema-version';
import { useTabEditor } from './hooks/use-tab-editor';
import { useTabManager } from './hooks/use-tab-manager';
import { useYjsSetup } from './hooks/use-yjs-setup';
import { Editor } from '@tiptap/react';
import type { DBlockRuntimeState } from './extensions/d-block/dblock-runtime';
import { registerFonts } from './utils/font-loader';

export const useDdocEditor = ({
  isPreviewMode,
  viewerMode,
  initialContent,
  versionHistoryState,
  collaboration,
  onChange,
  onCollaboratorChange,
  onCommentInteraction,
  onError,
  setCharacterCount,
  setWordCount,
  setSelectedWordCount,
  setPageCount,
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
  ...rest
}: Partial<DdocProps> & {
  isFocusMode?: boolean;
  isPreviewEditor?: boolean;
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
    enableIndexeddbSync,
    ddocId,
    collaboration,
    onCollaboratorChange,
    onIndexedDbError,
  });
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

  const tabManager = useTabManager({
    ydoc: yjsSetup.ydoc,
    initialContent: ddocContent,
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
  const { docSchemaVersion, isSchemaUnsupported } = useDocSchemaVersion({
    ydoc: yjsSetup.ydoc,
    isNewDdoc: Boolean(rest.isDDocOwner && !collabEnabled && !ddocContent),
    isContentResolved:
      !shouldWaitForIndexeddbBeforeCreatingDefaultTab ||
      yjsSetup.isIndexeddbSynced,
    preferredSchemaVersion,
  });

  const tabEditor = useTabEditor({
    ydoc: yjsSetup.ydoc,
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
    initialiseYjsIndexedDbProvider: yjsSetup.initialiseYjsIndexedDbProvider,
    externalExtensions,
    // An empty activeTabId makes useTabEditorCache destroy every editor and
    // create none, so this build never binds y-sync to a newer-schema doc.
    // Do NOT also gate on schema resolution: IndexedDB sync only starts from
    // the editor's content effect, so holding the editor until sync deadlocks.
    // A doc whose marker arrives late rebuilds its editors via the
    // docSchemaVersion dependency of buildExtensionsForTab instead.
    activeTabId: isSchemaUnsupported ? '' : tabManager.activeTabId,
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
