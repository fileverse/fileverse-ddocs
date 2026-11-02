import type { EditorView } from '@tiptap/pm/view';
import {
  getPaperPx,
  PAGE_MARGIN,
} from '../../../package/extensions/pagination/page-grid';
import type { ContentPrintOptions } from '../../../package/utils/handle-print';
import { getZoomScale } from '../../../package/utils/zoom';

export type ParityMismatch = {
  index: number;
  tag: string;
  text: string;
  screen: number;
  print: number;
};

const TOLERANCE = 0.5;

// Renders the print HTML off-screen the way the print root lays it out and
// compares every top-level block with the live editor (docs/PAGES_MODE.md
// §6.2). A difference is a stylesheet or node-view mismatch, not glyph drift.
export function measurePrintParity(
  view: EditorView,
  html: string,
  options: ContentPrintOptions,
): { ok: boolean; mismatches: ParityMismatch[] } {
  const { pageSetup, orientation, rootStyle } = options;
  const width = pageSetup ? getPaperPx(pageSetup.paper, orientation).width : 0;

  const holder = document.createElement('div');
  holder.setAttribute('data-pages-parity', '');
  holder.style.cssText = 'position:absolute;left:-100000px;top:0';
  const root = document.createElement('div');
  root.className = 'print-content-root ProseMirror main-doc-editor';
  root.setAttribute('data-page-mode', 'pages');
  Object.assign(root.style, rootStyle);
  root.style.boxSizing = 'border-box';
  root.style.width = `${width}px`;
  root.style.setProperty('padding', `0 ${PAGE_MARGIN}px`, 'important');
  root.innerHTML = html;
  holder.appendChild(root);
  document.body.appendChild(holder);

  const scale = getZoomScale(view.dom);
  const screen: { el: HTMLElement; top: number; height: number; skip: boolean }[] =
    [];
  view.state.doc.forEach((node, pos) => {
    const el = view.nodeDOM(pos);
    if (!(el instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    const inner = node.firstChild?.type.name;
    screen.push({
      el,
      top: rect.top / scale,
      height: rect.height / scale,
      // A page break is a grey strip on screen and a section split in print.
      skip: node.type.name === 'pageBreak' || inner === 'pageBreak',
    });
  });

  const printed = [...root.children].map((child) => {
    const rect = child.getBoundingClientRect();
    return { el: child as HTMLElement, top: rect.top, height: rect.height };
  });

  const mismatches: ParityMismatch[] = [];
  screen.forEach((block, i) => {
    const out = printed[i];
    if (!out || block.skip) return;
    const describe = (screenValue: number, printValue: number, tag: string) => ({
      index: i,
      tag,
      text: (out.el.textContent ?? '').trim().slice(0, 40),
      screen: Math.round(screenValue * 100) / 100,
      print: Math.round(printValue * 100) / 100,
    });
    if (Math.abs(block.height - out.height) > TOLERANCE) {
      mismatches.push(describe(block.height, out.height, out.el.tagName));
    }
    const prev = screen[i - 1];
    if (i > 0 && !prev.skip && printed[i - 1]) {
      const screenGap = block.top - (prev.top + prev.height);
      const printGap = out.top - (printed[i - 1].top + printed[i - 1].height);
      if (Math.abs(screenGap - printGap) > TOLERANCE) {
        mismatches.push(
          describe(screenGap, printGap, `${out.el.tagName} (gap above)`),
        );
      }
    }
  });
  if (printed.length !== screen.length) {
    mismatches.push({
      index: -1,
      tag: 'block count',
      text: '',
      screen: screen.length,
      print: printed.length,
    });
  }

  holder.remove();
  return { ok: mismatches.length === 0, mismatches };
}
