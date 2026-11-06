import { act, render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { PageSheets, maskBoundaries, visibleSheetRange } from './page-sheets';
import { createPageStore } from '../extensions/pagination/page-store';
import { PAGE_GAP, PageGrid } from '../extensions/pagination/page-grid';
import type { PageStart } from '../extensions/pagination/place';

const scroll = vi.hoisted(() => ({ el: null as HTMLElement | null }));
vi.mock('../utils/get-editor-scroll-container', () => ({
  getEditorScrollContainer: () => scroll.el,
}));

const A4 = new PageGrid('a4');
const CYCLE = A4.height + PAGE_GAP;

describe('visibleSheetRange', () => {
  const base = {
    scrollTop: 0,
    viewportHeight: 1000,
    originTop: 0,
    scale: 1,
    cycle: CYCLE,
    pageCount: 100,
  };

  it('covers the viewport and two viewports below it at the top', () => {
    // Window [-2000, 3000]: sheets 0..2 (sheet 2 starts at 2278).
    expect(visibleSheetRange(base)).toEqual([0, 2]);
  });

  it('covers twice the pages at scale 0.5', () => {
    expect(visibleSheetRange({ ...base, scale: 0.5 })).toEqual([0, 5]);
  });

  it('keeps two viewports above the scroll position', () => {
    // Window [8000, 13000] at scale 1: sheets 7..11.
    expect(visibleSheetRange({ ...base, scrollTop: 10000 })).toEqual([7, 11]);
  });

  it('accounts for the origin offset', () => {
    expect(visibleSheetRange({ ...base, originTop: 2500 })).toEqual([0, 0]);
  });

  it('clamps to the last page', () => {
    expect(visibleSheetRange({ ...base, pageCount: 2 })).toEqual([0, 1]);
    expect(
      visibleSheetRange({ ...base, scrollTop: 1e6, pageCount: 100 })[1],
    ).toBe(99);
  });
});

const starts = (kinds: PageStart['kind'][]): PageStart[] =>
  kinds.map((kind, pos) => ({ kind, pos }));

describe('maskBoundaries', () => {
  it('maskBoundaries lists every boundary in the window', () => {
    expect(
      maskBoundaries(0, 3, starts(['before', 'before', 'inText', 'before'])),
    ).toEqual([0, 1, 2]);
  });

  it('maskBoundaries skips a boundary a tall leaf crosses', () => {
    expect(
      maskBoundaries(0, 3, starts(['before', 'continued', 'before', 'before'])),
    ).toEqual([1, 2]);
  });

  it('stays inside the window', () => {
    expect(maskBoundaries(2, 4, starts(Array(8).fill('before')))).toEqual([
      2, 3,
    ]);
    expect(maskBoundaries(0, 0, starts(['before']))).toEqual([]);
  });
});

describe('PageSheets', () => {
  const setup = (state: {
    enabled: boolean;
    pageCount: number | null;
    pageStarts?: PageStart[];
  }) => {
    const store = createPageStore();
    store.set(state);
    // view.dom's parent, where the masks go.
    const host = document.createElement('div');
    const dom = host.appendChild(document.createElement('div'));
    const editor = {
      storage: { pagination: { store } },
      view: { dom },
    } as unknown as Editor;
    return { store, editor, host };
  };

  const sheets = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLElement>('.ddoc-page-sheet'));

  it('draws one sheet per page with numbers from 1', () => {
    const { editor } = setup({ enabled: true, pageCount: 3 });
    const { container } = render(<PageSheets editor={editor} grid={A4} />);
    const drawn = sheets(container);
    expect(drawn).toHaveLength(3);
    expect(drawn.map((s) => s.style.top)).toEqual(['0px', '1139px', '2278px']);
    expect(drawn.map((s) => s.style.height)).toEqual([
      '1123px',
      '1123px',
      '1123px',
    ]);
    expect(drawn.map((s) => s.style.width)).toEqual([
      '794px',
      '794px',
      '794px',
    ]);
    expect(drawn.map((s) => s.textContent)).toEqual(['1', '2', '3']);
    const layer = container.firstElementChild as HTMLElement;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
  });

  it('takes the sheet fill from the canvas style, else the canvas token', () => {
    const { editor } = setup({ enabled: true, pageCount: 1 });
    const { container, rerender } = render(
      <PageSheets editor={editor} grid={A4} />,
    );
    expect(sheets(container)[0].classList).toContain('color-bg-default');
    rerender(
      <PageSheets
        editor={editor}
        grid={A4}
        canvasStyle={{ backgroundColor: 'rgb(1, 2, 3)' }}
      />,
    );
    const sheet = sheets(container)[0];
    expect(sheet.classList).not.toContain('color-bg-default');
    expect(sheet.style.backgroundColor).toBe('rgb(1, 2, 3)');
  });

  const masks = (c: HTMLElement) =>
    Array.from(c.querySelectorAll<HTMLElement>('.ddoc-page-mask'));

  it('renders one mask per boundary, from text bottom to the next text top, aria-hidden', () => {
    const { editor, host } = setup({
      enabled: true,
      pageCount: 3,
      pageStarts: starts(['before', 'before', 'inText']),
    });
    const { container } = render(<PageSheets editor={editor} grid={A4} />);
    expect(masks(container)).toHaveLength(0);
    const drawn = masks(host);
    expect(drawn.map((m) => m.style.top)).toEqual(['1027px', '2166px']);
    expect(drawn.map((m) => m.style.height)).toEqual(['208px', '208px']);
    expect(drawn.map((m) => m.style.width)).toEqual(['794px', '794px']);
    const layer = host.querySelector('.ddoc-page-masks') as HTMLElement;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    // Bottom margin, desk gap, top margin.
    const parts = Array.from(drawn[0].children) as HTMLElement[];
    expect(parts.map((p) => p.className)).toEqual([
      'ddoc-page-mask-bottom color-bg-default',
      'ddoc-page-mask-gap color-bg-secondary',
      'ddoc-page-mask-top color-bg-default',
    ]);
    expect(parts.map((p) => p.style.height)).toEqual(['96px', '16px', '96px']);
  });

  it('places the masks in the sheets frame, from the view parent', () => {
    const { editor, host } = setup({
      enabled: true,
      pageCount: 2,
      pageStarts: starts(['before', 'before']),
    });
    const layer = document.createElement('div');
    // host sits 40px down and 8px right in the layer; view.dom 30px in host.
    Object.defineProperties(host, {
      offsetTop: { value: 40 },
      offsetLeft: { value: 8 },
      offsetParent: { value: layer },
    });
    Object.defineProperties(editor.view.dom, {
      offsetTop: { value: 30 },
      offsetLeft: { value: 0 },
      offsetParent: { value: host },
    });
    const { container } = render(<PageSheets editor={editor} grid={A4} />, {
      container: layer,
    });
    expect(sheets(container)[0].style.top).toBe('70px');
    const [mask] = masks(host);
    expect(mask.style.top).toBe(`${30 + 1027}px`);
    expect(mask.style.left).toBe('-8px');
  });

  it('draws no mask across a boundary a tall leaf crosses', () => {
    const { editor, host } = setup({
      enabled: true,
      pageCount: 3,
      pageStarts: starts(['before', 'continued', 'before']),
    });
    render(<PageSheets editor={editor} grid={A4} />);
    expect(masks(host).map((m) => m.style.top)).toEqual(['2166px']);
  });

  it('paints the mask like the sheet and the desk', () => {
    const { editor, host } = setup({
      enabled: true,
      pageCount: 2,
      pageStarts: starts(['before', 'before']),
    });
    render(
      <PageSheets
        editor={editor}
        grid={A4}
        canvasStyle={{ backgroundColor: 'rgb(1, 2, 3)', color: 'red' }}
        deskStyle={{ background: 'rgb(4, 5, 6)' }}
      />,
    );
    const [bottom, gap, top] = Array.from(
      masks(host)[0].children,
    ) as HTMLElement[];
    for (const margin of [bottom, top]) {
      expect(margin.classList).not.toContain('color-bg-default');
      expect(margin.style.backgroundColor).toBe('rgb(1, 2, 3)');
      expect(margin.style.color).toBe('');
    }
    expect(gap.classList).not.toContain('color-bg-secondary');
    expect(gap.style.background).toBe('rgb(4, 5, 6)');
  });

  it('lines a custom desk up with the canvas behind it', () => {
    const { editor, host } = setup({
      enabled: true,
      pageCount: 2,
      pageStarts: starts(['before', 'before']),
    });
    const scroller = document.createElement('div');
    Object.defineProperties(scroller, {
      clientHeight: { value: 800 },
      clientWidth: { value: 1200 },
    });
    scroller.getBoundingClientRect = () => ({ top: 50, left: 10 }) as DOMRect;
    const layer = document.createElement('div');
    layer.getBoundingClientRect = () => ({ top: 0, left: 0 }) as DOMRect;
    document.body.append(scroller, layer);
    scroll.el = scroller;
    const rect = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        return (
          this.classList.contains('ddoc-page-mask-gap')
            ? { top: 250, left: 110 }
            : { top: 0, left: 0 }
        ) as DOMRect;
      });
    try {
      render(
        <PageSheets
          editor={editor}
          grid={A4}
          deskStyle={{ background: 'linear-gradient(red, blue)' }}
        />,
        { container: layer },
      );
      const gap = host.querySelector<HTMLElement>('.ddoc-page-mask-gap')!;
      expect(gap.style.backgroundSize).toBe('1200px 800px');
      expect(gap.style.backgroundPosition).toBe('-100px -200px');
    } finally {
      rect.mockRestore();
      scroll.el = null;
      scroller.remove();
      layer.remove();
    }
  });

  it('follows the store', () => {
    const { editor, store } = setup({ enabled: true, pageCount: 1 });
    const { container } = render(<PageSheets editor={editor} grid={A4} />);
    expect(sheets(container)).toHaveLength(1);
    act(() => store.set({ pageCount: 4 }));
    expect(sheets(container)).toHaveLength(4);
  });

  it('draws nothing when disabled, with no count, or with no editor', () => {
    const off = setup({ enabled: false, pageCount: 3 });
    expect(
      sheets(render(<PageSheets editor={off.editor} grid={A4} />).container),
    ).toHaveLength(0);
    const pending = setup({ enabled: true, pageCount: null });
    expect(
      sheets(
        render(<PageSheets editor={pending.editor} grid={A4} />).container,
      ),
    ).toHaveLength(0);
    expect(
      sheets(render(<PageSheets editor={null} grid={A4} />).container),
    ).toHaveLength(0);
  });

  it('draws only the sheets near the scroll position', async () => {
    const { editor } = setup({ enabled: true, pageCount: 100 });
    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'clientHeight', { value: 1000 });
    scroller.scrollTop = 0;
    const layer = document.createElement('div');
    // The layer moves up as the scroller scrolls.
    layer.getBoundingClientRect = () =>
      ({ top: -scroller.scrollTop }) as DOMRect;
    document.body.append(scroller, layer);
    scroll.el = scroller;
    try {
      const { container } = render(<PageSheets editor={editor} grid={A4} />, {
        container: layer,
      });
      expect(sheets(container).map((s) => s.textContent)).toEqual([
        '1',
        '2',
        '3',
      ]);
      await act(async () => {
        scroller.scrollTop = 10000;
        scroller.dispatchEvent(new Event('scroll'));
        await new Promise((r) => requestAnimationFrame(r));
      });
      expect(sheets(container).map((s) => s.textContent)).toEqual([
        '8',
        '9',
        '10',
        '11',
        '12',
      ]);
    } finally {
      scroll.el = null;
      scroller.remove();
      layer.remove();
    }
  });
});
