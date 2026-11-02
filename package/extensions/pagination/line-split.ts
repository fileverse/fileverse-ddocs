// Ported from Edentext (https://github.com/stffnb/edentext, b5ee86a), src/lib/editor/extensions/pageBreaks.ts. AGPL-3.0.
import type { EditorView } from '@tiptap/pm/view';
import type { Line } from './place';

export type Rect = { top: number; bottom: number; left: number; right: number };

// Groups rects into lines by top proximity, not overlap: decorative fonts draw
// ink boxes taller than the line advance, which would chain lines together.
// The tolerance is a fraction of the median top-to-top advance.
export function groupLineRects(rects: Rect[], scale: number): Rect[] {
  if (rects.length === 0) return [];
  const sorted = [...rects].sort((a, b) => a.top - b.top);
  const gaps = sorted
    .slice(1)
    .map((rect, i) => rect.top - sorted[i].top)
    .filter((gap) => gap > 2)
    .sort((a, b) => a - b);
  const advance = gaps.length ? gaps[gaps.length >> 1] : 0;
  const tolerance = advance > 0 ? advance * 0.6 : 3;

  const lines: Rect[] = [];
  let lineTop = -Infinity;
  for (const rect of sorted) {
    if (rect.top - lineTop > tolerance) {
      lines.push({ ...rect });
      lineTop = rect.top;
    } else {
      const last = lines[lines.length - 1];
      last.bottom = Math.max(last.bottom, rect.bottom);
      last.left = Math.min(last.left, rect.left);
      last.right = Math.max(last.right, rect.right);
    }
  }
  return lines.map((line) => ({
    top: line.top / scale,
    bottom: line.bottom / scale,
    left: line.left / scale,
    right: line.right / scale,
  }));
}

const textNodesOf = (el: HTMLElement): Text[] => {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const chrome = node.parentElement?.closest('[contenteditable="false"]');
    // Skip node-view chrome (e.g. code line numbers) inside the block.
    if (chrome && chrome !== el && el.contains(chrome)) continue;
    if (node.textContent) nodes.push(node as Text);
  }
  return nodes;
};

// Line boxes of a textblock in the view.dom frame, unscaled. A line's bottom is
// the next line's top (glyph rects stop short of the line box); the last line
// ends at the block's bottom.
export function measureLines(
  view: EditorView,
  el: HTMLElement,
  args: {
    from: number;
    to: number;
    originTop: number;
    bottom: number;
    scale: number;
    range: Range;
  },
): Line[] {
  const { from, to, originTop, bottom, scale, range } = args;
  const rects: Rect[] = [];
  for (const node of textNodesOf(el)) {
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 0 && rect.height > 0) {
        rects.push({
          top: rect.top - originTop,
          bottom: rect.bottom - originTop,
          left: rect.left,
          right: rect.right,
        });
      }
    }
  }
  const lines = groupLineRects(rects, scale);
  const elRect = el.getBoundingClientRect();
  return lines.map((line, i) => ({
    top: line.top,
    bottom: i + 1 < lines.length ? lines[i + 1].top : bottom,
    startPos:
      i === 0
        ? from
        : lineStartPos(view, {
            from,
            to,
            screenTop: line.top * scale + originTop,
            screenMid: ((line.top + line.bottom) / 2) * scale + originTop,
            left: elRect.left,
            right: elRect.right,
          }),
  }));
}

// First document position on the line starting at screenTop.
function lineStartPos(
  view: EditorView,
  a: {
    from: number;
    to: number;
    screenTop: number;
    screenMid: number;
    left: number;
    right: number;
  },
): number {
  let lo = a.from;
  let hi = a.to;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    let top: number;
    try {
      top = view.coordsAtPos(mid).top;
    } catch {
      lo = mid + 1;
      continue;
    }
    if (top >= a.screenTop - 0.5) hi = mid;
    else lo = mid + 1;
  }
  // Chromium reports the letters after an automatic hyphen on the line above;
  // a hit test at the line's edges finds its true start.
  const hit = Math.min(
    view.posAtCoords({ left: a.left + 1, top: a.screenMid })?.pos ?? Infinity,
    view.posAtCoords({ left: a.right - 1, top: a.screenMid })?.pos ?? Infinity,
  );
  if (
    hit > a.from &&
    hit < lo &&
    !/\s/.test(view.state.doc.textBetween(hit, lo, ' ', ' '))
  ) {
    lo = hit;
  }
  return lo;
}
