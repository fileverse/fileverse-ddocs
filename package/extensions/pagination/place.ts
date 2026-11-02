// Ported from Edentext (https://github.com/stffnb/edentext, b5ee86a), src/lib/editor/extensions/pageBreaks.ts. AGPL-3.0.
// Placement only: leaf measurements in, break positions out. No DOM.
import { PRINT_BOTTOM_SLACK, type PageGrid } from './page-grid';

export type Line = { top: number; bottom: number; startPos: number };
// marginTop: what print keeps above the leaf after a forced break, i.e. the
// margins, borders and padding of the boxes that start with it (leadingOffset).
export type Leaf =
  | {
      kind: 'text';
      pos: number;
      top: number;
      bottom: number;
      marginTop: number;
      spacerPos: number;
      spacerCollapse: number;
      isHeading: boolean;
      lines: Line[];
    }
  | {
      kind: 'atomic';
      pos: number;
      top: number;
      bottom: number;
      marginTop: number;
      spacerPos: number;
      spacerCollapse: number;
      // headerHeight is 0 when the table has no header row.
      row?: { tableId: number; isHeader: boolean; headerHeight: number };
    }
  | { kind: 'forced'; pos: number };
export type PrintBreak =
  | { kind: 'before'; pos: number }
  | { kind: 'inText'; pos: number };
// 'continued': a box taller than a page carries on at the top of this page.
export type PageStart = {
  kind: 'before' | 'inText' | 'continued';
  pos: number;
};
// spacerPos: start of the outermost node that starts with the leaf.
// spacerCollapse: margin that stops collapsing when a spacer sits there.
// page: the 1-based page the spacer opens; print is false when paper has no
// break there (the leaf after a box taller than a page). print means the
// page also starts on paper, not that `breaks` has an entry: a leaf after a
// forced pageBreak gets print: true and no break.
export type Spacer = {
  kind: 'block' | 'inText';
  pos: number;
  height: number;
  page: number;
  print: boolean;
};
export type Placement = {
  breaks: PrintBreak[];
  pageStarts: PageStart[];
  pageCount: number;
  spacers: Spacer[];
};

type FlowLeaf = Exclude<Leaf, { kind: 'forced' }>;

// Word and LibreOffice keep at least two lines on each side of a split.
const MIN_KEPT_LINES = 2;

export function place(leaves: Leaf[], grid: PageGrid): Placement {
  const breaks: PrintBreak[] = [];
  const pageStarts: PageStart[] = [];
  const spacers: Spacer[] = [];
  // Shift a tall box's spill leaves for the next leaf, and the spacer for it.
  let carry = 0;
  let followIdx = -1;
  let followDelta = 0;
  let shift = 0;
  let page = 0;
  let placedOnPage = false;
  let startNextPage = false;

  const bottomOfPage = () => grid.contentBottomOf(page);
  const fits = (leaf: FlowLeaf) => leaf.bottom + shift <= bottomOfPage();

  // Moves `leaf` to the top of the next page, keeping its margin-top: print
  // truncates the margin before a forced break and keeps the one after it.
  const pushToNextPage = (leaf: FlowLeaf, reserve = 0) => {
    page += 1;
    const delta =
      grid.contentTopOf(page) + leaf.marginTop + reserve - (leaf.top + shift);
    shift += delta;
    let height = delta;
    if (followIdx >= 0) {
      height += followDelta;
      spacers.splice(followIdx, 1);
      followIdx = -1;
    }
    spacers.push({
      kind: 'block',
      pos: leaf.spacerPos,
      height: Math.max(0, Math.round(height - leaf.spacerCollapse)),
      page: page + 1,
      print: true,
    });
    pageStarts.push({ kind: 'before', pos: leaf.pos });
  };

  // Print fragments a box taller than a page across pages; each printed page
  // holds the text height plus the bottom slack, less a repeated table header.
  const spill = (leaf: Extract<FlowLeaf, { kind: 'atomic' }>) => {
    const reserve = leaf.row && !leaf.row.isHeader ? leaf.row.headerHeight : 0;
    const capacity = grid.textHeight + PRINT_BOTTOM_SLACK - reserve;
    const shiftBefore = shift;
    let rest =
      leaf.bottom + shift - (grid.contentBottomOf(page) + PRINT_BOTTOM_SLACK);
    while (rest > 0) {
      page += 1;
      pageStarts.push({ kind: 'continued', pos: leaf.pos });
      if (rest <= capacity) {
        shift +=
          grid.contentTopOf(page) + reserve + rest - (leaf.bottom + shift);
      }
      rest -= capacity;
    }
    carry = shift - shiftBefore;
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
      startNextPage = true;
      return;
    }
    followIdx = -1;
    if (carry > 0) {
      followIdx = spacers.length;
      followDelta = carry;
      carry = 0;
      spacers.push({
        kind: 'block',
        pos: leaf.spacerPos,
        height: Math.max(0, Math.round(followDelta - leaf.spacerCollapse)),
        page: page + 1,
        print: false,
      });
    }
    if (pageStarts.length === 0) {
      pageStarts.push({ kind: 'before', pos: leaf.pos });
    } else if (startNextPage) {
      pushToNextPage(leaf);
      placedOnPage = false;
    }
    startNextPage = false;
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
      // Taller than a page: it fits nowhere, so it spans from where it is.
      const isTall = leaf.bottom - leaf.top > grid.textHeight;
      if (!firstOnPage && !isTall) {
        const reserve =
          leaf.row && !leaf.row.isHeader ? leaf.row.headerHeight : 0;
        breaks.push({ kind: 'before', pos: leaf.pos });
        pushToNextPage(leaf, reserve);
      }
      if (!fits(leaf)) spill(leaf);
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
      const delta = grid.contentTopOf(page) - (line.top + shift);
      shift += delta;
      spacers.push({
        kind: 'inText',
        pos: line.startPos,
        height: Math.round(delta),
        page: page + 1,
        print: true,
      });
      startIdx = k;
      isFirst = true;
    }
    placedOnPage = true;
  });

  return { breaks, pageStarts, pageCount: page + 1, spacers };
}
