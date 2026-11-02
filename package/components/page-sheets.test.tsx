import { act, render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { PageSheets, visibleSheetRange } from './page-sheets';
import { createPageStore } from '../extensions/pagination/page-store';
import { PAGE_GAP, PageGrid } from '../extensions/pagination/page-grid';

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

describe('PageSheets', () => {
  const setup = (state: { enabled: boolean; pageCount: number | null }) => {
    const store = createPageStore();
    store.set(state);
    const dom = document.createElement('div');
    const editor = {
      storage: { pagination: { store } },
      view: { dom },
    } as unknown as Editor;
    return { store, editor };
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
