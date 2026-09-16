import { Editor } from '@tiptap/react';
import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from 'react';
import React from 'react';
import {
  CommentAnchor,
  applyAcceptedSuggestion,
  createCommentAnchorFromEditor,
  createCommentAnchorPointFromEditor,
  hasResolvableCommentAnchorInState,
  resolveCommentAnchorPointInState,
  resolveCommentAnchorRangeInState,
  triggerDecorationRebuild,
} from '../extensions/comment/comment-decoration-plugin';
import { SuggestionType } from '../types';
import uuid from 'react-uuid';
import { createStore, useStore } from 'zustand';
import { fromUint8Array } from 'js-base64';
import * as Y from 'yjs';
import { EditorState, TextSelection } from '@tiptap/pm/state';
import {
  CommentFloatingCard,
  CommentFloatingDraftCard,
  CommentFloatingThreadCard,
  EnsCache,
  InlineCommentData,
  InlineCommentDraft,
  InlineDraftLocation,
  SuggestionFloatingDraftCard,
} from '../components/inline-comment/context/types';
import { EnsStatus } from '../components/inline-comment/types';
import { DEFAULT_TAB_ID } from '../components/tabs/utils/tab-utils';
import {
  clearActiveComment,
  getDraftCommentRange,
  IComment,
  setActiveComment,
} from '../extensions/comment';
import { CommentMutationMeta, CommentMutationType } from '../types';
import { getAddressName } from '@fileverse/ens';
import {
  resolveCommentSelectionRange,
  scrollCommentSelectionRangeIntoView,
} from '../utils/comment-scroll-into-view';

export interface CommentExternalDeps {
  editor: Editor | null;
  ydoc: Y.Doc;
  setActiveCommentId: (id: string | null) => void;
  focusCommentWithActiveId: (id: string) => void;
  setInitialComments?: React.Dispatch<React.SetStateAction<IComment[]>>;
  setUsername?: React.Dispatch<React.SetStateAction<string>>;
  onNewComment?: (comment: IComment, meta?: CommentMutationMeta) => void;
  onEditComment?: (commentId: string, meta?: CommentMutationMeta) => void;
  onEditReply?: (
    commentId: string,
    replyId: string,
    meta?: CommentMutationMeta,
  ) => void;
  onCommentReply?: (activeCommentId: string, reply: IComment) => void;
  onResolveComment?: (commentId: string, meta?: CommentMutationMeta) => void;
  onUnresolveComment?: (commentId: string, meta?: CommentMutationMeta) => void;
  onDeleteComment?: (commentId: string, meta?: CommentMutationMeta) => void;
  onDeleteReply?: (commentId: string, replyId: string) => void;
  onInlineComment?: () => void;
  onComment?: () => void;
  setCommentDrawerOpen?: (open: boolean) => void;
  connectViaWallet?: () => Promise<void>;
  connectViaUsername?: (username: string) => Promise<void>;
  ensResolutionUrl: string;
  commentAnchorsRef?: React.MutableRefObject<CommentAnchor[]>;
  refreshCommentAnchorState?: () => void;
  /**
   * Derived anchor list for in-progress suggestion drafts. Maintained by the
   * store (not the consumer) — draft actions upsert into this ref whenever
   * state.drafts changes. The decoration extension reads this ref alongside
   * commentAnchorsRef to render both layers identically.
   */
  draftAnchorsRef?: React.MutableRefObject<CommentAnchor[]>;
}

/**
 * A suggestion draft is the viewer's in-progress proposed edit — kept local
 * until Submit. Drafts live in memory only (lost on refresh). Derived into
 * a CommentAnchor for decoration rendering via deriveDraftAnchor(). Most
 * suggestion types are derived at use time from hadDeletion + insertedText;
 * linkHref marks a link suggestion over the original selected text.
 */
export interface DraftSuggestion {
  id: string;
  anchorFrom: Y.RelativePosition;
  anchorTo: Y.RelativePosition;
  /** The text that was selected at draft creation (for Delete/Replace strikethrough). */
  originalContent: string;
  /** Accumulated text the viewer has typed. Empty for a pure Delete draft. */
  insertedText: string;
  /** Per-keystroke history for undo — each entry is one typed character. */
  keystrokes: string[];
  /** True when the draft was created via select+delete or select+type. */
  hadDeletion: boolean;
  /** Pasted link href for a link suggestion. */
  linkHref?: string;
}

type SuggestionDeleteDirection = 'backward' | 'forward';

export function isRangeDraft(draft: DraftSuggestion): boolean {
  return draft.hadDeletion || Boolean(draft.linkHref);
}

function deriveDraftSuggestionType(draft: DraftSuggestion): SuggestionType {
  if (draft.linkHref) {
    return 'link';
  }
  if (draft.hadDeletion) {
    return draft.insertedText.length > 0 ? 'replace' : 'delete';
  }
  return 'add';
}

function deriveDraftAnchor(draft: DraftSuggestion): CommentAnchor {
  return {
    id: draft.id,
    anchorFrom: draft.anchorFrom,
    anchorTo: draft.anchorTo,
    resolved: false,
    deleted: false,
    isSuggestion: true,
    suggestionType: deriveDraftSuggestionType(draft),
    originalContent: draft.originalContent,
    suggestedContent: draft.linkHref ?? draft.insertedText,
  };
}

function findDraftAtEditorCursor(
  drafts: Record<string, DraftSuggestion>,
  state: EditorState,
): DraftSuggestion | null {
  const { from, to } = state.selection;
  for (const draft of Object.values(drafts)) {
    if (isRangeDraft(draft)) {
      // Delete / Replace / Link draft: cursor must be within [anchorFrom, anchorTo]
      const range = resolveCommentAnchorRangeInState(draft, state);
      if (!range) continue;
      if (from >= range.from && to <= range.to) return draft;
    } else {
      // Add draft: point anchor — cursor must be exactly at the anchor point
      const point = resolveCommentAnchorPointInState(draft, state);
      if (point === null) continue;
      if (from === to && from === point) return draft;
    }
  }
  return null;
}

function resolveDeleteRangeAtCursor(
  state: EditorState,
  direction: SuggestionDeleteDirection,
): { from: number; to: number } | null {
  const { from, empty } = state.selection;
  if (!empty) {
    return null;
  }

  return resolveDeleteRangeAtPosition(state, from, direction);
}

function resolveDeleteRangeAtPosition(
  state: EditorState,
  position: number,
  direction: SuggestionDeleteDirection,
): { from: number; to: number } | null {
  const rangeFrom = direction === 'backward' ? position - 1 : position;
  const rangeTo = direction === 'backward' ? position : position + 1;

  if (
    rangeFrom < 0 ||
    rangeTo > state.doc.content.size ||
    rangeFrom >= rangeTo
  ) {
    return null;
  }

  // Only create delete drafts for real inline text. Structural deletions
  // (block joins, node boundaries, etc.) stay blocked in suggestion mode.
  const deletedText = state.doc.textBetween(rangeFrom, rangeTo, '', '');
  if (!deletedText) {
    return null;
  }

  return { from: rangeFrom, to: rangeTo };
}

function isPureDeleteDraft(draft: DraftSuggestion): boolean {
  return draft.hadDeletion && draft.insertedText.length === 0;
}

type SuggestionDraftStateSetter = (state: {
  drafts: Record<string, DraftSuggestion>;
  floatingCards: CommentFloatingCard[];
  activeSuggestionDraftIdAtCursor?: string | null;
}) => void;

function syncSuggestionDraftState(
  setState: SuggestionDraftStateSetter,
  nextDrafts: Record<string, DraftSuggestion>,
  nextCards: CommentFloatingCard[],
  draftAnchorsRef?: React.MutableRefObject<CommentAnchor[]>,
  activeSuggestionDraftIdAtCursor?: string | null,
) {
  setState({
    drafts: nextDrafts,
    floatingCards: nextCards,
    ...(activeSuggestionDraftIdAtCursor !== undefined
      ? { activeSuggestionDraftIdAtCursor }
      : {}),
  });
  if (draftAnchorsRef) {
    draftAnchorsRef.current = Object.values(nextDrafts).map(deriveDraftAnchor);
  }
}

function getSuggestionDraftIdAtFocusedEditorCursor(
  editor: Editor | null,
  drafts: Record<string, DraftSuggestion>,
): string | null {
  if (!editor) {
    return null;
  }

  try {
    if (!editor.view?.hasFocus()) {
      return null;
    }
  } catch {
    return null;
  }

  return findDraftAtEditorCursor(drafts, editor.state)?.id ?? null;
}

function updateDeleteDraftRange({
  setState,
  drafts,
  floatingCards,
  activeDraft,
  editor,
  draftAnchorsRef,
  from,
  to,
  collapseTo,
}: {
  setState: SuggestionDraftStateSetter;
  drafts: Record<string, DraftSuggestion>;
  floatingCards: CommentFloatingCard[];
  activeDraft: DraftSuggestion;
  editor: Editor;
  draftAnchorsRef?: React.MutableRefObject<CommentAnchor[]>;
  from: number;
  to: number;
  collapseTo: number;
}): boolean {
  const nextAnchorRange = createCommentAnchorFromEditor(editor, from, to);
  if (!nextAnchorRange) return false;

  const nextOriginalContent = editor.state.doc.textBetween(from, to, '\n');
  const nextDraft: DraftSuggestion = {
    ...activeDraft,
    anchorFrom: nextAnchorRange.anchorFrom,
    anchorTo: nextAnchorRange.anchorTo,
    originalContent: nextOriginalContent,
  };
  const nextDrafts = { ...drafts, [activeDraft.id]: nextDraft };
  const nextCards = floatingCards.map((card) =>
    card.type === 'suggestion-draft' && card.suggestionId === activeDraft.id
      ? { ...card, selectedText: nextOriginalContent }
      : card,
  );

  syncSuggestionDraftState(
    setState,
    nextDrafts,
    nextCards,
    draftAnchorsRef,
    activeDraft.id,
  );

  const tr = editor.state.tr.setSelection(
    TextSelection.near(editor.state.doc.resolve(collapseTo)),
  );
  editor.view.dispatch(tr);
  triggerDecorationRebuild(editor);
  return true;
}

type FloatingCardsUpdater = React.SetStateAction<CommentFloatingCard[]>;
type InlineCommentDataUpdater =
  | Partial<InlineCommentData>
  | ((
      prev: InlineCommentData,
    ) => Partial<InlineCommentData> | InlineCommentData);

type InlineDraftRecordMap = Record<string, InlineCommentDraft>;
type CreateInlineDraftOptions = {
  location?: InlineDraftLocation;
  tabId?: string;
  // Only the drawer's explicit "new comment" action may bypass text selection.
  // Do not reuse this for floating comments unless unanchored inline threads
  // become a deliberate product requirement.
  allowEmptySelection?: boolean;
};

type CommentEditRequest = {
  requestId: string;
  kind: 'comment' | 'reply';
  commentId: string;
  replyId?: string;
  text: string;
};

type ReplyEditTarget = {
  // Represents an active edit session (used by the drawer reply input).
  // When set, "Send" should edit the target rather than create a new reply.
  kind: 'comment' | 'reply';
  commentId: string;
  replyId?: string;
  // Captures the original text at the time edit mode started.
  // UIs use this to disable "Send" when the user hasn’t changed anything.
  originalText: string;
};

type CommentEditCompletion = {
  // Broadcast-only signal to clear local edit drafts in other mounted UIs.
  // Drawer uses shared store state, but floating/bubble inputs keep local state
  // and must be nudged when an edit is submitted elsewhere.
  nonce: number;
  kind: 'comment' | 'reply';
  commentId: string;
  replyId?: string;
};

type FocusCommentInEditorOptions = {
  source?: 'explicit-ui' | 'passive';
};

type ReconcileFloatingThreadsForActiveTabOptions = {
  hydrationReady: boolean;
};

// Marks editor transactions that came from an explicit thread jump in the UI
// (drawer, sidebar, or similar) rather than passive cursor movement. The
// provider reads this so the clicked thread can take ownership immediately,
// even if the selection update reaches the store before pointer heuristics do.
export const EXPLICIT_COMMENT_FOCUS_META = 'inlineCommentExplicitFocus';

const setFocusedFloatingCard = (
  floatingCards: CommentFloatingCard[],
  floatingCardId: string,
): CommentFloatingCard[] => {
  return floatingCards.map((floatingCard) => ({
    ...floatingCard,
    isFocused: floatingCard.floatingCardId === floatingCardId,
  }));
};

const upsertFloatingThreadCard = (
  floatingCards: CommentFloatingCard[],
  {
    commentId,
    selectedText,
    preferredFloatingCardId,
  }: {
    commentId: string;
    selectedText: string;
    preferredFloatingCardId?: string;
  },
): CommentFloatingCard[] => {
  const existingFloatingThreadCard = floatingCards.find(
    (floatingCard) =>
      floatingCard.type === 'thread' && floatingCard.commentId === commentId,
  );

  if (existingFloatingThreadCard) {
    return floatingCards.map((floatingCard) =>
      floatingCard.floatingCardId === existingFloatingThreadCard.floatingCardId
        ? {
            ...floatingCard,
            selectedText,
            isFocused: true,
          }
        : { ...floatingCard, isFocused: false },
    );
  }

  const nextFloatingCardId = preferredFloatingCardId ?? `thread:${commentId}`;

  return [
    ...floatingCards.map((floatingCard) => ({
      ...floatingCard,
      isFocused: false,
    })),
    {
      floatingCardId: nextFloatingCardId,
      type: 'thread',
      commentId,
      selectedText,
      isFocused: true,
    },
  ];
};

const resolveFloatingCardsUpdater = (
  previousFloatingCards: CommentFloatingCard[],
  nextFloatingCards: FloatingCardsUpdater,
) => {
  return typeof nextFloatingCards === 'function'
    ? nextFloatingCards(previousFloatingCards)
    : nextFloatingCards;
};

const getCommentAnchorSelector = (commentId: string) => {
  const safeCommentId =
    typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(commentId)
      : commentId.replace(/"/g, '\\"');

  return `[data-comment-id="${safeCommentId}"]`;
};

const getHydratedThreadDecorationAnchor = ({
  commentId,
  decorationAnchorById,
  commentAnchorsRef,
}: {
  commentId: string;
  decorationAnchorById?: Map<string, CommentAnchor>;
  commentAnchorsRef?: React.MutableRefObject<CommentAnchor[]>;
}) => {
  if (!commentId || !commentAnchorsRef) {
    return null;
  }

  return (
    decorationAnchorById?.get(commentId) ??
    commentAnchorsRef.current.find((anchor) => anchor.id === commentId) ??
    null
  );
};

const hasValidPendingPrehydrationFloatingThreadAnchor = ({
  commentId,
  decorationAnchorById,
  commentAnchorsRef,
  editor,
}: {
  commentId: string;
  decorationAnchorById?: Map<string, CommentAnchor>;
  commentAnchorsRef?: React.MutableRefObject<CommentAnchor[]>;
  editor: Editor;
}) => {
  if (!commentId || editor.isDestroyed) {
    return false;
  }

  // Pending prehydration threads must prove they still own a live decoration
  // anchor.
  const decorationAnchor = getHydratedThreadDecorationAnchor({
    commentId,
    decorationAnchorById,
    commentAnchorsRef,
  });

  return Boolean(
    decorationAnchor &&
      !decorationAnchor.deleted &&
      !decorationAnchor.resolved &&
      hasResolvableCommentAnchorInState(decorationAnchor, editor.state),
  );
};

const hasValidHydratedThreadAnchor = ({
  comment,
  decorationAnchorById,
  commentAnchorsRef,
  editor,
}: {
  comment: IComment;
  decorationAnchorById?: Map<string, CommentAnchor>;
  commentAnchorsRef?: React.MutableRefObject<CommentAnchor[]>;
  editor: Editor;
}) => {
  const commentId = comment.id;

  if (!commentId || editor.isDestroyed) {
    return false;
  }

  // Regular comments require selectedContent (the highlighted text to anchor
  // to). Suggestions don't always have selectedContent — Add suggestions are
  // point-anchored. Validity is determined by the anchor's resolvability,
  // not by selectedContent.
  if (!comment.isSuggestion && !comment.selectedContent) {
    return false;
  }

  if (commentAnchorsRef) {
    const decorationAnchor = getHydratedThreadDecorationAnchor({
      commentId,
      decorationAnchorById,
      commentAnchorsRef,
    });

    if (decorationAnchor) {
      if (decorationAnchor.deleted || decorationAnchor.resolved) {
        return false;
      }

      return hasResolvableCommentAnchorInState(decorationAnchor, editor.state);
    }
  }

  return Boolean(
    editor.view?.dom.querySelector(getCommentAnchorSelector(commentId)),
  );
};

const addPendingPrehydrationFloatingThreadId = (
  pendingCommentIds: string[],
  commentId: string | null | undefined,
) => {
  if (!commentId || pendingCommentIds.includes(commentId)) {
    return pendingCommentIds;
  }

  return [...pendingCommentIds, commentId];
};

const removePendingPrehydrationFloatingThreadIds = (
  pendingCommentIds: string[],
  commentIdsToRemove: Iterable<string>,
) => {
  const idsToRemove = new Set<string>();

  for (const commentId of commentIdsToRemove) {
    if (commentId) {
      idsToRemove.add(commentId);
    }
  }

  if (!idsToRemove.size) {
    return pendingCommentIds;
  }

  const nextPendingCommentIds = pendingCommentIds.filter(
    (commentId) => !idsToRemove.has(commentId),
  );

  return nextPendingCommentIds.length === pendingCommentIds.length
    ? pendingCommentIds
    : nextPendingCommentIds;
};

const areFloatingCardsEqual = (
  left: CommentFloatingCard[],
  right: CommentFloatingCard[],
) => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftCard, index) => {
    const rightCard = right[index];

    if (
      !rightCard ||
      leftCard.floatingCardId !== rightCard.floatingCardId ||
      leftCard.type !== rightCard.type ||
      leftCard.selectedText !== rightCard.selectedText ||
      leftCard.isFocused !== rightCard.isFocused
    ) {
      return false;
    }

    if (leftCard.type === 'draft') {
      return (
        rightCard.type === 'draft' && leftCard.draftId === rightCard.draftId
      );
    }

    if (leftCard.type === 'suggestion-draft') {
      return (
        rightCard.type === 'suggestion-draft' &&
        leftCard.suggestionId === rightCard.suggestionId
      );
    }

    return (
      rightCard.type === 'thread' && leftCard.commentId === rightCard.commentId
    );
  });
};

const upsertInlineDraft = (
  drafts: InlineDraftRecordMap,
  draft: InlineCommentDraft,
) => ({
  ...drafts,
  [draft.draftId]: draft,
});

const removeInlineDraft = (
  drafts: InlineDraftRecordMap,
  draftId: string,
): InlineDraftRecordMap => {
  if (!drafts[draftId]) {
    return drafts;
  }

  const nextDrafts = { ...drafts };
  delete nextDrafts[draftId];
  return nextDrafts;
};

const findCommentById = (comments: IComment[], commentId: string) =>
  comments.find((comment) => comment.id === commentId) ?? null;

const isFloatingThreadCard = (
  floatingCard: CommentFloatingCard,
): floatingCard is Extract<CommentFloatingCard, { type: 'thread' }> => {
  return floatingCard.type === 'thread';
};

const hasFloatingThreadCard = (
  floatingCards: CommentFloatingCard[],
  commentId: string | null,
) => {
  if (!commentId) {
    return false;
  }

  return floatingCards.some(
    (floatingCard) =>
      isFloatingThreadCard(floatingCard) &&
      floatingCard.commentId === commentId,
  );
};

const getFocusedFloatingThreadCommentId = (
  floatingCards: CommentFloatingCard[],
) => {
  const focusedFloatingThreadCard = floatingCards.find(
    (
      floatingCard,
    ): floatingCard is Extract<CommentFloatingCard, { type: 'thread' }> =>
      isFloatingThreadCard(floatingCard) && floatingCard.isFocused,
  );

  return focusedFloatingThreadCard?.commentId ?? null;
};

const findReplyById = (
  comments: IComment[],
  commentId: string,
  replyId: string,
) => {
  const comment = findCommentById(comments, commentId);
  if (!comment) {
    return null;
  }

  return (comment.replies || []).find((reply) => reply.id === replyId) ?? null;
};

function getExtDeps(get: () => CommentStoreState): CommentExternalDeps {
  const ref = get()._externalDepsRef;
  return (
    ref?.current ?? {
      editor: null,
      ydoc: null as unknown as Y.Doc,
      setActiveCommentId: () => {},
      focusCommentWithActiveId: () => {},
      ensResolutionUrl: '',
      refreshCommentAnchorState: () => {},
    }
  );
}

export interface CommentStoreState {
  // --- Synced from props via useEffect (data consumers subscribe to) ---
  initialComments: IComment[];
  tabComments: IComment[];
  activeComments: IComment[];
  activeComment: IComment | undefined;
  activeCommentIndex: number;
  username: string | null;
  activeCommentId: string | null;
  activeTabId: string;
  isConnected: boolean;
  isLoading: boolean;
  isDDocOwner: boolean;
  /** Inline comments usable at all (not RTC, published, not disabled) —
   *  synced from CommentStoreProvider's prop; drives insert.comment
   *  enablement in useEditorCommands. */
  isInlineCommentAvailable: boolean;

  // --- External callbacks (synced via useEffect, read by consumers) ---
  onComment: (() => void) | null;
  setCommentDrawerOpen: ((open: boolean) => void) | null;
  connectViaWallet: (() => Promise<void>) | null;
  connectViaUsername: ((username: string) => Promise<void>) | null;

  // --- Editor-derived state (synced when activeCommentId changes) ---
  isCommentActive: boolean;
  isCommentResolved: boolean;

  // --- Owned state ---
  showResolved: boolean;
  reply: string;
  comment: string;
  openReplyId: string | null;
  selectedText: string;
  isCommentOpen: boolean;
  isBubbleMenuSuppressed: boolean;
  inlineCommentData: InlineCommentData;
  floatingCards: CommentFloatingCard[];
  // Tracks just-created floating threads that already have a local anchor but
  // have not been rehydrated into canonical comment props yet.
  pendingPrehydrationFloatingThreadIds: string[];
  /** In-progress suggestion drafts — keyed by suggestionId. Viewer-local, lost on refresh. */
  drafts: Record<string, DraftSuggestion>;
  /** Suggestion draft currently under the focused editor cursor, if any. */
  activeSuggestionDraftIdAtCursor: string | null;
  inlineDrafts: InlineDraftRecordMap;
  activeDraftId: string | null;
  isDesktopFloatingEnabled: boolean;
  ensCache: EnsCache;
  inProgressFetch: string[];
  editRequest: CommentEditRequest | null;
  replyEditTarget: ReplyEditTarget | null;
  editCompletion: CommentEditCompletion | null;

  // --- Ref for external deps (set once by provider) ---
  _externalDepsRef: React.RefObject<CommentExternalDeps | null> | null;
  setExternalDepsRef: (
    ref: React.RefObject<CommentExternalDeps | null>,
  ) => void;

  // --- Internal ---
  _recomputeDerived: () => void;

  // --- Synced data setters (called by provider useEffects) ---
  setInitialComments: (comments: IComment[]) => void;
  setUsername: (username: string | null) => void;
  setActiveCommentId: (id: string | null) => void;
  setActiveTabId: (tabId: string) => void;
  setIsConnected: (connected: boolean) => void;
  setIsLoading: (loading: boolean) => void;
  setIsDDocOwner: (isOwner: boolean) => void;
  setIsInlineCommentAvailable: (value: boolean) => void;
  setOnComment: (fn: (() => void) | null) => void;
  setCommentDrawerOpenFn: (fn: ((open: boolean) => void) | null) => void;
  setConnectViaWallet: (fn: (() => Promise<void>) | null) => void;
  setConnectViaUsername: (
    fn: ((username: string) => Promise<void>) | null,
  ) => void;
  setIsCommentActive: (active: boolean) => void;
  setIsCommentResolved: (resolved: boolean) => void;

  // --- Derived getters ---
  getTabComments: () => IComment[];
  getActiveComment: () => IComment | undefined;
  getActiveComments: () => IComment[];
  getActiveCommentIndex: () => number;
  getIsCommentActive: () => boolean;
  getIsCommentResolved: () => boolean;

  // --- Owned state setters ---
  setShowResolved: (show: boolean) => void;
  setReply: (reply: string) => void;
  setComment: (comment: string) => void;
  setOpenReplyId: (id: string | null) => void;
  setSelectedText: (text: string) => void;
  setIsCommentOpen: (open: boolean) => void;
  setIsBubbleMenuSuppressed: (suppressed: boolean) => void;
  setInlineCommentData: (data: InlineCommentDataUpdater) => void;
  setFloatingCards: (floatingCards: FloatingCardsUpdater) => void;
  clearFloatingCards: () => void;
  setActiveDraftId: (draftId: string | null) => void;
  setIsDesktopFloatingEnabled: (enabled: boolean) => void;
  toggleResolved: () => void;
  clearEditRequest: (requestId: string) => void;
  setReplyEditTarget: (target: ReplyEditTarget | null) => void;
  cancelReplyEdit: () => void;

  // --- Handlers ---
  handleInput: (
    e: React.FormEvent<HTMLTextAreaElement>,
    content: string,
  ) => void;
  handleReplyChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleCommentChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  handleCommentKeyDown: (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    tabId?: string,
  ) => void;
  handleReplyKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  handleReplySubmit: () => void;
  handleCommentSubmit: (tabId?: string) => void;
  handleInlineComment: () => void;

  // --- Comment operations ---
  addComment: (content?: string, usernameProp?: string) => string | undefined;
  createFloatingDraft: (options?: CreateInlineDraftOptions) => string | null;
  updateInlineDraftText: (draftId: string, value: string) => void;
  cancelInlineDraft: (draftId: string) => void;
  submitInlineDraft: (draftId: string) => void;
  updateFloatingDraftText: (draftId: string, value: string) => void;
  cancelFloatingDraft: (draftId: string) => void;
  submitFloatingDraft: (draftId: string) => void;
  openFloatingThread: (commentId: string) => void;
  focusSubmittedSuggestionFromEditor: (commentId: string) => boolean;
  closeFloatingCard: (floatingCardId: string) => void;
  blurFloatingCard: (floatingCardId: string) => void;
  focusFloatingCard: (floatingCardId: string) => void;
  removeInvalidFloatingDrafts: () => void;
  reconcileFloatingThreadsForActiveTab: (
    options: ReconcileFloatingThreadsForActiveTabOptions,
  ) => void;
  syncFloatingThreadCardWithActiveComment: () => void;
  submitPendingFloatingDrafts: () => void;
  /**
   * Apply anchor edits to local comment state.
   * Called after transaction analysis identifies edited anchors.
   * Updates selectedContent for each affected comment
   * so thread display stays in sync immediately, before consumer rehydration.
   */
  applyCommentAnchorEdits: (
    edits: Array<{ commentId: string; selectedContent: string }>,
  ) => void;
  resolveComment: (commentId: string) => void;
  unresolveComment: (commentId: string) => void;
  // `skipExternalCallback` is for provider-driven auto-deletes, where the provider
  // is responsible for firing `onDeleteComment` and the store should only do local cleanup.
  deleteComment: (
    commentId: string,
    options?: { skipExternalCallback?: boolean },
  ) => void;
  acceptSuggestion: (commentId: string) => void;

  // --- Suggestion draft operations (Phase 2 — viewer-local drafts) ---
  /**
   * Append typed characters to the draft at the current cursor position.
   * Creates a new Add draft if no draft exists at the cursor.
   */
  appendToDraftAtCursor: (text: string) => void;
  /**
   * Create a Delete (or pending Replace) draft from a selection range.
   * Captures originalContent, leaves insertedText empty; type becomes 'replace'
   * as soon as the viewer types.
   */
  startDeleteDraft: (from: number, to: number, collapseTo?: number) => void;
  /**
   * Create a link suggestion from a selected range and pasted href.
   * The document stays unchanged until the owner accepts the suggestion.
   */
  startLinkDraft: (from: number, to: number, href: string) => void;
  /**
   * Convert a collapsed-caret Backspace/Delete into a delete draft when the
   * caret is adjacent to text, or shrink the active draft if the caret is
   * already inside one.
   */
  deleteAtCursorOrUndoActiveDraft: (
    direction: SuggestionDeleteDirection,
  ) => void;
  /**
   * Handle browser deletion paths that resolved to a concrete range even
   * though the user had no explicit selection.
   */
  deleteRangeOrUndoActiveDraft: (from: number, to: number) => void;
  /**
   * Undo the last keystroke in the draft at the current cursor position.
   * When the draft has no keystrokes left, it is discarded.
   * For a pure Delete draft (no keystrokes ever), calling this discards.
   */
  undoLastKeystrokeInActiveDraft: () => void;
  /** Drop a draft entirely — removes the inline overlay and draft card. */
  discardDraft: (suggestionId: string) => void;
  /**
   * Refresh the `originalContent` (and the suggestion-draft card's selectedText)
   * for a Delete/Replace draft whose anchored range still resolves but now
   * covers different text — happens when the owner edits within the anchored
   * range while the viewer's draft is open.
   */
  refreshDraftOriginalContent: (
    suggestionId: string,
    currentText: string,
  ) => void;
  /**
   * Sync the draft id under the current editor cursor. Each draft card uses
   * this to decide whether its own auto-submit countdown should run.
   */
  syncActiveSuggestionDraftAtCursor: () => void;
  /**
   * Promote a draft to a submitted suggestion. Pushes the anchor into
   * commentAnchorsRef, calls onNewComment, removes the draft, and swaps the
   * suggestion-draft floating card for a thread card (same floatingCardId).
   */
  submitDraft: (suggestionId: string) => void;

  deleteReply: (commentId: string, replyId: string) => void;
  requestEditComment: (commentId: string) => void;
  requestEditReply: (commentId: string, replyId: string) => void;
  editCommentContent: (commentId: string, content: string) => void;
  editReplyContent: (
    commentId: string,
    replyId: string,
    content: string,
  ) => void;
  handleAddReply: (
    activeCommentId: string,
    replyContent: string,
    replyCallback?: (activeCommentId: string, reply: IComment) => void,
  ) => void;
  focusCommentInEditor: (
    commentId: string,
    options?: FocusCommentInEditorOptions,
  ) => void;
  focusSuggestionDraftInEditor: (suggestionId: string) => void;
  onPrevComment: () => void;
  onNextComment: () => void;
  getEnsStatus: (
    walletAddress: string,
    setEnsStatus: React.Dispatch<React.SetStateAction<EnsStatus>>,
  ) => void;

  // --- Internal ---
  createMutationMeta: (
    type: CommentMutationType,
    mutate: () => boolean,
  ) => CommentMutationMeta | undefined;
}

export const createCommentStore = () =>
  createStore<CommentStoreState>((set, get) => ({
    // --- Synced data (updated by provider useEffects) ---
    initialComments: [],
    tabComments: [],
    activeComments: [],
    activeComment: undefined,
    activeCommentIndex: -1,
    username: null,
    activeCommentId: null,
    activeTabId: DEFAULT_TAB_ID,
    isConnected: false,
    isLoading: false,
    isDDocOwner: false,
    isInlineCommentAvailable: false,

    // --- External callbacks ---
    onComment: null,
    setCommentDrawerOpen: null,
    connectViaWallet: null,
    connectViaUsername: null,

    // --- Editor-derived state ---
    isCommentActive: false,
    isCommentResolved: false,

    // --- Owned state ---
    showResolved: true,
    reply: '',
    comment: '',
    openReplyId: null,
    selectedText: '',
    isCommentOpen: false,
    isBubbleMenuSuppressed: false,
    inlineCommentData: {
      highlightedTextContent: '',
      inlineCommentText: '',
      handleClick: false,
    },
    floatingCards: [],
    pendingPrehydrationFloatingThreadIds: [],
    drafts: {},
    activeSuggestionDraftIdAtCursor: null,
    inlineDrafts: {},
    activeDraftId: null,
    isDesktopFloatingEnabled: false,
    ensCache: (() => {
      try {
        const cached = localStorage.getItem('ensCache');
        return cached ? JSON.parse(cached) : {};
      } catch {
        return {};
      }
    })(),
    inProgressFetch: [],
    editRequest: null,
    // This is the edit "mode" state for the drawer reply input (shared store).
    // Floating + bubble inputs maintain local text, so they mirror this state
    // when an edit starts and clear on edit completion.
    replyEditTarget: null,
    // One-way event to help local-state inputs reset when an edit finishes.
    editCompletion: null,

    // --- External deps ref ---
    _externalDepsRef: null,
    setExternalDepsRef: (ref) => set({ _externalDepsRef: ref }),

    // --- Recompute derived state ---
    _recomputeDerived: () => {
      const { initialComments, activeTabId, activeCommentId } = get();
      const tabComments = initialComments.filter(
        (comment) => (comment.tabId || DEFAULT_TAB_ID) === activeTabId,
      );
      const activeComments = tabComments.filter(
        (comment) =>
          !comment.resolved &&
          Boolean(comment.selectedContent) &&
          !comment.deleted,
      );
      const activeComment = tabComments.find(
        (comment) => comment.id === activeCommentId,
      );
      const activeCommentIndex = activeComments.findIndex(
        (comment) => comment.id === activeCommentId,
      );

      set({ tabComments, activeComments, activeComment, activeCommentIndex });
    },

    // --- Synced data setters (batch with derived recomputation to avoid double set) ---
    setInitialComments: (comments) => {
      // Consumers persist comments through a cache schema that does not yet
      // store suggestion metadata (isSuggestion, suggestionType, originalContent,
      // suggestedContent). When the cache round-trips a suggestion back through
      // setInitialComments, those fields would be lost, flipping the UI from
      // SuggestionThreadFloatingCard to the generic ThreadFloatingCard. Merge
      // the local suggestion metadata back in for comments we already know are
      // suggestions in the current store.
      //
      // `deleted` / `resolved` are also merged monotonically (once locally true,
      // stay true): if the viewer withdraws a suggestion whose create-comment
      // cache write hadn't completed yet, the consumer's async delete write
      // silently no-ops, and the subsequent `addCommentToCacheV2` writes the
      // comment back as `deleted: false`. Without this guard, the next
      // userMessages round-trip un-deletes the withdrawn suggestion locally.
      const previousById = new Map(
        get().initialComments.map((comment) => [comment.id, comment]),
      );
      const merged = comments.map((comment) => {
        const previous = comment.id ? previousById.get(comment.id) : undefined;
        if (!previous?.isSuggestion) {
          return comment;
        }
        return {
          ...comment,
          isSuggestion: true,
          suggestionType: comment.suggestionType ?? previous.suggestionType,
          originalContent: comment.originalContent ?? previous.originalContent,
          suggestedContent:
            comment.suggestedContent ?? previous.suggestedContent,
          deleted: comment.deleted || previous.deleted || false,
          resolved: comment.resolved || previous.resolved || false,
        };
      });

      set({ initialComments: merged });
      // Recompute in same tick — Zustand batches synchronous set() calls
      const {
        activeTabId,
        activeCommentId,
        openReplyId,
        pendingPrehydrationFloatingThreadIds,
      } = get();
      const tabComments = merged.filter(
        (comment) => (comment.tabId || DEFAULT_TAB_ID) === activeTabId,
      );
      const activeComments = tabComments.filter(
        (comment) =>
          !comment.resolved &&
          Boolean(comment.selectedContent) &&
          !comment.deleted,
      );
      const activeComment = tabComments.find(
        (comment) => comment.id === activeCommentId,
      );
      const activeCommentIndex = activeComments.findIndex(
        (comment) => comment.id === activeCommentId,
      );
      // `openReplyId` drives the mobile focused-thread mode. Only deleted
      // comments should clear it here; resolved comments must retain focus so
      // the drawer stays in the active thread view.
      const nextOpenReplyId = merged.some(
        (comment) => comment.id === openReplyId && !comment.deleted,
      )
        ? openReplyId
        : null;
      const incomingCommentIds = comments.flatMap((comment) =>
        comment.id ? [comment.id] : [],
      );

      set({
        tabComments,
        activeComments,
        activeComment,
        activeCommentIndex,
        openReplyId: nextOpenReplyId,
        // External comment rehydration is the handoff point. Once the comment
        // arrives through props, stop treating it as a local preserve exception.
        pendingPrehydrationFloatingThreadIds:
          removePendingPrehydrationFloatingThreadIds(
            pendingPrehydrationFloatingThreadIds,
            incomingCommentIds,
          ),
      });
    },
    setUsername: (username) => {
      const previousUsername = get().username;
      set({ username });

      if (username && previousUsername !== username) {
        getExtDeps(get).setUsername?.(username);
      }
    },
    setActiveCommentId: (id) => {
      const previousActiveCommentId = get().activeCommentId;
      set({ activeCommentId: id });

      const tabComments = get().tabComments;
      const activeComments = get().activeComments;
      const activeComment = tabComments.find((comment) => comment.id === id);
      const activeCommentIndex = activeComments.findIndex(
        (comment) => comment.id === id,
      );

      set({ activeComment, activeCommentIndex });

      if (previousActiveCommentId !== id) {
        const { editor } = getExtDeps(get);
        if (editor) {
          triggerDecorationRebuild(editor);
        }
      }
    },
    setActiveTabId: (tabId) => {
      const {
        activeDraftId,
        activeTabId,
        inlineDrafts,
        isCommentOpen,
        openReplyId,
      } = get();
      const { editor } = getExtDeps(get);

      if (activeTabId !== tabId && editor) {
        // Draft anchors are tab-scoped. Clear them eagerly on tab switch so a
        // later submit cannot bind to a stale range from the previous tab.
        Object.keys(inlineDrafts).forEach((draftId) => {
          editor.commands.unsetDraftComment(draftId);
        });

        if (editor.isActive('highlight')) {
          editor.chain().unsetHighlight().run();
        }
      }

      set((state) => ({
        activeTabId: tabId,
        inlineDrafts: activeTabId === tabId ? inlineDrafts : {},
        activeDraftId: activeTabId === tabId ? activeDraftId : null,
        isCommentOpen: activeTabId === tabId ? isCommentOpen : false,
        openReplyId: activeTabId === tabId ? openReplyId : null,
        // The prehydration exception is scoped to the tab that created it.
        pendingPrehydrationFloatingThreadIds:
          activeTabId === tabId
            ? state.pendingPrehydrationFloatingThreadIds
            : [],
      }));
      get()._recomputeDerived();
    },
    setIsConnected: (connected) => set({ isConnected: connected }),
    setIsLoading: (loading) => set({ isLoading: loading }),
    setIsDDocOwner: (isOwner) => set({ isDDocOwner: isOwner }),
    setIsInlineCommentAvailable: (value) => {
      if (get().isInlineCommentAvailable !== value) {
        set({ isInlineCommentAvailable: value });
      }
    },
    setOnComment: (fn) => set({ onComment: fn }),
    setCommentDrawerOpenFn: (fn) => set({ setCommentDrawerOpen: fn }),
    setConnectViaWallet: (fn) => set({ connectViaWallet: fn }),
    setConnectViaUsername: (fn) => set({ connectViaUsername: fn }),
    setIsCommentActive: (active) => set({ isCommentActive: active }),
    setIsCommentResolved: (resolved) => set({ isCommentResolved: resolved }),

    // --- Derived getters (read from pre-computed state) ---
    getTabComments: () => get().tabComments,
    getActiveComment: () => get().activeComment,
    getActiveComments: () => get().activeComments,
    getActiveCommentIndex: () => get().activeCommentIndex,
    getIsCommentActive: () => get().isCommentActive,
    getIsCommentResolved: () => get().isCommentResolved,

    // --- Owned state setters ---
    setShowResolved: (show) => set({ showResolved: show }),
    setReply: (reply) => set({ reply }),
    setComment: (comment) => set({ comment }),
    setOpenReplyId: (id) => set({ openReplyId: id }),
    setSelectedText: (text) => set({ selectedText: text }),
    setIsCommentOpen: (open) => {
      const { activeDraftId, inlineDrafts } = get();
      const activeDraft = activeDraftId ? inlineDrafts[activeDraftId] : null;

      if (!open) {
        const { editor } = getExtDeps(get);

        // Only drawer-owned drafts should be dismissed here. Desktop new
        // comments stay alive because they belong to the floating comments,
        // not the drawer.
        // Unanchored drawer drafts never created a draft mark in the editor,
        // so only anchored drafts should try to unset one here.
        if (
          editor &&
          activeDraft?.location === 'drawer' &&
          activeDraft.selectedText
        ) {
          editor.commands.unsetDraftComment(activeDraft.draftId);
        }
        if (editor && editor.isActive('highlight')) {
          editor.chain().unsetHighlight().run();
        }

        set((state) => ({
          isCommentOpen: open,
          activeDraftId:
            activeDraft?.location === 'drawer' ? null : state.activeDraftId,
          inlineDrafts:
            activeDraft?.location === 'drawer'
              ? removeInlineDraft(state.inlineDrafts, activeDraft.draftId)
              : state.inlineDrafts,
        }));
        return;
      }

      set({ isCommentOpen: open });
    },
    setIsBubbleMenuSuppressed: (suppressed) =>
      set({ isBubbleMenuSuppressed: suppressed }),
    setInlineCommentData: (updater) =>
      set((state) => {
        const nextValue =
          typeof updater === 'function'
            ? updater(state.inlineCommentData)
            : updater;

        return {
          inlineCommentData: {
            ...state.inlineCommentData,
            ...nextValue,
          },
        };
      }),
    setFloatingCards: (nextFloatingCards) =>
      set((state) => ({
        floatingCards: resolveFloatingCardsUpdater(
          state.floatingCards,
          nextFloatingCards,
        ),
      })),
    clearFloatingCards: () =>
      set({
        floatingCards: [],
        activeSuggestionDraftIdAtCursor: null,
      }),
    setActiveDraftId: (draftId) => set({ activeDraftId: draftId }),
    setIsDesktopFloatingEnabled: (enabled) =>
      set({ isDesktopFloatingEnabled: enabled }),
    toggleResolved: () =>
      set((state) => ({ showResolved: !state.showResolved })),
    clearEditRequest: (requestId) =>
      set((state) =>
        // Consume editRequest only once. Multiple UIs might be mounted, but
        // we want the first eligible input to claim the edit prefill.
        state.editRequest?.requestId === requestId ? { editRequest: null } : {},
      ),
    setReplyEditTarget: (target) => set({ replyEditTarget: target }),
    cancelReplyEdit: () => set({ replyEditTarget: null }),

    // --- Handlers ---
    handleInput: (e, contentValue) => {
      e.currentTarget.style.height = 'auto';
      const newHeight = Math.min(
        Math.max(40, e.currentTarget.scrollHeight),
        contentValue.length > 30 || contentValue.includes('\n') ? 96 : 40,
      );
      e.currentTarget.style.height = `${newHeight}px`;
    },
    handleReplyChange: (e) => {
      const value = e.target.value;
      set({ reply: value });
      if (!value) {
        e.target.style.height = '40px';
      }
    },
    handleCommentChange: (e) => {
      const value = e.target.value;
      set({ comment: value });
      if (!value) {
        e.target.style.height = '40px';
      }
    },
    handleCommentKeyDown: (e, tabId) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        get().handleCommentSubmit(tabId);
      }
    },
    handleReplyKeyDown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        get().handleReplySubmit();
      }
    },
    handleReplySubmit: () => {
      const { activeCommentId, openReplyId, reply } = get();
      const targetCommentId = openReplyId || activeCommentId;

      if (!targetCommentId || !reply.trim()) {
        return;
      }

      const { replyEditTarget } = get();

      if (replyEditTarget) {
        if (replyEditTarget.kind === 'comment') {
          get().editCommentContent(replyEditTarget.commentId, reply);
        } else if (replyEditTarget.replyId) {
          get().editReplyContent(
            replyEditTarget.commentId,
            replyEditTarget.replyId,
            reply,
          );
        }

        set({ reply: '', replyEditTarget: null });
        return;
      }

      const { onCommentReply } = getExtDeps(get);
      get().handleAddReply(targetCommentId, reply, onCommentReply ?? undefined);
      set({ reply: '' });
    },
    handleCommentSubmit: (tabId) => {
      const { comment, username, activeTabId, onComment } = get();
      const { onNewComment, setActiveCommentId } = getExtDeps(get);
      const targetTabId = tabId ?? activeTabId;

      if (!comment.trim() || !username) {
        return;
      }

      const newComment: IComment = {
        id: `comment-${uuid()}`,
        tabId: targetTabId,
        username,
        selectedContent: '',
        content: comment,
        replies: [],
        createdAt: new Date(),
      };

      onNewComment?.(newComment);
      setActiveCommentId(newComment.id || null);
      set({ comment: '' });
      onComment?.();
    },
    handleInlineComment: () => {
      get().createFloatingDraft();
    },

    // --- Comment operations ---
    addComment: (content, usernameProp) => {
      const { onNewComment, setActiveCommentId } = getExtDeps(get);
      const { username, activeTabId } = get();

      // Keep this path unanchored. Inline comments must go through the shared
      // draft flow so submission never depends on whatever selection exists later.
      const newComment: IComment = {
        id: `comment-${uuid()}`,
        tabId: activeTabId,
        username: usernameProp || username!,
        selectedContent: '',
        content: content || '',
        replies: [],
        createdAt: new Date(),
      };

      setActiveCommentId(newComment.id || '');
      onNewComment?.(newComment);
      return newComment.id;
    },
    // Store floatingCards here so the floating comments can reopen, focus, and
    // submit drafts without re-deriving floating state from editor DOM on every frame.
    createFloatingDraft: (options) => {
      const { editor, onInlineComment } = getExtDeps(get);
      const {
        isDesktopFloatingEnabled,
        activeDraftId,
        activeTabId,
        inlineDrafts,
        setCommentDrawerOpen,
      } = get();
      const draftLocation =
        options?.location ?? (isDesktopFloatingEnabled ? 'floating' : 'drawer');
      const draftTabId = options?.tabId ?? activeTabId;
      const allowEmptySelection =
        draftLocation === 'drawer' && Boolean(options?.allowEmptySelection);

      if (!editor) {
        if (!allowEmptySelection) {
          return null;
        }

        // Preserve the drawer's top-level comment affordance even when the editor
        // is unavailable. This branch must stay unanchored: selectedText remains
        // empty so submit does not attempt to create anchor metadata later.
        const draftId = `draft-${uuid()}`;
        const existingDrawerDraftId =
          activeDraftId && inlineDrafts[activeDraftId]?.location === 'drawer'
            ? activeDraftId
            : null;

        set((state) => ({
          selectedText: '',
          isBubbleMenuSuppressed: true,
          activeDraftId: draftId,
          isCommentOpen: true,
          inlineDrafts: upsertInlineDraft(
            existingDrawerDraftId
              ? removeInlineDraft(state.inlineDrafts, existingDrawerDraftId)
              : state.inlineDrafts,
            {
              draftId,
              tabId: draftTabId,
              selectedText: '',
              text: '',
              location: 'drawer',
              isAuthPending: false,
            },
          ),
        }));

        onInlineComment?.();
        return draftId;
      }

      const { state } = editor;
      const { from, to } = state.selection;
      const text = state.doc.textBetween(from, to, ' ');
      const hasSelectionAnchor =
        !allowEmptySelection && from < to && Boolean(text.trim());

      // Keep the selection requirement for anchored inline comments. The drawer
      // button is the only path allowed to create an unanchored draft.
      if (!hasSelectionAnchor && !allowEmptySelection) {
        return null;
      }

      const draftId = `draft-${uuid()}`;

      if (hasSelectionAnchor) {
        // Capture the anchor immediately when the new comment opens. Submission should
        // resolve against this tracked draft range, never against live selection.
        const didCreateDraft = editor.commands.setDraftComment(draftId);

        if (!didCreateDraft) {
          return null;
        }
      }

      const existingDrawerDraftId =
        draftLocation === 'drawer' &&
        activeDraftId &&
        inlineDrafts[activeDraftId]?.location === 'drawer'
          ? activeDraftId
          : null;

      if (existingDrawerDraftId && existingDrawerDraftId !== draftId) {
        // Mobile keeps only one active inline draft so the drawer stays the
        // single source of truth for where the new comment opens.
        if (inlineDrafts[existingDrawerDraftId]?.selectedText) {
          editor.commands.unsetDraftComment(existingDrawerDraftId);
        }
      }

      if (draftLocation === 'floating') {
        setCommentDrawerOpen?.(false);
      }

      set((state) => ({
        selectedText: hasSelectionAnchor ? text : '',
        isBubbleMenuSuppressed: true,
        activeDraftId:
          draftLocation === 'drawer' ? draftId : state.activeDraftId,
        isCommentOpen: draftLocation === 'drawer' ? true : state.isCommentOpen,
        inlineDrafts: upsertInlineDraft(
          existingDrawerDraftId
            ? removeInlineDraft(state.inlineDrafts, existingDrawerDraftId)
            : state.inlineDrafts,
          {
            draftId,
            tabId: draftTabId,
            selectedText: hasSelectionAnchor ? text : '',
            text: '',
            location: draftLocation,
            isAuthPending: false,
          },
        ),
        floatingCards:
          draftLocation === 'floating'
            ? [
                ...state.floatingCards.map((floatingCard) => ({
                  ...floatingCard,
                  isFocused: false,
                })),
                {
                  floatingCardId: `draft:${draftId}`,
                  type: 'draft',
                  draftId,
                  selectedText: text,
                  isFocused: true,
                } satisfies CommentFloatingDraftCard,
              ]
            : state.floatingCards,
      }));

      onInlineComment?.();
      return draftId;
    },
    updateInlineDraftText: (draftId, value) => {
      set((state) => {
        const draft = state.inlineDrafts[draftId];

        if (!draft) {
          return state;
        }

        return {
          inlineDrafts: upsertInlineDraft(state.inlineDrafts, {
            ...draft,
            text: value,
            isAuthPending: false,
          }),
        };
      });
    },
    cancelInlineDraft: (draftId) => {
      const draftFloatingCard = get().floatingCards.find(
        (floatingCard): floatingCard is CommentFloatingDraftCard =>
          floatingCard.type === 'draft' && floatingCard.draftId === draftId,
      );

      if (draftFloatingCard) {
        get().closeFloatingCard(draftFloatingCard.floatingCardId);
        return;
      }

      const { editor } = getExtDeps(get);
      const { inlineDrafts } = get();
      const draft = inlineDrafts[draftId];

      if (!draft) {
        return;
      }

      if (editor && draft.selectedText) {
        editor.commands.unsetDraftComment(draftId);
      }

      set((state) => ({
        activeDraftId:
          state.activeDraftId === draftId ? null : state.activeDraftId,
        isCommentOpen:
          state.activeDraftId === draftId && draft.location === 'drawer'
            ? false
            : state.isCommentOpen,
        inlineDrafts: removeInlineDraft(state.inlineDrafts, draftId),
      }));
    },
    submitInlineDraft: (draftId) => {
      const {
        activeTabId,
        isConnected,
        inlineDrafts,
        setCommentDrawerOpen,
        username,
      } = get();
      const {
        editor,
        focusCommentWithActiveId,
        onNewComment,
        setActiveCommentId,
        commentAnchorsRef,
        refreshCommentAnchorState,
      } = getExtDeps(get);
      const draft = inlineDrafts[draftId];

      if (!draft) {
        return;
      }

      const draftText = draft.text.trim();

      if (!draftText) {
        return;
      }

      if (!isConnected || !username) {
        set((state) => ({
          activeDraftId:
            draft.location === 'drawer' ? draftId : state.activeDraftId,
          isCommentOpen:
            draft.location === 'drawer' ? true : state.isCommentOpen,
          inlineDrafts: upsertInlineDraft(state.inlineDrafts, {
            ...draft,
            isAuthPending: true,
          }),
          floatingCards: state.floatingCards.map((floatingCard) =>
            floatingCard.type === 'draft'
              ? {
                  ...floatingCard,
                  isFocused: floatingCard.draftId === draftId,
                }
              : {
                  ...floatingCard,
                  isFocused: false,
                },
          ),
        }));
        setCommentDrawerOpen?.(true);
        return;
      }

      if (!editor && draft.selectedText) {
        return;
      }

      // Submission resolves from the stored draft anchor. That keeps mobile
      // and desktop consistent even if editor selection moved after the new
      // comment opened.
      // When selectedText is empty, this draft came from the drawer's unanchored
      // new-comment action and should persist as a plain tab-level comment.
      const newComment: IComment = {
        id: `comment-${uuid()}`,
        tabId: draft.tabId ?? activeTabId,
        username,
        selectedContent: draft.selectedText,
        content: draftText,
        replies: [],
        createdAt: new Date(),
      };

      const draftRange = editor
        ? getDraftCommentRange(editor.state, draftId)
        : null;

      if (draft.selectedText && !draftRange) {
        // If the tracked anchor was deleted, fail closed instead of attaching
        // this comment to a new or stale selection.
        set((state) => ({
          inlineDrafts: upsertInlineDraft(state.inlineDrafts, {
            ...draft,
            isAuthPending: false,
          }),
        }));
        return;
      }

      let createdAnchor: {
        anchorFrom: Y.RelativePosition;
        anchorTo: Y.RelativePosition;
      } | null = null;

      if (editor && draftRange && commentAnchorsRef) {
        const anchor = createCommentAnchorFromEditor(
          editor,
          draftRange.from,
          draftRange.to,
        );
        if (anchor) {
          createdAnchor = anchor;
          commentAnchorsRef.current = [
            ...commentAnchorsRef.current,
            {
              id: newComment.id!,
              anchorFrom: anchor.anchorFrom,
              anchorTo: anchor.anchorTo,
              resolved: false,
              deleted: false,
            },
          ];
        }
      }

      if (editor && draft.selectedText) {
        editor.commands.unsetDraftComment(draftId);
        triggerDecorationRebuild(editor);
        refreshCommentAnchorState?.();
      }

      get().setActiveCommentId(newComment.id || '');
      setActiveCommentId(newComment.id || '');
      if (editor) {
        setTimeout(() => focusCommentWithActiveId(newComment.id || ''), 0);
      }

      const meta: CommentMutationMeta | undefined = createdAnchor
        ? {
            type: 'create',
            anchorFrom: fromUint8Array(
              Y.encodeRelativePosition(createdAnchor.anchorFrom),
            ),
            anchorTo: fromUint8Array(
              Y.encodeRelativePosition(createdAnchor.anchorTo),
            ),
          }
        : undefined;
      onNewComment?.(newComment, meta);

      set((state) => {
        const nextFloatingCards = state.floatingCards.filter(
          (floatingCard) =>
            floatingCard.type !== 'thread' ||
            floatingCard.commentId !== newComment.id,
        );
        const draftFloatingCard = nextFloatingCards.find(
          (floatingCard): floatingCard is CommentFloatingDraftCard =>
            floatingCard.type === 'draft' && floatingCard.draftId === draftId,
        );
        const replacementThreadCard = draftFloatingCard
          ? {
              floatingCardId: draftFloatingCard.floatingCardId,
              type: 'thread' as const,
              commentId: newComment.id || '',
              selectedText: draft.selectedText,
              isFocused: true,
            }
          : null;
        const replacementIndex = nextFloatingCards.findIndex(
          (floatingCard) =>
            floatingCard.type === 'draft' && floatingCard.draftId === draftId,
        );
        const nextResolvedFloatingCards =
          replacementThreadCard && replacementIndex >= 0
            ? nextFloatingCards.map((floatingCard) =>
                floatingCard.type === 'draft' &&
                floatingCard.draftId === draftId
                  ? replacementThreadCard
                  : {
                      ...floatingCard,
                      isFocused: false,
                    },
              )
            : replacementThreadCard
              ? [
                  ...nextFloatingCards.map((floatingCard) => ({
                    ...floatingCard,
                    isFocused: false,
                  })),
                  replacementThreadCard,
                ]
              : nextFloatingCards;

        return {
          activeDraftId:
            state.activeDraftId === draftId ? null : state.activeDraftId,
          isCommentOpen:
            state.activeDraftId === draftId && draft.location === 'drawer'
              ? false
              : state.isCommentOpen,
          inlineDrafts: removeInlineDraft(state.inlineDrafts, draftId),
          // Replace the draft card in place so the floating comments keep the same visual
          // identity instead of closing and reopening as a separate thread card.
          floatingCards: nextResolvedFloatingCards,
          // Mark this thread as locally created so reconcile can preserve it
          // only until consumer-owned comments catch up.
          pendingPrehydrationFloatingThreadIds: replacementThreadCard
            ? addPendingPrehydrationFloatingThreadId(
                state.pendingPrehydrationFloatingThreadIds,
                newComment.id,
              )
            : state.pendingPrehydrationFloatingThreadIds,
        };
      });
    },
    updateFloatingDraftText: (draftId, value) => {
      get().updateInlineDraftText(draftId, value);
    },
    cancelFloatingDraft: (draftId) => {
      get().cancelInlineDraft(draftId);
    },
    submitFloatingDraft: (draftId) => {
      get().submitInlineDraft(draftId);
    },
    openFloatingThread: (commentId) => {
      const { editor, setActiveCommentId } = getExtDeps(get);
      const state = get();
      const commentToOpen =
        state.tabComments.find(
          (comment) =>
            comment.id === commentId &&
            !comment.deleted &&
            !comment.resolved &&
            (comment.isSuggestion || Boolean(comment.selectedContent)),
        ) ?? null;

      if (!editor || !commentToOpen) {
        return;
      }

      const nextFloatingCards = upsertFloatingThreadCard(state.floatingCards, {
        commentId,
        selectedText: commentToOpen.selectedContent || '',
      });

      set({
        floatingCards: nextFloatingCards,
      });
      setActiveCommentId(commentId);
      setActiveComment(editor, commentId);
    },
    focusSubmittedSuggestionFromEditor: (commentId) => {
      const { editor, setActiveCommentId } = getExtDeps(get);
      const state = get();
      const suggestionToFocus = state.tabComments.find(
        (comment) =>
          comment.id === commentId &&
          comment.isSuggestion &&
          !comment.deleted &&
          !comment.resolved,
      );

      if (!editor || !suggestionToFocus) {
        return false;
      }

      if (state.isDesktopFloatingEnabled) {
        state.setActiveCommentId(commentId);
        setActiveCommentId(commentId);
        state.openFloatingThread(commentId);
        return true;
      }

      state.setActiveCommentId(commentId);
      setActiveCommentId(commentId);
      setActiveComment(editor, commentId);
      set({
        openReplyId: commentId,
      });
      state.setCommentDrawerOpen?.(true);
      return true;
    },
    closeFloatingCard: (floatingCardId) => {
      const { editor, setActiveCommentId } = getExtDeps(get);
      const { activeCommentId, floatingCards } = get();
      const floatingCardToClose = floatingCards.find(
        (floatingCard) => floatingCard.floatingCardId === floatingCardId,
      );

      if (!floatingCardToClose) {
        return;
      }

      if (floatingCardToClose.type === 'draft') {
        editor?.commands.unsetDraftComment(floatingCardToClose.draftId);
      } else if (
        floatingCardToClose.type === 'thread' &&
        editor &&
        activeCommentId === floatingCardToClose.commentId
      ) {
        setActiveCommentId(null);
        clearActiveComment(editor);
      }

      set((state) => ({
        activeDraftId:
          floatingCardToClose.type === 'draft' &&
          state.activeDraftId === floatingCardToClose.draftId
            ? null
            : state.activeDraftId,
        inlineDrafts:
          floatingCardToClose.type === 'draft'
            ? removeInlineDraft(state.inlineDrafts, floatingCardToClose.draftId)
            : state.inlineDrafts,
        floatingCards: state.floatingCards.filter(
          (floatingCard) => floatingCard.floatingCardId !== floatingCardId,
        ),
      }));
    },
    blurFloatingCard: (floatingCardId) => {
      const { editor } = getExtDeps(get);
      const { activeCommentId, floatingCards } = get();
      const floatingCardToBlur = floatingCards.find(
        (floatingCard) => floatingCard.floatingCardId === floatingCardId,
      );

      if (!editor || !floatingCardToBlur) {
        return;
      }

      if (
        floatingCardToBlur.type === 'thread' &&
        activeCommentId === floatingCardToBlur.commentId
      ) {
        // Use store action directly — NOT the external dep.
        // External dep would queue a React state update that round-trips
        // back via useEffect, overwriting whatever updateEditorState sets
        // when the user clicks on a different comment.
        get().setActiveCommentId(null);
        clearActiveComment(editor);
      }

      set((state) => ({
        floatingCards: state.floatingCards.map((floatingCard) => ({
          ...floatingCard,
          isFocused: false,
        })),
      }));
    },
    focusFloatingCard: (floatingCardId) => {
      const { editor, setActiveCommentId } = getExtDeps(get);
      const focusedFloatingCard = get().floatingCards.find(
        (floatingCard) => floatingCard.floatingCardId === floatingCardId,
      );

      if (!editor || !focusedFloatingCard) {
        return;
      }

      set((state) => ({
        floatingCards: setFocusedFloatingCard(
          state.floatingCards,
          floatingCardId,
        ),
      }));

      if (focusedFloatingCard.type === 'thread') {
        // Take local ownership immediately so suggestion decorations rebuild
        // with the active state on the same click, then mirror externally.
        get().setActiveCommentId(focusedFloatingCard.commentId);
        setActiveCommentId(focusedFloatingCard.commentId);
        setActiveComment(editor, focusedFloatingCard.commentId);
        return;
      }

      get().setActiveCommentId(null);
      setActiveCommentId(null);
      clearActiveComment(editor);
    },
    removeInvalidFloatingDrafts: () => {
      const { editor } = getExtDeps(get);
      const { floatingCards } = get();

      if (
        !floatingCards.some((floatingCard) => floatingCard.type === 'draft')
      ) {
        return;
      }

      const removedDraftIds = new Set<string>();
      const nextFloatingCards = floatingCards.filter((floatingCard) => {
        if (floatingCard.type !== 'draft') {
          return true;
        }

        const isValid = Boolean(
          editor && getDraftCommentRange(editor.state, floatingCard.draftId),
        );

        if (!isValid) {
          removedDraftIds.add(floatingCard.draftId);
        }

        return isValid;
      });

      if (nextFloatingCards.length === floatingCards.length) {
        return;
      }

      set((state) => {
        let nextInlineDrafts = state.inlineDrafts;

        removedDraftIds.forEach((draftId) => {
          nextInlineDrafts = removeInlineDraft(nextInlineDrafts, draftId);
        });

        return {
          activeDraftId:
            state.activeDraftId && removedDraftIds.has(state.activeDraftId)
              ? null
              : state.activeDraftId,
          inlineDrafts: nextInlineDrafts,
          floatingCards: nextFloatingCards,
        };
      });
    },
    reconcileFloatingThreadsForActiveTab: ({ hydrationReady }) => {
      const { editor, commentAnchorsRef, setActiveCommentId } = getExtDeps(get);
      const {
        activeCommentId,
        activeTabId,
        floatingCards,
        isDesktopFloatingEnabled,
        pendingPrehydrationFloatingThreadIds,
        tabComments,
      } = get();
      const validThreadCommentById = new Map<string, IComment>();
      const pendingPrehydrationFloatingThreadIdSet = new Set(
        pendingPrehydrationFloatingThreadIds,
      );
      const pendingPrehydrationThreadIdsToClear = new Set<string>();
      const tabCommentIdSet = new Set(
        tabComments.flatMap((comment) => (comment.id ? [comment.id] : [])),
      );
      const focusedFloatingThreadCard = floatingCards.find(
        (
          floatingCard,
        ): floatingCard is Extract<CommentFloatingCard, { type: 'thread' }> =>
          isFloatingThreadCard(floatingCard) && floatingCard.isFocused,
      );
      const decorationAnchorById =
        hydrationReady &&
        isDesktopFloatingEnabled &&
        editor &&
        !editor.isDestroyed &&
        commentAnchorsRef
          ? new Map(
              commentAnchorsRef.current.map((anchor) => [anchor.id, anchor]),
            )
          : undefined;

      if (
        hydrationReady &&
        isDesktopFloatingEnabled &&
        editor &&
        !editor.isDestroyed
      ) {
        tabComments.forEach((comment) => {
          const commentId = comment.id;

          if (!commentId) {
            return;
          }

          if ((comment.tabId || DEFAULT_TAB_ID) !== activeTabId) {
            return;
          }

          if (comment.deleted || comment.resolved) {
            return;
          }

          // Regular comments require selectedContent (the highlighted text).
          // Add suggestions are point-anchored and have no selectedContent —
          // letting that gate filter them out makes the auto-spawned thread
          // card disappear on every reconcile (sidebar toggle, live update,
          // etc.). Suggestions are always allowed; their visibility is
          // controlled by isSuggestion / accepted state instead.
          if (!comment.isSuggestion && !comment.selectedContent) {
            return;
          }

          if (
            !hasValidHydratedThreadAnchor({
              comment,
              decorationAnchorById,
              commentAnchorsRef,
              editor,
            })
          ) {
            return;
          }

          validThreadCommentById.set(commentId, comment);
        });

        pendingPrehydrationFloatingThreadIds.forEach((commentId) => {
          // Pending ids expire as soon as they hydrate or lose the unresolved
          // decoration anchor that proves the thread is still valid.
          if (tabCommentIdSet.has(commentId)) {
            pendingPrehydrationThreadIdsToClear.add(commentId);
            return;
          }

          if (
            !hasValidPendingPrehydrationFloatingThreadAnchor({
              commentId,
              decorationAnchorById,
              commentAnchorsRef,
              editor,
            })
          ) {
            pendingPrehydrationThreadIdsToClear.add(commentId);
          }
        });

        // Preserve only just-created floating threads whose canonical comment
        // object has not rehydrated yet. Resolved/deleted threads and any
        // generic focused card fallback must still reconcile away normally.
        if (
          focusedFloatingThreadCard &&
          pendingPrehydrationFloatingThreadIdSet.has(
            focusedFloatingThreadCard.commentId,
          ) &&
          !tabCommentIdSet.has(focusedFloatingThreadCard.commentId) &&
          !pendingPrehydrationThreadIdsToClear.has(
            focusedFloatingThreadCard.commentId,
          ) &&
          !validThreadCommentById.has(focusedFloatingThreadCard.commentId)
        ) {
          validThreadCommentById.set(focusedFloatingThreadCard.commentId, {
            id: focusedFloatingThreadCard.commentId,
            tabId: activeTabId,
            selectedContent: focusedFloatingThreadCard.selectedText,
          });
        }
      }

      const nextPendingPrehydrationFloatingThreadIds =
        removePendingPrehydrationFloatingThreadIds(
          pendingPrehydrationFloatingThreadIds,
          pendingPrehydrationThreadIdsToClear,
        );
      const didPendingPrehydrationIdsChange =
        nextPendingPrehydrationFloatingThreadIds !==
        pendingPrehydrationFloatingThreadIds;

      const focusedThreadCommentId =
        getFocusedFloatingThreadCommentId(floatingCards);
      const nextFocusedThreadCommentId =
        (focusedThreadCommentId &&
        validThreadCommentById.has(focusedThreadCommentId)
          ? focusedThreadCommentId
          : null) ??
        (activeCommentId && validThreadCommentById.has(activeCommentId)
          ? activeCommentId
          : null);
      const didRemoveFocusedThread = Boolean(
        focusedThreadCommentId &&
          !validThreadCommentById.has(focusedThreadCommentId),
      );
      const didRemoveActiveThread = Boolean(
        activeCommentId &&
          hasFloatingThreadCard(floatingCards, activeCommentId) &&
          !validThreadCommentById.has(activeCommentId),
      );
      const includedThreadCommentIds = new Set<string>();
      const nextFloatingCards: CommentFloatingCard[] = [];

      floatingCards.forEach((floatingCard) => {
        if (floatingCard.type === 'draft') {
          nextFloatingCards.push(floatingCard);
          return;
        }

        if (floatingCard.type === 'suggestion-draft') {
          // Suggestion drafts are managed by the draft-model actions; preserve here.
          nextFloatingCards.push(floatingCard);
          return;
        }

        const comment = validThreadCommentById.get(floatingCard.commentId);

        if (!comment) {
          return;
        }

        includedThreadCommentIds.add(floatingCard.commentId);

        const selectedText = comment.selectedContent || '';
        const isFocused = floatingCard.commentId === nextFocusedThreadCommentId;

        nextFloatingCards.push(
          floatingCard.selectedText === selectedText &&
            floatingCard.isFocused === isFocused
            ? floatingCard
            : {
                ...floatingCard,
                selectedText,
                isFocused,
              },
        );
      });

      validThreadCommentById.forEach((comment, commentId) => {
        if (includedThreadCommentIds.has(commentId)) {
          return;
        }

        nextFloatingCards.push({
          floatingCardId: `thread:${commentId}`,
          type: 'thread',
          commentId,
          selectedText: comment.selectedContent || '',
          isFocused: commentId === nextFocusedThreadCommentId,
        });
      });
      const didFloatingCardsChange = !areFloatingCardsEqual(
        floatingCards,
        nextFloatingCards,
      );

      if (!didFloatingCardsChange && !didPendingPrehydrationIdsChange) {
        return;
      }

      if (
        !nextFocusedThreadCommentId &&
        (didRemoveFocusedThread || didRemoveActiveThread)
      ) {
        // Mirror the cleanup locally and externally in the same branch so a
        // reconciled-away thread cannot leave stale active-comment state behind.
        get().setActiveCommentId(null);
        setActiveCommentId(null);
        if (editor) clearActiveComment(editor);
      }

      set({
        floatingCards: nextFloatingCards,
        pendingPrehydrationFloatingThreadIds:
          nextPendingPrehydrationFloatingThreadIds,
      });
    },
    // keep active-comment syncing narrow so a simple external focus
    // change does not force a full thread-anchor reconcile.
    syncFloatingThreadCardWithActiveComment: () => {
      const { activeCommentId, isDesktopFloatingEnabled, tabComments } = get();
      const { editor, commentAnchorsRef } = getExtDeps(get);

      if (!isDesktopFloatingEnabled || !activeCommentId) {
        return;
      }

      const activeThread = tabComments.find(
        (comment) =>
          comment.id === activeCommentId &&
          !comment.deleted &&
          !comment.resolved,
      );

      if (
        !activeThread?.selectedContent ||
        !editor ||
        !hasValidHydratedThreadAnchor({
          comment: activeThread,
          commentAnchorsRef,
          editor,
        })
      ) {
        return;
      }

      set((state) => ({
        floatingCards: upsertFloatingThreadCard(state.floatingCards, {
          commentId: activeCommentId,
          selectedText: activeThread.selectedContent || '',
        }),
      }));
    },
    submitPendingFloatingDrafts: () => {
      const { inlineDrafts, isConnected, username } = get();

      if (!isConnected || !username) {
        return;
      }

      // Authentication can complete after the new comment opened. Replay the same draft
      // records instead of reconstructing intent from transient UI state.
      Object.values(inlineDrafts)
        .filter((draft) => draft.isAuthPending && Boolean(draft.text.trim()))
        .forEach((draft) => {
          get().submitInlineDraft(draft.draftId);
        });
    },
    applyCommentAnchorEdits: (edits) => {
      // Batch-update selected content for edited anchors.
      // This is called after transaction analysis, BEFORE persistence callbacks.
      // Ensures local UI reflects anchor edits immediately, even if persistence is async.
      if (edits.length === 0) {
        return;
      }

      const nextSelectedContentById = new Map(
        edits.map((edit) => [edit.commentId, edit.selectedContent]),
      );
      const nextComments = get().initialComments.map((comment) => {
        const nextSelectedContent = nextSelectedContentById.get(
          comment.id || '',
        );

        if (nextSelectedContent === undefined) {
          return comment;
        }

        return {
          ...comment,
          selectedContent: nextSelectedContent,
        };
      });

      get().setInitialComments(nextComments);

      getExtDeps(get).setInitialComments?.((previousComments) =>
        previousComments.map((comment) => {
          const nextSelectedContent = nextSelectedContentById.get(
            comment.id || '',
          );

          if (nextSelectedContent === undefined) {
            return comment;
          }

          return {
            ...comment,
            selectedContent: nextSelectedContent,
          };
        }),
      );

      set((state) => ({
        floatingCards: state.floatingCards.map((floatingCard) => {
          if (floatingCard.type !== 'thread') {
            return floatingCard;
          }

          const nextSelectedContent = nextSelectedContentById.get(
            floatingCard.commentId,
          );

          if (nextSelectedContent === undefined) {
            return floatingCard;
          }

          return {
            ...floatingCard,
            selectedText: nextSelectedContent,
          };
        }),
      }));
    },
    resolveComment: (commentId) => {
      const {
        editor,
        onResolveComment,
        setActiveCommentId,
        commentAnchorsRef,
      } = getExtDeps(get);

      if (!editor) return;

      const isDecoration = commentAnchorsRef?.current.some(
        (a) => a.id === commentId,
      );

      if (isDecoration && commentAnchorsRef) {
        commentAnchorsRef.current = commentAnchorsRef.current.map((a) =>
          a.id === commentId ? { ...a, resolved: true } : a,
        );
        triggerDecorationRebuild(editor);
        onResolveComment?.(commentId);
      } else {
        const mutationMeta = get().createMutationMeta('resolve', () =>
          editor.commands.resolveComment(commentId),
        );
        onResolveComment?.(commentId, mutationMeta);
      }

      set((state) => ({
        floatingCards: state.floatingCards.filter(
          (floatingCard) =>
            !(
              floatingCard.type === 'thread' &&
              floatingCard.commentId === commentId
            ),
        ),
        // Local resolves can happen before props rehydrate, so remove the
        // temporary preserve marker immediately.
        pendingPrehydrationFloatingThreadIds:
          removePendingPrehydrationFloatingThreadIds(
            state.pendingPrehydrationFloatingThreadIds,
            [commentId],
          ),
      }));

      if (get().activeCommentId === commentId) {
        setActiveCommentId(null);
      }
    },
    unresolveComment: (commentId) => {
      const { editor, onUnresolveComment, commentAnchorsRef } = getExtDeps(get);

      if (!editor) return;

      const isDecoration = commentAnchorsRef?.current.some(
        (a) => a.id === commentId,
      );

      if (isDecoration && commentAnchorsRef) {
        commentAnchorsRef.current = commentAnchorsRef.current.map((a) =>
          a.id === commentId ? { ...a, resolved: false } : a,
        );
        triggerDecorationRebuild(editor);
        onUnresolveComment?.(commentId);
      } else {
        const mutationMeta = get().createMutationMeta('unresolve', () =>
          editor.commands.unresolveComment(commentId),
        );
        onUnresolveComment?.(commentId, mutationMeta);
      }
    },
    deleteComment: (commentId, options) => {
      const {
        editor,
        onDeleteComment,
        setActiveCommentId,
        commentAnchorsRef,
        setInitialComments,
      } = getExtDeps(get);

      if (!editor) return;

      const isDecoration = commentAnchorsRef?.current.some(
        (a) => a.id === commentId,
      );

      if (isDecoration && commentAnchorsRef) {
        const nextComments = get().initialComments.map((comment) =>
          comment.id === commentId ? { ...comment, deleted: true } : comment,
        );
        const mutationMeta = {
          type: 'delete' as const,
        } satisfies CommentMutationMeta;

        get().setInitialComments(nextComments);
        setInitialComments?.((previousComments) =>
          previousComments.map((comment) =>
            comment.id === commentId ? { ...comment, deleted: true } : comment,
          ),
        );

        commentAnchorsRef.current = commentAnchorsRef.current.filter(
          (a) => a.id !== commentId,
        );

        // Fire persistence callback before forcing a decoration rebuild.
        // `triggerDecorationRebuild()` dispatches a transaction; we don't want a
        // nested dispatch to interfere with consumer-side delete persistence.
        if (!options?.skipExternalCallback) {
          onDeleteComment?.(commentId, mutationMeta);
        }
        triggerDecorationRebuild(editor);
      } else {
        const mutationMeta = get().createMutationMeta('delete', () =>
          editor.commands.unsetComment(commentId),
        );
        if (!options?.skipExternalCallback) {
          onDeleteComment?.(commentId, mutationMeta);
        }
      }

      set((state) => ({
        floatingCards: state.floatingCards.filter(
          (floatingCard) =>
            !(
              floatingCard.type === 'thread' &&
              floatingCard.commentId === commentId
            ),
        ),
        // Deletes invalidate the prehydration exception immediately; reconcile
        // must not preserve a thread whose local lifecycle already ended.
        pendingPrehydrationFloatingThreadIds:
          removePendingPrehydrationFloatingThreadIds(
            state.pendingPrehydrationFloatingThreadIds,
            [commentId],
          ),
      }));

      if (get().activeCommentId === commentId) {
        setActiveCommentId(null);
      }
    },
    acceptSuggestion: (commentId) => {
      const {
        editor,
        onResolveComment,
        setActiveCommentId,
        commentAnchorsRef,
      } = getExtDeps(get);

      if (!editor) return;

      const anchor = commentAnchorsRef?.current.find(
        (a) => a.id === commentId && a.isSuggestion,
      );

      if (!anchor || !commentAnchorsRef) return;

      const applied = applyAcceptedSuggestion(editor, anchor);
      if (!applied) return;

      commentAnchorsRef.current = commentAnchorsRef.current.filter(
        (a) => a.id !== commentId,
      );
      triggerDecorationRebuild(editor);

      onResolveComment?.(commentId, {
        type: 'resolve',
        suggestionType: anchor.suggestionType,
        originalContent: anchor.originalContent,
        suggestedContent: anchor.suggestedContent,
      });

      set((state) => ({
        floatingCards: state.floatingCards.filter(
          (floatingCard) =>
            !(
              floatingCard.type === 'thread' &&
              floatingCard.commentId === commentId
            ),
        ),
      }));

      if (get().activeCommentId === commentId) {
        setActiveCommentId(null);
      }
    },

    // --- Suggestion draft operations ---------------------------------------

    appendToDraftAtCursor: (text) => {
      const deps = getExtDeps(get);
      const { editor, draftAnchorsRef } = deps;
      if (!editor) return;

      // The draft is created regardless of connection state. When !isConnected,
      // SuggestionDraftFloatingCard renders FloatingAuthPrompt inside (same
      // pattern as inline comments). The typed character is preserved as the
      // first keystroke so the user keeps what they typed once they join.

      const currentDrafts = get().drafts;
      const activeDraft = findDraftAtEditorCursor(currentDrafts, editor.state);

      let nextDrafts: Record<string, DraftSuggestion>;
      let nextCards = get().floatingCards;
      let activeSuggestionDraftIdAtCursor: string;

      if (activeDraft) {
        const extended: DraftSuggestion = {
          ...activeDraft,
          insertedText: activeDraft.insertedText + text,
          keystrokes: [...activeDraft.keystrokes, text],
        };
        nextDrafts = { ...currentDrafts, [activeDraft.id]: extended };
        // Mirror the updated insertedText on the floating card for the diff preview.
        nextCards = nextCards.map((c) =>
          c.type === 'suggestion-draft' && c.suggestionId === activeDraft.id
            ? { ...c, insertedText: extended.insertedText }
            : c,
        );
        activeSuggestionDraftIdAtCursor = activeDraft.id;
      } else {
        const { from } = editor.state.selection;
        const anchorPoint = createCommentAnchorPointFromEditor(editor, from);
        if (!anchorPoint) return;

        const id = `suggestion-${uuid()}`;
        const newDraft: DraftSuggestion = {
          id,
          anchorFrom: anchorPoint.anchorFrom,
          anchorTo: anchorPoint.anchorTo,
          originalContent: '',
          insertedText: text,
          keystrokes: [text],
          hadDeletion: false,
        };
        nextDrafts = { ...currentDrafts, [id]: newDraft };

        const newCard: SuggestionFloatingDraftCard = {
          type: 'suggestion-draft',
          floatingCardId: `suggestion-draft:${id}`,
          suggestionId: id,
          selectedText: '',
          insertedText: text,
          isFocused: true,
        };
        nextCards = [
          ...nextCards.map((c) => ({ ...c, isFocused: false })),
          newCard,
        ];
        activeSuggestionDraftIdAtCursor = id;
      }

      set({
        drafts: nextDrafts,
        floatingCards: nextCards,
        activeSuggestionDraftIdAtCursor,
      });
      if (draftAnchorsRef) {
        draftAnchorsRef.current =
          Object.values(nextDrafts).map(deriveDraftAnchor);
      }
      triggerDecorationRebuild(editor);
    },

    startDeleteDraft: (from, to, collapseTo) => {
      const deps = getExtDeps(get);
      const { editor, draftAnchorsRef } = deps;
      if (!editor) return;
      if (from >= to) return;

      // Draft is created regardless of connection state — see appendToDraftAtCursor.

      const anchorRange = createCommentAnchorFromEditor(editor, from, to);
      if (!anchorRange) return;

      const originalContent = editor.state.doc.textBetween(from, to, '\n');

      const id = `suggestion-${uuid()}`;
      const newDraft: DraftSuggestion = {
        id,
        anchorFrom: anchorRange.anchorFrom,
        anchorTo: anchorRange.anchorTo,
        originalContent,
        insertedText: '',
        keystrokes: [],
        hadDeletion: true,
      };

      const newCard: SuggestionFloatingDraftCard = {
        type: 'suggestion-draft',
        floatingCardId: `suggestion-draft:${id}`,
        suggestionId: id,
        selectedText: originalContent,
        insertedText: '',
        isFocused: true,
      };

      const nextDrafts = { ...get().drafts, [id]: newDraft };
      const nextCards = [
        ...get().floatingCards.map((c) => ({ ...c, isFocused: false })),
        newCard,
      ];

      syncSuggestionDraftState(set, nextDrafts, nextCards, draftAnchorsRef, id);

      // Collapse the selection at the requested caret position so Backspace
      // stays at the end of the deleted range while forward Delete remains at
      // the start.
      const nextCaretPos = collapseTo ?? to;
      const tr = editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(nextCaretPos)),
      );
      editor.view.dispatch(tr);

      triggerDecorationRebuild(editor);
    },

    startLinkDraft: (from, to, href) => {
      const deps = getExtDeps(get);
      const { editor, draftAnchorsRef } = deps;
      if (!editor) return;
      if (from >= to || !href) return;

      const anchorRange = createCommentAnchorFromEditor(editor, from, to);
      if (!anchorRange) return;

      const originalContent = editor.state.doc.textBetween(from, to, '\n');
      if (!originalContent) return;

      const id = `suggestion-${uuid()}`;
      const newDraft: DraftSuggestion = {
        id,
        anchorFrom: anchorRange.anchorFrom,
        anchorTo: anchorRange.anchorTo,
        originalContent,
        insertedText: '',
        keystrokes: [],
        hadDeletion: false,
        linkHref: href,
      };

      const newCard: SuggestionFloatingDraftCard = {
        type: 'suggestion-draft',
        floatingCardId: `suggestion-draft:${id}`,
        suggestionId: id,
        selectedText: originalContent,
        insertedText: '',
        linkHref: href,
        isFocused: true,
      };

      const nextDrafts = { ...get().drafts, [id]: newDraft };
      const nextCards = [
        ...get().floatingCards.map((c) => ({ ...c, isFocused: false })),
        newCard,
      ];

      syncSuggestionDraftState(set, nextDrafts, nextCards, draftAnchorsRef, id);
      triggerDecorationRebuild(editor);
    },

    deleteAtCursorOrUndoActiveDraft: (direction) => {
      const deps = getExtDeps(get);
      const { editor, draftAnchorsRef } = deps;
      if (!editor) return;

      const activeDraft = findDraftAtEditorCursor(get().drafts, editor.state);
      if (activeDraft) {
        if (isPureDeleteDraft(activeDraft)) {
          const activeRange = resolveCommentAnchorRangeInState(
            activeDraft,
            editor.state,
          );
          if (!activeRange) return;

          const extensionRange = resolveDeleteRangeAtPosition(
            editor.state,
            direction === 'backward' ? activeRange.from : activeRange.to,
            direction,
          );
          if (!extensionRange) return;

          updateDeleteDraftRange({
            setState: set,
            drafts: get().drafts,
            floatingCards: get().floatingCards,
            activeDraft,
            editor,
            draftAnchorsRef,
            from: Math.min(activeRange.from, extensionRange.from),
            to: Math.max(activeRange.to, extensionRange.to),
            collapseTo:
              direction === 'backward' ? activeRange.to : activeRange.from,
          });
          return;
        }

        get().undoLastKeystrokeInActiveDraft();
        return;
      }

      const deleteRange = resolveDeleteRangeAtCursor(editor.state, direction);
      if (!deleteRange) return;

      const collapseTo =
        direction === 'forward' ? deleteRange.from : deleteRange.to;

      get().startDeleteDraft(deleteRange.from, deleteRange.to, collapseTo);
    },

    deleteRangeOrUndoActiveDraft: (from, to) => {
      const deps = getExtDeps(get);
      const { editor, draftAnchorsRef } = deps;
      if (!editor) return;
      if (from >= to) return;

      const activeDraft = findDraftAtEditorCursor(get().drafts, editor.state);
      if (activeDraft) {
        if (isPureDeleteDraft(activeDraft)) {
          const activeRange = resolveCommentAnchorRangeInState(
            activeDraft,
            editor.state,
          );
          if (!activeRange) return;

          updateDeleteDraftRange({
            setState: set,
            drafts: get().drafts,
            floatingCards: get().floatingCards,
            activeDraft,
            editor,
            draftAnchorsRef,
            from: Math.min(activeRange.from, from),
            to: Math.max(activeRange.to, to),
            collapseTo:
              editor.state.selection.empty &&
              from === editor.state.selection.from
                ? from
                : to,
          });
          return;
        }

        get().undoLastKeystrokeInActiveDraft();
        return;
      }

      const collapseTo =
        editor.state.selection.empty && from === editor.state.selection.from
          ? from
          : to;

      get().startDeleteDraft(from, to, collapseTo);
    },

    undoLastKeystrokeInActiveDraft: () => {
      const deps = getExtDeps(get);
      const { editor, draftAnchorsRef } = deps;
      if (!editor) return;

      const activeDraft = findDraftAtEditorCursor(get().drafts, editor.state);
      if (!activeDraft) return;

      const nextKeystrokes = activeDraft.keystrokes.slice(0, -1);
      const nextInsertedText = nextKeystrokes.join('');

      // When no keystrokes remain (pure Add / Replace undone to empty, or
      // pure Delete with no keystrokes ever), discard the draft.
      if (nextKeystrokes.length === 0) {
        get().discardDraft(activeDraft.id);
        return;
      }

      const updated: DraftSuggestion = {
        ...activeDraft,
        keystrokes: nextKeystrokes,
        insertedText: nextInsertedText,
      };
      const nextDrafts = { ...get().drafts, [activeDraft.id]: updated };
      const nextCards = get().floatingCards.map((c) =>
        c.type === 'suggestion-draft' && c.suggestionId === activeDraft.id
          ? { ...c, insertedText: nextInsertedText }
          : c,
      );

      set({
        drafts: nextDrafts,
        floatingCards: nextCards,
        activeSuggestionDraftIdAtCursor: activeDraft.id,
      });
      if (draftAnchorsRef) {
        draftAnchorsRef.current =
          Object.values(nextDrafts).map(deriveDraftAnchor);
      }
      triggerDecorationRebuild(editor);
    },

    discardDraft: (suggestionId) => {
      const deps = getExtDeps(get);
      const { editor, draftAnchorsRef } = deps;

      const currentDrafts = get().drafts;
      if (!currentDrafts[suggestionId]) return;

      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[suggestionId];

      const nextCards = get().floatingCards.filter(
        (c) =>
          !(c.type === 'suggestion-draft' && c.suggestionId === suggestionId),
      );

      set({
        drafts: nextDrafts,
        floatingCards: nextCards,
        activeSuggestionDraftIdAtCursor:
          get().activeSuggestionDraftIdAtCursor === suggestionId
            ? null
            : get().activeSuggestionDraftIdAtCursor,
      });
      if (draftAnchorsRef) {
        draftAnchorsRef.current =
          Object.values(nextDrafts).map(deriveDraftAnchor);
      }
      if (editor) triggerDecorationRebuild(editor);
    },

    refreshDraftOriginalContent: (suggestionId, currentText) => {
      const deps = getExtDeps(get);
      const { draftAnchorsRef } = deps;
      const currentDrafts = get().drafts;
      const draft = currentDrafts[suggestionId];
      if (!draft) return;
      if (draft.originalContent === currentText) return;

      const nextDraft: DraftSuggestion = {
        ...draft,
        originalContent: currentText,
      };
      const nextDrafts = { ...currentDrafts, [suggestionId]: nextDraft };
      const nextCards = get().floatingCards.map((c) =>
        c.type === 'suggestion-draft' && c.suggestionId === suggestionId
          ? { ...c, selectedText: currentText }
          : c,
      );

      set({ drafts: nextDrafts, floatingCards: nextCards });
      if (draftAnchorsRef) {
        draftAnchorsRef.current =
          Object.values(nextDrafts).map(deriveDraftAnchor);
      }
    },

    syncActiveSuggestionDraftAtCursor: () => {
      const { editor } = getExtDeps(get);
      const nextSuggestionDraftIdAtCursor =
        getSuggestionDraftIdAtFocusedEditorCursor(editor, get().drafts);
      const currentState = get();

      if (
        currentState.activeSuggestionDraftIdAtCursor ===
        nextSuggestionDraftIdAtCursor
      ) {
        return;
      }

      set({
        activeSuggestionDraftIdAtCursor: nextSuggestionDraftIdAtCursor,
      });
    },

    submitDraft: (suggestionId) => {
      const deps = getExtDeps(get);
      const { editor, commentAnchorsRef, draftAnchorsRef, onNewComment } = deps;
      if (!editor || !commentAnchorsRef) return;

      const draft = get().drafts[suggestionId];
      if (!draft) return;

      let draftToSubmit = draft;

      if (isRangeDraft(draft)) {
        const currentRange = resolveCommentAnchorRangeInState(
          draft,
          editor.state,
        );
        if (!currentRange) return;

        const currentOriginalContent = editor.state.doc.textBetween(
          currentRange.from,
          currentRange.to,
          '\n',
        );
        if (!currentOriginalContent) return;

        if (currentOriginalContent !== draft.originalContent) {
          draftToSubmit = {
            ...draft,
            originalContent: currentOriginalContent,
          };
        }
      }

      const suggestionType = deriveDraftSuggestionType(draftToSubmit);

      // Promote draft anchor into commentAnchorsRef so the decoration layer
      // reads it from the "submitted" source henceforth.
      const submittedAnchor: CommentAnchor = deriveDraftAnchor(draftToSubmit);
      commentAnchorsRef.current = [
        ...commentAnchorsRef.current,
        submittedAnchor,
      ];

      // Remove from drafts and swap the floating card — same floatingCardId so
      // the card stays in place and the contents transition without remounting.
      const nextDrafts = { ...get().drafts };
      delete nextDrafts[suggestionId];

      const nextCards = get().floatingCards.map((c) => {
        if (c.type === 'suggestion-draft' && c.suggestionId === suggestionId) {
          const threadCard: CommentFloatingThreadCard = {
            type: 'thread',
            floatingCardId: c.floatingCardId,
            commentId: draftToSubmit.id,
            selectedText: draftToSubmit.originalContent,
            isFocused: c.isFocused,
          };
          return threadCard;
        }

        return c;
      });

      // Build IComment now so we can pre-populate local state and avoid a
      // "Loading encrypted comments" flash while the consumer round-trips
      // the new comment back through onNewComment → setInitialComments.
      const newComment: IComment = {
        id: draftToSubmit.id,
        tabId: get().activeTabId,
        username: get().username ?? undefined,
        selectedContent: draftToSubmit.originalContent,
        content: '',
        replies: [],
        isSuggestion: true,
        suggestionType,
        originalContent: draftToSubmit.originalContent,
        suggestedContent: draftToSubmit.linkHref ?? draftToSubmit.insertedText,
        resolved: false,
        deleted: false,
        createdAt: new Date(),
      };

      set({
        drafts: nextDrafts,
        floatingCards: nextCards,
        activeSuggestionDraftIdAtCursor:
          get().activeSuggestionDraftIdAtCursor === suggestionId
            ? null
            : get().activeSuggestionDraftIdAtCursor,
      });
      if (draftAnchorsRef) {
        draftAnchorsRef.current =
          Object.values(nextDrafts).map(deriveDraftAnchor);
      }
      // Pre-populate initialComments / tabComments so the thread card renders
      // with real data on the very next paint. Consumer's subsequent round-trip
      // via onNewComment replaces this list harmlessly (same content + any
      // extra metadata like commentIndex).
      get().setInitialComments([...get().initialComments, newComment]);
      triggerDecorationRebuild(editor);

      const meta: CommentMutationMeta = {
        type: 'create',
        anchorFrom: fromUint8Array(
          Y.encodeRelativePosition(draftToSubmit.anchorFrom),
        ),
        anchorTo: fromUint8Array(
          Y.encodeRelativePosition(draftToSubmit.anchorTo),
        ),
        suggestionType,
        originalContent: draftToSubmit.originalContent,
        suggestedContent: draftToSubmit.linkHref ?? draftToSubmit.insertedText,
      };

      onNewComment?.(newComment, meta);
    },

    deleteReply: (commentId, replyId) => {
      const { onDeleteReply, setInitialComments } = getExtDeps(get);
      const currentComments = get().initialComments;
      const nextComments = currentComments.map((comment) => {
        if (comment.id !== commentId) {
          return comment;
        }

        return {
          ...comment,
          replies: (comment.replies || []).map((reply) =>
            reply.id === replyId ? { ...reply, deleted: true } : reply,
          ),
        };
      });

      get().setInitialComments(nextComments);
      setInitialComments?.(nextComments);
      onDeleteReply?.(commentId, replyId);
    },
    requestEditComment: (commentId) => {
      const comment = findCommentById(get().initialComments, commentId);
      if (!comment) {
        return;
      }

      set({
        // Fire-and-forget signal: whichever UI owns the active thread input
        // should prefill its textarea and enter edit mode.
        editRequest: {
          requestId: `edit-${uuid()}`,
          kind: 'comment',
          commentId,
          text: comment.content || '',
        },
      });
    },
    requestEditReply: (commentId, replyId) => {
      const reply = findReplyById(get().initialComments, commentId, replyId);
      if (!reply) {
        return;
      }

      set({
        editRequest: {
          requestId: `edit-${uuid()}`,
          kind: 'reply',
          commentId,
          replyId,
          text: reply.content || '',
        },
      });
    },
    editCommentContent: (commentId, content) => {
      if (!content.trim()) {
        return;
      }

      const { setInitialComments } = getExtDeps(get);
      const currentComments = get().initialComments;
      const existingComment = findCommentById(currentComments, commentId);

      if (!existingComment) {
        return;
      }

      const nextComments = currentComments.map((comment) =>
        comment.id === commentId ? { ...comment, content } : comment,
      );

      // const mutationMeta = {
      //   type: 'edit' as const,
      //   content,
      // } satisfies CommentMutationMeta;

      // Optimistic local update: keep the UI in sync immediately.
      get().setInitialComments(nextComments);
      setInitialComments?.(nextComments);

      // External persistence hook for consumers (e.g. API/DB sync).
      // onEditComment?.(commentId, mutationMeta);
      const activeEdit = get().replyEditTarget;
      if (
        activeEdit &&
        activeEdit.kind === 'comment' &&
        activeEdit.commentId === commentId
      ) {
        // If the drawer is currently editing this comment, clear its shared
        // input state so we don't keep "editing mode" active after submit.
        set({ reply: '', replyEditTarget: null });
      }
      set((state) => ({
        // Notify local-state inputs (floating / drawer) to clear their drafts.
        editCompletion: {
          nonce: (state.editCompletion?.nonce ?? 0) + 1,
          kind: 'comment',
          commentId,
        },
      }));
    },
    editReplyContent: (commentId, replyId, content) => {
      if (!content.trim()) {
        return;
      }

      const { onEditReply, setInitialComments } = getExtDeps(get);
      const currentComments = get().initialComments;
      const existingReply = findReplyById(currentComments, commentId, replyId);

      if (!existingReply) {
        return;
      }

      const nextComments = currentComments.map((comment) => {
        if (comment.id !== commentId) {
          return comment;
        }

        return {
          ...comment,
          replies: (comment.replies || []).map((reply) =>
            reply.id === replyId ? { ...reply, content } : reply,
          ),
        };
      });

      const mutationMeta = {
        type: 'edit' as const,
        content,
      } satisfies CommentMutationMeta;

      // Optimistic local update: keep the UI in sync immediately.
      get().setInitialComments(nextComments);
      setInitialComments?.(nextComments);

      // External persistence hook for consumers (e.g. API/DB sync).
      onEditReply?.(commentId, replyId, mutationMeta);
      const activeEdit = get().replyEditTarget;
      if (
        activeEdit &&
        activeEdit.kind === 'reply' &&
        activeEdit.commentId === commentId &&
        activeEdit.replyId === replyId
      ) {
        // Clear drawer shared edit state on successful submit.
        set({ reply: '', replyEditTarget: null });
      }
      set((state) => ({
        // Notify local-state inputs (floating / drawer) to clear their drafts.
        editCompletion: {
          nonce: (state.editCompletion?.nonce ?? 0) + 1,
          kind: 'reply',
          commentId,
          replyId,
        },
      }));
    },
    handleAddReply: (activeCommentId, replyContent, replyCallback) => {
      if (!replyContent.trim()) {
        return;
      }

      const { activeTabId, username } = get();
      const { onCommentReply } = getExtDeps(get);
      const newReply: IComment = {
        id: `reply-${uuid()}`,
        tabId: activeTabId,
        content: replyContent,
        username: username!,
        replies: [],
        createdAt: new Date(),
        selectedContent: '',
      };
      const callback = replyCallback ?? onCommentReply;
      callback?.(activeCommentId, newReply);
    },
    focusCommentInEditor: (commentId, options) => {
      const { editor, setActiveCommentId, commentAnchorsRef } = getExtDeps(get);

      const foundComment = get()
        .getTabComments()
        .find((comment) => comment.id === commentId);

      if (!foundComment) {
        return;
      }

      if (editor?.view?.dom) {
        const selectionRange = resolveCommentSelectionRange({
          editor,
          commentId,
          commentAnchorsRef,
        });

        if (selectionRange) {
          const tr = editor.state.tr.setSelection(
            selectionRange.from === selectionRange.to
              ? TextSelection.near(
                  editor.state.doc.resolve(selectionRange.from),
                )
              : TextSelection.create(
                  editor.state.doc,
                  selectionRange.from,
                  selectionRange.to,
                ),
          );

          if (options?.source === 'explicit-ui') {
            // Stamp the selection transaction itself so downstream selection
            // listeners can tell this came from an intentional UI thread jump.
            tr.setMeta(EXPLICIT_COMMENT_FOCUS_META, { commentId });
          }

          editor.view.dispatch(tr);
          set({ isBubbleMenuSuppressed: true });
          setActiveComment(editor, commentId);

          // Keep the nested requestAnimationFrame so the editor selection and
          // active comment styling settle before measuring scroll coordinates.
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              scrollCommentSelectionRangeIntoView({
                editor,
                selectionRange,
              });
            });
          });
        }
      }

      // Keep suggestion-widget active styling in sync immediately instead of
      // waiting for the external activeCommentId round-trip.
      get().setActiveCommentId(commentId);
      setActiveCommentId(commentId);
    },
    focusSuggestionDraftInEditor: (suggestionId) => {
      const { editor, setActiveCommentId } = getExtDeps(get);
      const draft = get().drafts[suggestionId];

      if (!editor?.view?.dom || !draft) {
        return;
      }

      const anchor = deriveDraftAnchor(draft);
      const selectionRange =
        anchor.suggestionType === 'add'
          ? (() => {
              const point = resolveCommentAnchorPointInState(
                anchor,
                editor.state,
              );
              return point === null ? null : { from: point, to: point };
            })()
          : resolveCommentAnchorRangeInState(anchor, editor.state);

      if (!selectionRange) {
        return;
      }

      const tr = editor.state.tr.setSelection(
        selectionRange.from === selectionRange.to
          ? TextSelection.near(editor.state.doc.resolve(selectionRange.from))
          : TextSelection.create(
              editor.state.doc,
              selectionRange.from,
              selectionRange.to,
            ),
      );

      editor.view.dispatch(tr);
      editor.view.focus();
      set({ isBubbleMenuSuppressed: true });
      get().setActiveCommentId(null);
      setActiveCommentId(null);
      clearActiveComment(editor);
      set((state) => ({
        floatingCards: setFocusedFloatingCard(
          state.floatingCards,
          `suggestion-draft:${suggestionId}`,
        ),
        activeSuggestionDraftIdAtCursor: suggestionId,
      }));

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          scrollCommentSelectionRangeIntoView({
            editor,
            selectionRange,
          });
        });
      });
    },
    onPrevComment: () => {
      const { editor } = getExtDeps(get);

      if (!editor?.view?.dom) {
        return;
      }

      const activeCommentIndex = get().getActiveCommentIndex();
      const activeComments = get().getActiveComments();

      if (activeCommentIndex > 0) {
        const previousComment = activeComments[activeCommentIndex - 1];
        const commentElement = editor.view.dom.querySelector<HTMLElement>(
          `[data-comment-id="${previousComment.id}"]`,
        );

        if (commentElement) {
          const from = editor.view.posAtDOM(commentElement, 0);
          const to = from + (commentElement.textContent?.length ?? 0);
          editor.commands.setTextSelection({ from, to });
          get().focusCommentInEditor(previousComment.id || '');
        }
      }
    },
    onNextComment: () => {
      const { editor } = getExtDeps(get);

      if (!editor?.view?.dom) {
        return;
      }

      const activeCommentIndex = get().getActiveCommentIndex();
      const activeComments = get().getActiveComments();

      if (activeCommentIndex < activeComments.length - 1) {
        const nextComment = activeComments[activeCommentIndex + 1];
        const commentElement = editor.view.dom.querySelector<HTMLElement>(
          `[data-comment-id="${nextComment.id}"]`,
        );

        if (commentElement) {
          const from = editor.view.posAtDOM(commentElement, 0);
          const to = from + (commentElement.textContent?.length ?? 0);
          editor.commands.setTextSelection({ from, to });
          get().focusCommentInEditor(nextComment.id || '');
        }
      }
    },
    getEnsStatus: async (walletAddress, setEnsStatus) => {
      const { ensCache, inProgressFetch } = get();
      const { ensResolutionUrl } = getExtDeps(get);

      if (inProgressFetch.includes(walletAddress)) {
        setEnsStatus({ name: walletAddress || 'Anonymous', isEns: false });
        return;
      }

      if (walletAddress && ensCache[walletAddress]) {
        setEnsStatus({ ...ensCache[walletAddress] });
        return;
      }

      if (!walletAddress || !ensResolutionUrl) {
        setEnsStatus({ name: walletAddress || 'Anonymous', isEns: false });
        return;
      }

      try {
        set({ inProgressFetch: [...inProgressFetch, walletAddress] });

        const { isEns, name, resolved } = await getAddressName(
          walletAddress,
          ensResolutionUrl,
        );

        if (resolved) {
          const newCache = {
            ...get().ensCache,
            [walletAddress]: { name, isEns },
          };
          localStorage.setItem('ensCache', JSON.stringify(newCache));
          set({ ensCache: newCache });
        }

        set({
          inProgressFetch: get().inProgressFetch.filter(
            (item) => item !== walletAddress,
          ),
        });
        setEnsStatus({ name, isEns });
      } catch (error) {
        console.error('Error fetching ENS name:', error);
        setEnsStatus({ name: walletAddress || 'Anonymous', isEns: false });
      }
    },

    // --- Internal ---
    createMutationMeta: (type, mutate) => {
      const { ydoc } = getExtDeps(get);

      if (!ydoc) {
        return undefined;
      }

      const beforeStateVector = Y.encodeStateVector(ydoc);
      const hasMutated = mutate();

      if (!hasMutated) {
        return undefined;
      }

      const update = Y.encodeStateAsUpdate(ydoc, beforeStateVector);

      if (!update || update.byteLength === 0) {
        return undefined;
      }

      return { type, updateChunk: fromUint8Array(update) };
    },
  }));

// ---------------------------------------------------------------------------
// React integration
// ---------------------------------------------------------------------------

type CommentStore = ReturnType<typeof createCommentStore>;

export const CommentStoreContext = createContext<CommentStore | null>(null);

export function useCommentStore<T>(
  selector: (state: CommentStoreState) => T,
): T {
  const store = useContext(CommentStoreContext);

  if (!store) {
    throw new Error('useCommentStore must be used within CommentStoreProvider');
  }

  return useStore(store, selector);
}

/**
 * Non-throwing variant of useCommentStore: returns undefined when no
 * CommentStoreProvider is above the caller (e.g. useEditorCommands used
 * outside DdocEditor). The selector's RETURN VALUE must be Object.is-stable
 * for unchanged state (primitives or refs already held by the store) —
 * useSyncExternalStore compares snapshots with Object.is, so a selector
 * that constructs a fresh object/array per call would re-render forever.
 * Selector function identity itself doesn't matter.
 */
export function useCommentStoreOptional<T>(
  selector: (state: CommentStoreState) => T,
): T | undefined {
  const store = useContext(CommentStoreContext);
  const subscribe = useCallback(
    (onChange: () => void) => (store ? store.subscribe(onChange) : () => {}),
    [store],
  );
  const getSnapshot = () => (store ? selector(store.getState()) : undefined);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
