import type { Editor } from '@tiptap/core';
import {
  buildPrintHtml,
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
  pass: () => {
    passCount: number;
    lastTimings: { collect: number; place: number; emit: number } | null;
    settled: boolean;
  } | null;
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

// The plugin's own placement, so the checker sees what the screen and print use.
export const computeBreaks = (deps: PagesDebugDeps): PagesPrintBreaks | null => {
  const s = settings(deps);
  const placement = s?.editor.storage.pagination?.flush();
  if (!s || !placement) return null;
  const { doc } = s.editor.state;
  const pageFirstText = placement.pageStarts.map((start) =>
    doc
      .textBetween(start.pos, Math.min(start.pos + 200, doc.content.size), ' ')
      .trim()
      .slice(0, 40),
  );
  return { ...placement, pageFirstText };
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
    pass: () => {
      const storage = deps.getEditor()?.storage.pagination;
      if (!storage) return null;
      return {
        passCount: storage.lastPass?.count ?? 0,
        lastTimings: storage.lastPass?.timings ?? null,
        settled: storage.isIdle(),
      };
    },
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
