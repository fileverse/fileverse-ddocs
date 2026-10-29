import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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

  it('ZoomProvider exposes the level and scale it is given', () => {
    render(
      <ZoomProvider
        zoomLevel="fit"
        fitScale={1.13}
        scale={1.13}
        setZoomLevel={() => {}}
      >
        <Probe />
      </ZoomProvider>,
    );
    expect(latest?.zoomLevel).toBe('fit');
    expect(latest?.scale).toBe(1.13);
  });
});
