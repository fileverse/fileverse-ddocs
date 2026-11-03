import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { fromUint8Array } from 'js-base64';
import { getHeadlessExtensions } from './use-headless-editor';
import { useExportHeadlessEditorContent } from './use-export-headless-editor-content';
import { handleContentPrint } from '../utils/handle-print';
import { buildPrintHtml } from '../extensions/pagination/print';

vi.mock('../utils/handle-print', () => ({ handleContentPrint: vi.fn() }));
vi.mock('../extensions/pagination/print', async () => {
  const actual = await vi.importActual<
    typeof import('../extensions/pagination/print')
  >('../extensions/pagination/print');
  return { ...actual, buildPrintHtml: vi.fn() };
});

const encodedDoc = (html: string) => {
  const ydoc = new Y.Doc();
  const editor = new Editor({
    extensions: getHeadlessExtensions({
      ydoc,
      schemaVersion: 2,
    }) as AnyExtension[],
  });
  editor.commands.setContent(html);
  const content = fromUint8Array(Y.encodeStateAsUpdate(ydoc));
  editor.destroy();
  return content;
};

const exportPdf = async (
  option: Parameters<
    ReturnType<typeof useExportHeadlessEditorContent>['exportContent']
  >[0],
) => {
  const { result } = renderHook(() => useExportHeadlessEditorContent());
  act(() => result.current.exportContent(option));
  await act(async () => {
    await result.current.exportModalProps.onExport({
      format: 'pdf',
      tab: 'current',
    });
  });
};

describe('useExportHeadlessEditorContent PDF', () => {
  afterEach(() => {
    vi.mocked(handleContentPrint).mockReset();
    vi.mocked(buildPrintHtml).mockReset();
  });

  it('with a Pages setup, prints through the Pages pipeline', async () => {
    const options = { pageSetup: { mode: 'pages', paper: 'letter' } };
    vi.mocked(buildPrintHtml).mockResolvedValue({
      html: '<p>built</p>',
      options: options as never,
    });
    await exportPdf({
      content: encodedDoc('<p>Hello</p>'),
      pageSetup: { mode: 'pages', paper: 'letter' },
      orientation: 'landscape',
    });
    expect(buildPrintHtml).toHaveBeenCalledOnce();
    expect(vi.mocked(buildPrintHtml).mock.calls[0][0]).toMatchObject({
      pageSetup: { mode: 'pages', paper: 'letter' },
      orientation: 'landscape',
      isPagesActive: false,
    });
    expect(handleContentPrint).toHaveBeenCalledWith('<p>built</p>', options);
  });

  it('without a page setup, keeps the Pageless print', async () => {
    await exportPdf({ content: encodedDoc('<p>Hello</p>') });
    expect(buildPrintHtml).not.toHaveBeenCalled();
    expect(handleContentPrint).toHaveBeenCalledOnce();
    expect(vi.mocked(handleContentPrint).mock.calls[0]).toHaveLength(1);
    expect(vi.mocked(handleContentPrint).mock.calls[0][0]).toContain('Hello');
  });

  it('a Pageless setup keeps the Pageless print', async () => {
    await exportPdf({
      content: encodedDoc('<p>Hello</p>'),
      pageSetup: { mode: 'pageless', paper: 'a4' },
    });
    expect(buildPrintHtml).not.toHaveBeenCalled();
    expect(vi.mocked(handleContentPrint).mock.calls[0]).toHaveLength(1);
  });
});
