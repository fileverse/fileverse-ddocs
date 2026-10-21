import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { IComment } from '../../../extensions/comment';
import type { CommentStoreState } from '../../../stores/comment-store';
import type { CommentStoreProviderProps } from '../../../stores/comment-store-provider';
import type { CommentAccountProps } from '../../../types';

export interface CommentFloatingBaseCard {
  floatingCardId: string;
  selectedText: string;
  isFocused: boolean;
}

export type InlineDraftLocation = 'drawer' | 'floating';

export interface InlineCommentDraft {
  draftId: string;
  // Capture the intended tab when the draft is created so later submission
  // does not depend on whichever tab happens to be active then.
  tabId: string;
  selectedText: string;
  text: string;
  // The UI location is tracked explicitly so open/close behavior can differ
  // without splitting draft semantics between mobile and desktop code paths.
  location: InlineDraftLocation;
  isAuthPending: boolean;
}

export interface CommentFloatingDraftCard extends CommentFloatingBaseCard {
  type: 'draft';
  draftId: string;
}

export interface CommentFloatingThreadCard extends CommentFloatingBaseCard {
  type: 'thread';
  commentId: string;
  createdAt?: Date;
}

export interface SuggestionFloatingDraftCard extends CommentFloatingBaseCard {
  type: 'suggestion-draft';
  suggestionId: string;
  /** Accumulated inserted text from the live suggestion context. */
  insertedText: string;
  /** Pasted link href for link suggestions. */
  linkHref?: string;
}

export type CommentFloatingCard =
  | CommentFloatingDraftCard
  | CommentFloatingThreadCard
  | SuggestionFloatingDraftCard;

export interface InlineCommentData {
  highlightedTextContent?: string;
  inlineCommentText: string;
  handleClick: boolean;
}

export interface EnsEntry {
  name: string;
  isEns: boolean;
}

export type EnsCache = Record<string, EnsEntry>;

export type CommentProviderProps = CommentStoreProviderProps;

export type CommentContextType = Pick<
  CommentStoreState,
  | 'activeComment'
  | 'activeCommentIndex'
  | 'activeComments'
  | 'activeTabId'
  | 'addComment'
  | 'blurFloatingCard'
  | 'cancelFloatingDraft'
  | 'closeFloatingCard'
  | 'comment'
  | 'connectViaUsername'
  | 'connectViaWallet'
  | 'createFloatingDraft'
  | 'deleteComment'
  | 'deleteReply'
  | 'ensCache'
  | 'floatingCards'
  | 'focusCommentInEditor'
  | 'focusFloatingCard'
  | 'getEnsStatus'
  | 'handleAddReply'
  | 'handleCommentChange'
  | 'handleCommentKeyDown'
  | 'handleCommentSubmit'
  | 'handleInlineComment'
  | 'handleInput'
  | 'handleReplyChange'
  | 'handleReplyKeyDown'
  | 'handleReplySubmit'
  | 'inlineCommentData'
  | 'isBubbleMenuSuppressed'
  | 'isCommentActive'
  | 'isCommentOpen'
  | 'isCommentResolved'
  | 'isConnected'
  | 'isDDocOwner'
  | 'isDesktopFloatingEnabled'
  | 'isLoading'
  | 'onComment'
  | 'onNextComment'
  | 'onPrevComment'
  | 'openFloatingThread'
  | 'openReplyId'
  | 'reply'
  | 'resolveComment'
  | 'setComment'
  | 'setCommentDrawerOpen'
  | 'setInlineCommentData'
  | 'setIsBubbleMenuSuppressed'
  | 'setOpenReplyId'
  | 'setReply'
  | 'setShowResolved'
  | 'setUsername'
  | 'selectedText'
  | 'showResolved'
  | 'submitFloatingDraft'
  | 'toggleResolved'
  | 'unresolveComment'
  | 'updateFloatingDraftText'
  | 'username'
> & {
  comments: IComment[];
  commentsSectionRef: RefObject<HTMLDivElement>;
  dropdownRef: RefObject<HTMLDivElement>;
  buttonRef: RefObject<HTMLDivElement>;
  portalRef: RefObject<HTMLDivElement>;
  replySectionRef: RefObject<HTMLDivElement>;
  editor: CommentStoreProviderProps['editor'];
  ensResolutionUrl: string;
  onCommentReply?: CommentStoreProviderProps['onCommentReply'];
  setComments?: Dispatch<SetStateAction<IComment[]>>;
};

export interface CommentUsernameProps extends CommentAccountProps {
  username?: string | null;
  setUsername?: Dispatch<SetStateAction<string>>;
  isNavbarVisible?: boolean;
}
