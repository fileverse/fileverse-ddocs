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

  // A box taller than a page never fits anywhere: pushing it would only
  // waste the space above it, so it spans from where it starts.
  it('spans a tall atomic from where it starts instead of pushing it', () => {
    const r = place(
      [para(0, 96, 1), atom(50, 900, 1500), para(90, 2400, 1)],
      grid,
    );
    // 80 on page 0, 884 on page 1, 536 on page 2.
    expect(r.breaks).toEqual([]);
    expect(r.pageStarts).toEqual([
      { kind: 'before', pos: 0 },
      { kind: 'continued', pos: 50 },
      { kind: 'continued', pos: 50 },
    ]);
    expect(r.pageCount).toBe(3);
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
