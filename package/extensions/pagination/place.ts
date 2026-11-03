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
      // A single row's cells: lines of every textblock in each, and where
      // its content ends. Read only when the row splits (§13.6).
      cells?: { lines: Line[]; bottom: number }[];
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
// header: the repeated header row's height, part of `height`, when the spacer
// opens a page in the middle of a table (docs/PAGES_MODE.md §13.6).
export type Spacer = {
  kind: 'block' | 'inText';
  pos: number;
  height: number;
  page: number;
  print: boolean;
  header?: number;
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
  // Only headings (or a header row) so far on this page: a keep-with-next
  // chain that opens it.
  let headingsOnly = true;
  let startNextPage = false;
  // Placed minus rendered shift: each spacer's rounding is carried into the
  // next one, so the screen never drifts from the placement by more than 0.5px.
  let drift = 0;
  let followDrift = 0;

  const pixels = (displacement: number, collapse = 0) => {
    const height = Math.max(0, Math.round(displacement - collapse + drift));
    // A 0px spacer is not emitted, so its margins still collapse.
    drift += height ? displacement - collapse - height : displacement;
    return height;
  };

  const bottomOfPage = () => grid.contentBottomOf(page);
  // What one printed page holds. A header repeats on continued pages only
  // when it is at most a quarter of that (my reading of Chromium's table
  // fragmentation); a taller one would leave no room for rows.
  const capacity = grid.textHeight + PRINT_BOTTOM_SLACK;
  const repeated = (headerHeight: number) =>
    headerHeight <= capacity / 4 ? headerHeight : 0;
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
      drift = followDrift;
    }
    spacers.push({
      kind: 'block',
      pos: leaf.spacerPos,
      height: pixels(height, leaf.spacerCollapse),
      page: page + 1,
      print: true,
      ...(reserve > 0 ? { header: reserve } : {}),
    });
    pageStarts.push({ kind: 'before', pos: leaf.pos });
    headingsOnly = true;
  };

  // Print fragments a box taller than a page across pages; each printed page
  // holds the text height plus the bottom slack, less a repeated table header.
  const spill = (leaf: Extract<FlowLeaf, { kind: 'atomic' }>) => {
    const shiftBefore = shift;
    const reserve =
      leaf.row && !leaf.row.isHeader ? repeated(leaf.row.headerHeight) : 0;
    const room = Math.max(1, capacity - reserve);
    let rest =
      leaf.bottom + shift - (grid.contentBottomOf(page) + PRINT_BOTTOM_SLACK);
    while (rest > 0) {
      page += 1;
      pageStarts.push({ kind: 'continued', pos: leaf.pos });
      if (rest <= room) {
        shift +=
          grid.contentTopOf(page) + reserve + rest - (leaf.bottom + shift);
      }
      rest -= room;
    }
    carry = shift - shiftBefore;
  };

  // A row taller than the room splits inside its cells: each crossing cell
  // breaks at its first line that does not fit, keeping one line (§13.6).
  // No header is repeated across it. Returns false when no cell can break.
  const splitRow = (cells: { lines: Line[]; bottom: number }[]) => {
    const start = { shift, drift };
    const at = cells.map(() => ({ ...start, idx: 0 }));
    for (;;) {
      const bottom = bottomOfPage();
      const cuts = cells.flatMap((cell, c) => {
        const { lines } = cell;
        let k = lines.findIndex(
          (line, i) => i >= at[c].idx && line.bottom + at[c].shift > bottom,
        );
        if (k === at[c].idx) k += 1;
        return k > 0 && k < lines.length ? [{ c, k, line: lines[k] }] : [];
      });
      if (!cuts.length) break;
      page += 1;
      pageStarts.push({ kind: 'inText', pos: cuts[0].line.startPos });
      cuts.forEach(({ c, k, line }) => {
        const delta = grid.contentTopOf(page) - (line.top + at[c].shift);
        drift = at[c].drift;
        const height = pixels(delta);
        at[c] = { shift: at[c].shift + delta, drift, idx: k };
        breaks.push({ kind: 'inText', pos: line.startPos });
        spacers.push({
          kind: 'inText',
          pos: line.startPos,
          height,
          page: page + 1,
          print: true,
        });
      });
    }
    if (at.every((a) => a.idx === 0)) return false;
    // The row ends where its lowest cell now ends.
    const end = (c: number) => cells[c].bottom + at[c].shift;
    const last = cells.reduce((m, _, c) => (end(c) > end(m) ? c : m), 0);
    const natural = Math.max(...cells.map((cell) => cell.bottom));
    shift = end(last) - natural;
    drift = at[last].drift;
    return true;
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
      followDrift = drift;
      carry = 0;
      spacers.push({
        kind: 'block',
        pos: leaf.spacerPos,
        height: pixels(followDelta, leaf.spacerCollapse),
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
        if (!leaf.row?.isHeader) headingsOnly = false;
        return;
      }
      // Taller than a page: it starts its page (§12.3), or sits under the
      // headings that open it, and spans from there.
      const isTall = leaf.bottom - leaf.top > grid.textHeight;
      if (!firstOnPage && !(isTall && headingsOnly)) {
        const reserve =
          leaf.row && !leaf.row.isHeader ? repeated(leaf.row.headerHeight) : 0;
        breaks.push({ kind: 'before', pos: leaf.pos });
        pushToNextPage(leaf, reserve);
      }
      if (!fits(leaf) && !(leaf.cells && splitRow(leaf.cells))) {
        spill(leaf);
      }
      placedOnPage = true;
      if (!leaf.row?.isHeader) headingsOnly = false;
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
        height: pixels(delta),
        page: page + 1,
        print: true,
      });
      startIdx = k;
      isFirst = true;
    }
    placedOnPage = true;
    if (!leaf.isHeading) headingsOnly = false;
  });

  return { breaks, pageStarts, pageCount: page + 1, spacers };
}
