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
  ...extra,
});

describe('place', () => {
  it('empty doc is one page with no breaks', () => {
    expect(place([], grid)).toEqual({
      breaks: [],
      pageStarts: [],
      pageCount: 1,
    });
  });

  it('one short paragraph', () => {
    expect(place([para(0, 96, 3)], grid)).toEqual({
      breaks: [],
      pageStarts: [{ kind: 'before', pos: 0 }],
      pageCount: 1,
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

  it('never pushes a tall atomic that is first on its page', () => {
    const r = place([atom(0, 96, 1500), para(50, 1596, 1)], grid);
    expect(r.breaks).toEqual([{ kind: 'before', pos: 50 }]);
    expect(r.pageStarts).toEqual([
      { kind: 'before', pos: 0 },
      { kind: 'before', pos: 50 },
    ]);
    expect(r.pageCount).toBe(2);
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
