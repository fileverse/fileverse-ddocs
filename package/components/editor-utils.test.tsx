import React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { AllSelection, NodeSelection } from '@tiptap/pm/state';
import { makeEditor } from '../utils/make-editor';
import { CommentStoreProvider } from '../stores/comment-store-provider';
import { useEditorToolbar, shortcutAction } from './editor-utils';
import { IEditorTool } from '../hooks/use-visibility';
import copy from 'copy-to-clipboard';
import { toast } from '@fileverse/ui';
import { buildPrintHtml, getPrintInputs } from '../extensions/pagination/print';
import { handleContentPrint } from '../utils/handle-print';
import { searchForSecureImageNodeAndEmbedImageContent } from '../extensions/mardown-paste-handler';

vi.mock('../extensions/pagination/print', () => ({
  buildPrintHtml: vi.fn(),
  getPrintInputs: vi.fn(),
  resolvePrintPlacement: vi.fn(),
}));
vi.mock('../extensions/mardown-paste-handler', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('../extensions/mardown-paste-handler')
    >();
  return {
    ...actual,
    searchForSecureImageNodeAndEmbedImageContent: vi.fn(
      actual.searchForSecureImageNodeAndEmbedImageContent,
    ),
  };
});
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
  const pagesOptions = {
    pageSetup: { mode: 'pages' as const, paper: 'a4' as const },
  };
  const pagesMode = () =>
    vi.mocked(getPrintInputs).mockReturnValue({
      pageSetup: pagesOptions.pageSetup,
      isPagesActive: true,
    } as unknown as ReturnType<typeof getPrintInputs>);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getPrintInputs).mockReset().mockReturnValue(undefined);
    vi.mocked(buildPrintHtml)
      .mockReset()
      .mockResolvedValue({
        html: 'pages-html',
        options: pagesOptions,
      } as Awaited<ReturnType<typeof buildPrintHtml>>);
    vi.mocked(handleContentPrint).mockReset().mockResolvedValue(undefined);
    showLoader.mockClear();
    removeLoader.mockClear();
  });
  afterEach(() => {
    editor?.destroy();
    vi.useRealTimers();
  });

  const render = (onExportError = vi.fn()) => {
    editor = makeEditor('<p>hello</p>');
    return renderHook(
      () => useEditorToolbar({ editor, onError: vi.fn(), onExportError }),
      {
        wrapper: ({ children }) => (
          <CommentStoreProvider editor={editor} initialComments={[]}>
            {children}
          </CommentStoreProvider>
        ),
      },
    ).result;
  };

  const pdfOption = (result: ReturnType<typeof render>) =>
    result.current.exportOptions.find(
      (item) => item?.title === 'PDF document (.pdf)',
    );

  const run = async (fn: () => void) => {
    await act(async () => {
      fn();
      await vi.runAllTimersAsync();
    });
  };

  it('toolbar Print prints the built Pages HTML in Pages mode', async () => {
    pagesMode();
    const result = render();
    await run(() => result.current.printHandler());
    expect(buildPrintHtml).toHaveBeenCalledTimes(1);
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    expect(handleContentPrint).toHaveBeenCalledWith('pages-html', pagesOptions);
  });

  it('toolbar Print in Pageless calls handleContentPrint exactly as before', async () => {
    const result = render();
    await run(() => result.current.printHandler());
    expect(buildPrintHtml).not.toHaveBeenCalled();
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleContentPrint).mock.calls[0][0]).toContain('hello');
    expect(vi.mocked(handleContentPrint).mock.calls[0][1]).toBeUndefined();
  });

  it('Export PDF in Pages mode prints the Pages HTML and removes the loader', async () => {
    pagesMode();
    const result = render();
    await run(() => pdfOption(result)!.onClick());
    expect(handleContentPrint).toHaveBeenCalledWith('pages-html', pagesOptions);
    expect(showLoader).toHaveBeenCalledTimes(1);
    expect(removeLoader).toHaveBeenCalledWith('loader');
  });

  it('Export PDF removes an inline loader, which showLoader returns no element for', async () => {
    showLoader.mockReturnValueOnce(undefined as unknown as string);
    const result = render();
    await run(() => pdfOption(result)!.onClick());
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    expect(removeLoader).toHaveBeenCalledTimes(1);
  });

  it('Export PDF falls back, logs, reports and removes the loader when the Pages build rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    pagesMode();
    const boom = new Error('boom');
    vi.mocked(buildPrintHtml).mockRejectedValue(boom);
    const onExportError = vi.fn();
    const result = render(onExportError);
    await run(() => pdfOption(result)!.onClick());
    expect(err).toHaveBeenCalled();
    expect(onExportError).toHaveBeenCalledWith(boom, {
      format: 'pdf',
      stage: 'pages-build',
    });
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleContentPrint).mock.calls[0][0]).toContain('hello');
    expect(removeLoader).toHaveBeenCalledWith('loader');
    err.mockRestore();
  });

  it('toolbar Print falls back and logs when the Pages build rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    pagesMode();
    vi.mocked(buildPrintHtml).mockRejectedValue(new Error('boom'));
    const result = render();
    await run(() => result.current.printHandler());
    expect(err).toHaveBeenCalled();
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('Export PDF reports the embed stage and removes the loader when images fail', async () => {
    const failure = new Error('fetch failed');
    vi.mocked(
      searchForSecureImageNodeAndEmbedImageContent,
    ).mockRejectedValueOnce(failure);
    const onExportError = vi.fn();
    const result = render(onExportError);
    await run(() => pdfOption(result)!.onClick());
    expect(onExportError).toHaveBeenCalledWith(failure, {
      format: 'pdf',
      stage: 'embed-images',
    });
    expect(handleContentPrint).not.toHaveBeenCalled();
    expect(removeLoader).toHaveBeenCalledWith('loader');
  });

  it('Export PDF reports a hang as a timeout at the stuck stage', async () => {
    vi.mocked(searchForSecureImageNodeAndEmbedImageContent).mockReturnValueOnce(
      new Promise(() => {}),
    );
    const onExportError = vi.fn();
    const result = render(onExportError);
    await run(() => pdfOption(result)!.onClick());
    expect(onExportError).toHaveBeenCalledTimes(1);
    const [error, context] = onExportError.mock.calls[0];
    expect((error as Error).name).toBe('ExportTimeoutError');
    expect(context).toEqual({ format: 'pdf', stage: 'timeout:embed-images' });
  });

  it('Export PDF reports a print failure without a timeout', async () => {
    const noBridge = new TypeError('print bridge missing');
    vi.mocked(handleContentPrint).mockRejectedValue(noBridge);
    const onExportError = vi.fn();
    const result = render(onExportError);
    await run(() => pdfOption(result)!.onClick());
    expect(onExportError).toHaveBeenCalledTimes(1);
    expect(onExportError).toHaveBeenCalledWith(noBridge, {
      format: 'pdf',
      stage: 'print',
    });
    expect(removeLoader).toHaveBeenCalledWith('loader');
  });
});

describe('shortcutAction', () => {
  it.each([
    [{ key: 'Enter', metaKey: true }, true, 'pageBreak'],
    [{ key: 'Enter', ctrlKey: true }, false, 'pageBreak'],
    [{ key: 'Enter', ctrlKey: true }, true, null],
    [{ key: 'Enter', metaKey: true, shiftKey: true }, true, null],
    [{ key: 'k', metaKey: true }, true, null],
    [{ key: 'K', ctrlKey: true }, false, null],
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

  it('⌘+Enter with everything selected is swallowed and changes nothing', () => {
    mockMac();
    editor = makeEditor('<p>one</p><p>two</p>');
    mount();
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    const before = editor.getJSON();
    const dispatch = vi.spyOn(editor.view, 'dispatch');
    const { handled, event } = press({ key: 'Enter', metaKey: true });
    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.getJSON()).toEqual(before);
  });

  it('⌘+Enter with a node-selected block keeps it and adds a break after', () => {
    mockMac();
    editor = makeEditor('<p>one</p><hr><p>two</p>');
    mount();
    let hr = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule') hr = pos;
    });
    const $hr = editor.state.doc.resolve(hr);
    const at = $hr.depth > 0 ? $hr.before(1) : hr;
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, at)),
    );
    const { handled } = press({ key: 'Enter', metaKey: true });
    expect(handled).toBe(true);
    const json = JSON.stringify(editor.getJSON());
    expect(json).toContain('horizontalRule');
    expect(json).toContain('pageBreak');
    expect(json).toContain('two');
  });

  it('⌘+K is left to the toolbar link modal listener', () => {
    mockMac();
    editor = makeEditor('<p>hello</p>');
    const { result } = mount();
    const { event } = press({ key: 'k', metaKey: true });
    expect(event.defaultPrevented).toBe(false);
    expect(result.current.toolVisibility).toBe(IEditorTool.NONE);
  });
});
