import type { Editor } from '@tiptap/react';
import type { ReactNode, RefObject } from 'react';
import type { IComment } from '../../../extensions/comment';
import type {
  CommentFloatingDraftCard,
  CommentFloatingThreadCard,
  SuggestionFloatingDraftCard,
} from '../context/types';

export type RegisterCardNode = (
  floatingCardId: string,
  node: HTMLDivElement | null,
) => void;

export interface CommentFloatingContainerProps {
  editor: Editor;
  editorWrapperRef: RefObject<HTMLDivElement>;
  scrollContainerRef: RefObject<HTMLDivElement>;
  tabName: string;
  isHidden: boolean;
}

export interface FloatingCardShellProps {
  floatingCardId: string;
  isHidden: boolean;
  isFocused: boolean;
  onFocus: () => void;
  children: ReactNode;
}

export interface DraftFloatingCardProps {
  draft: CommentFloatingDraftCard;
  isHidden: boolean;
  registerCardNode: RegisterCardNode;
}

export interface ThreadFloatingCardProps {
  thread: CommentFloatingThreadCard;
  comment: IComment | undefined;
  tabName: string;
  isHidden: boolean;
  registerCardNode: RegisterCardNode;
}

export interface SuggestionDraftFloatingCardProps {
  card: SuggestionFloatingDraftCard;
  isHidden: boolean;
  registerCardNode: RegisterCardNode;
}
