import { groupLineRects, type Rect } from './line-split';

const r = (top: number, bottom: number, left = 0, right = 50): Rect => ({
  top,
  bottom,
  left,
  right,
});
const scaled = (rects: Rect[], s: number) =>
  rects.map((x) => r(x.top * s, x.bottom * s, x.left * s, x.right * s));

describe('groupLineRects', () => {
  const twoLines = [r(0, 20), r(0, 20, 50, 90), r(24, 44, 0, 30)];

  it('groups runs on one line and splits at the next', () => {
    expect(groupLineRects(twoLines, 1)).toEqual([
      r(0, 20, 0, 90),
      r(24, 44, 0, 30),
    ]);
  });

  it('keeps a raised superscript run on its own line', () => {
    expect(groupLineRects([...twoLines, r(20, 32, 30, 40)], 1)).toHaveLength(2);
  });

  it.each([1.5, 0.87])('returns unscaled lines at scale %s', (s) => {
    const out = groupLineRects(scaled(twoLines, s), s);
    const want = groupLineRects(twoLines, 1);
    expect(out).toHaveLength(want.length);
    out.forEach((line, i) => {
      expect(line.top).toBeCloseTo(want[i].top, 6);
      expect(line.bottom).toBeCloseTo(want[i].bottom, 6);
    });
  });

  it('returns nothing for no rects', () => {
    expect(groupLineRects([], 1)).toEqual([]);
  });
});
