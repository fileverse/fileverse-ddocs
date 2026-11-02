import type { PageSetup } from '../../types';
import { PageGrid, getPaperPx, isPagesActive } from './page-grid';

describe('PageGrid', () => {
  it('A4 portrait', () => {
    const g = new PageGrid('a4');
    expect([g.width, g.height, g.textWidth, g.textHeight]).toEqual([
      794, 1123, 602, 931,
    ]);
    expect(g.contentTopOf(0)).toBe(96);
    expect(g.contentBottomOf(0)).toBe(1027);
    expect(g.contentTopOf(1)).toBe(1123 + 16 + 96);
  });

  it('Letter landscape swaps', () => {
    expect(getPaperPx('letter', 'landscape')).toEqual({
      width: 1056,
      height: 816,
    });
    expect(new PageGrid('letter', 'landscape').textWidth).toBe(864);
  });

  it('pageAt treats the gap as the next page', () => {
    const g = new PageGrid('letter');
    expect(g.pageAt(0)).toBe(0);
    expect(g.pageAt(1055)).toBe(0);
    expect(g.pageAt(1056 + 8)).toBe(1);
  });
});

describe('isPagesActive', () => {
  const pages: PageSetup = { mode: 'pages', paper: 'a4' };
  it.each<[PageSetup | undefined, boolean, boolean, boolean, boolean]>([
    [pages, true, false, false, true],
    [{ mode: 'pageless', paper: 'a4' }, true, false, false, false],
    [undefined, true, false, false, false],
    [pages, false, false, false, false],
    [pages, true, true, false, false],
    [pages, true, false, true, false],
  ])(
    'case %#',
    (pageSetup, isWideEnough, isSplitViewActive, isVersionHistory, want) => {
      expect(
        isPagesActive({
          pageSetup,
          isWideEnough,
          isSplitViewActive,
          isVersionHistory,
        }),
      ).toBe(want);
    },
  );
});
