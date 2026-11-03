/* eslint-disable react-refresh/only-export-components */
import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Editor } from '@tiptap/react';
import cn from 'classnames';
import { PAGE_GAP, type PageGrid } from '../extensions/pagination/page-grid';
import { useZoom } from '../hooks/use-zoom';
import { getEditorScrollContainer } from '../utils/get-editor-scroll-container';

// Screen px between the sheet and its number, which keeps its 100% size.
const PAGE_NUMBER_GAP = 12;

const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

// Sheets within two viewport heights above and below the visible part of the
// scroller. `originTop` is sheet 0's top in scroll-content px (scaled).
export function visibleSheetRange(a: {
  scrollTop: number;
  viewportHeight: number;
  originTop: number;
  scale: number;
  cycle: number;
  pageCount: number;
}): [first: number, last: number] {
  const step = a.cycle * a.scale;
  const top = a.scrollTop - 2 * a.viewportHeight - a.originTop;
  const bottom = a.scrollTop + 3 * a.viewportHeight - a.originTop;
  const max = a.pageCount - 1;
  return [
    clamp(Math.floor(top / step), max),
    clamp(Math.floor(bottom / step), max),
  ];
}

const noop = () => () => {};

// view.dom's unscaled top within `layer`, summed along the offsetParent chain.
const offsetWithin = (el: HTMLElement, layer: HTMLElement | null) => {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node && node !== layer) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
};

export function PageSheets({
  editor,
  grid,
  canvasStyle,
}: {
  editor: Editor | null;
  grid: PageGrid;
  canvasStyle?: React.CSSProperties;
}) {
  const store = editor?.storage.pagination?.store;
  // A primitive snapshot: the store republishes placements that keep the count.
  const pageCount = useSyncExternalStore(store ? store.subscribe : noop, () => {
    const state = store?.get();
    return state?.enabled ? state.pageCount : null;
  });
  const { scale } = useZoom();
  const ref = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState(0);
  const [first, setFirst] = useState(0);
  // -1 until measured, so a long document never mounts every sheet at once.
  const [last, setLast] = useState(-1);
  const cycle = grid.height + PAGE_GAP;

  const measure = useCallback(() => {
    const layer = ref.current?.parentElement ?? null;
    if (!editor || editor.isDestroyed || !layer || !pageCount) return;
    const dom = editor.view.dom as HTMLElement;
    const top = offsetWithin(dom, layer);
    setOrigin(top);
    const scroller = getEditorScrollContainer({ targetElement: dom });
    if (!scroller) {
      setFirst(0);
      setLast(pageCount - 1);
      return;
    }
    const [a, b] = visibleSheetRange({
      scrollTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
      originTop:
        layer.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop +
        top * scale,
      scale,
      cycle,
      pageCount,
    });
    setFirst(a);
    setLast(b);
  }, [editor, pageCount, scale, cycle]);

  useLayoutEffect(() => {
    if (!pageCount || !editor || editor.isDestroyed) return;
    measure();
    const dom = editor.view.dom as HTMLElement;
    const scroller = getEditorScrollContainer({ targetElement: dom });
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    scroller?.addEventListener('scroll', schedule, { passive: true });
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    if (scroller) observer?.observe(scroller);
    const layer = ref.current?.parentElement;
    if (layer) observer?.observe(layer);
    return () => {
      scroller?.removeEventListener('scroll', schedule);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [editor, pageCount, measure]);

  if (!editor || !pageCount) return null;

  const end = Math.min(last, pageCount - 1);
  const fill = canvasStyle?.backgroundColor;
  const sheets: React.ReactNode[] = [];
  for (let i = first; i <= end; i++) {
    sheets.push(
      <div
        key={i}
        className={cn('ddoc-page-sheet', !fill && 'color-bg-default')}
        style={{
          ...canvasStyle,
          top: `${origin + i * cycle}px`,
          width: `${grid.width}px`,
          height: `${grid.height}px`,
        }}
      >
        <span
          className="ddoc-page-number color-text-secondary"
          style={{
            left: `calc(100% + ${PAGE_NUMBER_GAP / scale}px)`,
            transform: scale === 1 ? undefined : `scale(${1 / scale})`,
          }}
        >
          {i + 1}
        </span>
      </div>,
    );
  }

  return (
    <div ref={ref} className="ddoc-page-sheets" aria-hidden="true">
      {sheets}
    </div>
  );
}
