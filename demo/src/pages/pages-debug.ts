import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import * as Y from 'yjs';
import {
  buildPrintHtml,
  type PagesPrintBreaks,
} from '../../../package/extensions/pagination/print';
import {
  collectLeaves,
  SPACER_CLASS,
} from '../../../package/extensions/pagination/collect-leaves';
import {
  groupLineRects,
  type Rect,
} from '../../../package/extensions/pagination/line-split';
import {
  PAGE_GAP,
  PageGrid,
} from '../../../package/extensions/pagination/page-grid';
import { mountContentPrintHost } from '../../../package/utils/handle-print';
import { getZoomScale } from '../../../package/utils/zoom';
import type { DocumentStyling } from '../../../package/types';
import { measurePrintParity } from './print-parity';

export type PagesDebugDeps = {
  getEditor: () => Editor | null | undefined;
  getStyling: () => DocumentStyling | undefined;
  setZoomLevel: (zoom: string) => void;
  getYdoc?: () => Y.Doc | null | undefined;
};

type Check = { ok: boolean; problems: string[] };

export type PagesDebugApi = {
  ready: boolean;
  breaks: () => PagesPrintBreaks | null;
  pass: () => {
    passCount: number;
    lastTimings: { collect: number; place: number; emit: number } | null;
    dispatched: boolean;
    dispatches: number;
    settled: boolean;
    pageCount: number | null;
  } | null;
  sheetCheck: () => Check | null;
  stateVector: () => string | null;
  tabContent: () => string | null;
  watchWrites: () => void;
  writes: () => string[];
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

const TOLERANCE = 1;

// I4 (docs/PAGES_MODE.md §12.12): on screen, with spacers, every leaf lies
// inside one sheet's text area, or is taller than the text height and starts
// its page (under the headings that open it, §12.3). Text leaves are checked line by line; drawn sheets must sit on
// the grid.
export function checkSheets(
  view: EditorView,
  grid: PageGrid,
  pageCount: number,
): Check {
  const problems: string[] = [];
  const scale = getZoomScale(view.dom);
  const originTop = view.dom.getBoundingClientRect().top;
  const y = (clientY: number) => (clientY - originTop) / scale;
  const cycle = grid.height + PAGE_GAP;
  const { doc } = view.state;
  const textAt = (pos: number) =>
    doc
      .textBetween(pos, Math.min(pos + 80, doc.content.size), ' ')
      .trim()
      .slice(0, 30);
  const round = (n: number) => Math.round(n * 10) / 10;
  const area = (page: number) =>
    `page ${page + 1} text ${grid.contentTopOf(page)}..${grid.contentBottomOf(page)}`;

  document.querySelectorAll<HTMLElement>('.ddoc-page-sheet').forEach((el) => {
    const top = y(el.getBoundingClientRect().top);
    const i = Math.round(top / cycle);
    if (Math.abs(top - i * cycle) > TOLERANCE || i >= pageCount) {
      problems.push(`sheet at ${round(top)} is off the grid (${pageCount} pages)`);
    }
  });

  const inArea = (top: number, bottom: number) => {
    const page = grid.pageAt(top);
    return {
      page,
      ok:
        top >= grid.contentTopOf(page) - TOLERANCE &&
        bottom <= grid.contentBottomOf(page) + TOLERANCE,
    };
  };
  const range = document.createRange();
  let lastPage = -1;
  // Only headings so far on lastPage.
  let headingsOnly = true;
  for (const leaf of collectLeaves(view, grid.textHeight)) {
    if (leaf.kind === 'forced') continue;
    const el = view.nodeDOM(leaf.pos);
    if (!(el instanceof HTMLElement)) continue;
    const rect = el.getBoundingClientRect();
    const top = y(rect.top);
    const bottom = y(rect.bottom);
    const where = `@${leaf.pos} "${textAt(leaf.pos)}"`;
    if (leaf.kind === 'atomic') {
      const { page, ok } = inArea(top, bottom);
      const tall =
        bottom - top > grid.textHeight &&
        (page > lastPage || headingsOnly) &&
        top >= grid.contentTopOf(page) - TOLERANCE &&
        top <= grid.contentBottomOf(page);
      if (!ok && !tall) {
        problems.push(`${where} box ${round(top)}..${round(bottom)}, ${area(page)}`);
      }
      lastPage = grid.pageAt(bottom - TOLERANCE);
      headingsOnly = false;
      continue;
    }
    // Glyph rects per line; a line ends where the next one starts, as in place.
    const glyphs: Rect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const chrome = n.parentElement?.closest('[contenteditable="false"]');
      if (chrome && chrome !== el && el.contains(chrome)) continue;
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width > 0 && r.height > 0) {
          glyphs.push({
            top: r.top - originTop,
            bottom: r.bottom - originTop,
            left: r.left,
            right: r.right,
          });
        }
      }
    }
    const lines = groupLineRects(glyphs, scale);
    const isHeading = leaf.isHeading;
    lines.forEach((line, i) => {
      const next = lines[i + 1];
      const samePage = next && grid.pageAt(next.top) === grid.pageAt(line.top);
      const lineTop = i === 0 ? Math.max(line.top, top) : line.top;
      const lineBottom = samePage
        ? Math.min(line.bottom, next.top)
        : i === lines.length - 1
          ? Math.max(Math.min(line.bottom, bottom), line.top)
          : line.bottom;
      const { page, ok } = inArea(lineTop, lineBottom);
      if (!ok) {
        problems.push(
          `${where} line ${i + 1}/${lines.length} ${round(lineTop)}..${round(lineBottom)}, ${area(page)}`,
        );
      }
      headingsOnly = isHeading && (page > lastPage || headingsOnly);
      lastPage = page;
    });
    if (lines.length) {
      const endPage = grid.pageAt(lines[lines.length - 1].top);
      if (bottom > grid.contentBottomOf(endPage) + TOLERANCE) {
        problems.push(`${where} box bottom ${round(bottom)}, ${area(endPage)}`);
      }
    }
  }
  if (lastPage >= pageCount) {
    problems.push(`content on page ${lastPage + 1}, store has ${pageCount}`);
  }
  if (!view.dom.querySelector(`.${SPACER_CLASS}`) && pageCount > 1) {
    problems.push(`${pageCount} pages but no spacer in the view`);
  }
  return { ok: problems.length === 0, problems };
}

// window.__ddocPages: the hook scripts/pages-print-check.cjs drives.
export const installPagesDebug = (deps: PagesDebugDeps) => {
  let cleanup: (() => void) | null = null;
  let unwatch: (() => void) | null = null;
  let written: string[] = [];
  const api: PagesDebugApi = {
    ready: false,
    breaks: () => computeBreaks(deps),
    pass: () => {
      const storage = deps.getEditor()?.storage.pagination;
      if (!storage) return null;
      return {
        passCount: storage.lastPass?.count ?? 0,
        lastTimings: storage.lastPass?.timings ?? null,
        dispatched: storage.lastPass?.dispatched ?? false,
        dispatches: storage.lastPass?.dispatches ?? 0,
        settled: storage.isIdle(),
        pageCount: storage.store.get().pageCount,
      };
    },
    sheetCheck: () => {
      const s = settings(deps);
      const pageCount = s?.editor.storage.pagination?.store.get().pageCount;
      if (!s || !pageCount) return null;
      const grid = new PageGrid(s.pageSetup.paper, s.orientation);
      return checkSheets(s.editor.view, grid, pageCount);
    },
    stateVector: () => {
      const ydoc = deps.getYdoc?.();
      if (!ydoc) return null;
      return btoa(String.fromCharCode(...Y.encodeStateVector(ydoc)));
    },
    // Every tab's content (its XmlFragment), to compare before and after.
    tabContent: () => {
      const ydoc = deps.getYdoc?.();
      if (!ydoc) return null;
      const tabs = [...ydoc.share]
        .filter(([, type]) => type instanceof Y.XmlFragment)
        .map(([name, type]) => [name, type.toString()]);
      return JSON.stringify(tabs);
    },
    // Records every Yjs transaction that changes something, from now on.
    watchWrites: () => {
      unwatch?.();
      written = [];
      const ydoc = deps.getYdoc?.();
      if (!ydoc) return;
      const onTr = (tr: Y.Transaction) => {
        tr.changed.forEach((keys, type) => {
          const name =
            [...ydoc.share].find(([, t]) => t === type)?.[0] ??
            type._item?.parentSub;
          const keyList = [...keys].filter(Boolean).join(',');
          written.push(`${name ?? type.constructor.name}${keyList ? `.${keyList}` : ''}`);
        });
      };
      ydoc.on('afterTransaction', onTr);
      unwatch = () => ydoc.off('afterTransaction', onTr);
    },
    writes: () => written,
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
