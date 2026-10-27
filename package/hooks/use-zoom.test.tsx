import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ZoomContextValue, ZoomProvider, useZoom } from './use-zoom';

let latest: ZoomContextValue | null = null;
const Probe = () => {
  latest = useZoom();
  return null;
};

describe('useZoom', () => {
  it('useZoom outside a provider returns scale 1', () => {
    render(<Probe />);
    expect(latest?.scale).toBe(1);
    expect(latest?.zoomLevel).toBe('1');
  });

  it('stepZoom calls setZoomLevel with the next preset', () => {
    const setZoomLevel = vi.fn();
    render(
      <ZoomProvider
        zoomLevel="1"
        fitScale={1}
        scale={1}
        setZoomLevel={setZoomLevel}
      >
        <Probe />
      </ZoomProvider>,
    );
    latest?.stepZoom(1);
    expect(setZoomLevel).toHaveBeenCalledWith('1.25');
  });

  it('steps from fit using the computed scale', () => {
    const setZoomLevel = vi.fn();
    render(
      <ZoomProvider
        zoomLevel="fit"
        fitScale={1.13}
        scale={1.13}
        setZoomLevel={setZoomLevel}
      >
        <Probe />
      </ZoomProvider>,
    );
    latest?.stepZoom(-1);
    expect(setZoomLevel).toHaveBeenCalledWith('1');
  });

  it('does not call setZoomLevel at the end of the list', () => {
    const setZoomLevel = vi.fn();
    render(
      <ZoomProvider
        zoomLevel="2"
        fitScale={1}
        scale={2}
        setZoomLevel={setZoomLevel}
      >
        <Probe />
      </ZoomProvider>,
    );
    latest?.stepZoom(1);
    expect(setZoomLevel).not.toHaveBeenCalled();
  });
});
