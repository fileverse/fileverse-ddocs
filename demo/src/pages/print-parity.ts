import type { EditorView } from '@tiptap/pm/view';
import {
  mountContentPrintHost,
  type ContentPrintOptions,
} from '../../../package/utils/handle-print';
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
  // The real print host and its Pages CSS, shown off-screen with screen media.
  const { cleanup } = mountContentPrintHost(html, options);
  const hosts = document.querySelectorAll<HTMLElement>('.ddoc-print-host');
  const host = hosts[hosts.length - 1];
  host.setAttribute('data-pages-parity', '');
  host.style.cssText =
    'display:block !important;position:absolute;left:-100000px;top:0';

  const scale = getZoomScale(view.dom);
  const screen: {
    el: HTMLElement;
    top: number;
    height: number;
    skip: boolean;
    afterBreak: boolean;
  }[] = [];
  let afterBreak = false;
  view.state.doc.forEach((node, pos) => {
    // A page break is a grey strip on screen and a zero-height break in print.
    const isBreak = node.type.name === 'pageBreak';
    const el = view.nodeDOM(pos);
    if (!(el instanceof HTMLElement)) return;
    const rect = el.getBoundingClientRect();
    screen.push({
      el,
      top: rect.top / scale,
      height: rect.height / scale,
      skip: isBreak,
      afterBreak,
    });
    afterBreak = isBreak;
  });

  const root = host.querySelector('.print-content-root');
  const printed = [...(root?.children ?? [])].map((child) => {
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
    if (i > 0 && !prev.skip && !block.afterBreak && printed[i - 1]) {
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

  cleanup();
  return { ok: mismatches.length === 0, mismatches };
}
