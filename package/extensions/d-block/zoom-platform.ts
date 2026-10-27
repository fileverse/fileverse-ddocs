import { platform, type Platform } from '@floating-ui/dom';
import { getZoomScale } from '../../utils/zoom';

const isInZoomLayer = (element: unknown): element is Element =>
  element instanceof Element && !!element.closest('[data-ddoc-zoom-layer]');

// Floating-ui measures an offset parent's scale as rect / offsetWidth, which is
// 1 for the drag handle's zero-size wrapper inside the scaled layer, so the
// reference rect stays in screen pixels and gets scaled twice (TEC-3301).
export const zoomAwarePlatform: Platform = {
  ...platform,
  getScale: (element) =>
    isInZoomLayer(element)
      ? { x: getZoomScale(element), y: getZoomScale(element) }
      : platform.getScale(element),
  async getElementRects(data) {
    const rects = await platform.getElementRects.call(this, data);
    const offsetParent = await platform.getOffsetParent(
      data.floating as HTMLElement,
    );
    if (!isInZoomLayer(offsetParent)) return rects;
    const measured = (await platform.getScale(offsetParent as HTMLElement)).x;
    const factor = getZoomScale(offsetParent) / (measured || 1);
    if (Math.abs(factor - 1) < 0.001) return rects;
    const { x, y, width, height } = rects.reference;
    return {
      ...rects,
      reference: {
        x: x / factor,
        y: y / factor,
        width: width / factor,
        height: height / factor,
      },
    };
  },
};
