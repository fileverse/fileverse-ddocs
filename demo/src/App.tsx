import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import DdocEditor from '../../package/ddoc-editor';
import type { FontDescriptor } from '../../package/types';
import { Editor, JSONContent } from '@tiptap/react';
import { SecondLevelNav } from './components/second-level-nav/second-level-nav';
import { demoMenuTree } from './components/second-level-nav/menu-tree';
import { deriveCapabilities } from './components/second-level-nav/capabilities';
import { createDemoAppActions } from './components/second-level-nav/demo-app-actions';
import { LinkModal } from './components/LinkModal';

const demoFonts: FontDescriptor[] = [
  {
    name: 'Poppins',
    family: 'Poppins, sans-serif',
    url: 'https://fonts.gstatic.com/s/poppins/v22/pxiEyp8kv8JHgFVrJJfecnFHGPc.woff2',
  },
  {
    name: 'Inter',
    family: 'Inter, sans-serif',
    url: 'https://fonts.gstatic.com/s/inter/v20/UcCo3FwrK3iLTcviYwYZ8UA3.woff2',
  },
];
import {
  Button,
  Tag,
  IconButton,
  LucideIcon,
  toast,
  Toaster,
  TagType,
  DynamicDropdown,
  ThemeToggle,
} from '@fileverse/ui';
import { useMediaQuery } from 'usehooks-ts';
import { IComment } from '../../package/extensions/comment';
import { fromUint8Array } from 'js-base64';
import { crypto as cryptoUtils } from './crypto';
import { collabStore } from './storage/collab-store';
import { docStore } from './storage/doc-store';
import { DocumentStylingPanel } from './DocumentStylingPanel';
import {
  DocumentStyling,
  CollaborationProps,
  CollabState,
  SerializedCommentAnchor,
  CommentMutationMeta,
} from '../../package/types';
import {
  getKeyFromURLParams,
  generateDocId,
  getDocIdFromURL,
  getTabIdFromURL,
  setURLParams,
  buildDocTabURL,
} from './utils';
import { DevBar } from './components/DevBar';
import { DocSwitcher } from './components/DocSwitcher';

function App() {
  // --- Document identity ---
  const [docId] = useState<string>(() => {
    const urlDocId = getDocIdFromURL();
    if (urlDocId) {
      const list = docStore.getDocList();
      if (!list.find((d) => d.id === urlDocId)) {
        docStore.addDoc({
          id: urlDocId,
          title: 'Untitled',
          createdAt: Date.now(),
          lastModifiedAt: Date.now(),
        });
      }
      docStore.setCurrentDocId(urlDocId);
      return urlDocId;
    }

    const storedDocId = docStore.getCurrentDocId();
    if (storedDocId) {
      setURLParams({ doc: storedDocId });
      return storedDocId;
    }

    const newId = generateDocId();
    docStore.addDoc({
      id: newId,
      title: 'Untitled',
      createdAt: Date.now(),
      lastModifiedAt: Date.now(),
    });
    docStore.setCurrentDocId(newId);
    setURLParams({ doc: newId });
    return newId;
  });

  const urlTabId = getTabIdFromURL();

  const isOwnerEdSecretSet = import.meta.env.VITE_OWNER_ED_SECRET;
  // --- Persistence ---
  // Use undefined (not null) when no saved content — null has special meaning
  // in use-tab-editor.tsx (it signals "content explicitly not ready yet")
  const [initialContent] = useState<string | undefined>(
    () => docStore.getContent(docId) || undefined,
  );
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (
      updatedDocContent: string | JSONContent,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _updateChunk: string,
    ) => {
      if (typeof updatedDocContent === 'string') {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
        saveTimeoutRef.current = setTimeout(() => {
          docStore.setContent(docId, updatedDocContent);
          setLastSavedAt(Date.now());
        }, 100);
      }
    },
    [docId],
  );

  // --- Tab deep linking ---
  const handleCopyTabLink = useCallback(
    (tabId: string) => {
      const url = buildDocTabURL(docId, tabId);
      navigator.clipboard.writeText(url).then(() => {
        toast({
          title: 'Tab link copied to clipboard',
          variant: 'success',
          toastType: 'mini',
          iconType: 'icon',
        });
      });
    },
    [docId],
  );

  const tabConfig = useMemo(
    () => ({
      defaultTabId: urlTabId,
      onCopyTabLink: handleCopyTabLink,
    }),
    [urlTabId, handleCopyTabLink],
  );

  // --- Dev bar state ---
  const [activeTabInfo, setActiveTabInfo] = useState({
    activeTabId: 'default',
    tabCount: 0,
  });

  const [collabEnabled, setCollabEnabled] = useState(false);
  const [collabStatus, setCollabStatus] = useState<string>('off');
  const [username, setUsername] = useState('username');
  const isMobile = useMediaQuery('(max-width: 768px)');
  const isMediaMax1280px = useMediaQuery('(max-width: 1280px)');
  const [selectedTags, setSelectedTags] = useState<TagType[]>([]);
  const [isCommentSectionOpen, setIsCommentSectionOpen] = useState(false);
  const [isPresentationMode, setIsPresentationMode] = useState(false);
  const [isSplitView, setIsSplitView] = useState(false);
  const [showTOC, setShowTOC] = useState<boolean>(true);
  const [collaborationId, setCollaborationId] = useState<string>('');
  const [collabRoomKey, setCollabRoomKey] = useState<string>('');

  const [characterCount, setCharacterCount] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [pageCount, setPageCount] = useState(0);

  // --- Title with persistence ---
  const [title, setTitle] = useState(() => {
    const list = docStore.getDocList();
    const doc = list.find((d) => d.id === docId);
    return doc?.title || 'Untitled';
  });

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      docStore.updateDocTitle(docId, newTitle);
    },
    [docId],
  );

  // Document styling state - starts undefined to allow dark mode to work
  const [documentStyling, setDocumentStyling] = useState<
    DocumentStyling | undefined
  >(undefined);
  const [showStylingControls, setShowStylingControls] = useState(false);

  const [inlineCommentData, setInlineCommentData] = useState({
    inlineCommentText: '',
    highlightedTextContent: '',
    handleClick: false,
  });

  const [zoomLevel, setZoomLevel] = useState<string>('1');
  const [isNavbarVisible, setIsNavbarVisible] = useState(true);
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  // Controlled focus mode (D6) — the second-level nav's View menu drives it.
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const isOnline = useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb);
      window.addEventListener('offline', cb);
      return () => {
        window.removeEventListener('online', cb);
        window.removeEventListener('offline', cb);
      };
    },
    () => navigator.onLine,
  );
  const [disableInlineComment, setDisableInlineComment] = useState(false);
  const [isDDocOwner, setIsDDocOwner] = useState(true);
  const [viewerMode, setViewerMode] = useState<
    'suggest' | 'view-only' | undefined
  >(undefined);

  // Single mode picker for the demo navbar — cycles
  // Owner → Viewer/Suggest → Viewer/View-only → Owner.
  const cycleMode = () => {
    if (isDDocOwner) {
      setIsDDocOwner(false);
      setIsPreviewMode(true);
      setViewerMode('suggest');
    } else if (viewerMode === 'suggest') {
      setViewerMode('view-only');
    } else {
      setIsDDocOwner(true);
      setIsPreviewMode(false);
      setViewerMode(undefined);
    }
  };
  const modeIcon = isDDocOwner
    ? 'Crown'
    : viewerMode === 'suggest'
      ? 'PenLine'
      : 'Eye';
  const modeLabel = isDDocOwner
    ? 'Owner'
    : viewerMode === 'suggest'
      ? 'Suggest'
      : 'View-only';
  const nextModeLabel = isDDocOwner
    ? 'Suggest'
    : viewerMode === 'suggest'
      ? 'View-only'
      : 'Owner';
  const [initialCommentAnchors, setInitialCommentAnchors] = useState<
    SerializedCommentAnchor[]
  >([]);

  const searchParams = new URLSearchParams(window.location.search);
  const paramCollaborationId = searchParams.get('collaborationId');
  const paramKey = getKeyFromURLParams(searchParams);
  const [collabIsOwner, setCollabIsOwner] = useState(false);
  const [collabExtras, setCollabExtras] = useState<{
    ownerEdSecret?: string;
    contractAddress?: string;
    ownerAddress?: string;
    isEns?: boolean;
  }>({});

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);

  // Dev affordance: expose the editor handle for automated smoke tests.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ddoc = editorRef;
  }, []);

  // Poll tab state from Y.Doc for DevBar
  useEffect(() => {
    const interval = setInterval(() => {
      if (!editorRef.current) return;
      try {
        const ydoc = editorRef.current.getYdoc();
        if (!ydoc) return;
        const root = ydoc.getMap('ddocTabs');
        const order = root.get('order');
        const activeTab = root.get('activeTabId');
        if (order && activeTab) {
          setActiveTabInfo({
            activeTabId: activeTab.toString() || 'default',
            tabCount: order.length,
          });
        }
      } catch {
        // Editor not ready yet
      }
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (paramCollaborationId && paramKey) {
      const name = prompt('Whats your username');
      if (!name) return;

      setCollabRoomKey(paramKey);
      setCollaborationId(paramCollaborationId);
      setUsername(name);
      setCollabIsOwner(false);
      setCollabEnabled(true);
    }
  }, [paramCollaborationId, paramKey]);
  //To handle comments from consumer side

  const [commentDrawerOpen, setCommentDrawerOpen] = useState(false);
  const [initialComments, setInitialComment] = useState<IComment[]>([]);

  const handleReplyOnComment = (id: string, reply: IComment) => {
    setInitialComment((prev) =>
      prev.map((comment) => {
        if (comment.id === id) {
          return {
            ...comment,
            replies: [
              ...(comment.replies || []),
              { ...reply, commentIndex: comment.replies?.length },
            ],
          };
        }
        return comment; // Ensure you return the unchanged comment
      }),
    );
  };
  const handleNewComment = (comment: IComment, meta?: CommentMutationMeta) => {
    setInitialComment((prev) => [
      ...prev,
      { ...comment, commentIndex: prev.length, version: '2' },
    ]);

    // Register the serialized anchor for every new comment that came in with
    // anchor positions (both regular comments and suggestions). The package's
    // initialCommentAnchors useEffect resets `commentAnchorsRef.current` to
    // whatever this prop holds whenever it changes — if a regular comment
    // isn't included here, a subsequent suggestion submit (which DOES
    // re-set this state) wipes the regular comment's anchor and its
    // decoration disappears.
    if (comment.id && meta?.anchorFrom && meta?.anchorTo) {
      const anchor: SerializedCommentAnchor = {
        id: comment.id,
        anchorFrom: meta.anchorFrom,
        anchorTo: meta.anchorTo,
        resolved: false,
        deleted: false,
        ...(comment.isSuggestion && {
          isSuggestion: true,
          suggestionType: meta.suggestionType,
          originalContent: meta.originalContent,
          suggestedContent: meta.suggestedContent,
        }),
      };
      setInitialCommentAnchors((prev) => [...prev, anchor]);
    }
  };
  const handleResolveComment = (commentId: string) => {
    setInitialComment(
      initialComments.map((comment) =>
        comment.id === commentId ? { ...comment, resolved: true } : comment,
      ),
    );
  };

  const handleUnresolveComment = (commentId: string) => {
    setInitialComment(
      initialComments.map((comment) =>
        comment.id === commentId ? { ...comment, resolved: false } : comment,
      ),
    );
  };
  const handleDeleteComment = (commentId: string) => {
    setInitialComment(
      initialComments.map((comment) => {
        if (comment.id === commentId) {
          return {
            ...comment,
            deleted: true,
          };
        } else {
          return { ...comment };
        }
      }),
    );
  };

  //To handle comments from consumer side

  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    const stored = collabStore.getCollabConf();
    if (stored) {
      setCollabRoomKey(stored.roomKey);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setCollaborationId(stored.roomId || (stored as any).collaborationId);
      setUsername(stored.username);
      setCollabIsOwner(stored.isOwner);
      setCollabExtras({
        ownerEdSecret: stored.ownerEdSecret,
        contractAddress: stored.contractAddress,
        ownerAddress: stored.ownerAddress,
        isEns: stored.isEns,
      });
      setCollabEnabled(true);
    }
  }, []);

  const onToggleCollaboration = async () => {
    const name = prompt('Whats your username');
    if (!name) return;
    const { privateKey } = cryptoUtils.generateKeyPair();

    const newCollabId = crypto.randomUUID();
    const privateKeyBase64 = fromUint8Array(privateKey, true);

    const extras = {
      ownerEdSecret: import.meta.env.VITE_OWNER_ED_SECRET,
      contractAddress: import.meta.env.VITE_COLLAB_CONTRACT_ADDRESS,
      ownerAddress: import.meta.env.VITE_COLLAB_OWNER_ADDRESS,
      isEns: true as const,
    };

    collabStore.setCollabConf({
      roomKey: privateKeyBase64,
      roomId: newCollabId,
      wsUrl: import.meta.env.VITE_COLLAB_WS_URL,
      isOwner: true,
      username: name,
      ...extras,
    });

    setCollabRoomKey(privateKeyBase64);
    setCollaborationId(newCollabId);
    setUsername(name);
    setCollabIsOwner(true);
    setCollabExtras(extras);
    setCollabEnabled(true);

    console.log(
      `${window.location.origin}?collaborationId=${newCollabId}#key=${privateKeyBase64}`,
    );

    await navigator.clipboard.writeText(
      `${window.location.origin}?collaborationId=${newCollabId}#key=${privateKeyBase64}`,
    );

    toast({
      title: 'Collaboration link copied to clipboard',
      variant: 'success',
      toastType: 'mini',
      iconType: 'icon',
    });
  };

  // --- Second-level nav wiring (capability engine, consumer-mirror) ---
  // isCommentUsable: demo has no publish/IPFS-availability concept (unlike
  // the consumer's comments.available/isDocumentPublished), so this derives
  // from the closest equivalents already tracked here: `isOnline` (network,
  // consumer's comments.available proxy) and `!collabEnabled` (RTC gate,
  // consumer's !enableCollaboration). No unpublished-doc gate to mirror.
  const caps = deriveCapabilities({
    isPreviewMode,
    isCollaboratorMode: collabEnabled && !collabIsOwner,
    isDDocOwner,
    isAuthenticated: isConnected,
    isOnline,
    hasSelection: false, // refined inside SecondLevelNav from the registry
    permissionAllowsComment: !disableInlineComment,
    isRtcEnabled: collabEnabled,
    isCommentUsable: isOnline && !collabEnabled,
  });

  const renderNavbar = ({
    editor,
    liveEditor,
  }: {
    editor: JSONContent;
    liveEditor: Editor | null;
  }): JSX.Element => {
    const publishDoc = () => console.log(editor, title);
    const appActions = createDemoAppActions({
      liveEditor,
      exportModal: (format?: string) =>
        editorRef.current?.exportCurrentTabOrOpenExportModal(format),
      exportMarkdown: () =>
        editorRef.current?.exportContentAsMarkDown(title || 'Untitled'),
      onError: (msg) =>
        toast({
          title: 'Error',
          description: msg,
          variant: 'error',
          iconType: 'icon',
        }),
      isFocusMode,
      setIsFocusMode,
      showTOC,
      setShowTOC,
      openCommentsDrawer: () => setCommentDrawerOpen(true),
      canvasCommentsHidden: disableInlineComment,
      toggleCanvasComments: () => setDisableInlineComment((v) => !v),
      isSplitView,
      toggleSplitView: () => setIsSplitView((v: boolean) => !v),
      createTab: () => editorRef.current?.createTab?.(),
      openLinkModal: () => setLinkModalOpen(true),
      toggleStyling: () => setShowStylingControls((v) => !v),
      zoomLevel,
      setZoomLevel,
      documentStyling,
      setDocumentStyling,
      startPresentation: () => setIsPresentationMode(true),
    });

    return (
      <>
        {/* Split view's markdown pane is the sole input surface — the doc
            menus must not be reachable while it is active. */}
        {!isSplitView && (
          <SecondLevelNav
            tree={demoMenuTree}
            liveEditor={liveEditor}
            caps={caps}
            appActions={appActions}
          />
        )}
        <div className="flex gap-2 items-center">
          <DocSwitcher currentDocId={docId} currentTitle={title} />
          <div className="relative truncate inline-block xl:!max-w-[300px] !max-w-[108px] color-bg-default text-[14px] font-medium leading-[20px]">
            <span className="invisible whitespace-pre">
              {title || 'Untitled'}
            </span>
            <input
              className="focus:outline-none truncate color-bg-default absolute top-0 left-0 right-0 bottom-0 select-text"
              type="text"
              placeholder="Untitled"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
            />
          </div>
          <Tag
            icon="CircleCheck"
            variant="transparent"
            className="h-6 rounded border color-border-default color-text-secondary text-[12px] font-normal hidden xl:flex"
            style={{ backgroundColor: 'hsl(var(--color-bg-secondary))' }}
          >
            {lastSavedAt ? 'Saved' : 'Not saved yet'}
          </Tag>
          <div className="w-6 h-6 rounded color-bg-secondary flex justify-center items-center border color-border-default xl:hidden">
            <LucideIcon
              name="BadgeCheck"
              size="sm"
              className="color-text-secondary"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <ThemeToggle />

          {isMediaMax1280px ? (
            <DynamicDropdown
              key="navbar-more-actions"
              align="center"
              sideOffset={10}
              anchorTrigger={
                <IconButton
                  icon={'EllipsisVertical'}
                  variant="ghost"
                  size="md"
                />
              }
              content={
                <div className="flex flex-col gap-1 p-2 w-fit shadow-elevation-3 ">
                  <Button
                    variant={'ghost'}
                    onClick={() => setShowTOC(true)}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name="List" size="sm" />
                    Document Outline
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={cycleMode}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name={modeIcon} size="sm" />
                    {modeLabel}
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={() => setDisableInlineComment((v) => !v)}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon
                      name={disableInlineComment ? 'EyeOff' : 'Eye'}
                      size="sm"
                    />
                    {disableInlineComment
                      ? 'Show inline comments'
                      : 'Hide inline comments'}
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={() => {}}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name="Share2" size="sm" />
                    Share
                  </Button>
                  <Button
                    variant={'ghost'}
                    onClick={() => setShowStylingControls(!showStylingControls)}
                    className="flex justify-start gap-2"
                  >
                    <LucideIcon name="Palette" size="sm" />
                    Styling
                  </Button>
                </div>
              }
            />
          ) : (
            <>
              <IconButton
                variant={'ghost'}
                icon={modeIcon}
                size="md"
                title={`${modeLabel} mode — click to switch to ${nextModeLabel}`}
                onClick={cycleMode}
              />
              <IconButton
                variant={'ghost'}
                icon="Share2"
                className="flex xl:hidden"
                size="md"
              />
              <IconButton
                variant={'ghost'}
                icon="Palette"
                size="md"
                onClick={() => setShowStylingControls(!showStylingControls)}
              />
            </>
          )}
          <IconButton
            variant={'ghost'}
            icon="MessageSquareText"
            size="md"
            onClick={() => setCommentDrawerOpen((prev) => !prev)}
          />
          {!collabEnabled ? (
            <IconButton
              variant={'ghost'}
              disabled={!isOwnerEdSecretSet}
              icon="Users"
              size="md"
              onClick={onToggleCollaboration}
            />
          ) : (
            <DynamicDropdown
              key="navbar-more-actions"
              align="center"
              sideOffset={10}
              anchorTrigger={
                <IconButton icon={'Users'} variant="ghost" size="md" />
              }
              content={
                <div className="flex flex-col gap-1 p-2 w-fit shadow-elevation-3 ">
                  {collabIsOwner ? (
                    <Button
                      variant={'ghost'}
                      onClick={() => {
                        editorRef.current?.terminateSession();
                        setCollabEnabled(false);
                        setCollaborationId('');
                        setCollabRoomKey('');
                        setUsername('');
                        setCollabIsOwner(false);
                        setCollabExtras({});
                        setCollabStatus('off');
                        collabStore.clearCollabConf();
                      }}
                    >
                      Stop Collaboration
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => {
                      const base_name = 'sussy_baka';
                      const random_number = Math.floor(Math.random() * 1000000);
                      const new_name = `${base_name}_${random_number}`;
                      editorRef.current?.updateCollaboratorName(new_name);
                    }}
                    variant={'ghost'}
                  >
                    Update Collaborator Name
                  </Button>
                </div>
              }
            />
          )}

          <Button
            onClick={publishDoc}
            toggleLeftIcon={true}
            leftIcon="Share2"
            variant={'ghost'}
            className="!min-w-[90px] !px-0 hidden xl:flex"
          >
            Share
          </Button>
          <div className="flex gap-2 px-2 justify-center items-center">
            <LucideIcon name="Farcaster" />
            <div className="flex-col hidden xl:flex">
              <p className="text-heading-xsm">@[username]</p>
              <p className="text-helper-text-sm">Farcaster</p>
            </div>
          </div>
        </div>
      </>
    );
  };

  const handleConnectViaUsername = async (username: string) => {
    setUsername(username);
    setIsConnected(true);
  };

  const onCollaboratorChange = (collaborators: unknown[] | undefined) => {
    console.log('onCollaboratorChange', collaborators);
  };

  const collaboration = useMemo((): CollaborationProps => {
    if (!collabEnabled || !collaborationId || !collabRoomKey) {
      return { enabled: false };
    }
    return {
      enabled: true,
      connection: {
        roomKey: collabRoomKey,
        roomId: collaborationId,
        wsUrl: import.meta.env.VITE_COLLAB_WS_URL,
        isOwner: collabIsOwner,
        ownerEdSecret: collabExtras.ownerEdSecret,
        contractAddress: collabExtras.contractAddress,
        ownerAddress: collabExtras.ownerAddress,
      },
      session: {
        username,
        isEns: collabExtras.isEns,
      },
      services: {
        commitToStorage: undefined,
        fetchFromStorage: undefined,
      },
      on: {
        onStateChange: (state: CollabState) => {
          console.log('onStateChange', state);
          if (state.status === 'syncing') {
            setCollabStatus(
              state.hasUnmergedPeerUpdates ? 'merging' : 'syncing',
            );
          } else {
            setCollabStatus(state.status);
          }
          if (state.status === 'syncing' && state.hasUnmergedPeerUpdates) {
            toast({
              title: 'Syncing all new changes',
              variant: 'info',
              toastType: 'mini',
              iconType: 'icon',
            });
          } else if (state.status === 'reconnecting') {
            toast({
              title: `Reconnecting (${state.attempt}/${state.maxAttempts})...`,
              variant: 'warning',
              toastType: 'mini',
              iconType: 'icon',
            });
          } else if (state.status === 'error') {
            toast({
              title: 'Collaboration error',
              description: state.error.message,
              variant: 'error',
              iconType: 'icon',
            });
          }
        },
        onError: (error) => {
          console.log('onError', error);
          toast({
            title: 'Collaboration error',
            description: error.message,
            variant: 'error',
            iconType: 'icon',
          });
        },
      },
    };
  }, [
    collabEnabled,
    collaborationId,
    collabRoomKey,
    collabIsOwner,
    collabExtras,
    username,
  ]);

  return (
    <div>
      <DocumentStylingPanel
        isOpen={showStylingControls}
        onClose={() => setShowStylingControls(false)}
        documentStyling={documentStyling}
        onStylingChange={setDocumentStyling}
      />
      <DdocEditor
        ref={editorRef}
        fonts={demoFonts}
        collaboration={collaboration}
        username={username}
        setUsername={setUsername}
        isPreviewMode={isPreviewMode}
        disableInlineComment={disableInlineComment}
        onChange={handleContentChange}
        initialContent={initialContent}
        enableIndexeddbSync={true}
        ddocId={docId}
        // Only consulted at doc creation; existing docs follow their marker.
        preferredSchemaVersion={
          new URLSearchParams(window.location.search).get('v2') === '1'
            ? 2
            : undefined
        }
        tabConfig={tabConfig}
        onError={(error) => {
          toast({
            title: 'Error',
            description: error,
            variant: 'error',
            iconType: 'icon',
          });
        }}
        renderNavbar={renderNavbar}
        ensResolutionUrl={import.meta.env.ENS_RESOLUTION_URL}
        selectedTags={selectedTags}
        setSelectedTags={setSelectedTags}
        isCommentSectionOpen={isCommentSectionOpen}
        setIsCommentSectionOpen={setIsCommentSectionOpen}
        setInlineCommentData={setInlineCommentData}
        inlineCommentData={inlineCommentData}
        commentDrawerOpen={commentDrawerOpen}
        setCommentDrawerOpen={setCommentDrawerOpen}
        isPresentationMode={isPresentationMode}
        setIsPresentationMode={setIsPresentationMode}
        isFocusMode={isFocusMode}
        onFocusModeChange={setIsFocusMode}
        isSplitView={isSplitView}
        setIsSplitView={setIsSplitView}
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
        isNavbarVisible={isNavbarVisible}
        setIsNavbarVisible={setIsNavbarVisible}
        onComment={(): void => {}}
        onInlineComment={(): void => {}}
        onMarkdownImport={(): void => {}}
        onMarkdownExport={(): void => {}}
        onPdfExport={(): void => {}}
        onHtmlExport={(): void => {}}
        onTxtExport={(): void => {}}
        onDocxImport={(): void => {}}
        initialComments={initialComments}
        onCommentReply={handleReplyOnComment}
        onNewComment={handleNewComment}
        setInitialComments={setInitialComment}
        onResolveComment={handleResolveComment}
        onUnresolveComment={handleUnresolveComment}
        onDeleteComment={handleDeleteComment}
        showTOC={showTOC}
        setShowTOC={setShowTOC}
        isConnected={isConnected}
        connectViaWallet={async () => {}}
        isLoading={false}
        connectViaUsername={handleConnectViaUsername}
        onCopyHeadingLink={(link: string) => {
          navigator.clipboard.writeText(link);
          // Mirror the consumer (protected-document-context.tsx): the
          // package only supplies the slug; feedback is the host's job.
          toast({
            title: 'Anchor link copied to clipboard',
            toastType: 'mini',
            iconType: 'icon',
            customIcon: 'Link',
          });
        }}
        onCollaboratorChange={onCollaboratorChange}
        documentStyling={documentStyling}
        isDDocOwner={isDDocOwner}
        viewerMode={isDDocOwner ? undefined : viewerMode}
        initialCommentAnchors={initialCommentAnchors}
        setCharacterCount={setCharacterCount}
        setWordCount={setWordCount}
        setPageCount={setPageCount}
      />
      <LinkModal
        open={linkModalOpen}
        onOpenChange={setLinkModalOpen}
        getEditor={() => editorRef.current?.getEditor()}
        onError={(msg) =>
          toast({
            title: 'Error',
            description: msg,
            variant: 'error',
            iconType: 'icon',
          })
        }
      />
      <Toaster
        position={!isMobile ? 'bottom-right' : 'center-top'}
        duration={3000}
      />
      <DevBar
        pageCount={pageCount}
        docId={docId}
        activeTabId={activeTabInfo.activeTabId}
        tabCount={activeTabInfo.tabCount}
        characterCount={characterCount}
        wordCount={wordCount}
        collabStatus={collabStatus}
        lastSavedAt={lastSavedAt}
      />
    </div>
  );
}

export default App;
