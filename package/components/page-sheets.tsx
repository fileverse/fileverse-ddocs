/* eslint-disable react-refresh/only-export-components */
import React, {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import cn from 'classnames';
import {
  PAGE_GAP,
  PAGE_MARGIN,
  type PageGrid,
} from '../extensions/pagination/page-grid';
import type { PageStart } from '../extensions/pagination/place';
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

// Boundary i lies between sheets i and i + 1. A tall leaf continuing onto
// page i + 1 has its content in the band, so that boundary is not masked.
export function maskBoundaries(
  first: number,
  last: number,
  pageStarts: PageStart[],
): number[] {
  const out: number[] = [];
  for (let i = first; i < last; i++) {
    if (pageStarts[i + 1]?.kind !== 'continued') out.push(i);
  }
  return out;
}

// The canvas background does not scroll, so a custom desk (maybe a gradient)
// is sized and placed as the canvas paints it behind each gap.
const alignDesk = (
  masks: HTMLElement | null,
  scroller: HTMLElement | null,
  scale: number,
) => {
  if (!masks || !scroller) return;
  const box = scroller.getBoundingClientRect();
  const left = box.left + scroller.clientLeft;
  const top = box.top + scroller.clientTop;
  masks.querySelectorAll<HTMLElement>('.ddoc-page-mask-gap').forEach((gap) => {
    const r = gap.getBoundingClientRect();
    gap.style.backgroundSize = `${scroller.clientWidth / scale}px ${
      scroller.clientHeight / scale
    }px`;
    gap.style.backgroundPosition = `${(left - r.left) / scale}px ${
      (top - r.top) / scale
    }px`;
  });
};

const noop = () => () => {};

// el's unscaled offset within `layer`, summed along the offsetParent chain.
const offsetWithin = (el: HTMLElement, layer: HTMLElement | null) => {
  let top = 0;
  let left = 0;
  let node: HTMLElement | null = el;
  while (node && node !== layer) {
    top += node.offsetTop;
    left += node.offsetLeft;
    node = node.offsetParent as HTMLElement | null;
  }
  return { top, left };
};

export function PageSheets({
  editor,
  grid,
  canvasStyle,
  deskStyle,
}: {
  editor: Editor | null;
  grid: PageGrid;
  canvasStyle?: React.CSSProperties;
  deskStyle?: React.CSSProperties;
}) {
  const store = editor?.storage.pagination?.store;
  // A primitive snapshot: the store republishes placements that keep the count.
  const pageCount = useSyncExternalStore(store ? store.subscribe : noop, () => {
    const state = store?.get();
    return state?.enabled ? state.pageCount : null;
  });
  // Re-renders only when a boundary's mask comes or goes, not on every remap.
  const startKinds = useSyncExternalStore(
    store ? store.subscribe : noop,
    () =>
      store
        ?.get()
        .pageStarts.map((s) => (s.kind === 'continued' ? 1 : 0))
        .join('') ?? '',
  );
  const { scale } = useZoom();
  const ref = useRef<HTMLDivElement>(null);
  const masksRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState(0);
  // The masks live in view.dom's parent: it is a stacking context (index.css),
  // and the drag handle, media toolbar and carets stack inside it.
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [hostTop, setHostTop] = useState(0);
  const [hostLeft, setHostLeft] = useState(0);
  const [first, setFirst] = useState(0);
  // -1 until measured, so a long document never mounts every sheet at once.
  const [last, setLast] = useState(-1);
  const cycle = grid.height + PAGE_GAP;
  const hasDesk = !!deskStyle;
  const deskKey = deskStyle ? JSON.stringify(deskStyle) : '';

  const measure = useCallback(() => {
    const layer = ref.current?.parentElement ?? null;
    if (!editor || editor.isDestroyed || !layer || !pageCount) return;
    const dom = editor.view.dom as HTMLElement;
    const { top } = offsetWithin(dom, layer);
    setOrigin(top);
    const parent = dom.parentElement;
    setHost(parent);
    if (parent) {
      const at = offsetWithin(parent, layer);
      setHostTop(at.top);
      setHostLeft(at.left);
    }
    const scroller = getEditorScrollContainer({ targetElement: dom });
    if (hasDesk) alignDesk(masksRef.current, scroller, scale);
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
  }, [editor, pageCount, scale, cycle, hasDesk]);

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

  // New masks, and a desk React just rewrote, are placed before they paint.
  useLayoutEffect(() => {
    if (!deskKey || !editor || editor.isDestroyed) return;
    const dom = editor.view.dom as HTMLElement;
    alignDesk(
      masksRef.current,
      getEditorScrollContainer({ targetElement: dom }),
      scale,
    );
  }, [deskKey, editor, scale, first, last, origin, host, hostTop, startKinds]);

  if (!editor || !pageCount) return null;

  const end = Math.min(last, pageCount - 1);
  const fill = canvasStyle?.backgroundColor;
  const fillClass = !fill && 'color-bg-default';
  const sheets: React.ReactNode[] = [];
  for (let i = first; i <= end; i++) {
    sheets.push(
      <div
        key={i}
        className={cn('ddoc-page-sheet', fillClass)}
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

  const pageStarts = store?.get().pageStarts ?? [];
  const margin = { backgroundColor: fill, height: `${PAGE_MARGIN}px` };
  const masks = maskBoundaries(first, end, pageStarts).map((i) => (
    <div
      key={i}
      className="ddoc-page-mask"
      style={{
        top: `${origin - hostTop + grid.contentBottomOf(i)}px`,
        left: `${-hostLeft}px`,
        width: `${grid.width}px`,
        height: `${grid.contentTopOf(i + 1) - grid.contentBottomOf(i)}px`,
      }}
    >
      <div className={cn('ddoc-page-mask-bottom', fillClass)} style={margin} />
      <div
        className={cn('ddoc-page-mask-gap', !deskStyle && 'color-bg-secondary')}
        style={{ ...deskStyle, height: `${PAGE_GAP}px` }}
      />
      <div className={cn('ddoc-page-mask-top', fillClass)} style={margin} />
    </div>
  ));

  return (
    <>
      <div ref={ref} className="ddoc-page-sheets" aria-hidden="true">
        {sheets}
      </div>
      {host &&
        createPortal(
          <div ref={masksRef} className="ddoc-page-masks" aria-hidden="true">
            {masks}
          </div>,
          host,
        )}
    </>
  );
}
