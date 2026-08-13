/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  Dispatch,
  MutableRefObject,
  SetStateAction,
} from 'react';
import { toast } from '@fileverse/ui';
import {
  DdocProps,
  DdocEditorProps,
  SerializedCommentAnchor,
  ThemeKey,
} from '../types';
import * as Y from 'yjs';
import Collaboration from '@tiptap/extension-collaboration';
import { defaultExtensions } from '../extensions/default-extension';
import { AnyExtension, JSONContent, Editor } from '@tiptap/react';
import { getCursor } from '../utils/cursor';
import { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import SlashCommand from '../extensions/slash-command/slash-comand';
import {
  EditorState,
  TextSelection,
  Plugin,
  type Transaction,
} from '@tiptap/pm/state';
import customTextInputRules from '../extensions/customTextInputRules';
import { PageBreak } from '../extensions/page-break/page-break';
import { toUint8Array } from 'js-base64';
import { isJSONString } from '../utils/isJsonString';
import { zoomService } from '../zoom-service';
import { sanitizeContent } from '../utils/sanitize-content';
import { CommentExtension as Comment } from '../extensions/comment';
import {
  CommentAnchor,
  CommentDecorationExtension,
  triggerDecorationRebuild,
} from '../extensions/comment/comment-decoration-plugin';
import { SuggestionTrackingExtension } from '../extensions/suggestion/suggestion-tracking-extension';
import type { createCommentStore } from '../stores/comment-store';
import {
  createPageCounter,
  handleContentPrint,
  handlePrint,
} from '../utils/handle-print';
import { isBlackOrWhiteShade } from '../utils/color-utils';
import { AiAutocomplete } from '../extensions/ai-autocomplete/ai-autocomplete';
import { AIWriter } from '../extensions/ai-writer';
import { createDBlockExtension } from '../extensions/d-block/dblock';
import {
  DEFAULT_DBLOCK_RUNTIME_STATE,
  type DBlockRuntimeStateRef,
} from '../extensions/d-block/dblock-runtime';
import { ToCItemType } from '../components/toc/types';
import { TWITTER_REGEX } from '../constants/twitter';
import { headingToSlug } from '../utils/heading-to-slug';
import { useResponsive } from '../utils/responsive';
import { yCursorPlugin, yCursorPluginKey } from '@tiptap/y-tiptap';
import { getResponsiveColor } from '../utils/colors';
import { getEditorScrollContainer } from '../utils/get-editor-scroll-container';
import {
  deserializeCommentAnchors,
  getSerializedCommentAnchorsKey,
} from '../utils/comment-anchor-serialization';
import {
  CollabConnectionConfig,
  CollaborationProps,
} from '../sync-local/types';
import { destroyEditorWithYSyncCleanup } from '../utils/y-prosemirror-cleanup';
import { clearTableOfContentsStorage } from '../extensions/table-of-contents';
import { useTabEditorCache } from './use-tab-editor-cache';

// The single source of truth for the tab editor's construction-time
// `editorProps.attributes` (the `main-doc-editor`/prose classes,
// `spellcheck`, `suppressContentEditableWarning`). Extracted to a named,
// independently-testable constant so a future local `attributes:` key
// added inline at the `new Editor({ editorProps: { ... } })` call site
// below can't silently collide with — and replace — the spread of
// `DdocEditorProps` the way the pre-existing bug did (a later `attributes:`
// key in the same object literal overwrites the earlier one from
// `...DdocEditorProps`, rather than merging).
export const TAB_EDITOR_ATTRIBUTES: Record<string, string> = {
  ...(DdocEditorProps.attributes as Record<string, string>),
};

const usercolors = [
  '#30bced',
  '#6eeb83',
  '#fa69d1',
  '#ecd444',
  '#ee6352',
  '#db3041',
  '#0ad7f2',
  '#1bff39',
];

type ScheduledIdleTask = {
  kind: 'idle' | 'timeout';
  handle: number;
} | null;

const scheduleIdleTask = (callback: () => void): ScheduledIdleTask => {
  if (typeof window.requestIdleCallback === 'function') {
    return {
      kind: 'idle',
      handle: window.requestIdleCallback(() => callback(), {
        timeout: 300,
      }),
    };
  }

  return {
    kind: 'timeout',
    handle: window.setTimeout(callback, 16),
  };
};

const cancelIdleTask = (task: ScheduledIdleTask) => {
  if (!task) {
    return;
  }

  if (task.kind === 'idle' && typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(task.handle);
    return;
  }

  window.clearTimeout(task.handle);
};

const isEditorViewInsideActiveRoot = (
  view: EditorView,
  activeEditor: Editor | null,
) => activeEditor?.view === view && !activeEditor.isDestroyed;

const getInlineCommentEventTarget = (
  target: EventTarget | null,
): Element | null => {
  if (!(target instanceof Node)) {
    return null;
  }

  if (target.nodeType === Node.TEXT_NODE) {
    return target.parentElement;
  }

  return target instanceof Element ? target : null;
};

const hasVisibleFloatingCommentCard = () => {
  if (typeof document === 'undefined') {
    return false;
  }

  return Boolean(
    document.querySelector(
      '[data-floating-comment-hidden="false"] [data-floating-comment-card]',
    ),
  );
};

const getHeadingSignature = (doc: ProseMirrorNode) => {
  const headings: string[] = [];

  doc.descendants((node) => {
    if (node.type.name !== 'heading') {
      return true;
    }

    headings.push(
      [node.attrs.id ?? '', node.attrs.level ?? '', node.textContent].join(':'),
    );
    return false;
  });

  return headings.join('|');
};

const rangeTouchesHeading = (
  doc: ProseMirrorNode,
  from: number,
  to: number,
) => {
  const start = Math.max(0, Math.min(from - 2, doc.content.size));
  const end = Math.max(start, Math.min(to + 2, doc.content.size));
  let touchesHeading = false;

  doc.nodesBetween(start, end, (node) => {
    if (node.type.name === 'heading') {
      touchesHeading = true;
      return false;
    }

    return !touchesHeading;
  });

  return touchesHeading;
};

const transactionCouldTouchHeading = (transaction: Transaction) => {
  if (!transaction.docChanged) {
    return false;
  }

  let touchesHeading = false;

  transaction.mapping.maps.forEach((map, index) => {
    if (touchesHeading) {
      return;
    }

    const beforeDoc = transaction.docs[index] ?? transaction.before;
    const afterDoc = transaction.docs[index + 1] ?? transaction.doc;

    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (touchesHeading) {
        return;
      }

      touchesHeading =
        rangeTouchesHeading(beforeDoc, oldStart, oldEnd) ||
        rangeTouchesHeading(afterDoc, newStart, newEnd);
    });
  });

  return touchesHeading;
};

interface UseTabEditorArgs {
  ydoc: Y.Doc;
  isVersionMode?: boolean;
  hasTabState?: boolean;
  versionId?: string;
  isPreviewMode?: boolean;
  viewerMode?: DdocProps['viewerMode'];
  initialContent: DdocProps['initialContent'];
  collaboration?: CollaborationProps;
  isReady?: boolean;
  awareness?: any;
  disableInlineComment?: boolean;
  isFocusMode?: boolean;
  onCommentInteraction?: DdocProps['onCommentInteraction'];
  onError?: DdocProps['onError'];
  ipfsImageUploadFn?: DdocProps['ipfsImageUploadFn'];
  metadataProxyUrl?: string;
  onCopyHeadingLink?: DdocProps['onCopyHeadingLink'];
  ipfsImageFetchFn?: DdocProps['ipfsImageFetchFn'];
  fetchV1ImageFn?: DdocProps['fetchV1ImageFn'];
  isConnected?: boolean;
  activeModel?: DdocProps['activeModel'];
  maxTokens?: number;
  isAIAgentEnabled?: boolean;
  setCharacterCount?: DdocProps['setCharacterCount'];
  setWordCount?: DdocProps['setWordCount'];
  setSelectedWordCount?: DdocProps['setSelectedWordCount'];
  setPageCount?: DdocProps['setPageCount'];
  setIsContentLoading: Dispatch<SetStateAction<boolean>>;
  setIsCollabContentLoading: Dispatch<SetStateAction<boolean>>;
  unFocused?: boolean;
  zoomLevel?: string;
  isPresentationMode?: boolean;
  onInvalidContentError?: DdocProps['onInvalidContentError'];
  ignoreCorruptedData?: boolean;
  onConnect: (connectConfig: CollabConnectionConfig) => void;
  onDisconnect: () => void;
  isIndexeddbSynced: boolean;
  hasCollabContentInitialised?: boolean;
  initialiseYjsIndexedDbProvider: () => Promise<void>;
  externalExtensions?: Record<string, AnyExtension>;
  isContentLoading?: boolean;
  activeTabId: string;
  tabIds?: string[];
  theme?: ThemeKey;
  editorRef?: MutableRefObject<Editor | null>;
  initialCommentAnchors?: SerializedCommentAnchor[];
  dBlockRuntimeStateRef?: DBlockRuntimeStateRef;
  docSchemaVersion?: number;
}

export const useTabEditor = ({
  ydoc,
  isVersionMode,
  hasTabState,
  versionId,
  isPreviewMode,
  viewerMode,
  initialContent,
  collaboration,
  isReady,
  awareness,
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
  onInvalidContentError,
  ignoreCorruptedData,
  onConnect,
  onDisconnect,
  isIndexeddbSynced,
  hasCollabContentInitialised,
  initialiseYjsIndexedDbProvider,
  externalExtensions,
  isContentLoading,
  activeTabId,
  tabIds,
  theme,
  editorRef,
  initialCommentAnchors,
  dBlockRuntimeStateRef,
  docSchemaVersion = 1,
}: UseTabEditorArgs) => {
  const collabEnabled = collaboration?.enabled === true;
  const connection = collabEnabled ? collaboration.connection : null;
  const { activeCommentId, setActiveCommentId, focusCommentWithActiveId } =
    useActiveComment();

  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const activeEditorRef = useRef<Editor | null>(null);
  const hasAvailableModels = Boolean(activeModel && isAIAgentEnabled);
  const { tocItems, setTocItems, handleTocUpdateForTab } =
    useTocState(activeTabId);

  const isSuggestionMode = !!(isPreviewMode && viewerMode === 'suggest');
  const fallbackDBlockRuntimeStateRef = useRef(DEFAULT_DBLOCK_RUNTIME_STATE);
  const resolvedDBlockRuntimeStateRef =
    dBlockRuntimeStateRef ?? fallbackDBlockRuntimeStateRef;
  const handleCommentActivatedForTab = useCallback(
    (tabId: string, commentId: string) => {
      if (activeTabIdRef.current !== tabId) {
        return;
      }
      setActiveCommentId(commentId || null);
      if (commentId) {
        setTimeout(() => focusCommentWithActiveId(commentId));
      }
    },
    [focusCommentWithActiveId, setActiveCommentId],
  );
  const handleTocUpdateForActiveTab = useCallback(
    (tabId: string, data: ToCItemType[], isCreate: boolean | undefined) => {
      if (activeTabIdRef.current !== tabId) {
        return;
      }
      handleTocUpdateForTab(tabId, data, isCreate);
    },
    [handleTocUpdateForTab],
  );

  const {
    buildExtensionsForTab,
    commentAnchorsRef,
    draftAnchorsRef,
    storeApiRef,
  } = useEditorExtension({
    ydoc,
    onError,
    ipfsImageUploadFn,
    metadataProxyUrl,
    onCopyHeadingLink,
    ipfsImageFetchFn,
    fetchV1ImageFn,
    enableCollaboration: collabEnabled,
    disableInlineComment,
    isConnected,
    activeModel,
    maxTokens,
    isAIAgentEnabled,
    hasAvailableModels,
    activeCommentId,
    onCommentActivated: handleCommentActivatedForTab,
    onTocUpdateForTab: handleTocUpdateForActiveTab,
    externalExtensions,
    initialCommentAnchors,
    isSuggestionMode,
    dBlockRuntimeStateRef: resolvedDBlockRuntimeStateRef,
    docSchemaVersion,
  });

  const { handleCommentInteraction, handleCommentClick } =
    useCommentInteraction({
      isFocusMode,
      onCommentInteraction,
    });
  const isFocusModeRef = useRef(isFocusMode);

  useEffect(() => {
    isFocusModeRef.current = isFocusMode;
  }, [isFocusMode]);

  const focusSubmittedSuggestionFromEditorEvent = useCallback(
    (view: EditorView, event: Event) => {
      if (!isEditorViewInsideActiveRoot(view, activeEditorRef.current)) {
        return false;
      }

      if (isFocusModeRef.current) {
        return false;
      }

      const target = getInlineCommentEventTarget(event.target);
      const suggestionNode = target?.closest<HTMLElement>(
        '[data-suggestion-id][data-comment-id]',
      );
      const commentId =
        suggestionNode?.dataset.commentId ??
        suggestionNode?.dataset.suggestionId ??
        null;

      if (!commentId) {
        return false;
      }

      const didFocus =
        storeApiRef.current
          ?.getState()
          .focusSubmittedSuggestionFromEditor(commentId) ?? false;

      if (!didFocus) {
        return false;
      }

      event.preventDefault();
      event.stopPropagation();
      view.dom.blur();
      return true;
    },
    [storeApiRef],
  );
  const isInitialEditorCreation = useRef(true);
  const [slides, setSlides] = useState<string[]>([]);
  const unFocusedRef = useRef(unFocused);
  unFocusedRef.current = unFocused;

  useEffect(() => {
    if (!activeTabId) return;
    setActiveCommentId(null);
  }, [activeTabId, setActiveCommentId]);

  const createEditorForTab = useCallback(
    (tabId: string) => {
      const shouldAutofocus =
        !unFocusedRef.current &&
        isInitialEditorCreation.current &&
        activeTabIdRef.current === tabId;

      const createdEditor = new Editor({
        extensions: buildExtensionsForTab(tabId),
        editorProps: {
          clipboardTextSerializer(content) {
            return content.content.textBetween(0, content.content.size, '\n\n');
          },
          ...DdocEditorProps,
          handleDOMEvents: {
            mousedown: focusSubmittedSuggestionFromEditorEvent,
            mouseover: (view, event) => {
              if (
                !isEditorViewInsideActiveRoot(view, activeEditorRef.current)
              ) {
                return false;
              }
              return handleCommentInteraction(view, event);
            },
            keydown: (view, event) => {
              if (
                !isEditorViewInsideActiveRoot(view, activeEditorRef.current)
              ) {
                return false;
              }
              // prevent default event listeners from firing when slash command is active
              if (['ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) {
                const ownerDocument = view.dom.ownerDocument;
                const slashCommand =
                  ownerDocument.getElementById('slash-command');
                const emojiList = ownerDocument.getElementById('emoji-list');
                if (slashCommand || emojiList) {
                  return true;
                }
              }
              return false;
            },
            blur: (view) => {
              if (
                !isEditorViewInsideActiveRoot(view, activeEditorRef.current)
              ) {
                return false;
              }
              requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                  // Let focus transfer settle before clearing active comment
                  // state; clicks into floating thread UI blur the editor first.
                  if (hasVisibleFloatingCommentCard()) {
                    return;
                  }

                  activeEditorRef.current?.commands.unsetCommentActive();
                });
              });
              return false;
            },
          },
          handleClick: (view, pos, event) => {
            if (!isEditorViewInsideActiveRoot(view, activeEditorRef.current)) {
              return false;
            }
            // 1. Check for Modifier Keys (Ctrl or Cmd)
            const isModifierPressed = event.metaKey || event.ctrlKey;
            // 2. Check if the clicked element is a link
            // In Firefox, event.target can be a text node which lacks closest()
            const target = getInlineCommentEventTarget(event.target);

            const link = target?.closest<HTMLAnchorElement>('a');
            if (link?.href) {
              // Fragment links with heading= param should scroll within the document. Only check origin (not pathname) since the same doc has  different paths (i.e: shareable link vs owner link).
              const url = new URL(link.href, window.location.href);
              if (url.hash && url.origin === window.location.origin) {
                const hash = decodeURIComponent(url.hash.slice(1));
                const params = new URLSearchParams(hash);
                const headingParam = params.get('heading');
                if (headingParam) {
                  event.preventDefault();
                  const id = headingParam.split('-').pop();
                  if (id) {
                    const allHeadings =
                      view.dom.querySelectorAll('[data-toc-id]');
                    const element = Array.from(allHeadings).find((el) =>
                      (el as HTMLElement).dataset.tocId?.includes(id),
                    );
                    if (element) {
                      const scrollContainer = getEditorScrollContainer({
                        targetElement: element as HTMLElement,
                        editorRoot: view.dom as HTMLElement,
                      });
                      if (scrollContainer) {
                        requestAnimationFrame(() => {
                          const containerRect =
                            scrollContainer.getBoundingClientRect();
                          const elementRect = (
                            element as HTMLElement
                          ).getBoundingClientRect();
                          scrollContainer.scrollBy({
                            top: elementRect.top - containerRect.top,
                            behavior: 'smooth',
                          });
                        });
                      }
                      return true;
                    }
                  }
                  // Heading not found in current doc — fall through to
                  // open in new tab (navigates to the other ddoc).
                }
              }

              // Read-only preview mode can use the anchor's native navigation.
              // Suggestion mode is also a preview mode, but its ProseMirror
              // view stays editable so it can intercept proposed changes.
              if (!view.editable) {
                return false;
              }

              const isTwitter =
                link?.textContent?.match(TWITTER_REGEX) ?? false;

              if (isTwitter) {
                if (isModifierPressed) {
                  event.preventDefault();
                  window.open(link.href, '_blank');
                  return true;
                }
              } else {
                event.preventDefault();
                window.open(link.href, '_blank');
                return true;
              }
            }
            // --- COMMENT LOGIC ---
            // If the Twitter logic didn't claim the event, delegate to handleCommentClick.
            // We must return its result so Tiptap knows if the comment click was handled.
            if (handleCommentClick) {
              return handleCommentClick(view, pos, event);
            }

            return false;
          },
          // `...DdocEditorProps` above already sets `attributes` as ONE key
          // inside this same object literal — a later `attributes:` key
          // replaces the earlier one wholesale rather than merging, so this
          // must build on the same merged value (TAB_EDITOR_ATTRIBUTES, see
          // above) instead of introducing a colliding fresh literal.
          // data-schema-version lets CSS target one schema (v1 keeps the
          // dBlock-era compensation rules, v2 gets its own rhythm).
          attributes: {
            ...TAB_EDITOR_ATTRIBUTES,
            'data-schema-version': String(docSchemaVersion),
          },
        },
        textDirection: 'auto',
        autofocus: shouldAutofocus ? 'start' : false,
      });

      isInitialEditorCreation.current = false;
      return createdEditor;
    },
    [
      buildExtensionsForTab,
      focusSubmittedSuggestionFromEditorEvent,
      handleCommentClick,
      handleCommentInteraction,
      docSchemaVersion,
    ],
  );

  const isCollaborationEnabled = useMemo(() => {
    return collabEnabled;
  }, [collabEnabled]);

  // The editor stays editable while the collab server merges updates in the
  // background — local edits are queued and CRDT-merged on sync, so freezing is
  // unnecessary. Only preview mode (outside suggestion mode) blocks editing.
  const readyState = useMemo(() => {
    if (isPreviewMode && !isSuggestionMode) return false;
    return true;
  }, [isPreviewMode, isSuggestionMode]);

  const destroyTabEditor = useCallback((targetEditor: Editor) => {
    clearTableOfContentsStorage(targetEditor);
    destroyEditorWithYSyncCleanup(targetEditor);
    clearTableOfContentsStorage(targetEditor);
  }, []);

  const { editor, cachedEditorEntries } = useTabEditorCache({
    activeTabId,
    tabIds,
    activeTabIdRef,
    activeEditorRef,
    editorRef,
    readyState,
    createEditorForTab,
    destroyEditor: destroyTabEditor,
  });

  // TODO: to see why this is necessary
  useEffect(() => {
    if (editor) {
      isInitialEditorCreation.current = false;
    }
  }, [editor]);

  // Toggle a data attribute on the editor root so CSS can suppress the
  // "Type / to browse options" placeholder (and others) in suggestion mode.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // editor.view is lazily attached — guard against accessing before mount
    const dom = editor.view?.dom;
    if (!dom) return;
    if (isSuggestionMode) {
      dom.setAttribute('data-suggestion-mode', 'true');
    } else {
      dom.removeAttribute('data-suggestion-mode');
    }
  }, [editor, isSuggestionMode]);

  // Fix for TableOfContents not updating in Tiptap v3, but keep the refresh
  // scoped to heading transactions so paragraph typing does not churn ToC DOM.
  const tocDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tocIdleTaskRef = useRef<ScheduledIdleTask>(null);
  const tocRefreshRequestIdRef = useRef(0);
  const lastHeadingSignatureRef = useRef('');

  const scheduleActiveTableOfContentsRefresh = useCallback(
    (delayMs: number) => {
      if (!editor || editor.isDestroyed) return;

      if (tocDebounceRef.current) {
        clearTimeout(tocDebounceRef.current);
      }

      tocDebounceRef.current = setTimeout(() => {
        tocDebounceRef.current = null;
        const requestId = ++tocRefreshRequestIdRef.current;
        cancelIdleTask(tocIdleTaskRef.current);

        tocIdleTaskRef.current = scheduleIdleTask(() => {
          tocIdleTaskRef.current = null;
          if (
            requestId === tocRefreshRequestIdRef.current &&
            activeEditorRef.current === editor &&
            !editor.isDestroyed
          ) {
            editor.commands.updateTableOfContents();
          }
        });
      }, delayMs);
    },
    [editor],
  );

  useEffect(() => {
    if (!editor) return;

    lastHeadingSignatureRef.current = getHeadingSignature(editor.state.doc);
    scheduleActiveTableOfContentsRefresh(0);

    const handleTransaction = ({
      transaction,
    }: {
      transaction: Transaction;
    }) => {
      if (
        activeEditorRef.current !== editor ||
        !transactionCouldTouchHeading(transaction)
      ) {
        return;
      }

      const headingSignature = getHeadingSignature(transaction.doc);
      if (headingSignature !== lastHeadingSignatureRef.current) {
        lastHeadingSignatureRef.current = headingSignature;
        scheduleActiveTableOfContentsRefresh(300);
      }
    };

    editor.on('transaction', handleTransaction);

    return () => {
      editor.off('transaction', handleTransaction);
      if (tocDebounceRef.current) {
        clearTimeout(tocDebounceRef.current);
      }
      cancelIdleTask(tocIdleTaskRef.current);
      tocIdleTaskRef.current = null;
      tocRefreshRequestIdRef.current += 1;
    };
  }, [editor, scheduleActiveTableOfContentsRefresh]);

  // In preview mode the editor is non-editable so the browser natively
  // follows <a target="_blank">.  ProseMirror's handleClick pipeline
  // bails out early when !view.editable, so we need a DOM-level capture
  // listener to intercept fragment links and scroll instead.
  useEffect(() => {
    if (!isPreviewMode) return;

    const handler = (event: MouseEvent) => {
      const target = getInlineCommentEventTarget(event.target);
      const activeEditorRoot = activeEditorRef.current?.view.dom;
      if (!activeEditorRoot || !target || !activeEditorRoot.contains(target)) {
        return;
      }
      const link = target.closest<HTMLAnchorElement>('a');
      if (!link?.href) return;

      try {
        const url = new URL(link.href, window.location.href);
        if (!url.hash || url.origin !== window.location.origin) return;

        const hash = decodeURIComponent(url.hash.slice(1));
        const params = new URLSearchParams(hash);
        const headingParam = params.get('heading');
        if (!headingParam) return;

        const id = headingParam.split('-').pop();
        if (id) {
          const el = Array.from(
            activeEditorRoot.querySelectorAll('[data-toc-id]'),
          ).find((node) => (node as HTMLElement).dataset.tocId?.includes(id));
          if (el) {
            event.preventDefault();
            event.stopPropagation();
            const scrollContainer = getEditorScrollContainer({
              targetElement: el as HTMLElement,
              editorRoot: activeEditorRoot,
            });
            if (scrollContainer) {
              requestAnimationFrame(() => {
                const containerRect = scrollContainer.getBoundingClientRect();
                const elementRect = (el as HTMLElement).getBoundingClientRect();
                scrollContainer.scrollBy({
                  top: elementRect.top - containerRect.top,
                  behavior: 'smooth',
                });
              });
            }
            return;
          }
        }
        // Heading not found in current doc — let browser navigate
      } catch {
        // invalid URL — let browser handle
      }
    };

    document.addEventListener('click', handler, true);
    return () => document.removeEventListener('click', handler, true);
  }, [isPreviewMode]);

  useEffect(() => {
    if (!isCollaborationEnabled) return;
    setIsCollabContentLoading(!isReady && !hasCollabContentInitialised);
  }, [isCollaborationEnabled, isReady, hasCollabContentInitialised]);

  // ----- Intitalise and handle content from consumer app -----

  const initialContentSetRef = useRef(false);
  const versionHydrationKeyRef = useRef<string | null>(null);

  const mergeAndApplyUpdate = useCallback(
    (contents: string[]) => {
      const parsed = contents.map((content) => toUint8Array(content));
      Y.applyUpdate(ydoc, Y.mergeUpdates(parsed), 'self');
    },
    [ydoc],
  );

  const isContentYjsEncoded = useCallback(
    (content: string[] | JSONContent | string | null) =>
      Array.isArray(content) ||
      (typeof content === 'string' && !isJSONString(content)),
    [],
  );

  useEffect(() => {
    if (!editor || !ydoc) {
      return;
    }

    if (initialContent === null) {
      setIsContentLoading(true);
      return;
    }

    if (isVersionMode && hasTabState && !activeTabId) {
      setIsContentLoading(true);
      return;
    }

    const targetField = activeTabId || 'default';
    const hydrationKey = `${versionId || 'no-version-id'}:${targetField}`;

    if (!isVersionMode && initialContentSetRef.current) {
      setIsContentLoading(false);
      return;
    }

    if (isVersionMode && versionHydrationKeyRef.current === hydrationKey) {
      setIsContentLoading(false);
      return;
    }

    setIsContentLoading(true);
    queueMicrotask(() => {
      if (initialContent !== '' && initialContent !== undefined) {
        const isYjsEncoded = isContentYjsEncoded(initialContent as string);
        if (isYjsEncoded) {
          if (Array.isArray(initialContent)) {
            mergeAndApplyUpdate(initialContent);
          } else {
            Y.applyUpdate(ydoc, toUint8Array(initialContent as string), 'self');
          }
        } else {
          editor.commands.setContent(
            sanitizeContent({
              data: initialContent as JSONContent,
              ignoreCorruptedData,
              onInvalidContentError,
              wrapInDBlock: Boolean(editor.schema.nodes.dBlock),
            }),
          );
        }
      }

      if (zoomLevel) {
        zoomService.setZoom(zoomLevel);
      }
      if (isVersionMode) {
        versionHydrationKeyRef.current = hydrationKey;
        setIsContentLoading(false);
        return;
      }

      // IndexedDB persistence should not block first paint when initial
      // content, or existing Yjs content, is already available.
      const shouldWaitForIndexedDbBeforeShowingContent =
        initialContent === undefined && editor.isEmpty;

      if (!shouldWaitForIndexedDbBeforeShowingContent) {
        setIsContentLoading(false);
      }

      initialiseYjsIndexedDbProvider()
        .catch(() => {
          // Errors are reported by initialiseYjsIndexedDbProvider.
        })
        .finally(() => {
          if (shouldWaitForIndexedDbBeforeShowingContent) {
            setIsContentLoading(false);
          }
        });
    });
    initialContentSetRef.current = true;
  }, [
    initialContent,
    collabEnabled,
    editor,
    ydoc,
    zoomLevel,
    isVersionMode,
    hasTabState,
    activeTabId,
    versionId,
    setIsContentLoading,
    ignoreCorruptedData,
    onInvalidContentError,
    mergeAndApplyUpdate,
    isContentYjsEncoded,
    initialiseYjsIndexedDbProvider,
  ]);

  const collaborationCleanupRef = useRef<() => void>(() => {});
  const ref = useRef<HTMLDivElement>(null);

  // Keep the socket warm this long after the last local edit before idle-disconnecting
  // a durability-only doc. Live-collab docs (livePresence) never idle-disconnect.
  const COLLAB_WARM_MS = 30_000;
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSocketConnectedRef = useRef(false);

  useExtensionSyncWithCollaboration({
    editor,
    isReady,
    awareness,
    collaboration,
    collaborationCleanupRef,
  });

  // ZOOM handler
  useEffect(() => {
    if (!zoomLevel) return;

    zoomService.setZoom(zoomLevel);

    const timeoutId = window.setTimeout(() => {
      zoomService.setZoom(zoomLevel);
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [zoomLevel, isContentLoading, initialContent, editor?.isEmpty]);

  // FOR REAL TIME TEXT STYLE CLEANUP WHEN PASTING
  useEffect(() => {
    if (!editor) return;

    const handlePaste = ({ editor: pasteEditor }: { editor: any }) => {
      const from = pasteEditor.state.selection.from;

      setTimeout(() => {
        const to = pasteEditor.state.selection.from;

        // Get all marks in the pasted content
        const marks: { from: number; to: number; mark: any }[] = [];
        pasteEditor.state.doc.nodesBetween(
          from,
          to,
          (node: any, pos: number) => {
            if (node.marks) {
              node.marks.forEach((mark: any) => {
                if (mark.type.name === 'textStyle' && mark.attrs.color) {
                  marks.push({
                    from: pos,
                    to: pos + node.nodeSize,
                    mark,
                  });
                }
              });
            }
          },
        );

        // First, only remove color attribute from text styles
        pasteEditor
          .chain()
          .setTextSelection({ from, to })
          .setColor('') // This removes only the color attribute
          .run();

        // Then, restore colors that aren't black/white shades
        marks.forEach(({ from: markFrom, to: markTo, mark }) => {
          const color = mark.attrs.color;
          if (!isBlackOrWhiteShade(color)) {
            pasteEditor
              .chain()
              .setTextSelection({ from: markFrom, to: markTo })
              .setColor(color)
              .run();
          }
        });

        // Restore cursor position to end of paste
        pasteEditor.commands.setTextSelection(to);
      }, 0);
    };

    editor.on('paste', handlePaste);

    return () => {
      editor.off('paste', handlePaste);
    };
  }, [editor]);

  // Footer stats handler
  const statsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageCountIdleTaskRef = useRef<ScheduledIdleTask>(null);
  const pageCountRequestIdRef = useRef(0);
  const pageCounterRef = useRef<ReturnType<typeof createPageCounter> | null>(
    null,
  );
  const lastPageCountByTabRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!setPageCount) {
      return;
    }

    // Keep the measurement iframe scoped to this mounted hook instance, else
    // separate editor mounts can clobber the same hidden measurement surface.
    const pageCounter = createPageCounter();
    pageCounterRef.current = pageCounter;

    return () => {
      if (pageCounterRef.current === pageCounter) {
        pageCounterRef.current = null;
      }
      pageCounter.destroy();
    };
  }, [setPageCount]);

  useEffect(() => {
    if (!editor) return;
    if (
      !setCharacterCount &&
      !setWordCount &&
      !setSelectedWordCount &&
      !setPageCount
    )
      return;

    const updateSelectedWordCount = () => {
      if (
        !setSelectedWordCount ||
        activeEditorRef.current !== editor ||
        editor.isDestroyed
      ) {
        return;
      }

      const { from, to, empty } = editor.state.selection;
      if (empty) {
        setSelectedWordCount(0);
        return;
      }

      // ' ' separators match Tiptap CharacterCount's default whitespace word counting
      const text = editor.state.doc.textBetween(from, to, ' ', ' ');
      const words = text.split(' ').filter((word) => word !== '').length;
      setSelectedWordCount(words);
    };

    const updateCounts = () => {
      if (statsDebounceRef.current) {
        clearTimeout(statsDebounceRef.current);
      }

      statsDebounceRef.current = setTimeout(() => {
        statsDebounceRef.current = null;

        if (
          editor &&
          activeEditorRef.current === editor &&
          !editor.isDestroyed
        ) {
          setCharacterCount?.(editor.storage.characterCount.characters() ?? 0);
          setWordCount?.(editor.storage.characterCount.words() ?? 0);

          if (setPageCount) {
            const pageCounter = pageCounterRef.current;

            if (!pageCounter) {
              return;
            }

            const requestId = ++pageCountRequestIdRef.current;
            // Cancel the queued estimate before scheduling a new one, else
            // slower stale HTML can win after a newer edit.
            cancelIdleTask(pageCountIdleTaskRef.current);
            // Push page counting off the typing path, else measurement work
            // competes with input responsiveness.
            pageCountIdleTaskRef.current = scheduleIdleTask(() => {
              pageCountIdleTaskRef.current = null;
              if (
                requestId !== pageCountRequestIdRef.current ||
                activeEditorRef.current !== editor ||
                editor.isDestroyed
              ) {
                return;
              }

              const html = editor.getHTML();

              pageCounter
                .getPageCount(html)
                .then((pageCount) => {
                  if (
                    requestId === pageCountRequestIdRef.current &&
                    activeEditorRef.current === editor &&
                    editor &&
                    !editor.isDestroyed
                  ) {
                    lastPageCountByTabRef.current[activeTabId] = pageCount;
                    setPageCount(pageCount);
                  }
                })
                .catch(() => {
                  if (
                    requestId === pageCountRequestIdRef.current &&
                    activeEditorRef.current === editor &&
                    editor &&
                    !editor.isDestroyed
                  ) {
                    // Reuse the last good count for this tab, else transient
                    // measurement failures collapse the footer back to 1.
                    setPageCount(
                      lastPageCountByTabRef.current[activeTabId] ?? 1,
                    );
                  }
                });
            });
          }
        }
      }, 500);
    };

    // Initial count
    updateCounts();
    updateSelectedWordCount();
    editor.on('update', updateCounts);
    editor.on('selectionUpdate', updateSelectedWordCount);

    return () => {
      editor.off('update', updateCounts);
      editor.off('selectionUpdate', updateSelectedWordCount);
      if (statsDebounceRef.current) {
        clearTimeout(statsDebounceRef.current);
      }
      cancelIdleTask(pageCountIdleTaskRef.current);
      pageCountIdleTaskRef.current = null;
      pageCountRequestIdRef.current += 1;
    };
  }, [
    activeTabId,
    editor,
    setCharacterCount,
    setPageCount,
    setWordCount,
    setSelectedWordCount,
  ]);

  // Print shortcut handler
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'p') {
        event.preventDefault();
        if (editor) {
          isPresentationMode
            ? handlePrint(slides)
            : handleContentPrint(editor.getHTML());
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, isPresentationMode, slides]);

  // Collaboration hybrid connect controller — connect-and-stay while
  // livePresence/connectOnOpen holds; otherwise lazy connect-on-edit with a warm window.
  useEffect(() => {
    if (!collabEnabled || !connection) return;

    const keepAlive =
      connection.livePresence === true || connection.connectOnOpen === true;

    const doConnect = () => {
      if (isSocketConnectedRef.current) return;
      isSocketConnectedRef.current = true;
      onConnect(connection);
    };
    const doDisconnect = () => {
      if (!isSocketConnectedRef.current) return;
      isSocketConnectedRef.current = false;
      onDisconnect();
    };
    const armIdle = () => {
      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
      warmTimerRef.current = setTimeout(() => {
        warmTimerRef.current = null;
        if (
          connection.livePresence !== true &&
          connection.connectOnOpen !== true
        ) {
          doDisconnect();
        }
      }, COLLAB_WARM_MS);
    };

    if (keepAlive) {
      doConnect();
    }

    // Lazy path: connect on the first qualifying local edit, then keep warm.
    const onEdit = (_update: Uint8Array, origin: unknown) => {
      if (origin === 'self' || origin === 'remote' || !isIndexeddbSynced)
        return;
      doConnect();
      armIdle();
    };
    ydoc?.on('update', onEdit);

    return () => {
      ydoc?.off('update', onEdit);
      if (warmTimerRef.current) {
        clearTimeout(warmTimerRef.current);
        warmTimerRef.current = null;
      }
    };
  }, [
    collabEnabled,
    connection?.roomKey,
    connection?.roomId,
    connection?.wsUrl,
    connection?.livePresence,
    connection?.connectOnOpen,
    ydoc,
    onConnect,
    onDisconnect,
    isIndexeddbSynced,
  ]);

  // Scroll to heading handler for preview mode
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.substring(1)
    : window.location.hash;
  const { isNativeMobile } = useResponsive();

  const hashParams = new URLSearchParams(hash);
  const heading = hashParams.get('heading');
  const headingId = heading?.split('-').pop();
  const scrollToHeading = useCallback(
    (headingId: string) => {
      if (!editor) return;

      try {
        const allHeadings = editor.view.dom.querySelectorAll('[data-toc-id]');
        const element = Array.from(allHeadings).find((el) =>
          (el as HTMLElement).dataset.tocId?.includes(headingId),
        );

        if (!element) return;

        const currentHeadingText = headingToSlug(
          element?.textContent as string,
        );
        const urlHeadingText = heading?.split('-').slice(0, -1).join('-');
        if (currentHeadingText !== urlHeadingText) {
          hashParams.set('heading', `${currentHeadingText}-${headingId}`);
          window.location.hash = hashParams.toString();
        }

        const pos = editor.view.posAtDOM(element as Node, 0);

        // set focus
        const tr = editor.view.state.tr;
        tr.setSelection(new TextSelection(tr.doc.resolve(pos)));
        editor.view.dispatch(tr);

        const scrollContainer = getEditorScrollContainer({
          targetElement: element as HTMLElement,
          editorRoot: editor.view.dom as HTMLElement,
        });
        if (scrollContainer) {
          // Use requestAnimationFrame to ensure DOM updates are complete
          requestAnimationFrame(() => {
            const containerRect = scrollContainer.getBoundingClientRect();
            const elementRect = (
              element as HTMLElement
            ).getBoundingClientRect();

            // Calculate the scroll position to start the element at the top of the container
            const scrollTop =
              elementRect.top -
              containerRect.top -
              containerRect.height / (isNativeMobile ? 5 : 7) +
              elementRect.height / (isNativeMobile ? 5 : 7);

            scrollContainer.scrollBy({
              top: scrollTop,
              behavior: 'smooth',
            });
          });
        }
      } catch (error) {
        // View not ready, skip
        return;
      }
    },
    [editor, isNativeMobile],
  );

  useEffect(() => {
    if (!isPreviewMode || !headingId || isContentLoading) return;
    setTimeout(() => {
      scrollToHeading(headingId);
    }, 100);
  }, [
    editor,
    isPreviewMode,
    isNativeMobile,
    headingId,
    isContentLoading,
    scrollToHeading,
  ]);

  // FOR AUTO TEXT STYLE CLEANUP WHEN DOCUMENT IS RENDERED
  useEffect(() => {
    // Exit if editor not ready, content loading.
    if (!editor || isContentLoading || !initialContent) {
      return;
    }
    const timeoutId = setTimeout(() => {
      const { tr, doc } = editor.state;
      let hasChanges = false;

      doc.descendants((node, pos) => {
        if (!node.marks || node.marks.length === 0) return;

        const textStyleMark = node.marks.find(
          (m) => m.type.name === 'textStyle' && m.attrs.color,
        );

        if (!textStyleMark) return;

        const originalColor = (textStyleMark.attrs['data-original-color'] ||
          textStyleMark.attrs.color) as string;

        if (
          originalColor.startsWith('var(--color-editor-') ||
          originalColor === 'inherit'
        )
          return;

        const responsiveColor = getResponsiveColor(originalColor, theme);

        if (responsiveColor !== textStyleMark.attrs.color) {
          hasChanges = true;
          const newMark = textStyleMark.type.create({
            ...textStyleMark.attrs,
            color: responsiveColor,
            'data-original-color': originalColor,
          });

          tr.removeMark(pos, pos + node.nodeSize, textStyleMark);
          tr.addMark(pos, pos + node.nodeSize, newMark);
        }
      });

      if (hasChanges) {
        tr.setMeta('addToHistory', false);
        editor.view.dispatch(tr);
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [editor, initialContent, isContentLoading, theme]);

  useDarkModeStyleCleanup(editor, initialContent, false);

  const previousActiveDecorationCommentIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }

    if (previousActiveDecorationCommentIdRef.current === activeCommentId) {
      return;
    }

    previousActiveDecorationCommentIdRef.current = activeCommentId;
    // Active-thread styling also lives in the decoration layer, so rebuild
    // when React-owned activeCommentId changes outside doc transactions.
    triggerDecorationRebuild(editor);
  }, [activeCommentId, editor]);

  return {
    editor,
    cachedEditorEntries,
    ref,
    slides,
    setSlides,
    tocItems,
    setTocItems,
    activeCommentId,
    setActiveCommentId,
    focusCommentWithActiveId,
    isContentLoading,
    commentAnchorsRef,
    draftAnchorsRef,
    storeApiRef,
  };
};

const useActiveComment = () => {
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const commentsSectionRef = useRef<HTMLDivElement | null>(null);

  const focusCommentWithActiveId = useCallback((id: string) => {
    if (!commentsSectionRef.current) return;

    const commentInput =
      commentsSectionRef.current.querySelector<HTMLInputElement>(`input#${id}`);

    if (!commentInput) return;

    commentInput.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'center',
    });
  }, []);

  useEffect(() => {
    if (!activeCommentId) return;
    focusCommentWithActiveId(activeCommentId);
  }, [activeCommentId, focusCommentWithActiveId]);

  return {
    activeCommentId,
    setActiveCommentId,
    focusCommentWithActiveId,
  };
};

const useTocState = (activeTabId: string) => {
  const [tocItems, setTocItems] = useState<ToCItemType[]>([]);
  const tocUpdateTimeoutRef = useRef<number | null>(null);
  const tabToTocCacheRef = useRef<Record<string, ToCItemType[]>>({});
  const activeTabRef = useRef(activeTabId);

  // immediately render TOC from cache if available on switching tabs
  useEffect(() => {
    activeTabRef.current = activeTabId;
    const cached = tabToTocCacheRef.current[activeTabId];
    setTocItems(cached ?? []);
  }, [activeTabId]);

  const handleTocUpdateForTab = useCallback(
    (
      targetTabId: string,
      data: ToCItemType[],
      isCreate: boolean | undefined,
    ) => {
      const cacheUpdate = () => {
        tabToTocCacheRef.current = {
          ...tabToTocCacheRef.current,
          [targetTabId]: data,
        };
        if (activeTabRef.current === targetTabId) {
          setTocItems(data);
        }
      };

      if (isCreate) {
        cacheUpdate();
        return;
      }

      if (tocUpdateTimeoutRef.current) {
        clearTimeout(tocUpdateTimeoutRef.current);
      }

      requestAnimationFrame(() => {
        tocUpdateTimeoutRef.current = window.setTimeout(() => {
          cacheUpdate();
          tocUpdateTimeoutRef.current = null;
        }, 100);
      });
    },
    [],
  );

  useEffect(() => {
    return () => {
      if (tocUpdateTimeoutRef.current) {
        clearTimeout(tocUpdateTimeoutRef.current);
      }
    };
  }, []);

  return {
    tocItems,
    setTocItems,
    handleTocUpdateForTab,
  };
};

interface UseExtensionStackArgs {
  ydoc: Y.Doc;
  onError?: (error: string) => void;
  ipfsImageUploadFn?: DdocProps['ipfsImageUploadFn'];
  metadataProxyUrl?: string;
  onCopyHeadingLink?: DdocProps['onCopyHeadingLink'];
  ipfsImageFetchFn?: DdocProps['ipfsImageFetchFn'];
  fetchV1ImageFn?: DdocProps['fetchV1ImageFn'];
  enableCollaboration?: boolean;
  isConnected: DdocProps['isConnected'];
  disableInlineComment?: boolean;
  activeModel?: DdocProps['activeModel'];
  maxTokens?: number;
  isAIAgentEnabled?: boolean;
  hasAvailableModels: boolean;
  activeCommentId: string | null;
  onCommentActivated: (tabId: string, commentId: string) => void;
  onTocUpdateForTab: (
    tabId: string,
    data: ToCItemType[],
    isCreate: boolean | undefined,
  ) => void;
  externalExtensions?: Record<string, AnyExtension>;
  initialCommentAnchors?: SerializedCommentAnchor[];
  isSuggestionMode?: boolean;
  dBlockRuntimeStateRef: DBlockRuntimeStateRef;
  docSchemaVersion?: number;
}

const useEditorExtension = ({
  ydoc,
  onError,
  ipfsImageUploadFn,
  metadataProxyUrl,
  onCopyHeadingLink,
  ipfsImageFetchFn,
  fetchV1ImageFn,
  enableCollaboration,
  disableInlineComment,
  isConnected,
  activeModel,
  maxTokens,
  hasAvailableModels,
  activeCommentId,
  onCommentActivated,
  onTocUpdateForTab,
  externalExtensions,
  initialCommentAnchors,
  isSuggestionMode = false,
  dBlockRuntimeStateRef,
  docSchemaVersion = 1,
}: UseExtensionStackArgs) => {
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onCopyHeadingLinkRef = useRef(onCopyHeadingLink);
  onCopyHeadingLinkRef.current = onCopyHeadingLink;
  const handleExtensionError = useCallback((error: string) => {
    onErrorRef.current?.(error);
  }, []);
  const handleCopyHeadingLink = useCallback((link: string) => {
    onCopyHeadingLinkRef.current?.(link);
  }, []);
  const slashCommandConfigRef = useRef({
    isConnected,
    enableCollaboration,
    disableInlineComment,
  });

  useEffect(() => {
    slashCommandConfigRef.current = {
      isConnected,
      enableCollaboration,
      disableInlineComment,
    };
  }, [isConnected, enableCollaboration, disableInlineComment]);
  const createSlashCommand = useCallback(
    () =>
      SlashCommand(
        handleExtensionError,
        ipfsImageUploadFn,
        slashCommandConfigRef,
      ),
    [handleExtensionError, ipfsImageUploadFn],
  );

  const initialCommentAnchorsKey = useMemo(
    () => getSerializedCommentAnchorsKey(initialCommentAnchors),
    [initialCommentAnchors],
  );
  const initialCommentAnchorState = useMemo(
    () => deserializeCommentAnchors(initialCommentAnchors),
    [initialCommentAnchorsKey],
  );
  // Seed persisted anchors before editor creation so the decoration plugin can
  // render the initial highlight set on first paint.
  const commentAnchorsRef = useRef<CommentAnchor[]>(initialCommentAnchorState);
  // Derived anchors for in-progress suggestion drafts. Maintained by the
  // store's draft actions — decoration layer reads this alongside
  // commentAnchorsRef so drafts and submitted suggestions render identically.
  const draftAnchorsRef = useRef<CommentAnchor[]>([]);
  const activeCommentIdRef = useRef<string | null>(activeCommentId);

  useEffect(() => {
    activeCommentIdRef.current = activeCommentId;
  }, [activeCommentId]);

  // Keep a stable ref to isSuggestionMode so the extension closure always
  // reads the latest value without needing to rebuild extensions.
  const isSuggestionModeRef = useRef(isSuggestionMode);
  isSuggestionModeRef.current = isSuggestionMode;

  // Stable ref to the Zustand store API. The CommentStoreProvider populates
  // this once it creates the store; the SuggestionTrackingExtension reads it
  // lazily inside its event handlers so draft actions route to the store
  // without rebuilding the editor.
  const storeApiRef = useRef<ReturnType<typeof createCommentStore> | null>(
    null,
  );

  const buildExtensionsForTab = useCallback(
    (tabId: string) => {
      const tabCommentExtension = Comment.configure({
        HTMLAttributes: {
          class: 'inline-comment',
        },
        onCommentActivated: (commentId: string) =>
          onCommentActivated(tabId, commentId),
      });

      const coreExtensions: AnyExtension[] = [
        ...defaultExtensions({
          onError: handleExtensionError,
          ipfsImageUploadFn,
          metadataProxyUrl,
          onCopyHeadingLink: handleCopyHeadingLink,
          ipfsImageFetchFn,
          fetchV1ImageFn,
          onTocUpdate: (data, isCreate) =>
            onTocUpdateForTab(tabId, data, isCreate),
          hasAvailableModels,
          dBlockRuntimeStateRef,
          schemaVersion: docSchemaVersion,
        }),
        createSlashCommand(),
        customTextInputRules,
        PageBreak,
        tabCommentExtension,
        Collaboration.configure({
          document: ydoc,
          field: tabId,
        }),
        CommentDecorationExtension.configure({
          getAnchors: () => [
            ...commentAnchorsRef.current,
            ...draftAnchorsRef.current,
          ],
          getActiveCommentId: () => activeCommentIdRef.current,
        }),
        SuggestionTrackingExtension.configure({
          getIsSuggestionMode: () => isSuggestionModeRef.current,
          onTextInput: (text) =>
            storeApiRef.current?.getState().appendToDraftAtCursor(text),
          onReplaceTyping: (from, to, text) => {
            const state = storeApiRef.current?.getState();
            if (!state) return;
            state.startDeleteDraft(from, to);
            state.appendToDraftAtCursor(text);
          },
          onDeleteSelection: (from, to) =>
            storeApiRef.current?.getState().startDeleteDraft(from, to),
          onPasteLink: (from, to, href) =>
            storeApiRef.current?.getState().startLinkDraft(from, to, href),
          onUnsupportedPaste: () =>
            toast({
              title:
                'Suggestion mode only supports single-line plain text paste.',
              toastType: 'mini',
            }),
          onDeleteAtCursor: (direction) =>
            storeApiRef.current
              ?.getState()
              .deleteAtCursorOrUndoActiveDraft(direction),
          onDeleteRangeWithoutSelection: (from, to) =>
            storeApiRef.current
              ?.getState()
              .deleteRangeOrUndoActiveDraft(from, to),
          onUndo: () =>
            storeApiRef.current?.getState().undoLastKeystrokeInActiveDraft(),
        }),
        ...(externalExtensions
          ? (Object.values(externalExtensions) as AnyExtension[])
          : []),
      ] as AnyExtension[];

      if (!activeModel) {
        return coreExtensions;
      }

      return [
        ...coreExtensions.filter(
          (ext) =>
            ext.name !== 'aiAutocomplete' &&
            ext.name !== 'aiWriter' &&
            ext.name !== 'dBlock' &&
            ext.name !== 'slash-command',
        ),
        AiAutocomplete.configure({
          model: activeModel,
          endpoint: activeModel.endpoint,
          maxTokens: maxTokens,
          temperature: 0.1,
          tone: 'neutral',
        }),
        AIWriter,
        // v2 has no dBlock: the filter above removed nothing, re-add nothing.
        ...(docSchemaVersion >= 2
          ? []
          : [
              createDBlockExtension({
                hasAvailableModels,
                ipfsImageUploadFn,
                onCopyHeadingLink: handleCopyHeadingLink,
                getRuntimeState: () => dBlockRuntimeStateRef.current,
              }),
            ]),
        createSlashCommand(),
      ] as AnyExtension[];
    },
    [
      ipfsImageUploadFn,
      metadataProxyUrl,
      handleExtensionError,
      handleCopyHeadingLink,
      ipfsImageFetchFn,
      fetchV1ImageFn,
      onTocUpdateForTab,
      hasAvailableModels,
      dBlockRuntimeStateRef,
      createSlashCommand,
      ydoc,
      externalExtensions,
      activeModel,
      maxTokens,
      onCommentActivated,
      docSchemaVersion,
    ],
  );

  return {
    buildExtensionsForTab,
    commentAnchorsRef,
    draftAnchorsRef,
    storeApiRef,
  };
};

interface UseCommentInteractionArgs {
  isFocusMode?: boolean;
  onCommentInteraction?: DdocProps['onCommentInteraction'];
}

const useCommentInteraction = ({
  isFocusMode = false,
  onCommentInteraction,
}: UseCommentInteractionArgs) => {
  // `useEditor` is initialized with explicit deps, so these DOM handlers won't
  // be refreshed just because focus mode toggles. Keep the latest values in
  // refs so comment behavior updates without rebuilding the editor instance.
  const isFocusModeRef = useRef(isFocusMode);
  const onCommentInteractionRef = useRef(onCommentInteraction);

  useEffect(() => {
    isFocusModeRef.current = isFocusMode;
  }, [isFocusMode]);

  useEffect(() => {
    onCommentInteractionRef.current = onCommentInteraction;
  }, [onCommentInteraction]);

  const isHighlightedYellow = useCallback(
    (state: EditorState, from: number, to: number) => {
      let highlighted = false;
      state.doc.nodesBetween(from, to, (node) => {
        if (
          node.marks &&
          node.marks.some(
            (mark) =>
              mark.type.name === 'highlight' && mark.attrs.color === 'yellow',
          )
        ) {
          highlighted = true;
        }
      });
      return highlighted;
    },
    [],
  );

  const handleCommentInteraction = useCallback(
    (view: EditorView, event: MouseEvent) => {
      if (isFocusModeRef.current) {
        return false;
      }

      const target = event.target as HTMLElement | null;

      if (
        !target ||
        target.nodeName !== 'MARK' ||
        target.dataset.color !== 'yellow'
      ) {
        return false;
      }

      const highlightedText = target.textContent;
      const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });

      if (!pos) return false;

      const { state } = view;
      let from = pos.pos;
      let to = pos.pos;

      state.doc.nodesBetween(from, to, (node, nodePos) => {
        if (node.marks && node.marks.length) {
          node.marks.forEach((mark) => {
            if (mark.type.name === 'highlight') {
              from = nodePos;
              to = nodePos + node.nodeSize;
            }
          });
        }
      });

      if (from === to) return false;

      const data = {
        text: highlightedText,
        from,
        to,
        isHighlightedYellow: isHighlightedYellow(state, from, to),
      };
      onCommentInteractionRef.current?.(data);

      return false;
    },
    [isHighlightedYellow],
  );

  const handleCommentClick = useCallback(
    (view: EditorView, _pos: number, event: MouseEvent) => {
      return handleCommentInteraction(view, event);
    },
    [handleCommentInteraction],
  );

  return { handleCommentInteraction, handleCommentClick };
};

interface UseExtensionSyncWithCollaborationArgs {
  editor?: Editor | null;
  isReady?: boolean;
  awareness?: any;
  collaboration?: CollaborationProps;
  collaborationCleanupRef: MutableRefObject<() => void>;
}

const useExtensionSyncWithCollaboration = ({
  editor,
  isReady,
  awareness,
  collaboration,
  collaborationCleanupRef,
}: UseExtensionSyncWithCollaborationArgs) => {
  const collabEnabled = collaboration?.enabled === true;
  const session = collabEnabled ? collaboration.session : null;

  const userColorRef = useRef(
    usercolors[Math.floor(Math.random() * usercolors.length)],
  );
  // Register collaboration cursor plugin directly via editor.registerPlugin
  // instead of setExtensions, which would destroy and recreate the editor (causing scroll jump)
  useEffect(() => {
    if (!collabEnabled || !editor || !awareness || !isReady) return;

    const user = {
      name: session?.username || '',
      color: userColorRef.current,
      isEns: session?.isEns,
    };

    awareness.setLocalStateField('user', user);

    const originalPlugin = yCursorPlugin(awareness, {
      cursorBuilder: getCursor,
    });
    // Track last known cursor positions per client to avoid unnecessary
    // decoration recreation (which causes cursor DOM flicker).
    let lastCursorSnapshot = '';
    const getCursorSnapshot = () => {
      const parts: string[] = [];
      awareness.getStates().forEach((state: any, clientId: number) => {
        if (clientId === awareness.clientID) return;
        const cursor = state.cursor;
        if (cursor) {
          parts.push(`${clientId}:${JSON.stringify(cursor)}`);
        }
      });
      return parts.sort().join('|');
    };
    // Patch apply: only recreate decorations when remote cursor positions
    // actually changed. Content-only changes and awareness updates that
    // don't affect cursor positions just remap existing decorations,
    // preserving the cursor DOM and preventing flicker.
    const plugin = new Plugin({
      key: yCursorPluginKey,
      state: {
        init: originalPlugin.spec.state!.init,
        apply(tr, prevState, oldState, newState) {
          const yCursorState = tr.getMeta(yCursorPluginKey);
          if (yCursorState && yCursorState.awarenessUpdated) {
            const snapshot = getCursorSnapshot();
            if (snapshot !== lastCursorSnapshot) {
              lastCursorSnapshot = snapshot;
              return originalPlugin.spec.state!.apply!(
                tr,
                prevState,
                oldState,
                newState,
              );
            }
          }
          return prevState.map(tr.mapping, tr.doc);
        },
      },
      props: originalPlugin.spec.props,
      view: originalPlugin.spec.view,
    });
    editor.registerPlugin(plugin);

    collaborationCleanupRef.current = () => {
      if (!editor.isDestroyed) {
        editor.unregisterPlugin(yCursorPluginKey);
      }
    };

    return () => {
      collaborationCleanupRef.current();
      collaborationCleanupRef.current = () => {};
    };
  }, [collabEnabled, editor, awareness, isReady]);

  // Awareness update — separate effect watches session metadata (e.g. ENS resolution)
  useEffect(() => {
    if (!isReady || !collabEnabled || !awareness || !session) return;
    if (session.isEns) {
      awareness.setLocalStateField('user', {
        name: session.username,
        color: userColorRef.current,
        isEns: session.isEns,
      });
    }
  }, [isReady, collabEnabled, session?.username, session?.isEns, awareness]);
};

const useDarkModeStyleCleanup = (
  editor?: Editor | null,
  initialContent?: string | JSONContent | string[] | null,
  isContentLoading?: boolean,
) => {
  const isDarkMode = useRef(localStorage.getItem('theme') !== null);
  const cleanupDone = useRef(false);

  useEffect(() => {
    if (
      !editor ||
      isContentLoading ||
      !isDarkMode.current ||
      cleanupDone.current
    ) {
      return;
    }

    if (!initialContent) {
      cleanupDone.current = true;
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (!editor) return;

      const { from, to } = editor.state.selection;
      const marks: { from: number; to: number; mark: any }[] = [];

      editor.state.doc.descendants((node, pos) => {
        if (node.marks) {
          node.marks.forEach((mark) => {
            if (mark.type.name === 'textStyle' && mark.attrs.color) {
              marks.push({
                from: pos,
                to: pos + node.nodeSize,
                mark,
              });
            }
          });
        }
      });

      if (marks.length > 0) {
        editor.chain().selectAll().setColor('').run();

        marks.forEach(({ from: markFrom, to: markTo, mark }) => {
          const color = mark.attrs.color;
          if (!isBlackOrWhiteShade(color)) {
            editor
              .chain()
              .setTextSelection({ from: markFrom, to: markTo })
              .setColor(color)
              .run();
          }
        });

        editor.commands.setTextSelection({ from, to });
      }

      cleanupDone.current = true;
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [editor, initialContent, isContentLoading]);
};
