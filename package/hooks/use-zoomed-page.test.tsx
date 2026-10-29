import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useZoomedPage } from './use-zoomed-page';

let layerHeight = 1000;
let wrapper: HTMLDivElement | null = null;

let scrollTop = 0;
let scrollLeft = 0;
let overflowsX = false;
const scrollWrites: Array<{ value: number; wrapperHeight: string }> = [];
const LAYER_START = 100;
const LAYER_LEFT = 50;

const Harness = ({ scale, enabled }: { scale: number; enabled: boolean }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useZoomedPage({ wrapperRef, layerRef, scrollerRef, scale, enabled });
  return (
    <div
      ref={(node) => {
        scrollerRef.current = node;
        if (node) {
          Object.defineProperty(node, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
            set: (value: number) => {
              scrollWrites.push({
                value,
                wrapperHeight: wrapper?.style.height ?? '',
              });
              scrollTop = value;
            },
          });
          Object.defineProperty(node, 'scrollLeft', {
            configurable: true,
            get: () => scrollLeft,
            set: (value: number) => {
              scrollLeft = value;
            },
          });
          Object.defineProperty(node, 'scrollWidth', {
            configurable: true,
            get: () => (overflowsX ? 2000 : 1000),
          });
          Object.defineProperty(node, 'clientWidth', {
            configurable: true,
            get: () => 1000,
          });
          node.getBoundingClientRect = () => ({ top: 0, left: 0 }) as DOMRect;
        }
      }}
    >
      <div
        ref={(node) => {
          wrapperRef.current = node;
          wrapper = node;
        }}
      >
        <div
          ref={(node) => {
            layerRef.current = node;
            if (node) {
              Object.defineProperty(node, 'offsetHeight', {
                configurable: true,
                get: () => layerHeight,
              });
              node.getBoundingClientRect = () =>
                ({
                  top: LAYER_START - scrollTop,
                  left: LAYER_LEFT - scrollLeft,
                }) as DOMRect;
            }
          }}
        />
      </div>
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
  layerHeight = 1000;
  wrapper = null;
  scrollTop = 0;
  scrollLeft = 0;
  overflowsX = false;
  scrollWrites.length = 0;
});

describe('useZoomedPage', () => {
  it('sets the wrapper height to layer height times scale', () => {
    installObserver();
    render(<Harness scale={1.5} enabled />);
    expect(wrapper?.style.height).toBe('1500px');
  });

  it('re-measures the wrapper when the layer grows', () => {
    const resize = installObserver();
    render(<Harness scale={1.5} enabled />);
    layerHeight = 1200;
    resize();
    expect(wrapper?.style.height).toBe('1800px');
  });

  it('rewrites the height synchronously when the scale changes', () => {
    installObserver();
    const { rerender } = render(<Harness scale={1.5} enabled />);
    rerender(<Harness scale={0.5} enabled />);
    expect(wrapper?.style.height).toBe('500px');
  });

  it('clears the height when disabled', () => {
    installObserver();
    const { rerender } = render(<Harness scale={1.5} enabled />);
    rerender(<Harness scale={1.5} enabled={false} />);
    expect(wrapper?.style.height).toBe('');
  });

  it('keeps the anchor when zooming out from deep in the document', () => {
    installObserver();
    const { rerender } = render(<Harness scale={2} enabled />);
    scrollTop = 3100;
    rerender(<Harness scale={1} enabled />);
    expect(scrollTop).toBe(1600);
    expect(scrollWrites).toEqual([{ value: 1600, wrapperHeight: '1000px' }]);
  });

  it('keeps the horizontal anchor while the page overflows sideways', () => {
    installObserver();
    overflowsX = true;
    const { rerender } = render(<Harness scale={2} enabled />);
    scrollLeft = 850;
    rerender(<Harness scale={1} enabled />);
    expect(scrollLeft).toBe(450);
  });

  it('leaves scrollLeft alone when the page fits', () => {
    installObserver();
    const { rerender } = render(<Harness scale={2} enabled />);
    scrollLeft = 850;
    rerender(<Harness scale={1} enabled />);
    expect(scrollLeft).toBe(850);
  });

  it('does not anchor on the first scale after being re-enabled', () => {
    installObserver();
    const { rerender } = render(<Harness scale={2} enabled />);
    rerender(<Harness scale={2} enabled={false} />);
    scrollTop = 3100;
    rerender(<Harness scale={1} enabled />);
    expect(scrollWrites).toEqual([]);
  });

  it('does not touch the scroll on mount', () => {
    installObserver();
    scrollTop = 500;
    render(<Harness scale={2} enabled />);
    expect(scrollWrites).toEqual([]);
  });
});
