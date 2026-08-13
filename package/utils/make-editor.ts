import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

/**
 * Shared jsdom editor factory for unit tests (use-editor-commands.test.tsx,
 * selection-utils.test.ts, ...). Collaboration owns the doc, so content must
 * be set via `setContent` *after* construction — passing `content` to the
 * `Editor` constructor is silently ignored once Collaboration is configured.
 */
export const makeEditor = (content: string = '<p></p>'): Editor => {
  const editor = new Editor({
    extensions: getHeadlessExtensions(),
    // matches useHeadlessEditor/ddoc-editor; required for dir tracking
    textDirection: 'auto',
  });
  editor.commands.setContent(content);
  return editor;
};
