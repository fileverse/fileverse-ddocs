import type { Editor } from '@tiptap/core';
import { PageGrid } from '../../../package/extensions/pagination/page-grid';
import {
  buildPrintHtml,
  getPrintBreaks,
  type PagesPrintBreaks,
} from '../../../package/extensions/pagination/print';
import { mountContentPrintHost } from '../../../package/utils/handle-print';
import type { DocumentStyling } from '../../../package/types';
import { measurePrintParity } from './print-parity';

export type PagesDebugDeps = {
  getEditor: () => Editor | null | undefined;
  getStyling: () => DocumentStyling | undefined;
  setZoomLevel: (zoom: string) => void;
};

export type PagesDebugApi = {
  ready: boolean;
  breaks: () => PagesPrintBreaks | null;
  parity: () => Promise<ReturnType<typeof measurePrintParity> | null>;
  mountPrint: (debugMarkers: boolean) => Promise<void>;
  unmountPrint: () => void;
  setZoomLevel: (zoom: string) => void;
};

declare global {
  interface Window {
    __ddocPages?: PagesDebugApi;
  }
}

const settings = (deps: PagesDebugDeps) => {
  const editor = deps.getEditor();
  const styling = deps.getStyling();
  const pageSetup = styling?.pageSetup;
  if (!editor || editor.isDestroyed || pageSetup?.mode !== 'pages') return null;
  return { editor, pageSetup, orientation: styling?.orientation };
};

export const computeBreaks = (deps: PagesDebugDeps) => {
  const s = settings(deps);
  if (!s) return null;
  return getPrintBreaks(
    s.editor.view,
    new PageGrid(s.pageSetup.paper, s.orientation),
  );
};

export const buildPagesPrint = async (
  deps: PagesDebugDeps,
  debugMarkers: boolean,
) => {
  const s = settings(deps);
  if (!s) return null;
  return buildPrintHtml({
    editor: s.editor,
    pageSetup: s.pageSetup,
    orientation: s.orientation,
    isPagesActive: true,
    placement: computeBreaks(deps) ?? undefined,
    debugMarkers,
  });
};

// window.__ddocPages: the hook scripts/pages-print-check.cjs drives.
export const installPagesDebug = (deps: PagesDebugDeps) => {
  let cleanup: (() => void) | null = null;
  const api: PagesDebugApi = {
    ready: false,
    breaks: () => computeBreaks(deps),
    parity: async () => {
      const s = settings(deps);
      if (!s) return null;
      const { html, options } = await buildPrintHtml({
        editor: s.editor,
        pageSetup: s.pageSetup,
        orientation: s.orientation,
        isPagesActive: false,
      });
      return measurePrintParity(s.editor.view, html, options);
    },
    mountPrint: async (debugMarkers) => {
      cleanup?.();
      const built = await buildPagesPrint(deps, debugMarkers);
      if (built) cleanup = mountContentPrintHost(built.html, built.options).cleanup;
    },
    unmountPrint: () => {
      cleanup?.();
      cleanup = null;
    },
    setZoomLevel: deps.setZoomLevel,
  };
  window.__ddocPages = api;
  return api;
};

// Resolves once fonts, images and two frames have settled.
export const waitForLayout = async (root: HTMLElement) => {
  await document.fonts.ready;
  await Promise.all(
    [...root.querySelectorAll('img')].map((img) =>
      img.complete
        ? null
        : new Promise((resolve) => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
          }),
    ),
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
};
