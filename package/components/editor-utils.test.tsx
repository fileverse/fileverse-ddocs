import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { makeEditor } from '../utils/make-editor';
import { CommentStoreProvider } from '../stores/comment-store-provider';
import { useEditorToolbar } from './editor-utils';

// Repro for the slides double-toast: on an empty doc the toolbar button
// fired the "document is empty" error but STILL entered presentation mode,
// whose own empty-content backstop then fired a second error ("Cannot enter
// presentation mode with empty content"). Only the first message should
// surface, and presentation mode should not be entered at all.

const getSlidesTool = (result: {
  current: ReturnType<typeof useEditorToolbar>;
}) =>
  result.current.toolbar
    .concat(result.current.bottomToolbar)
    .find((item) => item?.title?.includes('Slides'));

describe('slides toolbar button on empty content', () => {
  let editor: Editor;
  afterEach(() => {
    editor?.destroy();
    vi.useRealTimers();
  });

  const renderToolbar = () => {
    const onError = vi.fn();
    const setIsPresentationMode = vi.fn();
    const { result } = renderHook(
      () =>
        useEditorToolbar({
          editor,
          onError,
          setIsPresentationMode,
          isPresentationMode: false,
        }),
      {
        // useEditorToolbar reads the comment button ref from the store.
        wrapper: ({ children }) => (
          <CommentStoreProvider editor={editor} initialComments={[]}>
            {children}
          </CommentStoreProvider>
        ),
      },
    );
    return { result, onError, setIsPresentationMode };
  };

  it('errors once and never enters presentation mode when empty', () => {
    vi.useFakeTimers();
    editor = makeEditor('<p></p>');
    const { result, onError, setIsPresentationMode } = renderToolbar();

    const slides = getSlidesTool(result);
    expect(slides).toBeDefined();

    act(() => {
      slides!.onClick();
      vi.runAllTimers(); // the setter is deferred behind a 50ms timeout
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(
      'Your document is empty. Add some content before starting presentation mode.',
    );
    expect(setIsPresentationMode).not.toHaveBeenCalled();
  });

  it('enters presentation mode without error when content exists', () => {
    vi.useFakeTimers();
    editor = makeEditor('<p>real content</p>');
    const { result, onError, setIsPresentationMode } = renderToolbar();

    const slides = getSlidesTool(result);
    expect(slides).toBeDefined();
    act(() => {
      slides!.onClick();
      vi.runAllTimers();
    });

    expect(onError).not.toHaveBeenCalled();
    expect(setIsPresentationMode).toHaveBeenCalledTimes(1);
  });
});
