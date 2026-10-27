import { RefObject, useLayoutEffect, useRef } from 'react';
import { anchorScroll } from '../utils/zoom';

interface UseZoomedPageOptions {
  wrapperRef: RefObject<HTMLElement | null>;
  layerRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  scale: number;
  enabled: boolean;
}

const readAnchor = (scroller: HTMLElement, layer: HTMLElement) => {
  const scrollerRect = scroller.getBoundingClientRect();
  const layerRect = layer.getBoundingClientRect();
  return {
    top: scroller.scrollTop,
    left: scroller.scrollLeft,
    layerTop: layerRect.top - scrollerRect.top + scroller.scrollTop,
    layerLeft: layerRect.left - scrollerRect.left + scroller.scrollLeft,
  };
};

// The scaled layer keeps its 100% layout box, so the wrapper reserves the
// scaled footprint. Written to the DOM directly so typing never re-renders.
export const useZoomedPage = ({
  wrapperRef,
  layerRef,
  scrollerRef,
  scale,
  enabled,
}: UseZoomedPageOptions) => {
  const prevScaleRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const layer = layerRef.current;
    if (!wrapper || !layer) return;
    if (!enabled) {
      wrapper.style.height = '';
      prevScaleRef.current = null;
      return;
    }
    const prevScale = prevScaleRef.current;
    prevScaleRef.current = scale;
    const scroller = scrollerRef.current;
    // Read before the height write: a shorter wrapper would clamp scrollTop.
    const anchor =
      scroller && prevScale !== null && prevScale !== scale
        ? readAnchor(scroller, layer)
        : null;
    const writeHeight = () => {
      wrapper.style.height = `${layer.offsetHeight * scale}px`;
    };
    writeHeight();
    if (scroller && anchor && prevScale !== null) {
      scroller.scrollTop = anchorScroll(
        anchor.top,
        anchor.layerTop,
        prevScale,
        scale,
      );
      if (scroller.scrollWidth > scroller.clientWidth) {
        scroller.scrollLeft = anchorScroll(
          anchor.left,
          anchor.layerLeft,
          prevScale,
          scale,
        );
      }
    }
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(writeHeight);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [wrapperRef, layerRef, scrollerRef, scale, enabled]);
};
