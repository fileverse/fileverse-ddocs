import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { EditorContent, type Editor } from '@tiptap/react';

/**
 * Test helper: mounts the editor in EditorContent, as every product editor is.
 * Since @tiptap/react 3.34 a React node view (table cell, media, code block)
 * renders an empty placeholder until then. Unmount with RTL's `cleanup`.
 */
export const mountEditorContent = (editor: Editor): Editor => {
  act(() => {
    render(createElement(EditorContent, { editor }));
  });
  return editor;
};
