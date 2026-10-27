import { useRef } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useZoomedPage } from './use-zoomed-page';

let layerHeight = 1000;
let wrapper: HTMLDivElement | null = null;

const Harness = ({ scale, enabled }: { scale: number; enabled: boolean }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  useZoomedPage({ wrapperRef, layerRef, scrollerRef, scale, enabled });
  return (
    <div ref={scrollerRef}>
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
});
