import { BubbleMenuProps } from '@tiptap/react/menus';
import { Editor } from '@tiptap/react';
import { IComment } from '../../extensions/comment';
import { SetStateAction } from 'react';
import { Tab } from '../tabs/utils/tab-utils';

export interface UseCommentActionsProps {
  editor: Editor;
  comments: IComment[];
  setComments: (comments: IComment[]) => void;
}

export interface CommentDropdownProps {
  editor: Editor;
  onSubmit: (content: string) => string;
  onClose: () => void;
  setComments?: (comments: IComment[]) => void;
  comments?: IComment[];
  username?: string;
  walletAddress?: string;
  activeCommentId?: string;
  commentDrawerOpen?: boolean;
  setCommentDrawerOpen?: React.Dispatch<SetStateAction<boolean>>;
  initialComment?: string;
  isBubbleMenu?: boolean;
  selectedContent?: string;
  isDisabled?: boolean;
  isCommentOwner?: boolean;
}

export interface CommentDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isNavbarVisible: boolean;
  isPresentationMode: boolean;
  activeCommentId: string | null;
  activeTabId: string;
  onTabChange?: (tabId: string) => void;
  isPreviewMode: boolean;
  tabs: Tab[];
  // The mobile sheet renders here, outside the scrolling canvas: iOS Safari
  // clips a fixed element's painting to an ancestor scroller.
  mobileContainer?: HTMLElement | null;
}

export interface CommentCardProps extends IComment {
  comment?: string;
  onResolve?: (commentId: string) => void;
  onDelete?: (commentId: string) => void;
  onRequestDelete?: (commentId: string) => void;
  onUnresolve?: (commentId: string) => void;
  onFocusRequest?: () => void;
  isResolved?: boolean;
  isDropdown?: boolean;
  activeCommentId?: string;
  isDisabled?: boolean;
  isCommentOwner?: boolean;
  canResolveComment?: boolean;
  version?: string;
  emptyComment?: boolean;
  isFocused?: boolean;
  isCommentDrawerContext?: boolean;
}

export type CommentBubbleMenuProps = Omit<BubbleMenuProps, 'children'>;

export interface CommentReplyProps {
  commentId: string;
  replyId: string;
  reply: string;
  username: string;
  createdAt: Date;
  isLast: boolean;
  isThreadResolved?: boolean;
  isCommentDrawerContext?: boolean;
}

export interface EnsStatus {
  name: string;
  isEns: boolean;
}

export interface CommentSectionProps {
  activeCommentId: string | null;
  isNavbarVisible?: boolean;
  isPresentationMode?: boolean;
  isMobile?: boolean;
  comments?: IComment[];
  commentType?: 'all' | 'active' | 'resolved';
  sectionLabel?: string;
  tabNameById?: Record<string, string>;
  selectedTabLabel?: string;
  newCommentTabId?: string;
  showNewCommentInput?: boolean;
  onCommentFocus?: (commentId: string, tabId?: string) => void;
  onReset?: () => void;
}

export interface UserDisplayProps {
  username: string;
  createdAt: Date | undefined;
}
