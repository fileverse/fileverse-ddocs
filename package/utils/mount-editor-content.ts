import { createElement } from 'react';
import { onTestFinished } from 'vitest';
import { act, render } from '@testing-library/react';
import { EditorContent, type Editor } from '@tiptap/react';

type ActGlobal = { IS_REACT_ACT_ENVIRONMENT?: boolean };

/**
 * Test helper: mounts the editor in EditorContent, as every product editor is.
 * Since @tiptap/react 3.34 a React node view (table cell, media, code block)
 * renders an empty placeholder until then. Unmount with RTL's `cleanup`.
 */
export const mountEditorContent = (editor: Editor): Editor => {
  act(() => {
    render(createElement(EditorContent, { editor }));
  });
  // Later dispatches re-render node-view portals outside act; these tests read
  // ProseMirror's DOM, not React's, so the act warnings are noise.
  const scope = globalThis as ActGlobal;
  const previous = scope.IS_REACT_ACT_ENVIRONMENT;
  scope.IS_REACT_ACT_ENVIRONMENT = false;
  onTestFinished(() => {
    scope.IS_REACT_ACT_ENVIRONMENT = previous;
  });
  return editor;
};
