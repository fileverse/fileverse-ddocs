import { EditorContent, isTextSelection } from '@tiptap/react';
import { EditorBubbleMenu } from './components/editor-bubble-menu/editor-bubble-menu';
import { DdocProps } from './types';
import type { CollaborationProps } from './sync-local/types';

// A LIVE collaboration session (peers/presence — what users know as "real-time
// collab mode") vs a durable background connection (connectOnOpen sync, which
// every doc now has). UI restrictions — slides, split view, comment surfaces —
// key off the live session; sync plumbing keys off `enabled`. Hosts that
// predate `livePresence` never send it → fall back to `enabled`, preserving
// their old semantics.
const isLiveCollabSession = (collaboration?: CollaborationProps): boolean =>
  Boolean(
    collaboration?.enabled && (collaboration.connection.livePresence ?? true),
  );
import { ColumnsMenu } from './extensions/multi-column/menus';
import { EditingProvider } from './hooks/use-editing-context';
import EditorToolBar from './components/editor-toolbar';
import './styles/editor.css';
import 'tippy.js/animations/shift-toward-subtle.css';
import { useDdocEditor } from './use-ddoc-editor';
import './styles/index.css';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import cn from 'classnames';
import {
  Button,
  LucideIcon,
  Tag,
  TagType,
  TagInput,
  Skeleton,
} from '@fileverse/ui';
import { useMediaQuery, useOnClickOutside } from 'usehooks-ts';
import { AnimatePresence, motion } from 'framer-motion';
import * as Y from 'yjs';
import MobileToolbar from './components/mobile-toolbar';
import { toUint8Array } from 'js-base64';
import { PresentationMode } from './components/presentation-mode/presentation-mode';
import { CommentDrawer } from './components/inline-comment/comment-drawer';
import { useResponsive } from './utils/responsive';
import { CommentStoreProvider } from './stores/comment-store-provider';
import { CommentBubbleCard } from './components/inline-comment/comment-bubble-card';
import { CommentFloatingContainer } from './components/inline-comment/comment-floating-container';
import { DocumentOutline } from './components/toc/document-outline';
import { EditorProvider } from './context/editor-context';
import { fadeInTransition, slideUpTransition } from './components/motion-div';
import { PreviewContentLoader } from './components/preview-content-loader';
import { EmbedSettings } from './extensions/twitter-embed/embed-settings';
import {
  DEFAULT_TAB_ID,
  DEFAULT_TAB_NAME,
} from './components/tabs/utils/tab-utils';
import { PreviewModeExportTrigger } from './components/preview-export-trigger';
import {
  getResponsiveThemeTextColor,
  getThemeStyle,
} from './utils/document-styling';
import { sanitizeCustomCss } from './utils/sanitize-css';
import { useFocusMode } from './hooks/use-focus-mode';
import { FullScreenToolbar } from './components/fullscreen-toolbar';
import { mergeTabAwareYjsUpdates } from './components/tabs/utils/tab-utils';
import { DBlockToolbarProvider } from './extensions/d-block/dblock-toolbar';
import SearchReplace from './extensions/search-replace/components/search-replace-popover';
import { SplitViewMarkdownPane } from './components/split-view/split-view-markdown-pane';
import { SplitViewRightHeader } from './components/split-view/split-view-right-header';
import { useMarkdownSync } from './hooks/use-markdown-sync';
import { useSplitResize } from './hooks/use-split-resize';

const DdocEditor = forwardRef(
  (
    {
      isPreviewMode = false,
      viewerMode,
      initialContent,
      collaboration,
      username,
      setUsername,
      renderNavbar,
      walletAddress,
      onChange,
      onCollaboratorChange,
      onTextSelection,
      onCommentInteraction,
      handleCommentButtonClick,
      showCommentButton,
      ensResolutionUrl,
      ipfsImageUploadFn,
      disableBottomToolbar,
      onError,
      setCharacterCount,
      setWordCount,
      setSelectedWordCount,
      setPageCount,
      tags,
      selectedTags,
      setSelectedTags,
      isCommentSectionOpen,
      setIsCommentSectionOpen,
      setInlineCommentData,
      inlineCommentData,
      enableIndexeddbSync,
      ddocId,
      zoomLevel,
      setZoomLevel,
      isPresentationMode,
      setIsPresentationMode,
      isSplitView = false,
      setIsSplitView,
      isNavbarVisible,
      setIsNavbarVisible,
      onComment,
      onInlineComment,
      onFocusMode,
      isFocusMode: isFocusModeProp,
      onFocusModeChange,
      onMarkdownExport,
      onMarkdownImport,
      onPdfExport,
      onHtmlExport,
      onTxtExport,
      onOdtExport,
      onDocxImport,
      editorCanvasClassNames,
      sharedSlidesLink,
      documentName,
      onInvalidContentError,
      ignoreCorruptedData,
      commentDrawerOpen,
      setCommentDrawerOpen,
      initialComments = [],
      initialCommentAnchors,
      onNewComment,
      onEditComment,
      onEditReply,
      onCommentReply,
      setInitialComments,
      onSlidesShare,
      onResolveComment,
      onUnresolveComment,
      onDeleteComment,
      onDeleteReply,
      theme,
      showTOC,
      setShowTOC,
      isConnected,
      connectViaWallet,
      isLoading,
      connectViaUsername,
      isDDocOwner,
      isCollabDocumentPublished = true,
      disableInlineComment,
      renderThemeToggle,
      metadataProxyUrl,
      extensions,
      onCopyHeadingLink,
      tabConfig,
      footerHeight,
      ipfsImageFetchFn,
      fetchV1ImageFn,
      activeModel,
      maxTokens,
      isAIAgentEnabled,
      // Document styling object
      documentStyling,
      fonts,
      ...rest
    }: DdocProps,
    ref,
  ) => {
    const { isFocusMode, toggleFocusMode } = useFocusMode({
      isFocusMode: isFocusModeProp,
      onFocusModeChange,
      onFocusMode: (value) => {
        if (commentDrawerOpen) {
          setCommentDrawerOpen?.(false);
        }
        onFocusMode?.(value);
      },
    });
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const exportTriggerRef = useRef<
      ((format?: string, name?: string) => void) | null
    >(null);

    /**
     * Document styling system with dark mode support
     * When no document styling exists, CSS classes handle theming (including dark mode)
     * When document styling exists, it applies custom styles
     */

    // Helper to merge document styling with dark mode requirements
    const getMergedStyles = () => {
      // If no document styling is provided, return undefined to let CSS classes handle everything
      if (!documentStyling) {
        return { canvas: undefined, background: undefined };
      }

      const canvas: React.CSSProperties = {};
      const background: React.CSSProperties = {};
      const currentTheme = theme ?? 'light';

      // Apply custom document styling
      if (documentStyling.canvasBackground) {
        const themeCanvasBackground = getThemeStyle(
          documentStyling.canvasBackground,
          currentTheme,
        );
        canvas.backgroundColor = themeCanvasBackground;
      }
      if (documentStyling.textColor) {
        const responsiveTextColor = getResponsiveThemeTextColor(
          documentStyling.textColor,
          currentTheme,
        );
        if (responsiveTextColor) {
          canvas.color = responsiveTextColor;
        }
      }
      if (documentStyling.fontFamily) {
        canvas.fontFamily = documentStyling.fontFamily;
      }
      if (documentStyling.background) {
        const themeBackgroundStyle = getThemeStyle(
          documentStyling.background,
          currentTheme,
        );
        background.background = themeBackgroundStyle;
      }

      return {
        canvas: Object.keys(canvas).length > 0 ? canvas : undefined,
        background: Object.keys(background).length > 0 ? background : undefined,
      };
    };

    const mergedStyles = getMergedStyles();

    // Helper functions that return styles only when they should override CSS classes
    const getCanvasStyle = () => mergedStyles.canvas;
    const getBackgroundStyle = () => mergedStyles.background;

    const btn_ref = useRef(null);
    const editorScrollContainerRef = useRef<HTMLDivElement | null>(null);
    const editorWrapperRef = useRef<HTMLDivElement | null>(null);
    const { isBelow1280px, isNativeMobile } = useResponsive();

    const [isHiddenTagsVisible, setIsHiddenTagsVisible] = useState(false);
    const tagsContainerRef = useRef(null);

    const visibleTags = selectedTags?.slice(0, 4) || [];
    const hiddenTagsCount = selectedTags
      ? Math.max(0, selectedTags.length - 4)
      : 0;

    useOnClickOutside(tagsContainerRef, () => {
      setIsHiddenTagsVisible(false);
    });

    useEffect(() => {
      if (selectedTags && selectedTags.length <= 4) {
        setIsHiddenTagsVisible(false);
      }
    }, [selectedTags]);
    const [dropdownOpen, setDropdownOpen] = useState(false);

    const {
      editor,
      cachedEditorEntries,
      ref: editorRef,
      isContentLoading,
      ydoc,
      awareness,
      refreshYjsIndexedDbProvider,
      activeCommentId,
      setActiveCommentId,
      focusCommentWithActiveId,
      slides,
      setSlides,
      tocItems,
      setTocItems,
      terminateSession,
      updateTitle,
      tabs,
      setTabs,
      activeTabId,
      setActiveTabId,
      createTab,
      renameTab,
      duplicateTab,
      orderTab,
      deleteTab,
      commentAnchorsRef,
      draftAnchorsRef,
      storeApiRef,
      dBlockRuntimeState,
      isSchemaUnsupported,
    } = useDdocEditor({
      documentStyling,
      ipfsImageFetchFn,
      fetchV1ImageFn,
      enableIndexeddbSync,
      ddocId,
      isPreviewMode,
      viewerMode,
      initialContent,
      collaboration,
      walletAddress,
      username,
      onChange,
      onCollaboratorChange,
      onCommentInteraction,
      onTextSelection,
      ensResolutionUrl,
      onError,
      setCharacterCount,
      setWordCount,
      setSelectedWordCount,
      setPageCount,
      ipfsImageUploadFn,
      isCommentSectionOpen,
      setIsCommentSectionOpen,
      setInlineCommentData,
      inlineCommentData,
      initialCommentAnchors,
      theme,
      zoomLevel,
      setZoomLevel,
      isNavbarVisible,
      setIsNavbarVisible,
      onDocxImport,
      onInvalidContentError,
      ignoreCorruptedData,
      isPresentationMode,
      metadataProxyUrl,
      extensions,
      onCopyHeadingLink,
      disableInlineComment,
      isFocusMode,
      isConnected,
      activeModel,
      maxTokens,
      isAIAgentEnabled,
      isDDocOwner,
      tabConfig,
      onNewComment,
      fonts,
      ...rest,
    });
    const currentTabName = useMemo(
      () =>
        tabs.find((tab) => tab.id === (activeTabId || DEFAULT_TAB_ID))?.name ||
        DEFAULT_TAB_NAME,
      [activeTabId, tabs],
    );

    // All tabs share a single scroll container (editorScrollContainerRef), so
    // its scrollTop carries over between tabs. On switch, reset the active tab's
    // canvas to the top. useLayoutEffect runs before paint to avoid a flash.
    useLayoutEffect(() => {
      const el = editorScrollContainerRef.current;
      if (!el) return;
      el.scrollTop = 0;
    }, [activeTabId]);

    // Split View (markdown left, read-only doc right). Disabled in preview.
    // Desktop-only for v1: two side-by-side panes don't fit below the 960px
    // `mobile` breakpoint (which also hides the toolbar that holds the toggle).
    // Disabled during a LIVE collaboration session: the markdown→doc sync is a
    // one-way full-doc replace, so editing the left pane would clobber a
    // collaborator's changes. A durable-only connection (no live peers) is fine.
    const canUseSplitView = useMediaQuery('(min-width: 960px)');
    const isCollabEnabled = isLiveCollabSession(collaboration);
    const isSplitViewActive =
      Boolean(isSplitView) &&
      !isPreviewMode &&
      canUseSplitView &&
      !isCollabEnabled;
    // Exit Split View if it becomes unavailable while open — the window shrank
    // below the breakpoint, or a collaboration session started.
    useEffect(() => {
      if ((!canUseSplitView || isCollabEnabled) && isSplitView) {
        setIsSplitView?.(false);
      }
    }, [canUseSplitView, isCollabEnabled, isSplitView, setIsSplitView]);
    // The right pane is read-only in Split View — let the dBlock toolbar know so
    // it hides editing affordances there (e.g. the empty-doc template picker).
    const splitAwareDBlockRuntimeState = useMemo(
      () => ({ ...dBlockRuntimeState, isSplitView: isSplitViewActive }),
      [dBlockRuntimeState, isSplitViewActive],
    );
    // Resizable split: each pane's flex-grow is driven by splitRatio (left-pane
    // fraction); the divider drags it. See useSplitResize for drag teardown.
    const {
      containerRef: splitContainerRef,
      leftRatio: splitRatio,
      onSeparatorMouseDown: handleSplitterDown,
    } = useSplitResize();
    const [showSplitTabsPanel, setShowSplitTabsPanel] = useState(false);
    const {
      markdown: splitViewMarkdown,
      onMarkdownChange: onSplitViewMarkdownChange,
      rightScrollRef: splitViewScrollRef,
    } = useMarkdownSync({
      editor,
      isSplitView: isSplitViewActive,
      isPreviewMode,
      activeTabId,
      ipfsImageUploadFn,
      onSeedError: () => {
        onError?.('Could not open Markdown view — please try again.');
        setIsSplitView?.(false);
      },
    });

    // Mirror custom CSS into the markdown extension's storage so the
    // exportMarkdownFile command can embed it as a <style> block (the export
    // has no other access to documentStyling).
    useEffect(() => {
      const storage = editor?.storage?.markdownPasteHandler;
      if (storage) storage.customCSS = documentStyling?.customCSS ?? '';
    }, [editor, documentStyling?.customCSS]);

    // Sanitize + scope the author's custom CSS before injecting it (it reaches
    // viewers of published docs, so it's untrusted). Returns '' on SSR; the
    // client re-renders with the sanitized rule after hydration.
    // Scope with a DOUBLED class (`.ProseMirror.ProseMirror`) so author custom
    // CSS reliably wins over the editor's own element/class defaults without
    // needing !important. The editor styles links via `.ProseMirror
    // .custom-text-link` (specificity 0,2,0), which would otherwise beat a
    // plain author `a { … }` (0,1,1); doubling makes author rules 0,2,1.
    const safeCustomCss = useMemo(
      () =>
        sanitizeCustomCss(
          documentStyling?.customCSS,
          '.ProseMirror.ProseMirror',
        ),
      [documentStyling?.customCSS],
    );

    useImperativeHandle(
      ref,
      () => ({
        getEditor: () => editor,
        getYdoc: () => ydoc,
        createTab,
        refreshYjsIndexedDbProvider,
        mergeYjsContents: (_contents: string[]) => {
          const mergedContent = mergeTabAwareYjsUpdates(_contents);
          Y.applyUpdate(
            ydoc as unknown as Y.Doc,
            toUint8Array(mergedContent),
            'self',
          );

          return mergedContent;
        },
        exportContentAsMarkDown: async (filename: string) => {
          if (editor) {
            const generateDownloadUrl =
              await editor.commands.exportMarkdownFile();
            if (generateDownloadUrl) {
              const url = generateDownloadUrl;
              const link = document.createElement('a');
              link.href = url;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }
          }
        },
        updateCollaboratorName: (name: string) => {
          if (!editor || !awareness) {
            console.debug('collab: cannot find editor or awareness');
            return;
          }

          const localState = awareness.getLocalState();
          const existingUser = localState?.user as
            | Record<string, unknown>
            | undefined;

          const newUser = {
            name,
            color: existingUser?.color,
            isEns: existingUser?.isEns,
          };

          awareness.setLocalStateField('user', newUser);
          editor.setEditable(true);
        },
        exportCurrentTabOrOpenExportModal: (format = 'pdf', name?: string) => {
          exportTriggerRef.current?.(format, name);
        },
        terminateSession,
        updateSessionTitle: (args: {
          encryptedTitle: string;
          documentTitle: string;
        }) => {
          updateTitle(args);
        },
      }),

      // eslint-disable-next-line react-hooks/exhaustive-deps
      [editor, awareness],
    );

    const handleAddTag = (tag: TagType) => {
      setSelectedTags?.((prevTags) => {
        if (prevTags.length >= 6) {
          // If we already have 6 tags, don't add any more
          return prevTags;
        }

        const newTags = tag.name.split(',').map((name) => {
          const trimmedName = name.trim();
          const existingTag = tags?.find(
            (t) => t.name.toLowerCase() === trimmedName.toLowerCase(),
          );
          return existingTag || { name: trimmedName, color: tag.color };
        });

        const uniqueTags = [...prevTags];
        newTags.forEach((newTag) => {
          if (
            !uniqueTags.some(
              (t) => t.name.toLowerCase() === newTag.name.toLowerCase(),
            )
          ) {
            uniqueTags.push(newTag);
          }
        });

        // Ensure we don't exceed 6 tags
        return uniqueTags.slice(0, 6);
      });
    };

    const handleRemoveTag = (tagName: string) => {
      setSelectedTags?.((prevTags) =>
        prevTags.filter((tag) => tag.name !== tagName),
      );
    };
    const handleClosePresentationMode = () => {
      setIsPresentationMode?.(false);

      // Remove slides parameter from URL
      const url = new URL(window.location.href);
      const hash = url.hash;

      // Split the hash to preserve the key parameter
      const [hashPath, keyParam] = hash.split('&');
      if (keyParam && keyParam.startsWith('slides=')) {
        // Remove only the slides parameter while keeping the key
        url.hash = hashPath;
        window.history.replaceState({}, '', url.toString());
      }
    };

    const handlePresentationMode = () => {
      setIsPresentationMode?.(true);
      commentDrawerOpen && setCommentDrawerOpen?.(false);
    };

    useEffect(() => {
      if (!editor) return;
      if (isNativeMobile) {
        const { selection } = editor.state;
        const isTextSelected = isTextSelection(selection);

        const handleKeyboardShow = () => {
          setIsKeyboardVisible(true);
        };

        const handleKeyboardHide = () => {
          setIsKeyboardVisible(false);
        };

        !isTextSelected && editor.on('focus', handleKeyboardShow);
        isTextSelected && editor.on('blur', handleKeyboardHide);

        return () => {
          editor.off('focus', handleKeyboardShow);
          editor.off('blur', handleKeyboardHide);
        };
      }
    }, [isNativeMobile, editor]);

    useEffect(() => {
      if (!editor) return;

      try {
        const editorElement = editor.view.dom;
        if (!editorElement) return;

        // Pressing the enter key will scroll the editor to the current selection
        const handleEnterKey = (event: KeyboardEvent) => {
          if (event.key === 'Enter') {
            editor.commands.scrollIntoView();
          }
        };

        editorElement.addEventListener('keydown', handleEnterKey);

        return () => {
          editorElement.removeEventListener('keydown', handleEnterKey);
        };
      } catch (error) {
        // View not ready yet, skip this effect
        return;
      }
    }, [editor]);

    // Push the editor to the top when the keyboard is visible
    useEffect(() => {
      if (!isNativeMobile || !editor) return;

      try {
        const editorElement = editor.view.dom;
        if (!editorElement) return;

        const handleKeyboardShow = () => {
          if (editorRef.current) {
            editorRef.current.scrollIntoView();
          }
        };

        editorElement.addEventListener('resize', handleKeyboardShow);

        return () => {
          editorElement.removeEventListener('resize', handleKeyboardShow);
        };
      } catch (error) {
        // View not ready yet, skip this effect
        return;
      }
    }, [editor, editorRef, isNativeMobile]);

    // Entering focus mode should put the caret in the editor so the user can
    // start typing immediately.
    useEffect(() => {
      if (!isFocusMode || !editor || editor.isDestroyed) return;
      editor.commands.focus();
    }, [isFocusMode, editor]);

    const isMobile = useMediaQuery('(max-width: 768px)');
    const tabCommentCounts = useMemo(() => {
      return (initialComments || []).reduce<Record<string, number>>(
        (acc, comment) => {
          if (comment.deleted) return acc;
          const tabId = comment.tabId || DEFAULT_TAB_ID;
          acc[tabId] = (acc[tabId] || 0) + 1;
          return acc;
        },
        {},
      );
    }, [initialComments]);
    const isLandscapeMode = documentStyling?.orientation === 'landscape';
    const baseWidth = isLandscapeMode ? 1190 : 850;

    const zoom = Number(zoomLevel);
    const scaledWidth = baseWidth * zoom;
    const shouldRenderDocumentOutline =
      // Hidden in Split View — the right pane has its own tabs panel (the
      // List button in the split header), so the editor's native left rail
      // would just duplicate it.
      !isSplitViewActive &&
      (tabs.length > 0 ||
        (tocItems.length > 0 && !rest.versionHistoryState?.enabled)) &&
      (!isFocusMode || showTOC);

    const containerWidth =
      typeof window !== 'undefined' ? window.innerWidth : 0;
    const shouldHideRight = scaledWidth + 148 * 2 > containerWidth;

    const leftWidth = shouldRenderDocumentOutline ? 148 : 0;

    // remaining space after reserving left
    const availableSpace = containerWidth - leftWidth;

    // should editor overflow?
    const shouldScroll = scaledWidth > availableSpace;
    const editorContentRef = useRef<HTMLDivElement | null>(null);
    const setActiveEditorContentRef = useCallback(
      (node: HTMLDivElement | null, isActive: boolean) => {
        if (isActive) {
          editorContentRef.current = node;
          return;
        }

        if (node && editorContentRef.current === node) {
          editorContentRef.current = null;
        }
      },
      [],
    );

    const handleFocusModeMouseDown = (event: React.MouseEvent) => {
      if (!isFocusMode || !editor || event.button !== 0) return;

      const target = event.target as HTMLElement;

      // 1. Ignore clicks inside editor
      const clickedInsideEditor = editorContentRef.current?.contains(target);

      if (clickedInsideEditor) return;

      // 2. Ignore clicks inside ANY modal / portal
      const clickedInsideModal = target.closest(
        '[data-radix-dialog-content], [role="dialog"], [data-modal], [data-overlay]',
      );

      if (clickedInsideModal) return;

      // 3. Ignore dropdowns / popovers (important for your comment system)
      const clickedInsideFloatingUI = target.closest(
        '[data-radix-popper-content-wrapper], [data-floating-ui-portal]',
      );

      if (clickedInsideFloatingUI) return;

      // 4. Only now treat as canvas click
      event.preventDefault();

      editor.commands.focus('end', { scrollIntoView: false });
    };

    // Extracted so the formatting toolbar renders in BOTH normal and Split View
    // modes (Split View bypasses the rest of renderComp but must keep the toolbar).
    const editorToolbar = !isPreviewMode ? (
      <div
        id="toolbar"
        className={cn(
          'z-[45] hidden mobile:flex items-center justify-center w-full h-11 fixed left-0 color-bg-default border-b color-border-default transition-all duration-300 top-[var(--navbar)]',
          {
            'translate-y-0 opacity-100': !isFocusMode && isNavbarVisible,
            '-translate-y-[var(--navbar)] opacity-100':
              !isFocusMode && !isNavbarVisible,
            '-translate-y-[var(--navbar)] opacity-0 pointer-events-none':
              isFocusMode,
          },
        )}
      >
        <div className="justify-center items-center grow relative color-text-default">
          <EditorToolBar
            isPresentationMode={isPresentationMode}
            setIsPresentationMode={handlePresentationMode}
            enableCollaboration={isLiveCollabSession(collaboration)}
            onError={onError}
            editor={editor}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            isNavbarVisible={isNavbarVisible}
            setIsNavbarVisible={setIsNavbarVisible}
            ipfsImageUploadFn={ipfsImageUploadFn}
            onMarkdownExport={onMarkdownExport}
            onMarkdownImport={onMarkdownImport}
            onPdfExport={onPdfExport}
            onHtmlExport={onHtmlExport}
            onTxtExport={onTxtExport}
            onOdtExport={onOdtExport}
            onDocxImport={onDocxImport}
            isLoading={!editor || isContentLoading}
            ipfsImageFetchFn={ipfsImageFetchFn}
            fetchV1ImageFn={fetchV1ImageFn}
            isConnected={isConnected}
            tabs={tabs}
            ydoc={ydoc}
            toggleFocusMode={toggleFocusMode}
            isSplitView={isSplitView}
            onToggleSplitView={
              // Hidden during collaboration — Split View is solo-only in v1.
              setIsSplitView && !isCollabEnabled
                ? () => setIsSplitView((open) => !open)
                : undefined
            }
            onRegisterExportTrigger={(trigger) => {
              exportTriggerRef.current = trigger;
            }}
            fonts={fonts}
          />
        </div>
      </div>
    ) : null;

    const renderComp = () => {
      return (
        <AnimatePresence>
          <>
            {isFocusMode && (
              <FullScreenToolbar
                dropdownOpen={dropdownOpen}
                setDropdownOpen={setDropdownOpen}
                zoomLevel={zoomLevel}
                setZoomLevel={setZoomLevel}
                showTOC={showTOC}
                setShowTOC={setShowTOC}
                toggleFocusMode={toggleFocusMode}
              />
            )}

            {/* Hidden in Split View — the markdown pane has its own toolbar. */}
            {!isSplitViewActive && editorToolbar}
            {/* The export trigger normally registers via the toolbar's
                ImportExportButton. When that toolbar is unmounted (preview
                mode, Split View), mount the hidden registrar instead so the
                exportCurrentTabOrOpenExportModal ref keeps working. */}
            {(isPreviewMode || isSplitViewActive) && editor && (
              <PreviewModeExportTrigger
                editor={editor}
                ydoc={ydoc}
                tabs={tabs}
                onRegisterExportTrigger={(trigger) => {
                  exportTriggerRef.current = trigger;
                }}
                onError={onError}
                ipfsImageUploadFn={ipfsImageUploadFn}
                onMarkdownExport={onMarkdownExport}
                onMarkdownImport={onMarkdownImport}
                onPdfExport={onPdfExport}
                onHtmlExport={onHtmlExport}
                onTxtExport={onTxtExport}
                onOdtExport={onOdtExport}
                ipfsImageFetchFn={ipfsImageFetchFn}
                onDocxImport={onDocxImport}
                fetchV1ImageFn={fetchV1ImageFn}
                isConnected={isConnected}
              />
            )}
            {isPresentationMode && editor && (
              <PresentationMode
                editor={editor}
                onClose={handleClosePresentationMode}
                isFullscreen={isFullscreen}
                setIsFullscreen={setIsFullscreen}
                onError={onError}
                setCommentDrawerOpen={setCommentDrawerOpen}
                sharedSlidesLink={sharedSlidesLink}
                isPreviewMode={isPreviewMode}
                documentName={documentName as string}
                onSlidesShare={onSlidesShare}
                slides={slides}
                setSlides={setSlides}
                renderThemeToggle={renderThemeToggle}
                isContentLoading={isContentLoading}
                ipfsImageFetchFn={ipfsImageFetchFn}
                documentStyling={documentStyling}
                fetchV1ImageFn={fetchV1ImageFn}
                theme={theme ?? 'light'}
              />
            )}
            <div
              className={cn(
                'editor-left-rail',
                shouldRenderDocumentOutline && 'editor-left-rail-has-outline',
                !isMobile && 'flex-[1_0_263px]',
                !isPreviewMode &&
                  !isFocusMode &&
                  isNavbarVisible &&
                  '-mt-[1.5rem] md:!mt-[0.8rem]',
                isPreviewMode && 'md:!mt-[1rem]',
                { 'md:!mt-[0.7rem]': !isPreviewMode && !isFocusMode },
                {
                  '-mt-[1.5rem] md:!mt-[0.7rem]':
                    !isNavbarVisible && !isPreviewMode,
                },
                isFocusMode && 'mt-[48px]',
                isFocusMode && !showTOC && shouldHideRight && 'hidden',
              )}
            >
              {editor && shouldRenderDocumentOutline && (
                <DocumentOutline
                  editor={editor}
                  hasToC={true}
                  items={tocItems}
                  setItems={setTocItems}
                  showTOC={showTOC}
                  setShowTOC={setShowTOC}
                  isPreviewMode={isPreviewMode || !isNavbarVisible}
                  orientation={documentStyling?.orientation}
                  tabs={tabs}
                  setTabs={setTabs}
                  activeTabId={activeTabId}
                  setActiveTabId={setActiveTabId}
                  createTab={createTab}
                  renameTab={renameTab}
                  duplicateTab={duplicateTab}
                  orderTab={orderTab}
                  deleteTab={deleteTab}
                  ydoc={ydoc}
                  tabCommentCounts={tabCommentCounts}
                  tabConfig={tabConfig}
                  isConnected={isConnected}
                  isFocusMode={isFocusMode}
                />
              )}
            </div>
            <div
              ref={editorScrollContainerRef}
              data-editor-scroll-container="true"
              className={cn(
                'flex w-full',
                // In Split View the right-pane wrapper owns the scroll — let the
                // editor content flow so there's only one scroller.
                isSplitViewActive ? 'overflow-visible' : 'overflow-auto',
                isLandscapeMode && 'mx-[24px]',
              )}
            >
              {/* Split View: drop w-full — inside the flex scroll container it
                  pins this to the fixed page width and leaves dead space; letting
                  it size naturally lets the content fill the pane. */}
              <div
                className={cn(isSplitViewActive ? 'h-full' : 'w-full h-full')}
              >
                <div
                  className={cn(
                    'flex min-h-[100%] items-start',
                    // Split View: wrap to the right pane's width (no min-w-max),
                    // so there's no horizontal scroll.
                    !isMobile && !isSplitViewActive && 'min-w-max',
                  )}
                >
                  <div
                    className={cn(
                      'editor-main-lane flex-grow min-w-0 flex overflow-visible items-stretch',
                      shouldScroll ? 'justify-start' : 'justify-center',
                      isMobile && 'w-full',
                    )}
                    data-zoom-below-100={zoom < 1 ? 'true' : 'false'}
                    style={{
                      minHeight: isFocusMode
                        ? '100vh'
                        : // Split View: don't force viewport height — the content
                          // flows inside the right pane's own scroll box.
                          isSplitViewActive
                          ? 'auto'
                          : `calc(100dvh - 108px - ${footerHeight || '0px'})`,
                    }}
                  >
                    <div
                      className={cn(
                        'editor-comment-layout relative shrink-0 overflow-visible',
                        isMobile && 'w-full',
                      )}
                      // Visual-only lift for the mobile focused-thread case.
                      // The actual scroll position still lives on the container.
                      style={
                        isBelow1280px
                          ? {
                              transform:
                                'translateY(var(--mobile-comment-drawer-canvas-offset, 0px))',
                            }
                          : undefined
                      }
                    >
                      {isMobile && isPreviewMode && (
                        <p className="text-center color-text-secondary text-helper-text-sm flex gap-2 items-center justify-center py-1.5">
                          <LucideIcon
                            name={'LockKeyhole'}
                            className="w-[14px] h-[14px]"
                          />
                          <span>End-to-end Encrypted</span>
                        </p>
                      )}
                      <div
                        id="editor-wrapper"
                        ref={editorWrapperRef}
                        className={cn(
                          'w-full flex-grow min-w-0 no-scrollbar rounded transition-all mx-auto duration-300 ease-in-out',
                          !documentStyling?.canvasBackground &&
                            !isFocusMode &&
                            'color-bg-default',
                          !isSplitViewActive &&
                            !isPreviewMode &&
                            !isFocusMode &&
                            (isNavbarVisible
                              ? '-mt-[1.5rem] md:!mt-[0.8rem]'
                              : null),
                          !isSplitViewActive &&
                            isPreviewMode &&
                            'md:!mt-[1rem]',
                          {
                            'md:!mt-[0.7rem]':
                              !isSplitViewActive &&
                              !isPreviewMode &&
                              !isFocusMode,
                          },
                          {
                            '-mt-[1.5rem] md:!mt-[0.7rem]':
                              !isSplitViewActive &&
                              !isNavbarVisible &&
                              !isPreviewMode,
                          },
                          // Split View: no full-screen top spacing.
                          isSplitViewActive && 'mt-0',
                          isFocusMode && 'mt-[48px]',
                        )}
                        style={{
                          ...(isMobile
                            ? {}
                            : {
                                width: `${scaledWidth}px`,
                                maxWidth: `${scaledWidth}px`,
                              }),
                          flexShrink: 0,
                          minHeight: '100%',
                          ...(!isFocusMode ? getCanvasStyle() || {} : {}),
                          // Split View: fill the right pane instead of the
                          // fixed page width (kept last so it wins).
                          ...(isSplitViewActive
                            ? { width: '100%', maxWidth: '100%' }
                            : {}),
                        }}
                        data-mode={isFocusMode ? 'focus' : 'normal'}
                      >
                        <div
                          ref={editorRef}
                          className={cn(
                            'w-full pt-8 md:pt-0',
                            {
                              'color-bg-default':
                                !documentStyling?.canvasBackground &&
                                (zoomLevel === '1.4' || zoomLevel === '1.5') &&
                                !isFocusMode,
                            },
                            isPreviewMode && 'pt-3',
                          )}
                          style={
                            isMobile
                              ? {}
                              : isSplitViewActive
                                ? // Split View: fill the pane, no page width / zoom.
                                  { width: '100%' }
                                : {
                                    width: `${baseWidth}px`,
                                    transform: `scale(${zoom})`,
                                    transformOrigin: 'top left',
                                    height: `${100 / zoom}%`,
                                  }
                          }
                        >
                          <div>
                            {editor && (
                              <>
                                <EditorBubbleMenu
                                  editor={editor}
                                  //@ts-expect-error error mismatch here
                                  onError={onError}
                                  zoomLevel={zoomLevel}
                                  disableInlineComment={
                                    disableInlineComment || false
                                  }
                                  setIsCommentSectionOpen={
                                    setIsCommentSectionOpen
                                  }
                                  inlineCommentData={inlineCommentData}
                                  setInlineCommentData={setInlineCommentData}
                                  isPreviewMode={isPreviewMode}
                                  username={username as string}
                                  walletAddress={walletAddress as string}
                                  onInlineComment={onInlineComment}
                                  setCommentDrawerOpen={setCommentDrawerOpen}
                                  activeCommentId={activeCommentId}
                                  isCollabDocumentPublished={
                                    isCollabDocumentPublished
                                  }
                                  ipfsImageFetchFn={ipfsImageFetchFn}
                                  fetchV1ImageFn={fetchV1ImageFn}
                                  ipfsImageUploadFn={ipfsImageUploadFn}
                                  enableCollaboration={isLiveCollabSession(
                                    collaboration,
                                  )}
                                  isCollabDocOwner={
                                    collaboration?.enabled
                                      ? collaboration.connection.isOwner
                                      : true
                                  }
                                />
                                <EmbedSettings editor={editor} />
                              </>
                            )}

                            {editor && (
                              <ColumnsMenu
                                editor={editor}
                                appendTo={editorRef}
                              />
                            )}
                          </div>
                          {!editor || isContentLoading
                            ? fadeInTransition(
                                <div
                                  className={`${!isMobile ? 'p-20' : 'px-9 pt-6'}`}
                                >
                                  {isPreviewMode ? (
                                    <PreviewContentLoader />
                                  ) : (
                                    <Skeleton
                                      className={`${isMobile ? 'w-full' : 'w-[400px]'}  h-[32px] rounded-sm mb-4`}
                                    />
                                  )}
                                </div>,
                                'content-transition',
                              )
                            : slideUpTransition(
                                <div>
                                  <EditingProvider
                                    isPreviewMode={isPreviewMode}
                                    isSuggestionMode={
                                      isPreviewMode && viewerMode === 'suggest'
                                    }
                                    isCollaboratorsDoc={
                                      collaboration?.enabled === true &&
                                      !collaboration.connection.isOwner
                                    }
                                  >
                                    {tags && tags.length > 0 && (
                                      <div
                                        ref={tagsContainerRef}
                                        className={cn(
                                          'flex flex-wrap px-4 md:px-8 lg:px-[80px] mb-8 items-center gap-1 mt-4 lg:!mt-0',
                                          { 'pt-12': isPreviewMode },
                                        )}
                                        {...(!isFocusMode &&
                                          getCanvasStyle() && {
                                            style: getCanvasStyle(),
                                          })}
                                      >
                                        {visibleTags.map((tag, index) => (
                                          <Tag
                                            key={index}
                                            style={{
                                              backgroundColor: tag?.color,
                                            }}
                                            onRemove={() =>
                                              handleRemoveTag(tag?.name)
                                            }
                                            isRemovable={!isPreviewMode}
                                            className="!h-6 rounded"
                                          >
                                            {tag?.name}
                                          </Tag>
                                        ))}
                                        {hiddenTagsCount > 0 &&
                                          !isHiddenTagsVisible && (
                                            <Button
                                              variant="ghost"
                                              className="!h-6 rounded min-w-fit !px-2 color-bg-secondary text-helper-text-sm"
                                              onClick={() =>
                                                setIsHiddenTagsVisible(true)
                                              }
                                            >
                                              +{hiddenTagsCount}
                                            </Button>
                                          )}

                                        {isHiddenTagsVisible && (
                                          <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{
                                              opacity: 1,
                                              height: 'auto',
                                            }}
                                            exit={{ opacity: 0, height: 0 }}
                                            transition={{ duration: 0.3 }}
                                            className="flex flex-wrap items-center gap-1"
                                          >
                                            {selectedTags
                                              ?.slice(4)
                                              .map((tag, index) => (
                                                <Tag
                                                  key={index + 4}
                                                  style={{
                                                    backgroundColor: tag?.color,
                                                  }}
                                                  onRemove={() =>
                                                    handleRemoveTag(tag?.name)
                                                  }
                                                  isRemovable={!isPreviewMode}
                                                  className="!h-6 rounded"
                                                >
                                                  {tag?.name}
                                                </Tag>
                                              ))}
                                          </motion.div>
                                        )}

                                        {selectedTags &&
                                        selectedTags?.length < 6 ? (
                                          <TagInput
                                            tags={tags || []}
                                            selectedTags={
                                              selectedTags as TagType[]
                                            }
                                            onAddTag={handleAddTag}
                                            isPreviewMode={isPreviewMode}
                                          />
                                        ) : null}
                                      </div>
                                    )}
                                    <DBlockToolbarProvider
                                      editor={editor}
                                      runtimeState={
                                        splitAwareDBlockRuntimeState
                                      }
                                      onCopyHeadingLink={onCopyHeadingLink}
                                    >
                                      <div className="grammarly-wrapper">
                                        {(cachedEditorEntries?.length
                                          ? cachedEditorEntries
                                          : editor
                                            ? [
                                                {
                                                  tabId: activeTabId,
                                                  editor,
                                                  isActive: true,
                                                },
                                              ]
                                            : []
                                        ).map((entry) => (
                                          <div
                                            key={entry.tabId}
                                            data-ddoc-editor-panel="true"
                                            data-ddoc-editor-tab-id={
                                              entry.tabId
                                            }
                                            aria-hidden={!entry.isActive}
                                            style={{
                                              position: entry.isActive
                                                ? 'relative'
                                                : 'absolute',
                                              inset: entry.isActive
                                                ? undefined
                                                : 0,
                                              width: '100%',
                                              visibility: entry.isActive
                                                ? 'visible'
                                                : 'hidden',
                                              pointerEvents: entry.isActive
                                                ? undefined
                                                : 'none',
                                              // Inactive tabs stay mounted (for
                                              // instant switching) but are
                                              // collapsed to the wrapper height
                                              // via inset:0. Without clipping,
                                              // their taller content overflows
                                              // this box and inflates the shared
                                              // scroll container's scrollHeight —
                                              // so switching long→short leaves a
                                              // ghost "void" the browser won't
                                              // scroll-clamp away. Clip it.
                                              overflow: entry.isActive
                                                ? undefined
                                                : 'hidden',
                                            }}
                                          >
                                            <EditorContent
                                              editor={entry.editor}
                                              data-ddoc-editor-root="true"
                                              data-ddoc-editor-tab-id={
                                                entry.tabId
                                              }
                                              ref={(node) =>
                                                setActiveEditorContentRef(
                                                  node,
                                                  entry.isActive,
                                                )
                                              }
                                              className={cn(
                                                'w-full h-auto',
                                                isPreviewMode && 'preview-mode',
                                                activeModel !== undefined &&
                                                  isAIAgentEnabled &&
                                                  'has-available-models',
                                                disableInlineComment &&
                                                  'hide-inline-comments',
                                              )}
                                            />
                                          </div>
                                        ))}
                                      </div>
                                    </DBlockToolbarProvider>
                                  </EditingProvider>
                                </div>,
                                'editor-transition',
                              )}
                        </div>
                      </div>
                      {editor && !isFocusMode && (
                        <div className="comment-floating-slot absolute left-full top-0 ml-[12px] overflow-visible">
                          <CommentFloatingContainer
                            editor={editor}
                            editorWrapperRef={editorWrapperRef}
                            scrollContainerRef={editorScrollContainerRef}
                            tabName={currentTabName}
                            isHidden={
                              Boolean(commentDrawerOpen) ||
                              Boolean(disableInlineComment)
                            }
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
              <div
                className={cn(
                  'editor-right-rail',
                  !isMobile && 'flex-[1_1_263px]',
                  !isPreviewMode &&
                    !isFocusMode &&
                    isNavbarVisible &&
                    '-mt-[1.5rem] md:!mt-[0.8rem]',
                  isPreviewMode && 'md:!mt-[1rem]',
                  { 'md:!mt-[0.7rem]': !isPreviewMode && !isFocusMode },
                  {
                    '-mt-[1.5rem] md:!mt-[0.7rem]':
                      !isNavbarVisible && !isPreviewMode,
                  },
                  isFocusMode && 'mt-[48px]',
                  isFocusMode && !showTOC && shouldHideRight && 'hidden',
                )}
              ></div>
            </div>

            {showCommentButton && !isNativeMobile && (
              <Button
                ref={btn_ref}
                onClick={() => {
                  if (!editor) return;
                  handleCommentButtonClick?.(editor);
                }}
                variant="ghost"
                className={cn(
                  'absolute w-12 h-12 color-bg-default rounded-full shadow-xl top-[70px] right-[-23px]',
                )}
              >
                <LucideIcon name="MessageSquareText" size="sm" />
              </Button>
            )}
            {!isPreviewMode && !disableBottomToolbar && (
              <div
                className={cn(
                  'flex mobile:hidden items-center w-full h-[52px] fixed left-0 z-10 px-4 color-bg-default transition-all duration-300 ease-in-out border-b border-color-default',
                  isKeyboardVisible && 'hidden',
                  {
                    'top-[var(--navbar)]': isNavbarVisible,
                    'top-0': !isNavbarVisible,
                  },
                )}
              >
                <MobileToolbar
                  onError={onError}
                  editor={editor}
                  isKeyboardVisible={isKeyboardVisible}
                  isNavbarVisible={isNavbarVisible}
                  setIsNavbarVisible={setIsNavbarVisible}
                  ipfsImageUploadFn={ipfsImageUploadFn}
                  isLoading={!editor || isContentLoading}
                  ipfsImageFetchFn={ipfsImageFetchFn}
                  fetchV1ImageFn={fetchV1ImageFn}
                />
              </div>
            )}
            {editor && (
              <CommentDrawer
                isOpen={commentDrawerOpen as boolean}
                onClose={() => setCommentDrawerOpen?.(false)}
                isNavbarVisible={isNavbarVisible}
                isPresentationMode={isPresentationMode as boolean}
                activeCommentId={activeCommentId}
                activeTabId={activeTabId}
                onTabChange={setActiveTabId}
                isPreviewMode={isPreviewMode}
                tabs={tabs}
              />
            )}

            <div>
              {editor && isBelow1280px && !isFocusMode && (
                <CommentBubbleCard
                  editor={editor}
                  activeCommentId={activeCommentId}
                  commentDrawerOpen={commentDrawerOpen as boolean}
                  isCollabDocumentPublished={isCollabDocumentPublished}
                  disableInlineComment={disableInlineComment}
                />
              )}
            </div>
          </>
        </AnimatePresence>
      );
    };

    // A doc created on a newer schema must never bind editors in this build;
    // useDdocEditor already blocks editor creation via the schema guard, this
    // branch replaces the editor surface with a refresh prompt.
    if (isSchemaUnsupported) {
      return (
        <div className="w-full h-[100dvh] color-bg-secondary flex items-center justify-center p-6">
          <div className="flex flex-col items-center gap-4 text-center max-w-[24rem]">
            <LucideIcon name="RefreshCw" size="md" />
            <div className="flex flex-col gap-2">
              <p className="text-heading-sm color-text-default">
                Update needed to open this document
              </p>
              <p className="text-body-sm color-text-secondary">
                This document was created with a newer version of the app.
                Refresh the page to update and open it.
              </p>
            </div>
            <Button onClick={() => window.location.reload()}>Refresh</Button>
          </div>
        </div>
      );
    }

    return (
      <EditorProvider
        documentStyling={documentStyling}
        theme={theme ?? 'light'}
        isFocusMode={isFocusMode}
      >
        <div
          className={cn(
            'w-full',
            !isPresentationMode ? 'color-bg-secondary' : 'color-bg-default',
          )}
          style={{
            height: isFocusMode
              ? '100vh'
              : isSplitViewActive
                ? isNavbarVisible
                  ? `calc(100dvh - 56px - ${footerHeight || '0px'})`
                  : `calc(100dvh - ${footerHeight || '0px'})`
                : !isPreviewMode
                  ? isNavbarVisible
                    ? `calc(100dvh - 108px - ${footerHeight || '0px'})`
                    : `calc(100dvh - 52px - ${footerHeight || '0px'})`
                  : `calc(100dvh - 52px - ${footerHeight || '0px'})`,
          }}
        >
          {/* Author's custom CSS escape hatch. The author writes bare selectors
              (`h1 { … }`, `p { … }`); sanitizeCustomCss scopes every rule to the
              document (`.ProseMirror { … }`) AND strips injection vectors —
              breakout via `}`, url()/@import exfiltration, position:fixed
              overlays, expression()/behavior. Custom CSS reaches viewers of a
              published doc, so it is treated as untrusted input, not a trusted
              stylesheet. Applies live while editing, in preview, and published. */}
          {safeCustomCss ? (
            <style dangerouslySetInnerHTML={{ __html: safeCustomCss }} />
          ) : null}
          <div
            id="editor-canvas"
            onMouseDown={handleFocusModeMouseDown}
            className={cn(
              'h-[100%] flex w-full relative [--navbar:64px] max-lg:[--navbar:46px] [--toolbar:44px] max-mobile:[--toolbar:52px]',
              // Split View: the right-pane wrapper owns the scroll, not the canvas.
              isSplitViewActive ? 'overflow-hidden' : 'overflow-auto',
              !isPreviewMode &&
                !isFocusMode &&
                !isSplitViewActive &&
                (isNavbarVisible
                  ? 'mt-[calc(var(--navbar)+var(--toolbar))]'
                  : 'mt-[var(--toolbar)]'),
              // Split View hides the rich toolbar, so only reserve the navbar.
              isSplitViewActive &&
                !isFocusMode &&
                (isNavbarVisible ? 'mt-[var(--navbar)]' : 'mt-0'),
              isPreviewMode && !isFocusMode && 'mt-[var(--navbar)]',
              !isPresentationMode ? 'color-bg-secondary' : 'color-bg-default',
              editorCanvasClassNames,
            )}
            style={!isFocusMode ? getBackgroundStyle() : undefined}
          >
            <SearchReplace editor={editor} viewerMode={viewerMode} />

            <CommentStoreProvider
              isInlineCommentAvailable={
                !isCollabEnabled &&
                !disableInlineComment &&
                isCollabDocumentPublished
              }
              editor={editor ?? null}
              ydoc={ydoc}
              isFocusMode={isFocusMode}
              username={username as string}
              setUsername={setUsername}
              activeCommentId={activeCommentId}
              setActiveCommentId={setActiveCommentId}
              activeTabId={activeTabId}
              focusCommentWithActiveId={focusCommentWithActiveId}
              initialComments={initialComments}
              setInitialComments={setInitialComments}
              onNewComment={onNewComment}
              onEditComment={onEditComment}
              onEditReply={onEditReply}
              onCommentReply={onCommentReply}
              onResolveComment={onResolveComment}
              onUnresolveComment={onUnresolveComment}
              onDeleteComment={onDeleteComment}
              onDeleteReply={onDeleteReply}
              ensResolutionUrl={ensResolutionUrl as string}
              isConnected={isConnected}
              connectViaWallet={connectViaWallet}
              isLoading={isLoading}
              connectViaUsername={connectViaUsername}
              isDDocOwner={isDDocOwner}
              onInlineComment={onInlineComment}
              onComment={onComment}
              setCommentDrawerOpen={setCommentDrawerOpen}
              commentAnchorsRef={commentAnchorsRef}
              draftAnchorsRef={draftAnchorsRef}
              storeApiRef={storeApiRef}
              initialCommentAnchors={initialCommentAnchors}
            >
              <nav
                id="Navbar"
                onKeyDown={(e) => {
                  // Escape from anywhere in the navbar returns focus to the
                  // editor, letting keyboard users leave the navbar's tabbing
                  // order (mirrors the formatting toolbar's behavior).
                  if (e.key === 'Escape' && editor) {
                    e.preventDefault();
                    editor.commands.focus();
                  }
                }}
                className={cn(
                  'h-[var(--navbar)] color-bg-default p-2 flex gap-10 items-center justify-between w-screen fixed left-0 top-0 border-b color-border-default z-[45] transition-all duration-300',
                  {
                    'translate-y-0 opacity-100':
                      !isFocusMode && isNavbarVisible && !isPresentationMode,
                    'translate-y-[-100%] opacity-0 pointer-events-none':
                      isFocusMode || !isNavbarVisible || isPresentationMode,
                  },
                )}
              >
                {editor &&
                  renderNavbar?.({
                    get editor() {
                      return editor.getJSON();
                    },
                    liveEditor: editor,
                  })}
              </nav>
              {/*
                Split View keeps the REAL editor mounted in place — it is never
                moved into a second <EditorContent>, which would orphan every
                React node view (tables, images, embeds). `display: contents`
                makes these wrappers invisible in normal mode (renderComp lays
                out exactly as before) and turns them into the 2-pane split
                layout when active, without changing renderComp's tree position.
              */}
              <div
                ref={splitContainerRef}
                className={cn(
                  isSplitViewActive
                    ? 'flex w-full h-full p-4 color-bg-secondary overflow-hidden'
                    : 'contents',
                )}
              >
                {editor && isSplitViewActive && (
                  <SplitViewMarkdownPane
                    markdown={splitViewMarkdown}
                    onMarkdownChange={onSplitViewMarkdownChange}
                    ipfsImageUploadFn={ipfsImageUploadFn}
                    onError={onError}
                    customCSS={documentStyling?.customCSS}
                    style={{ flexGrow: splitRatio }}
                  />
                )}

                {/* Draggable divider to resize the two panes. */}
                {editor && isSplitViewActive && (
                  <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-valuenow={Math.round(splitRatio * 100)}
                    aria-valuemin={20}
                    aria-valuemax={80}
                    onMouseDown={handleSplitterDown}
                    className="group flex w-2 shrink-0 cursor-col-resize items-center justify-center"
                  >
                    <div className="h-10 w-[3px] rounded-full color-bg-default-hover transition-colors group-hover:color-bg-brand" />
                  </div>
                )}

                {/* RIGHT pane (split) / passthrough (normal) — the real editor. */}
                <div
                  style={
                    isSplitViewActive ? { flexGrow: 1 - splitRatio } : undefined
                  }
                  className={cn(
                    isSplitViewActive
                      ? 'flex-1 min-w-0 h-full flex flex-col color-bg-default rounded border color-border-default overflow-hidden relative'
                      : 'contents',
                  )}
                >
                  {editor && isSplitViewActive && (
                    <SplitViewRightHeader
                      editor={editor}
                      onExitSplitView={() => setIsSplitView?.(false)}
                      showTabsPanel={showSplitTabsPanel}
                      onToggleTabsPanel={() =>
                        setShowSplitTabsPanel((open) => !open)
                      }
                    />
                  )}

                  <div
                    className={cn(
                      isSplitViewActive
                        ? 'flex-1 min-h-0 relative overflow-hidden'
                        : 'contents',
                    )}
                  >
                    <div
                      ref={splitViewScrollRef}
                      {...(isSplitViewActive
                        ? { 'data-split-view-preview': 'true' }
                        : {})}
                      className={cn(
                        isSplitViewActive
                          ? 'absolute inset-0 overflow-y-auto overflow-x-hidden'
                          : 'contents',
                      )}
                    >
                      {renderComp()}
                    </div>

                    {/* Document-tabs overlay (existing DocumentOutline). */}
                    {editor && isSplitViewActive && showSplitTabsPanel && (
                      <div className="absolute top-0 left-0 h-full w-[263px] z-20 color-bg-default border-r color-border-default shadow-elevation-3 overflow-y-auto">
                        <DocumentOutline
                          editor={editor}
                          hasToC={true}
                          items={tocItems}
                          setItems={setTocItems}
                          showTOC={showTOC}
                          setShowTOC={setShowTOC}
                          isPreviewMode={false}
                          orientation={documentStyling?.orientation}
                          tabs={tabs}
                          setTabs={setTabs}
                          activeTabId={activeTabId}
                          setActiveTabId={setActiveTabId}
                          createTab={createTab}
                          renameTab={renameTab}
                          duplicateTab={duplicateTab}
                          orderTab={orderTab}
                          deleteTab={deleteTab}
                          ydoc={ydoc}
                          tabCommentCounts={tabCommentCounts}
                          tabConfig={tabConfig}
                          isConnected={isConnected}
                          isFocusMode={isFocusMode}
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CommentStoreProvider>
          </div>
        </div>
      </EditorProvider>
    );
  },
);

export default DdocEditor;
