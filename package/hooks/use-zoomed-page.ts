import { RefObject, useLayoutEffect } from 'react';

interface UseZoomedPageOptions {
  wrapperRef: RefObject<HTMLElement | null>;
  layerRef: RefObject<HTMLElement | null>;
  scrollerRef: RefObject<HTMLElement | null>;
  scale: number;
  enabled: boolean;
}

// The scaled layer keeps its 100% layout box, so the wrapper reserves the
// scaled footprint. Written to the DOM directly so typing never re-renders.
export const useZoomedPage = ({
  wrapperRef,
  layerRef,
  scale,
  enabled,
}: UseZoomedPageOptions) => {
  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const layer = layerRef.current;
    if (!wrapper || !layer) return;
    if (!enabled) {
      wrapper.style.height = '';
      return;
    }
    const writeHeight = () => {
      wrapper.style.height = `${layer.offsetHeight * scale}px`;
    };
    writeHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(writeHeight);
    observer.observe(layer);
    return () => observer.disconnect();
  }, [wrapperRef, layerRef, scale, enabled]);
};
