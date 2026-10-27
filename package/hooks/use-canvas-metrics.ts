import {
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { EditorWidthStore } from '../utils/editor-width-store';
import { computeFitScale } from '../utils/zoom';

const RAIL_WIDTH = 148;

export const computeWidthDecisions = (
  width: number,
  scaledWidth: number,
  leftWidth: number,
) => ({
  shouldHideRight: scaledWidth + RAIL_WIDTH * 2 > width,
  shouldScroll: scaledWidth > width - leftWidth,
});

type WidthDecisions = ReturnType<typeof computeWidthDecisions> & {
  fitScale: number;
};

export const useCanvasMetrics = ({
  canvasRef,
  rootRef,
  scaledWidth,
  leftWidth,
  widthStore,
  baseWidth,
  fitReservedWidth,
  isFit = false,
}: {
  canvasRef: RefObject<HTMLElement | null>;
  rootRef: RefObject<HTMLElement | null>;
  scaledWidth: number;
  leftWidth: number;
  widthStore?: EditorWidthStore;
  baseWidth: number;
  fitReservedWidth: number;
  // At Fit the page width comes from the measured fitScale, not scaledWidth.
  isFit?: boolean;
}): WidthDecisions => {
  const [decisions, setDecisions] = useState<WidthDecisions>(() => ({
    ...computeWidthDecisions(0, scaledWidth, leftWidth),
    fitScale: 1,
  }));
  const inputsRef = useRef({
    scaledWidth,
    leftWidth,
    baseWidth,
    fitReservedWidth,
    isFit,
  });
  const decisionsRef = useRef(decisions);

  const measure = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const root = rootRef.current;
    // Written straight to the DOM so a resize drag does not re-render.
    root?.style.setProperty('--ddoc-canvas-w', `${canvas.clientWidth}px`);
    root?.style.setProperty('--ddoc-canvas-h', `${canvas.clientHeight}px`);
    if (root) widthStore?.set(root.clientWidth);
    const inputs = inputsRef.current;
    const fitScale = computeFitScale(
      canvas.clientWidth,
      inputs.baseWidth,
      inputs.fitReservedWidth,
    );
    const next = {
      ...computeWidthDecisions(
        canvas.clientWidth,
        inputs.isFit ? inputs.baseWidth * fitScale : inputs.scaledWidth,
        inputs.leftWidth,
      ),
      fitScale,
    };
    const prev = decisionsRef.current;
    if (
      prev.shouldHideRight === next.shouldHideRight &&
      prev.shouldScroll === next.shouldScroll &&
      prev.fitScale === next.fitScale
    )
      return;
    decisionsRef.current = next;
    setDecisions(next);
  }, [canvasRef, rootRef, widthStore]);

  useLayoutEffect(() => {
    inputsRef.current = {
      scaledWidth,
      leftWidth,
      baseWidth,
      fitReservedWidth,
      isFit,
    };
    measure();
  }, [scaledWidth, leftWidth, baseWidth, fitReservedWidth, isFit, measure]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, measure]);

  return decisions;
};
