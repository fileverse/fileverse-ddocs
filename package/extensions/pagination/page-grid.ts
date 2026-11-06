import type { PageSetup } from '../../types';

// CSS px at 96 per inch, the unit the browser lays out in.
export const PAGE_MARGIN = 96;
export const PAGE_GAP = 16;
export const PRINT_BOTTOM_SLACK = 20;

export type Orientation = 'portrait' | 'landscape';

const PAPER_PX: Record<PageSetup['paper'], { width: number; height: number }> =
  {
    a4: { width: 794, height: 1123 },
    letter: { width: 816, height: 1056 },
  };

export const getPaperPx = (
  paper: PageSetup['paper'],
  orientation: Orientation = 'portrait',
) => {
  const { width, height } = PAPER_PX[paper];
  return orientation === 'landscape'
    ? { width: height, height: width }
    : { width, height };
};

export const getPagesBaseWidth = (
  pageSetup: PageSetup,
  orientation?: Orientation,
) => getPaperPx(pageSetup.paper, orientation).width;

// Pages are 0-based; page p occupies [p * (height + gap), ... + height).
export class PageGrid {
  readonly width: number;
  readonly height: number;
  readonly textWidth: number;
  readonly textHeight: number;

  constructor(paper: PageSetup['paper'], orientation?: Orientation) {
    const { width, height } = getPaperPx(paper, orientation);
    this.width = width;
    this.height = height;
    this.textWidth = width - 2 * PAGE_MARGIN;
    this.textHeight = height - 2 * PAGE_MARGIN;
  }

  private get cycle() {
    return this.height + PAGE_GAP;
  }

  pageAt(y: number): number {
    const page = Math.floor(y / this.cycle);
    return y - page * this.cycle >= this.height ? page + 1 : page;
  }

  contentTopOf(page: number): number {
    return page * this.cycle + PAGE_MARGIN;
  }

  contentBottomOf(page: number): number {
    return page * this.cycle + this.height - PAGE_MARGIN;
  }
}

export const isPagesActive = ({
  pageSetup,
  isWideEnough,
  isSplitViewActive,
  isVersionHistory,
}: {
  pageSetup?: PageSetup;
  isWideEnough: boolean;
  isSplitViewActive: boolean;
  isVersionHistory: boolean;
}) =>
  pageSetup?.mode === 'pages' &&
  isWideEnough &&
  !isSplitViewActive &&
  !isVersionHistory;
