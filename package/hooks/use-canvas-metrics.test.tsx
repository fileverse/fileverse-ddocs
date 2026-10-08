// package/hooks/use-canvas-metrics.test.tsx
import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeWidthDecisions, useCanvasMetrics } from './use-canvas-metrics';

describe('computeWidthDecisions', () => {
  it('hides the right rail when the page plus both rails does not fit', () => {
    expect(computeWidthDecisions(1146, 850, 0).shouldHideRight).toBe(false);
    expect(computeWidthDecisions(1145, 850, 0).shouldHideRight).toBe(true);
  });

  it('changes alignment while the rail decision stays the same', () => {
    expect(computeWidthDecisions(1000, 850, 0)).toEqual({
      shouldHideRight: true,
      shouldScroll: false,
    });
    expect(computeWidthDecisions(800, 850, 0)).toEqual({
      shouldHideRight: true,
      shouldScroll: true,
    });
  });

  it('accounts for the left outline', () => {
    expect(computeWidthDecisions(900, 850, 0).shouldScroll).toBe(false);
    expect(computeWidthDecisions(900, 850, 148).shouldScroll).toBe(true);
  });
});

let size = { width: 1000, height: 600 };
let renders = 0;
let latest = { shouldHideRight: false, shouldScroll: false };

const Harness = ({
  scaledWidth,
  leftWidth,
}: {
  scaledWidth: number;
  leftWidth: number;
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  renders += 1;
  latest = useCanvasMetrics({ canvasRef, rootRef, scaledWidth, leftWidth });
  return (
    <div ref={rootRef} data-testid="root">
      <div
        ref={(node) => {
          canvasRef.current = node;
          if (node) {
            Object.defineProperty(node, 'clientWidth', {
              configurable: true,
              get: () => size.width,
            });
            Object.defineProperty(node, 'clientHeight', {
              configurable: true,
              get: () => size.height,
            });
          }
        }}
      />
    </div>
  );
};

const installObserver = () => {
  const callbacks: Array<() => void> = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        callbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  return () => act(() => callbacks.forEach((callback) => callback()));
};

afterEach(() => {
  vi.unstubAllGlobals();
  size = { width: 1000, height: 600 };
  renders = 0;
});

describe('useCanvasMetrics', () => {
  it('measures before paint and publishes the size on the root', () => {
    installObserver();
    const { getByTestId } = render(<Harness scaledWidth={850} leftWidth={0} />);
    const root = getByTestId('root');
    expect(root.style.getPropertyValue('--ddoc-canvas-w')).toBe('1000px');
    expect(root.style.getPropertyValue('--ddoc-canvas-h')).toBe('600px');
    expect(latest).toEqual({ shouldHideRight: true, shouldScroll: false });
  });

  it('re-renders only when a decision changes', () => {
    const resize = installObserver();
    const { getByTestId } = render(<Harness scaledWidth={850} leftWidth={0} />);
    const settled = renders;
    size = { width: 950, height: 600 };
    resize();
    expect(renders).toBe(settled);
    expect(getByTestId('root').style.getPropertyValue('--ddoc-canvas-w')).toBe(
      '950px',
    );
    size = { width: 800, height: 600 };
    resize();
    expect(latest.shouldScroll).toBe(true);
  });

  it('recomputes when zoom or outline width changes without a resize', () => {
    installObserver();
    const { rerender } = render(<Harness scaledWidth={850} leftWidth={0} />);
    rerender(<Harness scaledWidth={1275} leftWidth={0} />);
    expect(latest.shouldScroll).toBe(true);
    rerender(<Harness scaledWidth={850} leftWidth={148} />);
    expect(latest.shouldScroll).toBe(false);
    size = { width: 900, height: 600 };
    rerender(<Harness scaledWidth={850} leftWidth={149} />);
    expect(latest.shouldScroll).toBe(true);
  });

  it('measures once and does not throw without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { getByTestId } = render(<Harness scaledWidth={850} leftWidth={0} />);
    expect(getByTestId('root').style.getPropertyValue('--ddoc-canvas-w')).toBe(
      '1000px',
    );
  });
});
