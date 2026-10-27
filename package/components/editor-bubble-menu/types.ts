/* eslint-disable @typescript-eslint/no-explicit-any */
import { Editor } from '@tiptap/react';
import { BubbleMenuProps } from '@tiptap/react/menus';
import { SetStateAction } from 'react';
import {
  InlineCommentData,
  IpfsImageFetchPayload,
  IpfsImageUploadResponse,
} from '../../types';

export interface BubbleMenuItem {
  name: string;
  isActive: () => boolean;
  command: () => void;
  icon: any;
}

export type EditorBubbleMenuProps = Omit<BubbleMenuProps, 'children'> & {
  activeCommentId: string | null;
  isPreviewMode: boolean;
  disableInlineComment: boolean;
  onError?: (errorString: string) => void;
  setIsCommentSectionOpen?: (isOpen: boolean) => void;
  inlineCommentData?: InlineCommentData;
  setInlineCommentData?: React.Dispatch<
    React.SetStateAction<InlineCommentData>
  >;
  walletAddress?: string;
  username?: string;
  onInlineComment?: () => void;
  commentDrawerOpen?: boolean;
  setCommentDrawerOpen?: React.Dispatch<SetStateAction<boolean>>;
  isCollabDocumentPublished?: boolean | undefined;
  enableCollaboration?: boolean;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
  isCollabDocOwner?: boolean;
};

export interface NodeSelectorProps {
  editor: Editor;
  elementRef: React.RefObject<HTMLDivElement>;
}
