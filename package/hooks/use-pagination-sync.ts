import { useLayoutEffect } from 'react';
import type { Editor } from '@tiptap/react';
import type { PageSetup } from '../types';
import type { Orientation } from '../extensions/pagination/page-grid';
import {
  setPrintInputs,
  type PrintInputs,
} from '../extensions/pagination/print';

type Inputs = {
  pageSetup?: PageSetup;
  orientation?: Orientation;
  zoom: number;
  isPagesMode: boolean;
  onPagesError?: (error: unknown) => void;
  printInputs: () => PrintInputs;
};

export function usePaginationSync(
  editor: Editor | null,
  {
    pageSetup,
    orientation,
    zoom,
    isPagesMode,
    onPagesError,
    printInputs,
  }: Inputs,
): void {
  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setPrintInputs(editor, printInputs);
    return () => setPrintInputs(editor, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const s = editor.storage.pagination;
    if (s) s.onError = onPagesError;
  }, [editor, onPagesError]);

  useLayoutEffect(() => {
    if (!editor || editor.isDestroyed) return;
    // Pageless never touches the extension (already inert).
    if (!isPagesMode && !editor.storage.pagination?.enabled) return;
    editor.commands.setPagination({
      pageSetup,
      orientation,
      zoom,
      enabled: isPagesMode,
      running: isPagesMode,
    });
  }, [editor, isPagesMode, pageSetup, orientation, zoom]);

  // Leaving the active tab (or unmounting): stop passes, keep the spacers.
  useLayoutEffect(() => {
    if (!editor) return;
    return () => {
      const s = editor.storage.pagination;
      if (editor.isDestroyed || !s?.running) return;
      editor.commands.setPagination({
        pageSetup: s.pageSetup,
        orientation: s.orientation,
        zoom: s.zoom,
        enabled: s.enabled,
        running: false,
      });
    };
  }, [editor]);
}
