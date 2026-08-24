import React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { makeEditor } from '../utils/make-editor';
import { CommentStoreProvider } from '../stores/comment-store-provider';
import { useEditorToolbar } from './editor-utils';
import copy from 'copy-to-clipboard';
import { toast } from '@fileverse/ui';

vi.mock('copy-to-clipboard', () => ({ default: vi.fn() }));
vi.mock('@fileverse/ui', async () => {
  const actual =
    await vi.importActual<typeof import('@fileverse/ui')>('@fileverse/ui');
  return { ...actual, toast: vi.fn() };
});

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

describe('Copy HTML export', () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
    vi.restoreAllMocks();
    vi.mocked(copy).mockReset();
    vi.mocked(toast).mockReset();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });

  const renderToolbar = ({
    onError = vi.fn(),
    onHtmlExport = vi.fn(),
  } = {}) => {
    const { result } = renderHook(
      () =>
        useEditorToolbar({
          editor,
          onError,
          onHtmlExport,
        }),
      {
        wrapper: ({ children }) => (
          <CommentStoreProvider editor={editor} initialComments={[]}>
            {children}
          </CommentStoreProvider>
        ),
      },
    );
    const option = result.current.exportOptions.find(
      (item) => item?.title === 'Copy HTML',
    );
    return { result, option, onError, onHtmlExport };
  };

  it('copies literal body HTML without document wrappers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    editor = makeEditor('<p>Hello <strong>world</strong></p>');
    const { option, onError } = renderToolbar();

    expect(option).toBeDefined();
    await act(async () => {
      await option!.onClick();
    });

    expect(writeText).toHaveBeenCalledOnce();
    const copiedHtml = writeText.mock.calls[0][0];
    expect(copiedHtml).toContain('Hello');
    expect(copiedHtml).toContain('<strong');
    expect(copiedHtml).toContain('world</strong>');
    expect(copiedHtml).not.toMatch(/<html|<head|<body|<style/i);
    expect(copy).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledOnce();
    expect(toast).toHaveBeenCalledWith({
      title: 'HTML copied.',
      toastType: 'mini',
      variant: 'success',
      iconType: 'icon',
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it('keeps the existing HTML download flow working', async () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:html-download');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    editor = makeEditor('<p>Downloadable chapter</p>');
    const { result, onHtmlExport } = renderToolbar();
    const option = result.current.exportOptions.find(
      (item) => item?.title === 'Web page (.html)',
    );

    await act(async () => {
      await option!.onClick('Chapter one');
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:html-download');
    expect(onHtmlExport).toHaveBeenCalledOnce();
  });

  it('reports an error when AO3 HTML generation fails', async () => {
    editor = makeEditor('<p>Chapter text</p>');
    const { result, onError } = renderToolbar();

    await act(async () => {
      await result.current.copyAo3Html(async () => {
        throw new Error('export failed');
      });
    });

    expect(onError).toHaveBeenCalledWith(
      'Couldn’t copy HTML. Check clipboard permissions and try again.',
    );
    expect(toast).not.toHaveBeenCalled();
  });

  it('reports an error when both clipboard methods fail', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    vi.mocked(copy).mockReturnValue(false);
    editor = makeEditor('<p>Chapter text</p>');
    const { option, onError } = renderToolbar();

    await act(async () => {
      await option!.onClick();
    });

    expect(copy).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledWith(expect.stringContaining('Chapter text'), {
      format: 'text/plain',
    });
    expect(onError).toHaveBeenCalledWith(
      'Couldn’t copy HTML. Check clipboard permissions and try again.',
    );
    expect(toast).not.toHaveBeenCalled();
  });
});
