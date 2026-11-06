import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { getHeadlessExtensions } from './use-headless-editor';
import { Pagination } from '../extensions/pagination';
import {
  getPrintInputs,
  type PrintInputs,
} from '../extensions/pagination/print';
import { usePaginationSync } from './use-pagination-sync';

const A4 = { mode: 'pages', paper: 'a4' } as const;
const PRINT = { tag: 'inputs' } as unknown as PrintInputs;

const makeEditor = () =>
  new Editor({
    element: document.createElement('div'),
    extensions: [
      ...getHeadlessExtensions({ ydoc: new Y.Doc(), schemaVersion: 2 }),
      Pagination,
    ] as AnyExtension[],
  });

type Props = {
  editor: Editor | null;
  isPagesMode: boolean;
  onPagesError?: (error: unknown) => void;
};

describe('usePaginationSync', () => {
  const editors: Editor[] = [];
  const create = () => {
    const e = makeEditor();
    editors.push(e);
    return e;
  };
  const render = (initial: Props) =>
    renderHook(
      (p: Props) =>
        usePaginationSync(p.editor, {
          pageSetup: A4,
          orientation: 'portrait',
          zoom: 1.5,
          isPagesMode: p.isPagesMode,
          onPagesError: p.onPagesError,
          printInputs: () => PRINT,
        }),
      { initialProps: initial },
    );

  afterEach(() => {
    editors.splice(0).forEach((e) => e.destroy());
  });

  it('calls setPagination with the inputs on the active editor', () => {
    const editor = create();
    render({ editor, isPagesMode: true });
    expect(editor.storage.pagination).toMatchObject({
      pageSetup: A4,
      orientation: 'portrait',
      zoom: 1.5,
      enabled: true,
      running: true,
    });
  });

  it('switching editors calls running:false on the old one and keeps its enabled', () => {
    const a = create();
    const b = create();
    const { rerender } = render({ editor: a, isPagesMode: true });
    rerender({ editor: b, isPagesMode: true });
    expect(a.storage.pagination).toMatchObject({
      enabled: true,
      running: false,
      zoom: 1.5,
    });
    expect(b.storage.pagination.running).toBe(true);
  });

  it('Pageless with an untouched extension never calls setPagination', () => {
    const editor = create();
    const spy = vi.spyOn(editor.commands, 'setPagination');
    render({ editor, isPagesMode: false });
    expect(spy).not.toHaveBeenCalled();
    expect(editor.storage.pagination.pageSetup).toBeUndefined();
  });

  it('assigns onPagesError to the editor storage', () => {
    const editor = create();
    const onPagesError = vi.fn();
    render({ editor, isPagesMode: true, onPagesError });
    expect(editor.storage.pagination.onError).toBe(onPagesError);
  });

  it('registers print inputs for the active editor and unregisters on switch', () => {
    const a = create();
    const b = create();
    const { rerender } = render({ editor: a, isPagesMode: false });
    expect(getPrintInputs(a)).toBe(PRINT);
    expect(getPrintInputs(b)).toBeUndefined();
    rerender({ editor: b, isPagesMode: false });
    expect(getPrintInputs(a)).toBeUndefined();
    expect(getPrintInputs(b)).toBe(PRINT);
  });
});
