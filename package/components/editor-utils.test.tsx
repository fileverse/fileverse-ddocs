import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { makeEditor } from '../utils/make-editor';
import { CommentStoreProvider } from '../stores/comment-store-provider';
import { useEditorToolbar, shortcutAction } from './editor-utils';
import { IEditorTool } from '../hooks/use-visibility';
import copy from 'copy-to-clipboard';
import { toast } from '@fileverse/ui';
import { printPagesTab } from '../extensions/pagination/print';
import { handleContentPrint } from '../utils/handle-print';

vi.mock('../extensions/pagination/print', () => ({
  printPagesTab: vi.fn().mockResolvedValue(false),
}));
const removeLoader = vi.fn();
const showLoader = vi.fn(() => 'loader');
vi.mock('../utils/inline-loader', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/inline-loader')>()),
  inlineLoader: () => ({ showLoader, removeLoader }),
}));
vi.mock('../utils/handle-print', () => ({ handleContentPrint: vi.fn() }));

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
    expect(copiedHtml).toBe('<p>Hello <strong>world</strong></p>');
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

describe('Print and PDF export in Pages mode', () => {
  let editor: Editor;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(printPagesTab).mockReset().mockResolvedValue(false);
    vi.mocked(handleContentPrint).mockReset();
    showLoader.mockClear();
    removeLoader.mockClear();
  });
  afterEach(() => {
    editor?.destroy();
    vi.useRealTimers();
  });

  const render = () => {
    editor = makeEditor('<p>hello</p>');
    return renderHook(() => useEditorToolbar({ editor, onError: vi.fn() }), {
      wrapper: ({ children }) => (
        <CommentStoreProvider editor={editor} initialComments={[]}>
          {children}
        </CommentStoreProvider>
      ),
    }).result;
  };

  const run = async (fn: () => void) => {
    await act(async () => {
      fn();
      await vi.runAllTimersAsync();
    });
  };

  it('toolbar Print uses printPagesTab in Pages mode and skips the Pageless path', async () => {
    vi.mocked(printPagesTab).mockResolvedValue(true);
    const result = render();
    await run(() => result.current.printHandler());
    expect(printPagesTab).toHaveBeenCalledWith(editor);
    expect(handleContentPrint).not.toHaveBeenCalled();
  });

  it('toolbar Print in Pageless calls handleContentPrint exactly as before', async () => {
    const result = render();
    await run(() => result.current.printHandler());
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleContentPrint).mock.calls[0]).toHaveLength(1);
    expect(vi.mocked(handleContentPrint).mock.calls[0][0]).toContain('hello');
  });

  it('Export PDF in Pages mode uses printPagesTab and removes the loader', async () => {
    vi.mocked(printPagesTab).mockResolvedValue(true);
    const result = render();
    const pdf = result.current.exportOptions.find(
      (item) => item?.title === 'PDF document (.pdf)',
    );
    await run(() => pdf!.onClick());
    expect(printPagesTab).toHaveBeenCalledWith(editor);
    expect(handleContentPrint).not.toHaveBeenCalled();
    expect(showLoader).toHaveBeenCalledTimes(1);
    expect(removeLoader).toHaveBeenCalledWith('loader');
  });

  it('Export PDF falls back, logs and removes the loader when Pages print rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(printPagesTab).mockRejectedValue(new Error('boom'));
    const result = render();
    const pdf = result.current.exportOptions.find(
      (item) => item?.title === 'PDF document (.pdf)',
    );
    await run(() => pdf!.onClick());
    expect(err).toHaveBeenCalled();
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    expect(removeLoader).toHaveBeenCalledWith('loader');
    err.mockRestore();
  });

  it('toolbar Print falls back and logs when Pages print rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(printPagesTab).mockRejectedValue(new Error('boom'));
    const result = render();
    await run(() => result.current.printHandler());
    expect(err).toHaveBeenCalled();
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

describe('shortcutAction', () => {
  it.each([
    [{ key: 'Enter', metaKey: true }, true, 'pageBreak'],
    [{ key: 'Enter', ctrlKey: true }, false, 'pageBreak'],
    [{ key: 'Enter', ctrlKey: true }, true, null],
    [{ key: 'Enter', metaKey: true, shiftKey: true }, true, null],
    [{ key: 'k', metaKey: true }, true, 'link'],
    [{ key: 'K', ctrlKey: true }, false, 'link'],
    [{ key: 'Enter', altKey: true }, true, 'link'],
  ])('shortcutAction(%o, mac=%s) is %s', (event, isMac, expected) => {
    expect(
      shortcutAction(
        {
          metaKey: false,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          ...event,
        },
        isMac,
      ),
    ).toBe(expected);
  });
});

describe('page-break and link shortcuts through handleKeyDown', () => {
  let editor: Editor;
  let platform: ReturnType<typeof vi.spyOn> | undefined;
  const mockMac = () => {
    platform = vi
      .spyOn(navigator, 'platform', 'get')
      .mockReturnValue('MacIntel');
  };
  afterEach(() => {
    editor?.destroy();
    platform?.mockRestore();
  });

  const mount = () =>
    renderHook(
      () =>
        useEditorToolbar({
          editor,
          onError: vi.fn(),
          setIsPresentationMode: vi.fn(),
          isPresentationMode: false,
        }),
      {
        wrapper: ({ children }) => (
          <CommentStoreProvider editor={editor} initialComments={[]}>
            {children}
          </CommentStoreProvider>
        ),
      },
    );

  const press = (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    let handled: boolean | undefined;
    act(() => {
      handled = editor.view.someProp('handleKeyDown', (f) =>
        f(editor.view, event),
      );
    });
    return { handled, event };
  };

  it('⌘+Enter inserts a page break and does not open the link popup', () => {
    mockMac();
    editor = makeEditor('<ul><li><p>a</p></li></ul>');
    const { result } = mount();
    editor.commands.setTextSelection(4);
    const { handled, event } = press({ key: 'Enter', metaKey: true });
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toContain('pageBreak');
    expect(result.current.toolVisibility).toBe(IEditorTool.NONE);
  });

  it('⌘+Enter inside a code block falls through', () => {
    mockMac();
    editor = makeEditor('<pre><code>code</code></pre>');
    const { result } = mount();
    editor.commands.setTextSelection(3);
    const { handled, event } = press({ key: 'Enter', metaKey: true });
    expect(handled).toBeFalsy();
    expect(event.defaultPrevented).toBe(false);
    expect(JSON.stringify(editor.getJSON())).not.toContain('pageBreak');
    expect(result.current.toolVisibility).toBe(IEditorTool.NONE);
  });

  it('with two useEditorToolbar instances, ⌘+K leaves the link popup open', () => {
    mockMac();
    editor = makeEditor('<p>hello</p>');
    mount();
    const second = mount();
    const { event } = press({ key: 'k', metaKey: true });
    expect(event.defaultPrevented).toBe(true);
    expect(second.result.current.toolVisibility).toBe(IEditorTool.LINK_POPUP);
  });
});
