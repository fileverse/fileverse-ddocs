import { platform } from '@floating-ui/dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zoomAwarePlatform } from './zoom-platform';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('zoomAwarePlatform', () => {
  it('returns the zoom for an element inside the layer', async () => {
    document.body.innerHTML =
      '<div data-ddoc-zoom-layer data-ddoc-zoom="1.5"><div><div id="parent"></div></div></div>';
    const parent = document.getElementById('parent') as HTMLElement;
    expect(await zoomAwarePlatform.getScale(parent)).toEqual({
      x: 1.5,
      y: 1.5,
    });
  });

  it('delegates outside the layer', async () => {
    document.body.innerHTML = '<div id="outside"></div>';
    const outside = document.getElementById('outside') as HTMLElement;
    const spy = vi
      .spyOn(platform, 'getScale')
      .mockReturnValue({ x: 0.8, y: 0.8 });
    expect(await zoomAwarePlatform.getScale(outside)).toEqual({
      x: 0.8,
      y: 0.8,
    });
    expect(spy).toHaveBeenCalledWith(outside);
  });

  it('keeps the other platform methods', () => {
    expect(zoomAwarePlatform.getOffsetParent).toBe(platform.getOffsetParent);
    expect(zoomAwarePlatform.getDimensions).toBe(platform.getDimensions);
  });

  const rectsWith = async (measuredScale: number) => {
    document.body.innerHTML =
      '<div data-ddoc-zoom-layer data-ddoc-zoom="2"><div id="parent"><div id="floating"></div></div></div>';
    const parent = document.getElementById('parent') as HTMLElement;
    const floating = document.getElementById('floating') as HTMLElement;
    vi.spyOn(platform, 'getOffsetParent').mockReturnValue(parent);
    vi.spyOn(platform, 'getScale').mockReturnValue({
      x: measuredScale,
      y: measuredScale,
    });
    vi.spyOn(platform, 'getElementRects').mockResolvedValue({
      reference: { x: 200, y: 400, width: 100, height: 40 },
      floating: { x: 0, y: 0, width: 80, height: 24 },
    });
    return zoomAwarePlatform.getElementRects.call(zoomAwarePlatform, {
      reference: document.body,
      floating,
      strategy: 'absolute',
    });
  };

  it('converts the reference rect to layer units when the offset parent measures unscaled', async () => {
    expect(await rectsWith(1)).toEqual({
      reference: { x: 100, y: 200, width: 50, height: 20 },
      floating: { x: 0, y: 0, width: 80, height: 24 },
    });
  });

  it('leaves the rects alone when the offset parent already measures the zoom', async () => {
    expect((await rectsWith(2)).reference).toEqual({
      x: 200,
      y: 400,
      width: 100,
      height: 40,
    });
  });
});
