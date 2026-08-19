/* eslint-disable @typescript-eslint/no-explicit-any */
import { TagType } from '@fileverse/ui';
import { Extension, JSONContent } from '@tiptap/core';
import { EditorProps } from '@tiptap/pm/view';
import { Editor } from '@tiptap/react';
import React, { SetStateAction } from 'react';
import { IComment } from './extensions/comment';
import { CollaborationProps } from './sync-local/types';

// Re-export collaboration types for consumer access via @fileverse-dev/ddoc/types
export type {
  CollaborationProps,
  CollabConnectionConfig,
  CollabSessionMeta,
  CollabServices,
  CollabCallbacks,
  CollabState,
  CollabError,
  CollabErrorCode,
  CollabStatus,
} from './sync-local/types';

export const DdocEditorProps: EditorProps = {
  attributes: {
    class: `prose-lg prose-headings:font-display prose prose-p:my-2 prose-h1:my-2 prose-h2:my-2 prose-h3:my-2 prose-ul:my-2 prose-ol:my-2 max-w-none focus:outline-none w-full main-doc-editor`,
    spellcheck: 'true',
    suppressContentEditableWarning: 'true',
  },
};

export interface IDocCollabUsers {
  clientId: string | number;
  name: string;
  isEns: string;
  color: string;
  isPlaceholder?: boolean;
}

export type InlineCommentData = {
  inlineCommentText: string;
  highlightedTextContent: string;
  handleClick: boolean;
};

export type CommentMutationType =
  | 'create'
  | 'edit'
  | 'resolve'
  | 'unresolve'
  | 'delete';

export type SuggestionType = 'add' | 'replace' | 'delete' | 'link';

export interface CommentMutationMeta {
  type: CommentMutationType;
  updateChunk?: string;
  anchorFrom?: string;
  anchorTo?: string;
  selectedContent?: string;
  content?: string;
  suggestionType?: SuggestionType;
  originalContent?: string;
  suggestedContent?: string;
}

export interface SerializedCommentAnchor {
  id: string;
  anchorFrom: string;
  anchorTo: string;
  resolved: boolean;
  deleted: boolean;
  isSuggestion?: boolean;
  suggestionType?: SuggestionType;
  originalContent?: string;
  suggestedContent?: string;
}

export interface CommentAccountProps {
  isConnected?: boolean;
  connectViaWallet?: () => Promise<void>;
  isLoading?: boolean;
  connectViaUsername?: (username: string) => Promise<void>;
  isDDocOwner?: boolean;
}

export interface CustomModel {
  id?: string;
  label: string;
  modelName: string;
  endpoint: string;
  contextSize: number;
  apiKey: string;
  systemPrompt: string;
}

export type ThemeKey =
  | 'light'
  | 'dark'
  | 'theme-sepia'
  | 'theme-pink'
  | 'theme-green';

export interface ThemeVariantValue {
  light: string;
  dark: string;
  sepia?: string;
  [key: string]: string | undefined;
}

export type DocumentStylingValue = string | ThemeVariantValue;

/**
 * Document styling configuration interface
 * @description Defines the styling options available for customizing the document editor appearance
 */
export interface DocumentStyling {
  /**
   * Outer page/document background
   * @description Controls the background of the entire editor area. Supports solid colors and CSS gradients.
   * @example "#f8f9fa" | "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" | { light: "#f8f9fa", dark: "#1e1f22" }
   */
  background?: DocumentStylingValue;

  /**
   * Editor content area background
   * @description Controls the background color of the actual editor content where text is written. Should be solid colors for readability.
   * @example "#ffffff" | "#f5f5f5" | { light: "#ffffff", dark: "#1e1f22" }
   */
  canvasBackground?: DocumentStylingValue;

  /**
   * Text color
   * @description Controls the color of the text content in the editor.
   * @example "#000000" | "#1a1a1a" | { light: "#1a1a1a", dark: "#e8ebec" }
   */
  textColor?: DocumentStylingValue;

  /**
   * Font family
   * @description Controls the font family used for the editor content.
   * @example "Inter" | "Arial" | "Georgia"
   */
  fontFamily?: string;

  /**
   * Canvas orientation
   * @description Controls the orientation and dimensions of the editor canvas. Portrait is the default orientation with standard document width. Landscape provides a wider canvas for horizontal content layouts.
   * @default "portrait"
   * @example "portrait" | "landscape"
   */
  orientation?: 'portrait' | 'landscape';

  /**
   * Custom CSS
   * @description The author's escape hatch for styling the document beyond the
   * structured options above. Write BARE selectors (`h1 { … }`, `p { … }`,
   * `blockquote { … }`) — they are auto-scoped to the document content, so rules
   * can't leak into the toolbar or the host app. Bare top-level declarations
   * (e.g. `background`, `font-family`) style the document surface itself.
   * Applies live in the editor, in preview, and in exports (Markdown/HTML).
   * @example "h1 { letter-spacing: -0.02em } p { line-height: 1.8 }"
   */
  customCSS?: string;
}
export interface DdocProps extends CommentAccountProps {
  /**
   * Optional catalog of fonts available to the editor in addition to the
   * package baseline (system fonts only). Each entry is loaded lazily via the
   * CSS Font Loading API when first selected in the picker or when a document
   * references its family.
   */
  fonts?: FontDescriptor[];
  tabConfig?: {
    onCopyTabLink?: (tabId: string) => void;
    defaultTabId?: string;
  };
  versionHistoryState?: {
    enabled: boolean;
    versionId: string;
    content: string | string[];
    onActiveTabChange?: (tabId: string | null) => void;
  };
  tabSectionContainer?: HTMLElement;
  isCollabDocumentPublished?: boolean;
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
  disableInlineComment?: boolean;
  //Comments V2 Props
  commentDrawerOpen?: boolean;
  setCommentDrawerOpen?: React.Dispatch<SetStateAction<boolean>>;
  initialComments?: IComment[];
  initialCommentAnchors?: SerializedCommentAnchor[];
  setInitialComments?: React.Dispatch<SetStateAction<IComment[]>>;
  onCommentReply?: (activeCommentId: string, reply: IComment) => void;
  onNewComment?: (newComment: IComment, meta?: CommentMutationMeta) => void;
  onEditComment?: (activeCommentId: string, meta?: CommentMutationMeta) => void;
  onEditReply?: (
    activeCommentId: string,
    replyId: string,
    meta?: CommentMutationMeta,
  ) => void;
  onResolveComment?: (
    activeCommentId: string,
    meta?: CommentMutationMeta,
  ) => void;
  onUnresolveComment?: (
    activeCommentId: string,
    meta?: CommentMutationMeta,
  ) => void;
  onDeleteComment?: (
    activeCommentId: string,
    meta?: CommentMutationMeta,
  ) => void;
  onDeleteReply?: (activeCommentId: string, replyId: string) => void;
  //Comments V2 Props
  showTOC?: boolean;
  setShowTOC?: React.Dispatch<SetStateAction<boolean>>;
  extensions?: Record<string, Extension | any>;
  selectedTags?: TagType[];
  setSelectedTags?: React.Dispatch<SetStateAction<TagType[]>>;
  collaboration?: CollaborationProps;
  setIsCommentSectionOpen?: React.Dispatch<SetStateAction<boolean>>;
  inlineCommentData?: InlineCommentData;
  setInlineCommentData?: React.Dispatch<
    React.SetStateAction<InlineCommentData>
  >;
  theme?: ThemeKey;
  zoomLevel: string;
  setZoomLevel: React.Dispatch<SetStateAction<string>>;
  isNavbarVisible: boolean;
  setIsNavbarVisible: React.Dispatch<SetStateAction<boolean>>;
  editorCanvasClassNames?: string;
  isCommentSectionOpen?: boolean;
  isPreviewMode: boolean;
  viewerMode?: 'suggest' | 'view-only';
  ensResolutionUrl?: string;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  enableIndexeddbSync?: boolean;
  ddocId?: string;
  initialContent?: JSONContent | string | string[] | null;
  /**
   * Schema for newly created docs only: 1 = dBlock (default), 2 = flat.
   * Ignored for existing docs, which always follow the schemaVersion marker
   * stored inside the doc itself.
   */
  preferredSchemaVersion?: 1 | 2;
  walletAddress?: string | null;
  username?: string | null;
  setUsername?: React.Dispatch<SetStateAction<string>>;
  renderNavbar?: ({
    editor,
    liveEditor,
  }: {
    /** JSON snapshot — legacy field, unchanged. */
    editor: JSONContent;
    /** Live Tiptap editor instance (D8) — null until the editor is ready. */
    liveEditor: Editor | null;
  }) => JSX.Element;
  onChange?: (
    updatedDocContent: string | JSONContent,
    updateChunk: string,
  ) => void;
  onCollaboratorChange?: (collaborators: undefined | IDocCollabUsers[]) => void;
  onTextSelection?: (data: IEditorSelectionData) => void;
  onCommentInteraction?: (data: IEditorSelectionData) => void;
  handleCommentButtonClick?: (e: Editor) => void;
  showCommentButton?: boolean;
  disableBottomToolbar?: boolean;
  /**
   * Replaces the default To-do quick template with the Fanfic template.
   * Disabled by default so hosts must explicitly opt in where Fanfic is available.
   */
  enableFanficTemplate?: boolean;
  onError?: (error: string) => void;
  setCharacterCount?: React.Dispatch<SetStateAction<number>>;
  setWordCount?: React.Dispatch<SetStateAction<number>>;
  setSelectedWordCount?: React.Dispatch<SetStateAction<number>>;
  setPageCount?: React.Dispatch<SetStateAction<number>>;
  tags?: Array<{ name: string; color: string }>;
  className?: string;
  unFocused?: boolean;
  isPresentationMode?: boolean;
  setIsPresentationMode?: React.Dispatch<SetStateAction<boolean>>;
  /** Split View: edit markdown on the left, see the read-only ddoc render on the right. */
  isSplitView?: boolean;
  setIsSplitView?: React.Dispatch<SetStateAction<boolean>>;
  onComment?: () => void;
  onInlineComment?: () => void;
  onFocusMode?: (isFocusMode: boolean) => void;
  /** Controlled focus mode (D6). Omit for the legacy internal-state behavior. */
  isFocusMode?: boolean;
  onFocusModeChange?: (isFocusMode: boolean) => void;
  onMarkdownExport?: () => void;
  onMarkdownImport?: () => void;
  onPdfExport?: () => void;
  onHtmlExport?: () => void;
  onTxtExport?: () => void;
  onOdtExport?: () => void;
  onDocxImport?: () => void;
  sharedSlidesLink?: string;
  documentName?: string;
  onInvalidContentError?: (e: unknown) => void;
  ignoreCorruptedData?: boolean;
  onSlidesShare?: () => void;
  renderThemeToggle?: () => JSX.Element;
  metadataProxyUrl?: string;
  onCopyHeadingLink?: (link: string) => void;
  footerHeight?: string;
  activeModel?: CustomModel;
  maxTokens?: number;
  isAIAgentEnabled?: boolean;
  /**
   * Document styling configuration
   * @description Customize the appearance of the document editor
   */
  documentStyling?: DocumentStyling;
  /**
   * Callback when IndexedDB initialization fails
   * @description Called when the IndexedDB persistence provider fails to initialize (e.g., private browsing, quota exceeded, corrupted DB). The editor will continue to function without local persistence.
   */
  onIndexedDbError?: (error: Error) => void;
}

export interface IEditorSelectionData {
  from: number;
  to: number;
  text: string;
  isHighlightedYellow: boolean;
}

export interface Data {
  editorJSONData: string | JSONContent;
}
export interface IUser {
  name: string;
  color: string;
  isEns: boolean;
}

export { type IComment };
export interface IpfsImageUploadResponse {
  encryptionKey: string;
  nonce: string;
  ipfsUrl: string;
  ipfsHash: string;
  authTag: string;
}
export interface IpfsImageFetchPayload {
  encryptionKey: string;
  nonce: string;
  ipfsUrl: string;
  ipfsHash: string;
  mimeType: string;
  authTag: string;
}

export type FontDescriptor = {
  /**
   * Cosmetic display name shown in the picker, e.g. "Poppins". Does not affect
   * font matching — the CSS face name is derived from the first token of
   * `family`, so this can differ freely (e.g. "Poppins (Brand)").
   */
  name: string;
  /**
   * CSS font-family stack stored in textStyle marks, e.g. "Poppins, sans-serif".
   * Its first token is used as the registered face name, so it must match the
   * family the woff2 in `url` provides.
   */
  family: string;
  /**
   * woff2 source(s).
   *   - string: single file covering all weights (variable font).
   *   - Record<number, string>: per-weight map, e.g. { 400: '/p-400.woff2', 700: '/p-700.woff2' }.
   *   - omitted: pure system font, no loading.
   */
  url?: string | Record<number, string>;
  /**
   * SVG preview rendered in the picker. Any React node that renders an <svg>.
   * Falls back to the font name in the default font when absent.
   */
  preview?: React.ReactNode;
};
