import { PageGrid } from './page-grid';
import { place, type Leaf } from './place';

// Letter: page 0 content 96..960, page 1 content 1168..2032.
const grid = new PageGrid('letter');
const P1_TOP = 1168;

const para = (
  pos: number,
  top: number,
  lineCount: number,
  { lineH = 20, isHeading = false, marginTop = 0 } = {},
): Extract<Leaf, { kind: 'text' }> => ({
  kind: 'text',
  pos,
  top,
  bottom: top + lineCount * lineH,
  marginTop,
  spacerPos: pos,
  spacerCollapse: 0,
  isHeading,
  lines: Array.from({ length: lineCount }, (_, i) => ({
    top: top + i * lineH,
    bottom: top + (i + 1) * lineH,
    startPos: pos + 1 + i * 10,
  })),
});

const atom = (
  pos: number,
  top: number,
  height: number,
  extra: Partial<Extract<Leaf, { kind: 'atomic' }>> = {},
): Leaf => ({
  kind: 'atomic',
  pos,
  top,
  bottom: top + height,
  marginTop: 0,
  spacerPos: pos,
  spacerCollapse: 0,
  ...extra,
});

describe('place', () => {
  it('empty doc is one page with no breaks', () => {
    expect(place([], grid)).toEqual({
      breaks: [],
      pageStarts: [],
      pageCount: 1,
      spacers: [],
    });
  });

  it('one short paragraph', () => {
    expect(place([para(0, 96, 3)], grid)).toEqual({
      breaks: [],
      pageStarts: [{ kind: 'before', pos: 0 }],
      pageCount: 1,
      spacers: [],
    });
  });

  it('content ending exactly at the content bottom adds no page', () => {
    const r = place([para(0, 96, 1), para(10, 900, 3)], grid);
    expect(r.breaks).toEqual([]);
    expect(r.pageCount).toBe(1);
  });

  it('splits a paragraph between lines', () => {
    const p = para(50, 860, 10);
    const r = place([para(0, 96, 1), p], grid);
    expect(r.breaks).toEqual([{ kind: 'inText', pos: p.lines[5].startPos }]);
    expect(r.pageStarts[1]).toEqual({
      kind: 'inText',
      pos: p.lines[5].startPos,
    });
    expect(r.pageCount).toBe(2);
  });

  it('carries two lines instead of one (widow)', () => {
    const p = para(50, 860, 6);
    const r = place([para(0, 96, 1), p], grid);
    expect(r.breaks).toEqual([{ kind: 'inText', pos: p.lines[4].startPos }]);
  });

  it('pushes the whole paragraph when one line would stay (orphan)', () => {
    const r = place([para(0, 96, 1), para(50, 940, 5)], grid);
    expect(r.breaks).toEqual([{ kind: 'before', pos: 50 }]);
  });

  it('pushes an atomic leaf and shifts what follows', () => {
    const after = para(90, 1000, 41);
    const r = place([para(0, 96, 1), atom(50, 800, 200), after], grid);
    // Image moves to 1168..1368, so the paragraph starts at 1368 and 33 lines fit.
    expect(r.breaks).toEqual([
      { kind: 'before', pos: 50 },
      { kind: 'inText', pos: after.lines[33].startPos },
    ]);
    expect(r.pageCount).toBe(3);
  });

  it('keeps the margin-top of a leaf pushed to a new page', () => {
    const after = para(90, 1000, 40);
    const r = place(
      [para(0, 96, 1), atom(50, 800, 200, { marginTop: 12 }), after],
      grid,
    );
    // Image at 1180..1380: 32 lines fit below it.
    expect(r.breaks[1]).toEqual({
      kind: 'inText',
      pos: after.lines[32].startPos,
    });
  });

  // Print fragments a box taller than a page across pages (rows, flex boxes,
  // images); each printed page holds the text height plus the bottom slack.
  it('spans a tall atomic first on its page across the pages it fills', () => {
    const r = place([atom(0, 96, 1500), para(50, 1596, 1)], grid);
    // 884px on page 0, the remaining 616 on page 1, then the paragraph.
    expect(r.breaks).toEqual([]);
    expect(r.pageStarts).toEqual([
      { kind: 'before', pos: 0 },
      { kind: 'continued', pos: 0 },
    ]);
    expect(r.pageCount).toBe(2);
  });

  it('spans a box taller than two pages', () => {
    const after = para(50, 2596, 5);
    const r = place([atom(0, 96, 2500), after], grid);
    // 884 + 884 + 732: ends 2240 + 732 = 2972 on page 2; 132px (6 lines) left.
    expect(r.breaks).toEqual([]);
    expect(r.pageStarts.filter((s) => s.kind === 'continued')).toHaveLength(2);
    expect(r.pageCount).toBe(3);
  });

  // §12.3: a box taller than a page starts its page, then spans from there.
  it('pushes a tall atomic that is not first on its page, then spans it', () => {
    const r = place(
      [para(0, 96, 1), atom(50, 900, 1500), para(90, 2400, 1)],
      grid,
    );
    // Page 1 from 1168: 884 there, the remaining 616 on page 2.
    expect(r.breaks).toEqual([{ kind: 'before', pos: 50 }]);
    expect(r.pageStarts).toEqual([
      { kind: 'before', pos: 0 },
      { kind: 'before', pos: 50 },
      { kind: 'continued', pos: 50 },
    ]);
    expect(r.spacers[0]).toMatchObject({ pos: 50, print: true, page: 2 });
    expect(r.pageCount).toBe(3);
  });

  it('keeps a tall atomic under the heading that opens its page', () => {
    const heading = para(10, 900, 1, { isHeading: true });
    const r = place([para(0, 96, 1), heading, atom(50, 920, 1500)], grid);
    // The heading moves with the table (keep-with-next) and is not left alone.
    expect(r.breaks).toEqual([{ kind: 'before', pos: 10 }]);
    expect(r.pageStarts.map((s) => s.kind)).toEqual([
      'before',
      'before',
      'continued',
    ]);
  });

  it('spills a tall row under a header taller than a page', () => {
    const landscape = new PageGrid('letter', 'landscape');
    const row = (pos: number, top: number, height: number, isHeader = false) =>
      atom(pos, top, height, {
        row: { tableId: 1, isHeader, headerHeight: 700 },
      });
    // 700 + 1400 = 2100px over 644px pages: the header does not repeat.
    const r = place([row(10, 96, 700, true), row(20, 796, 1400)], landscape);
    expect(r.pageCount).toBe(4);
  });

  it('reserves the repeated header on pages a tall row continues onto', () => {
    const row = (pos: number, top: number, height: number, isHeader = false) =>
      atom(pos, top, height, {
        row: { tableId: 1, isHeader, headerHeight: 30 },
      });
    // Body row 126..1596 under a 30px header: page 1 holds 884 - 30 = 854,
    // so the 616 left ends at 1168 + 30 + 616 = 1814. Ten of the paragraph's
    // 11 lines fit, so two carry. Without the reserve (1784) all 11 would fit.
    const after = para(90, 1596, 11);
    const r = place([row(10, 96, 30, true), row(20, 126, 1470), after], grid);
    expect(r.breaks).toEqual([
      { kind: 'inText', pos: after.lines[9].startPos },
    ]);
    expect(r.pageCount).toBe(3);
  });

  it('splits a paragraph taller than a page on every page', () => {
    const p = para(0, 96, 100);
    const r = place([p], grid);
    expect(r.breaks).toEqual([
      { kind: 'inText', pos: p.lines[43].startPos },
      { kind: 'inText', pos: p.lines[86].startPos },
    ]);
    expect(r.pageCount).toBe(3);
  });

  it('pushes a heading with the next block when < 2 of its lines fit', () => {
    const heading = para(40, 900, 1, { lineH: 32, isHeading: true });
    const r = place([para(0, 96, 1), heading, para(60, 932, 5)], grid);
    expect(r.breaks).toEqual([{ kind: 'before', pos: 40 }]);
    expect(r.pageCount).toBe(2);
  });

  it('keep-with-next does not chain through a second heading', () => {
    const a = para(40, 900, 1, { isHeading: true });
    const b = para(50, 920, 1, { isHeading: true });
    const r = place([para(0, 96, 1), a, b, para(60, 940, 5)], grid);
    expect(r.breaks).toEqual([{ kind: 'before', pos: 50 }]);
  });

  it('starts a page after a forced break without emitting a print break', () => {
    const r = place(
      [para(0, 96, 1), { kind: 'forced', pos: 10 }, para(20, 120, 1)],
      grid,
    );
    expect(r.breaks).toEqual([]);
    expect(r.pageStarts).toEqual([
      { kind: 'before', pos: 0 },
      { kind: 'before', pos: 20 },
    ]);
    expect(r.pageCount).toBe(2);
  });

  it('reserves the header row height on a continued table page', () => {
    const row = (pos: number, top: number, isHeader = false) =>
      atom(pos, top, 30, {
        row: { tableId: 1, isHeader, headerHeight: 30 },
      });
    const after = para(90, 980, 41);
    const r = place(
      [
        para(0, 96, 1),
        row(10, 860, true),
        row(20, 890),
        row(30, 920),
        row(40, 950),
        after,
      ],
      grid,
    );
    // Row 40 lands at 1168 + 30; the paragraph at 1228 fits 40 lines, carries 2.
    expect(r.breaks).toEqual([
      { kind: 'before', pos: 40 },
      { kind: 'inText', pos: after.lines[39].startPos },
    ]);
    expect(P1_TOP).toBe(grid.contentTopOf(1));
  });

  it('pushes a header row together with the row after it', () => {
    const row = (pos: number, top: number, isHeader = false) =>
      atom(pos, top, 30, {
        row: { tableId: 1, isHeader, headerHeight: 30 },
      });
    const r = place([para(0, 96, 1), row(10, 920, true), row(20, 950)], grid);
    expect(r.breaks).toEqual([{ kind: 'before', pos: 10 }]);
  });
});

describe('place spacers', () => {
  // A4: page 0 content 96..1027, page 1 content starts at 1235.
  const a4 = new PageGrid('a4');

  it('a pushed leaf gets a block spacer of the shift less the collapsed margin', () => {
    const p = place(
      [
        para(1, 96, 45),
        atom(50, 1010, 50, { spacerPos: 49, spacerCollapse: 12 }),
      ],
      a4,
    );
    expect(p.spacers).toEqual([
      {
        kind: 'block',
        pos: 49,
        height: 1235 - 1010 - 12,
        page: 2,
        print: true,
      },
    ]);
  });

  it('an inText split gets an inText spacer at the carried line start', () => {
    const p = para(50, 860, 10, { lineH: 40 });
    const r = place([p], a4);
    const [b] = r.breaks;
    const line = p.lines.find((l) => l.startPos === b.pos)!;
    expect(r.spacers).toEqual([
      {
        kind: 'inText',
        pos: b.pos,
        height: Math.round(a4.contentTopOf(1) - line.top),
        page: 2,
        print: true,
      },
    ]);
  });

  it('after a leaf taller than a page the next leaf follows paper with a non-printing spacer', () => {
    const next = para(100, 1600, 2, { marginTop: 0 });
    const r = place([atom(10, 96, 1500), next], a4);
    expect(r.spacers).toEqual([
      {
        kind: 'block',
        pos: next.spacerPos,
        height: Math.round(1235 + 549 - 1596 - next.spacerCollapse),
        page: 2,
        print: false,
      },
    ]);
    expect(r.breaks.map((b) => b.pos)).not.toContain(next.pos);
    expect(r.pageCount).toBe(2);
  });

  it('a follow spacer and a push on the same leaf merge into one printing spacer', () => {
    const next = atom(100, 1596, 400, { spacerCollapse: 10 });
    const r = place([atom(10, 96, 1500), next], a4);
    expect(r.spacers).toEqual([
      {
        kind: 'block',
        pos: next.spacerPos,
        height: a4.contentTopOf(2) - 1596 - 10,
        page: 3,
        print: true,
      },
    ]);
  });

  it('a tall box, a leaf, a forced break, then a leaf keeps the first follow spacer', () => {
    const a = para(100, 1600, 2);
    const b = para(200, 1700, 2);
    const r = place(
      [atom(10, 96, 1500), a, { kind: 'forced', pos: 150 }, b],
      a4,
    );
    const follow = r.spacers.find((s) => s.pos === a.spacerPos)!;
    expect(follow).toMatchObject({ print: false, page: 2 });
    const own = r.spacers.filter((s) => s.pos === b.spacerPos);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ print: true, page: 3 });
    expect(r.breaks).toEqual([]);
  });

  it('a leaf after a forced break has a printing spacer and no break', () => {
    const r = place(
      [para(0, 96, 1), { kind: 'forced', pos: 5 }, para(10, 130, 1)],
      a4,
    );
    expect(r.breaks).toEqual([]);
    expect(r.spacers).toHaveLength(1);
    expect(r.spacers[0]).toMatchObject({ pos: 10, print: true, page: 2 });
  });

  it('a spacer is never negative', () => {
    const r = place(
      [
        para(1, 96, 45),
        atom(50, 1010, 50, { spacerPos: 49, spacerCollapse: 5000 }),
      ],
      a4,
    );
    expect(r.spacers[0].height).toBe(0);
  });

  it('carries the rounding of spacer heights instead of letting it add up', () => {
    // Each push moves its leaf by x.7px; rounded one by one, the screen would
    // drift 0.3px further from the placement at every page.
    const leaves = [
      atom(0, 96, 900),
      atom(10, 1000.3, 900),
      atom(20, 1900.6, 900),
      atom(30, 2800.9, 900),
    ];
    const r = place(leaves, a4);
    expect(r.spacers.map((s) => s.pos)).toEqual([10, 20, 30]);
    let rendered = 0;
    r.spacers.forEach((s, i) => {
      rendered += s.height;
      const leaf = leaves[i + 1] as Extract<Leaf, { kind: 'atomic' }>;
      const top = leaf.top + rendered;
      expect(Math.abs(top - a4.contentTopOf(s.page - 1))).toBeLessThanOrEqual(
        0.5,
      );
    });
  });

  it('without forced breaks, printing spacers correspond one-to-one with breaks', () => {
    const leaves = [
      para(0, 96, 1),
      para(10, 860, 12, { lineH: 40 }),
      atom(500, 1700, 300),
      atom(600, 2100, 1100),
      para(700, 3300, 3),
    ];
    const r = place(leaves, a4);
    const printing = r.spacers.filter((s) => s.print);
    expect(printing).toHaveLength(r.breaks.length);
    printing.forEach((s, i) => {
      if (s.kind === 'inText') expect(s.pos).toBe(r.breaks[i].pos);
    });
  });
});

// docs/PAGES_MODE.md §13.6: rows are leaves; a row that does not fit moves to
// the next page whole, under the repeated header.
describe('place table rows', () => {
  // A4: page 0 content 96..1027, page 1 content starts at 1235.
  const a4 = new PageGrid('a4');
  const TABLE = 5;
  const rowsFrom = (
    top: number,
    heights: number[],
    headerHeight: number,
    { hasHeader = headerHeight > 0 } = {},
  ) => {
    let y = top;
    return heights.map((h, i) => {
      const pos = TABLE + 1 + i * 10;
      const leaf = atom(pos, y, h, {
        // Row 0 starts the table: its spacer goes before it (§12.4).
        spacerPos: i === 0 ? TABLE : pos,
        row: { tableId: 1, isHeader: hasHeader && i === 0, headerHeight },
      });
      y += h;
      return leaf as Extract<Leaf, { kind: 'atomic' }>;
    });
  };

  it('a row that does not fit moves whole under a repeated header', () => {
    const rows = rowsFrom(96, [40, ...Array(20).fill(60)], 40);
    const r = place(rows, a4);
    // Row 14 (976..1036) crosses 1027.
    const row = rows.find((l) => l.bottom > 1027)!;
    expect(row.top).toBe(976);
    expect(r.breaks).toEqual([{ kind: 'before', pos: row.pos }]);
    expect(r.spacers).toHaveLength(1);
    const [spacer] = r.spacers;
    expect(spacer).toMatchObject({
      kind: 'block',
      pos: row.spacerPos,
      page: 2,
      print: true,
      header: 40,
    });
    const nextRowTopOnScreen = row.top + spacer.height;
    expect(nextRowTopOnScreen).toBe(1235 + 40);
    expect(r.pageStarts.map((s) => s.kind)).toEqual(['before', 'before']);
  });

  it('a 492px row that fits a fresh page moves whole (fixture 10 v2 A4 case)', () => {
    const rows = rowsFrom(700, [30, 100, 492, 60], 30);
    const r = place([para(0, 96, 1), ...rows], a4);
    // 830..1322 crosses 1027 and fits a fresh page under the header.
    expect(r.breaks).toEqual([{ kind: 'before', pos: rows[2].pos }]);
    expect(r.pageStarts.map((s) => s.kind)).toEqual(['before', 'before']);
    expect(r.spacers[0]).toMatchObject({ pos: rows[2].pos, header: 30 });
    expect(r.spacers[0].height).toBe(1235 + 30 - 830);
    expect(r.pageCount).toBe(2);
  });

  it('no header field when the header exceeds a quarter of the capacity', () => {
    // A4 capacity 931 + 20: a quarter is 237.75.
    const rows = rowsFrom(96, [240, ...Array(4).fill(200)], 240);
    const r = place(rows, a4);
    expect(r.breaks).toEqual([{ kind: 'before', pos: rows[4].pos }]);
    expect(r.spacers).toHaveLength(1);
    expect('header' in r.spacers[0]).toBe(false);
    expect(r.spacers[0].height).toBe(1235 - rows[4].top);
  });

  it('no header field in a table without a header row', () => {
    const rows = rowsFrom(96, Array(20).fill(60), 0);
    const r = place(rows, a4);
    expect(r.spacers).toHaveLength(1);
    expect('header' in r.spacers[0]).toBe(false);
  });

  it('a header row moves with the row after it', () => {
    const rows = rowsFrom(960, [40, 60, 60], 40);
    const r = place([para(0, 96, 1), ...rows], a4);
    expect(r.breaks).toEqual([{ kind: 'before', pos: rows[0].pos }]);
    expect(r.spacers).toHaveLength(1);
    expect(r.spacers[0]).toMatchObject({ pos: TABLE, page: 2 });
    expect('header' in r.spacers[0]).toBe(false);
    expect(r.spacers[0].height).toBe(1235 - 960);
  });

  it('a break before row 0 goes before the table', () => {
    const rows = rowsFrom(1000, [60, 60], 0);
    const r = place([para(0, 96, 1), ...rows], a4);
    expect(r.breaks).toEqual([{ kind: 'before', pos: rows[0].pos }]);
    expect(r.spacers[0].pos).toBe(TABLE);
    expect('header' in r.spacers[0]).toBe(false);
  });

  // A row taller than the room splits inside its cells (§13.6).
  const cell = (from: number, top: number, count: number, lineH: number) => {
    const lines = Array.from({ length: count }, (_, i) => ({
      top: top + i * lineH,
      bottom: top + (i + 1) * lineH,
      startPos: from + i * 10,
    }));
    return { lines, bottom: top + count * lineH };
  };
  const tallRow = (
    pos: number,
    top: number,
    cells: ReturnType<typeof cell>[],
    headerHeight = 0,
  ) =>
    atom(pos, top, Math.max(...cells.map((c) => c.bottom)) + 10 - top, {
      row: { tableId: 1, isHeader: false, headerHeight },
      cells,
    }) as Extract<Leaf, { kind: 'atomic' }>;

  it('a row taller than the room splits in each crossing cell at its first non-fitting line', () => {
    // Cell A: 30px lines from 100; line 30 (1000..1030) crosses 1027.
    const a = cell(1000, 100, 50, 30);
    const b = cell(2000, 100, 10, 30);
    const row = tallRow(TABLE + 1, 96, [a, b]);
    const p = place([row], a4);
    expect(
      p.spacers.filter((s) => s.kind === 'inText').map((s) => s.pos),
    ).toEqual([a.lines[30].startPos]);
    expect(p.breaks).toContainEqual({
      kind: 'inText',
      pos: a.lines[30].startPos,
    });
    expect(p.breaks.some((br) => br.kind === 'before')).toBe(false);
    expect(p.spacers[0].height).toBe(1235 - 1000);
    expect(p.pageStarts).toEqual([
      { kind: 'before', pos: row.pos },
      { kind: 'inText', pos: a.lines[30].startPos },
    ]);
    expect(p.pageCount).toBe(2);
  });

  it('two crossing cells get one spacer each, heights from their own line tops', () => {
    const a = cell(1000, 100, 50, 30);
    // Cell B: 25px lines; line 37 (1025..1050) crosses.
    const b = cell(2000, 100, 50, 25);
    const after = para(3000, 1610, 1);
    const p = place([tallRow(TABLE + 1, 96, [a, b]), after], a4);
    expect(p.spacers).toEqual([
      expect.objectContaining({
        kind: 'inText',
        pos: a.lines[30].startPos,
        height: 235,
        page: 2,
      }),
      expect.objectContaining({
        kind: 'inText',
        pos: b.lines[37].startPos,
        height: 210,
        page: 2,
      }),
    ]);
    expect(p.breaks).toEqual([
      { kind: 'inText', pos: a.lines[30].startPos },
      { kind: 'inText', pos: b.lines[37].startPos },
    ]);
    // One page start per page, at the first cell's break.
    expect(p.pageStarts.map((s) => s.kind)).toEqual(['before', 'inText']);
    expect(p.pageCount).toBe(2);
  });

  it('the row ends where its tallest cell ends, not at the largest displacement', () => {
    // A is tallest (ends 1600, moves 235); B's 55px line 16 (980..1035)
    // crosses, so B moves 255 but ends at 1200 + 255 = 1455.
    const a = cell(1000, 100, 50, 30);
    const b = cell(2000, 100, 20, 55);
    const row = tallRow(TABLE + 1, 96, [a, b]);
    const after = para(3000, row.bottom, 40);
    const p = place([row, after], a4);
    // The row ends at 1610 + 235: line 16 of the paragraph crosses 2166
    // (with 255 it would be line 15).
    const cut = after.lines.findIndex((l) => l.bottom + 235 > 2166);
    expect(cut).toBe(16);
    expect(p.breaks).toContainEqual({
      kind: 'inText',
      pos: after.lines[cut].startPos,
    });
  });

  it('pages repeat while any cell still crosses', () => {
    // Page 1 content 1235..2166: after the first cut at line 30, line 61
    // (1235 + 31 * 30 = 2165 .. 2195) crosses.
    const a = cell(1000, 100, 80, 30);
    const p = place([tallRow(TABLE + 1, 96, [a, cell(2000, 100, 5, 30)])], a4);
    expect(p.breaks).toEqual([
      { kind: 'inText', pos: a.lines[30].startPos },
      { kind: 'inText', pos: a.lines[61].startPos },
    ]);
    expect(p.pageCount).toBe(3);
    expect(p.pageStarts.some((s) => s.kind === 'continued')).toBe(false);
  });

  it('no header is reserved across an in-cell split', () => {
    const header = rowsFrom(96, [40], 40)[0];
    const a = cell(1000, 140, 50, 30);
    const row = tallRow(TABLE + 11, 136, [a], 40);
    const p = place([header, row], a4);
    // Line 29 (1010..1040) is the first to cross 1027.
    const k = a.lines.findIndex((l) => l.bottom > 1027);
    expect(p.breaks).toEqual([{ kind: 'inText', pos: a.lines[k].startPos }]);
    expect(p.spacers).toHaveLength(1);
    expect('header' in p.spacers[0]).toBe(false);
    expect(p.spacers[0].height).toBe(1235 - a.lines[k].top);
  });

  it('a row moved under a repeated header splits there without a second header', () => {
    const rows = rowsFrom(96, [40, 800], 40);
    const a = cell(1000, 946, 40, 30);
    const tall = tallRow(TABLE + 21, rows[1].bottom, [a], 40);
    const p = place([...rows, tall], a4);
    expect(p.breaks[0]).toEqual({ kind: 'before', pos: tall.pos });
    expect(p.spacers[0]).toMatchObject({ kind: 'block', header: 40 });
    // Moved under the repeated header, then cut where page 1 ends (2166).
    const moved = 1235 + 40 - tall.top;
    const k = a.lines.findIndex((l) => l.bottom + moved > 2166);
    expect(p.breaks[1]).toEqual({ kind: 'inText', pos: a.lines[k].startPos });
    expect('header' in p.spacers[1]).toBe(false);
  });

  it('a row with no lines in any crossing cell keeps the tall-leaf rule', () => {
    const row = tallRow(TABLE + 1, 96, [{ lines: [], bottom: 1500 }]);
    const p = place([row], a4);
    expect(p.breaks).toEqual([]);
    expect(p.pageStarts.map((s) => s.kind)).toEqual(['before', 'continued']);
  });
});
