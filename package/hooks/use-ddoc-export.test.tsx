import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/react';
import { makeEditor } from '../utils/make-editor';
import { getTemporaryEditor } from '../utils/helpers';
import { useDdocExport } from './use-ddoc-export';

vi.mock('../utils/helpers', async () => {
  const actual =
    await vi.importActual<typeof import('../utils/helpers')>(
      '../utils/helpers',
    );
  return { ...actual, getTemporaryEditor: vi.fn() };
});

describe('useDdocExport AO3 copy routing', () => {
  let editor: Editor;

  afterEach(() => {
    editor?.destroy();
    vi.mocked(getTemporaryEditor).mockReset();
  });

  it('routes current-tab AO3 export through the active editor option', async () => {
    editor = makeEditor('<p>Active chapter</p>');
    const onClick = vi.fn();
    const copyAo3Html = vi.fn();
    const { result } = renderHook(() =>
      useDdocExport({
        editor,
        tabs: [
          { id: 'chapter-1', name: 'Chapter 1', emoji: null },
          { id: 'chapter-2', name: 'Chapter 2', emoji: null },
        ],
        ydoc: new Y.Doc(),
        exportOptions: [
          {
            icon: 'FileText',
            title: 'Copy HTML',
            onClick,
            isActive: false,
          },
        ],
        copyAo3Html,
      }),
    );

    expect(result.current.getOptionFormat('Copy HTML')).toBe(
      'ao3-html',
    );

    await act(async () => {
      await result.current.handleExportAsync({
        format: 'ao3-html',
        tab: 'current',
      });
    });

    expect(onClick).toHaveBeenCalledOnce();
    expect(copyAo3Html).not.toHaveBeenCalled();
  });

  it('combines all tabs in order and copies body HTML once', async () => {
    editor = makeEditor('<p>Active chapter</p>');
    const firstEditor = {
      commands: {
        exportHtmlContent: vi.fn().mockResolvedValue('<p>First body</p>'),
      },
      destroy: vi.fn(),
    } as unknown as Editor;
    const secondEditor = {
      commands: {
        exportHtmlContent: vi.fn().mockResolvedValue('<p>Second body</p>'),
      },
      destroy: vi.fn(),
    } as unknown as Editor;
    vi.mocked(getTemporaryEditor)
      .mockReturnValueOnce(firstEditor)
      .mockReturnValueOnce(secondEditor);

    let copiedHtml = '';
    const copyAo3Html = vi.fn(async (getHtml: () => Promise<string>) => {
      copiedHtml = await getHtml();
      return true;
    });
    const onClick = vi.fn();
    const { result } = renderHook(() =>
      useDdocExport({
        editor,
        tabs: [
          { id: 'chapter-1', name: 'Chapter & One', emoji: null },
          { id: 'chapter-2', name: 'Chapter 2', emoji: null },
        ],
        ydoc: new Y.Doc(),
        exportOptions: [
          {
            icon: 'FileText',
            title: 'Copy HTML',
            onClick,
            isActive: false,
          },
        ],
        copyAo3Html,
      }),
    );

    await act(async () => {
      await result.current.handleExportAsync({
        format: 'ao3-html',
        tab: 'all',
      });
    });

    expect(onClick).not.toHaveBeenCalled();
    expect(copyAo3Html).toHaveBeenCalledOnce();
    expect(copiedHtml).toBe(
      '<h1>Chapter &amp; One</h1>\n<p>First body</p>\n' +
        '<h1>Chapter 2</h1>\n<p>Second body</p>',
    );
    expect(copiedHtml).not.toMatch(/<html|<head|<body|<style/i);
    expect(firstEditor.destroy).toHaveBeenCalledOnce();
    expect(secondEditor.destroy).toHaveBeenCalledOnce();
  });

  it('skips blank tabs while copying populated tabs', async () => {
    editor = makeEditor('<p>Active chapter</p>');
    const populatedEditor = {
      isEmpty: false,
      commands: {
        exportHtmlContent: vi.fn().mockResolvedValue('<p>Chapter body</p>'),
      },
      destroy: vi.fn(),
    } as unknown as Editor;
    const blankEditor = {
      isEmpty: true,
      commands: { exportHtmlContent: vi.fn() },
      destroy: vi.fn(),
    } as unknown as Editor;
    vi.mocked(getTemporaryEditor)
      .mockReturnValueOnce(populatedEditor)
      .mockReturnValueOnce(blankEditor);

    let copiedHtml = '';
    const copyAo3Html = vi.fn(async (getHtml: () => Promise<string>) => {
      copiedHtml = await getHtml();
      return true;
    });
    const { result } = renderHook(() =>
      useDdocExport({
        editor,
        tabs: [
          { id: 'chapter-1', name: 'Chapter 1', emoji: null },
          { id: 'chapter-2', name: 'Blank chapter', emoji: null },
        ],
        ydoc: new Y.Doc(),
        exportOptions: [],
        copyAo3Html,
      }),
    );

    await act(async () => {
      await result.current.handleExportAsync({
        format: 'ao3-html',
        tab: 'all',
      });
    });

    expect(copiedHtml).toBe('<h1>Chapter 1</h1>\n<p>Chapter body</p>');
    expect(blankEditor.commands.exportHtmlContent).not.toHaveBeenCalled();
    expect(populatedEditor.destroy).toHaveBeenCalledOnce();
    expect(blankEditor.destroy).toHaveBeenCalledOnce();
  });

  it('copies nothing when every tab is blank', async () => {
    editor = makeEditor('<p>Active chapter</p>');
    const emptyEditor = {
      isEmpty: true,
      commands: { exportHtmlContent: vi.fn() },
      destroy: vi.fn(),
    } as unknown as Editor;
    const sanitizedEmptyEditor = {
      isEmpty: false,
      commands: { exportHtmlContent: vi.fn().mockResolvedValue('   ') },
      destroy: vi.fn(),
    } as unknown as Editor;
    vi.mocked(getTemporaryEditor)
      .mockReturnValueOnce(emptyEditor)
      .mockReturnValueOnce(sanitizedEmptyEditor);

    let copiedHtml: string | undefined;
    const copyAo3Html = vi.fn(async (getHtml: () => Promise<string>) => {
      try {
        copiedHtml = await getHtml();
        return true;
      } catch {
        return false;
      }
    });
    const { result } = renderHook(() =>
      useDdocExport({
        editor,
        tabs: [
          { id: 'chapter-1', name: 'Blank chapter 1', emoji: null },
          { id: 'chapter-2', name: 'Blank chapter 2', emoji: null },
        ],
        ydoc: new Y.Doc(),
        exportOptions: [],
        copyAo3Html,
      }),
    );

    await act(async () => {
      await result.current.handleExportAsync({
        format: 'ao3-html',
        tab: 'all',
      });
    });

    expect(copiedHtml).toBeUndefined();
    expect(emptyEditor.commands.exportHtmlContent).not.toHaveBeenCalled();
    expect(sanitizedEmptyEditor.commands.exportHtmlContent).toHaveBeenCalled();
    expect(emptyEditor.destroy).toHaveBeenCalledOnce();
    expect(sanitizedEmptyEditor.destroy).toHaveBeenCalledOnce();
  });
});
