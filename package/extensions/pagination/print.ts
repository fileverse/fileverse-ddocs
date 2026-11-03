import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { DdocProps, PageSetup } from '../../types';
import { getTemporaryEditor } from '../../utils/helpers';
import { getZoomScale } from '../../utils/zoom';
import {
  handleContentPrint,
  type ContentPrintOptions,
} from '../../utils/handle-print';
import { renderMermaidBlocks } from '../code-block/render-mermaid-html';
import { searchForSecureImageNodeAndEmbedImageContent } from '../mardown-paste-handler';
import { collectLeaves } from './collect-leaves';
import { PageGrid } from './page-grid';
import { place, type Placement } from './place';
import {
  buildPrintSchema,
  REPEAT_HEADER,
  serializeWithBreaks,
} from './print-break-node';

export type PagesPrintBreaks = Placement & { pageFirstText: string[] };

export function getPrintBreaks(
  view: EditorView,
  grid: PageGrid,
): PagesPrintBreaks {
  const placement = place(collectLeaves(view, grid.textHeight), grid);
  const { doc } = view.state;
  const pageFirstText = placement.pageStarts.map((start) =>
    doc
      .textBetween(start.pos, Math.min(start.pos + 200, doc.content.size), ' ')
      .trim()
      .slice(0, 40),
  );
  return { ...placement, pageFirstText };
}

const ROOT_STYLE_KEYS = [
  'fontFamily',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'wordSpacing',
] as const;

// Text styles set outside .ProseMirror (documentStyling.fontFamily sits on the
// canvas wrapper) must reach the print root, or lines wrap differently.
const readRootStyle = (dom: HTMLElement) => {
  const computed = getComputedStyle(dom);
  const style: NonNullable<ContentPrintOptions['rootStyle']> = {};
  ROOT_STYLE_KEYS.forEach((key) => {
    if (computed[key]) style[key] = computed[key];
  });
  return style;
};

const NO_CHILD_RENDER = new Set([
  'IFRAME',
  'IMG',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'EMBED',
  'OBJECT',
]);

// Layout-neutral page labels the M0 checker reads back out of a PDF.
const addDebugMarkers = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('[data-print-page-start]').forEach((el) => {
    const marker = document.createElement('span');
    marker.className = 'ddoc-print-marker';
    // Below the page edge: WebKit paints a glyph crossing it on both pages.
    marker.setAttribute(
      'style',
      'position:absolute;top:4px;font-size:4px;line-height:1;color:#fff',
    );
    marker.textContent = `§P${el.getAttribute('data-print-page-start')}§`;
    // A span directly in a <tr> would be moved out of the table on parse.
    let host = el.tagName === 'TR' ? (el.querySelector('td, th') ?? el) : el;
    // An iframe or other replaced element renders no children: wrap it in a
    // block that takes over its break and page start, and hold the marker there.
    if (NO_CHILD_RENDER.has(el.tagName) && el.parentNode) {
      host = document.createElement('div');
      ['data-print-break-before', 'data-print-page-start'].forEach((name) => {
        if (!el.hasAttribute(name)) return;
        host.setAttribute(name, el.getAttribute(name) ?? '');
        el.removeAttribute(name);
      });
      el.parentNode.insertBefore(host, el);
      host.appendChild(el);
    }
    // Gecko places an absolute box against its containing block's unbroken
    // layout: the host itself must be that block, on the marker's page.
    if (host instanceof HTMLElement) host.style.position = 'relative';
    host.insertBefore(marker, host.firstChild);
  });
  return root.innerHTML;
};

type BlockAttrs = { pos: number; attrs: Record<string, string> }[];

// Ordered lists print as blocks (WebKit cannot break inside a flex item),
// where adjacent item margins collapse; in the screen's flex column they add
// up, so each gap moves onto the lower item as that sum.
const orderedListMargins = (editor: Editor): BlockAttrs => {
  const out: BlockAttrs = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'orderedList') return true;
    const items: { pos: number; top: number; bottom: number }[] = [];
    node.forEach((_item, offset) => {
      const el = editor.view.nodeDOM(pos + 1 + offset);
      if (!(el instanceof HTMLElement)) return;
      const style = getComputedStyle(el);
      items.push({
        pos: pos + 1 + offset,
        top: parseFloat(style.marginTop) || 0,
        bottom: parseFloat(style.marginBottom) || 0,
      });
    });
    items.forEach((item, i) => {
      const top = item.top + (i > 0 ? items[i - 1].bottom : 0);
      const bottom = i < items.length - 1 ? 0 : item.bottom;
      out.push({
        pos: item.pos,
        attrs: { style: `margin-top: ${top}px; margin-bottom: ${bottom}px` },
      });
    });
    return true;
  });
  return out;
};

// Column widths of each table that print splits at a row break, from a row
// without merged cells; automatic layout would size every piece anew.
const splitTableWidths = (editor: Editor, placement: Placement): BlockAttrs => {
  const { doc } = editor.state;
  const scale = getZoomScale(editor.view.dom);
  const tables = new Set<number>();
  placement.breaks.forEach((b) => {
    if (b.kind !== 'before' || doc.nodeAt(b.pos)?.type.name !== 'tableRow') {
      return;
    }
    const $row = doc.resolve(b.pos);
    if ($row.index() > 0) tables.add($row.before());
  });
  const out: BlockAttrs = [];
  tables.forEach((pos) => {
    const dom = editor.view.nodeDOM(pos);
    const table =
      dom instanceof HTMLTableElement
        ? dom
        : dom instanceof HTMLElement
          ? dom.querySelector('table')
          : null;
    const columns = table?.querySelectorAll('col').length ?? 0;
    const row = [...(table?.rows ?? [])].find(
      (r) =>
        r.cells.length === columns &&
        [...r.cells].every((cell) => cell.colSpan === 1),
    );
    if (!row) return;
    const widths = [...row.cells].map(
      (cell) => cell.getBoundingClientRect().width / scale,
    );
    out.push({ pos, attrs: { 'data-print-col-widths': widths.join(',') } });
  });
  return out;
};

// Rows that open a page under a repeated header on screen: their print piece
// repeats it too.
const repeatedHeaderRows = (placement: Placement): BlockAttrs =>
  placement.spacers
    .filter((s) => s.header)
    .map((s) => ({ pos: s.pos, attrs: { [REPEAT_HEADER]: '' } }));

// Mermaid blocks the live editor shows as source: Pages prints a diagram in
// the state it shows, so these stay code.
const MERMAID_SOURCE = 'data-print-mermaid-source';
const mermaidSourceBlocks = (editor: Editor) => {
  const out: { pos: number; attrs: Record<string, string> }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock' || node.attrs.language !== 'mermaid') {
      return true;
    }
    const el = editor.view.nodeDOM(pos);
    const pre =
      el instanceof HTMLElement
        ? (el.closest('pre') ?? el.querySelector('pre') ?? el)
        : null;
    if (pre?.getAttribute('data-mermaid-view') === 'source') {
      out.push({ pos, attrs: { [MERMAID_SOURCE]: '' } });
    }
    return false;
  });
  return out;
};

// The live layout's placement, so print breaks where the screen does. Null
// (extension idle or failed) lets buildPrintHtml measure afresh.
export function resolvePrintPlacement(
  editor: Editor,
  isPagesActive: boolean,
): Placement | undefined {
  if (!isPagesActive) return undefined;
  return editor.storage.pagination?.flush() ?? undefined;
}

export async function buildPrintHtml(args: {
  editor: Editor;
  pageSetup?: PageSetup;
  orientation?: 'portrait' | 'landscape';
  isPagesActive: boolean;
  ipfsImageFetchFn?: DdocProps['ipfsImageFetchFn'];
  fetchV1ImageFn?: DdocProps['fetchV1ImageFn'];
  debugMarkers?: boolean;
  // Breaks already computed for this layout (the demo shows them first).
  placement?: Placement;
}): Promise<{ html: string; options: ContentPrintOptions }> {
  const { editor, pageSetup, orientation, isPagesActive } = args;
  const liveDoc = editor.state.doc;
  const isPages = pageSetup?.mode === 'pages';

  let placement: Placement | null =
    isPages && isPagesActive
      ? (args.placement ??
        getPrintBreaks(editor.view, new PageGrid(pageSetup.paper, orientation)))
      : null;

  const embedded = await searchForSecureImageNodeAndEmbedImageContent(
    liveDoc,
    args.ipfsImageFetchFn,
    args.fetchV1ImageFn,
    true,
  );
  // Break positions are only valid while the structure is the same.
  if (placement && embedded.content.size !== liveDoc.content.size) {
    console.warn(
      `ddoc pages: image embedding changed the document size (${liveDoc.content.size} -> ${embedded.content.size}); printing without page breaks`,
    );
    placement = null;
  }

  let html: string;
  if (isPages) {
    const sameStructure = embedded.content.size === liveDoc.content.size;
    html = serializeWithBreaks(
      embedded,
      buildPrintSchema(editor.schema),
      placement?.breaks ?? [],
      placement?.pageStarts ?? [],
      sameStructure
        ? [
            ...mermaidSourceBlocks(editor),
            ...orderedListMargins(editor),
            ...(placement
              ? [
                  ...splitTableWidths(editor, placement),
                  ...repeatedHeaderRows(placement),
                ]
              : []),
          ]
        : [],
    );
  } else {
    const temporaryEditor = getTemporaryEditor(
      editor as Parameters<typeof getTemporaryEditor>[0],
      embedded.toJSON(),
    );
    html = temporaryEditor.getHTML();
    temporaryEditor.destroy();
  }
  html = await renderMermaidBlocks(
    html,
    isPages ? { skip: (pre) => pre.hasAttribute(MERMAID_SOURCE) } : {},
  );
  if (args.debugMarkers) html = addDebugMarkers(html);

  return {
    html,
    options: isPages
      ? { pageSetup, orientation, rootStyle: readRootStyle(editor.view.dom) }
      : {},
  };
}

export type PrintInputs = Omit<
  Parameters<typeof buildPrintHtml>[0],
  'editor' | 'placement'
>;

const printInputsByEditor = new WeakMap<Editor, () => PrintInputs>();

export function setPrintInputs(
  editor: Editor,
  get: (() => PrintInputs) | null,
): void {
  if (get) printInputsByEditor.set(editor, get);
  else printInputsByEditor.delete(editor);
}

export function getPrintInputs(editor: Editor): PrintInputs | undefined {
  return printInputsByEditor.get(editor)?.();
}

// Prints the tab through the Pages pipeline. False (nothing printed) means the
// caller keeps its Pageless path.
export async function printPagesTab(editor: Editor): Promise<boolean> {
  const inputs = getPrintInputs(editor);
  if (inputs?.pageSetup?.mode !== 'pages') return false;
  const { html, options } = await buildPrintHtml({
    editor,
    ...inputs,
    placement: resolvePrintPlacement(editor, inputs.isPagesActive),
  });
  handleContentPrint(html, options);
  return true;
}
