// Ported from Edentext (https://github.com/stffnb/edentext, b5ee86a), src/lib/editor/extensions/pageBreaks.ts. AGPL-3.0.
// Placement only: leaf measurements in, break positions out. No DOM.
import type { PageGrid } from './page-grid';

export type Line = { top: number; bottom: number; startPos: number };
export type Leaf =
  | {
      kind: 'text';
      pos: number;
      top: number;
      bottom: number;
      marginTop: number;
      isHeading: boolean;
      lines: Line[];
    }
  | {
      kind: 'atomic';
      pos: number;
      top: number;
      bottom: number;
      marginTop: number;
      // headerHeight is 0 when the table has no header row.
      row?: { tableId: number; isHeader: boolean; headerHeight: number };
    }
  | { kind: 'forced'; pos: number };
export type PrintBreak =
  | { kind: 'before'; pos: number }
  | { kind: 'inText'; pos: number };
export type PageStart = { kind: 'before' | 'inText'; pos: number };
export type Placement = {
  breaks: PrintBreak[];
  pageStarts: PageStart[];
  pageCount: number;
};

type FlowLeaf = Exclude<Leaf, { kind: 'forced' }>;

// Word and LibreOffice keep at least two lines on each side of a split.
const MIN_KEPT_LINES = 2;

export function place(leaves: Leaf[], grid: PageGrid): Placement {
  const breaks: PrintBreak[] = [];
  const pageStarts: PageStart[] = [];
  let shift = 0;
  let page = 0;
  let placedOnPage = false;
  let startNextPage: 'forced' | 'overflow' | null = null;

  const bottomOfPage = () => grid.contentBottomOf(page);
  const fits = (leaf: FlowLeaf) => leaf.bottom + shift <= bottomOfPage();

  // Moves `leaf` to the top of the next page, keeping its margin-top: print
  // truncates the margin before a forced break and keeps the one after it.
  const pushToNextPage = (leaf: FlowLeaf, reserve = 0) => {
    page += 1;
    shift +=
      grid.contentTopOf(page) + leaf.marginTop + reserve - (leaf.top + shift);
    pageStarts.push({ kind: 'before', pos: leaf.pos });
  };

  const nextFlowLeaf = (i: number): FlowLeaf | null => {
    const next = leaves[i + 1];
    return next && next.kind !== 'forced' ? next : null;
  };

  // A heading or header row moves down with the block after it when that block
  // would not start on this page with at least two lines (or whole, if atomic).
  const strandsNext = (next: FlowLeaf | null) => {
    if (!next || fits(next)) return false;
    if (next.kind === 'atomic') return true;
    const fitting = next.lines.filter(
      (line) => line.bottom + shift <= bottomOfPage(),
    ).length;
    return fitting < MIN_KEPT_LINES;
  };

  leaves.forEach((leaf, i) => {
    if (leaf.kind === 'forced') {
      startNextPage = 'forced';
      return;
    }
    if (pageStarts.length === 0) {
      pageStarts.push({ kind: 'before', pos: leaf.pos });
    } else if (startNextPage) {
      if (startNextPage === 'overflow') {
        breaks.push({ kind: 'before', pos: leaf.pos });
      }
      pushToNextPage(leaf);
      placedOnPage = false;
    }
    startNextPage = null;
    const firstOnPage = !placedOnPage;

    if (leaf.kind === 'atomic') {
      const keepsNext =
        leaf.row?.isHeader === true &&
        nextFlowLeaf(i)?.kind === 'atomic' &&
        strandsNext(nextFlowLeaf(i));
      if (fits(leaf) && !(keepsNext && !firstOnPage)) {
        placedOnPage = true;
        return;
      }
      if (firstOnPage) {
        // Taller than a page: it stays and overflows (clipped), and the next
        // leaf starts the following page.
        startNextPage = 'overflow';
        placedOnPage = true;
        return;
      }
      const reserve =
        leaf.row && !leaf.row.isHeader ? leaf.row.headerHeight : 0;
      breaks.push({ kind: 'before', pos: leaf.pos });
      pushToNextPage(leaf, reserve);
      placedOnPage = true;
      return;
    }

    const next = nextFlowLeaf(i);
    if (
      leaf.isHeading &&
      !firstOnPage &&
      fits(leaf) &&
      !(next?.kind === 'text' && next.isHeading) &&
      strandsNext(next)
    ) {
      breaks.push({ kind: 'before', pos: leaf.pos });
      pushToNextPage(leaf);
      placedOnPage = true;
      return;
    }

    const minLines =
      leaf.bottom - leaf.top > grid.textHeight ? 1 : MIN_KEPT_LINES;
    let startIdx = 0;
    let isFirst = firstOnPage;
    while (leaf.bottom + shift > bottomOfPage()) {
      let k = leaf.lines.findIndex(
        (line, idx) => idx >= startIdx && line.bottom + shift > bottomOfPage(),
      );
      if (k < 0) break;
      const carried = leaf.lines.length - k;
      if (carried < minLines) k -= minLines - carried;
      if (k - startIdx < minLines) {
        if (startIdx === 0 && !isFirst) {
          breaks.push({ kind: 'before', pos: leaf.pos });
          pushToNextPage(leaf);
          isFirst = true;
          continue;
        }
        k = Math.min(startIdx + minLines, leaf.lines.length - 1);
        if (k <= startIdx) break;
      }
      const line = leaf.lines[k];
      breaks.push({ kind: 'inText', pos: line.startPos });
      pageStarts.push({ kind: 'inText', pos: line.startPos });
      page += 1;
      shift += grid.contentTopOf(page) - (line.top + shift);
      startIdx = k;
      isFirst = true;
    }
    placedOnPage = true;
  });

  return { breaks, pageStarts, pageCount: page + 1 };
}
