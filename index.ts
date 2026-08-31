export { default as DdocEditor } from './package/ddoc-editor';
export { PreviewDdocEditor } from './package/preview-ddoc-editor';
export { handleContentPrint } from './package/utils/handle-print';
export { DdocExportModal } from './package/components/export-modal';
export { useHeadlessEditor } from './package/hooks/use-headless-editor';
export type {
  TabbedJSONContent,
  TabbedJSONContentTab,
} from './package/hooks/use-headless-editor';
export { FANFIC_TEMPLATE } from './package/utils/fanfic-template';
export { useEditorCommands } from './package/hooks/use-editor-commands';
export type {
  EditorCommand,
  EditorCommandId,
  UseEditorCommandsOptions,
} from './package/hooks/use-editor-commands';
export { useExportHeadlessEditorContent } from './package/hooks/use-export-headless-editor-content';
export { mergeTabAwareYjsUpdates } from './package/components/tabs/utils/tab-utils';
export {
  validateCustomCss,
  sanitizeCustomCss,
} from './package/utils/sanitize-css';
export type {
  CssDiagnostic,
  CssValidationResult,
} from './package/utils/sanitize-css';
export { buildVersionDiffSnapshot } from './package/components/tabs/utils/version-diff-snapshot';
export type {
  DdocExportModalProps,
  ExportFormatOption,
  ExportTabOption,
} from './package/components/export-modal';
export type { VersionTabSnapshot } from './package/components/tabs/utils/version-diff-snapshot';
export { Editor } from '@tiptap/react';
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
} from './package/sync-local/types';
export {
  encryptForRoomKey,
  decryptForRoomKey,
} from './package/sync-local/crypto/room-key';
export {
  fetchSessionState,
  seedSession,
} from './package/sync-local/session-tools';

export type { CommentMutationMeta, SuggestionType } from './package/types';
export type {
  ImageUploadFn,
  ImageFetchFn,
  StorageImageUploadResponse,
  StorageImageFetchPayload,
} from './package/types';
export {
  resolveImageUploadFn,
  resolveImageFetchFn,
} from './package/utils/storage-adapter';
export type { IComment } from './package/extensions/comment/comment.ts';
export type { FontDescriptor } from './package/types';
