import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import type { DdocProps, PageSetup } from '../../types';
import { getTemporaryEditor } from '../../utils/helpers';
import type { ContentPrintOptions } from '../../utils/handle-print';
import { renderMermaidBlocks } from '../code-block/render-mermaid-html';
import { searchForSecureImageNodeAndEmbedImageContent } from '../mardown-paste-handler';
import { collectLeaves } from './collect-leaves';
import { PageGrid } from './page-grid';
import { place, type Placement } from './place';
import { buildPrintSchema, serializeWithBreaks } from './print-break-node';

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

// Layout-neutral page labels the M0 checker reads back out of a PDF.
const addDebugMarkers = (html: string) => {
  const root = document.createElement('div');
  root.innerHTML = html;
  root.querySelectorAll('[data-print-page-start]').forEach((el) => {
    const marker = document.createElement('span');
    marker.className = 'ddoc-print-marker';
    marker.setAttribute(
      'style',
      'position:absolute;font-size:4px;line-height:1;color:#fff',
    );
    marker.textContent = `§P${el.getAttribute('data-print-page-start')}§`;
    // A span directly in a <tr> would be moved out of the table on parse.
    const host = el.tagName === 'TR' ? (el.querySelector('td, th') ?? el) : el;
    host.insertBefore(marker, host.firstChild);
  });
  return root.innerHTML;
};

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
    html = serializeWithBreaks(
      embedded,
      buildPrintSchema(editor.schema),
      placement?.breaks ?? [],
      placement?.pageStarts ?? [],
    );
  } else {
    const temporaryEditor = getTemporaryEditor(
      editor as Parameters<typeof getTemporaryEditor>[0],
      embedded.toJSON(),
    );
    html = temporaryEditor.getHTML();
    temporaryEditor.destroy();
  }
  html = await renderMermaidBlocks(html);
  if (args.debugMarkers) html = addDebugMarkers(html);

  return {
    html,
    options: isPages
      ? { pageSetup, orientation, rootStyle: readRootStyle(editor.view.dom) }
      : {},
  };
}
