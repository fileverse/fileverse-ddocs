import { afterEach, describe, expect, it } from 'vitest';
import { getCornerResizeStep } from './corner-resize';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('getCornerResizeStep', () => {
  it('converts the pointer delta into layer units inside the zoomed page', () => {
    document.body.innerHTML =
      '<div data-ddoc-zoom-layer data-ddoc-zoom="2"><img id="m" /></div>';
    const media = document.getElementById('m');
    expect(getCornerResizeStep('br', 300, 400, media)).toEqual({
      direction: 'right',
      delta: 50,
    });
  });

  it('mirrors the direction for the left corners', () => {
    expect(getCornerResizeStep('tl', 300, 400, null)).toEqual({
      direction: 'left',
      delta: 100,
    });
    expect(getCornerResizeStep('bl', 400, 300, null)).toEqual({
      direction: 'right',
      delta: 100,
    });
  });

  it('is null when the pointer did not move', () => {
    expect(getCornerResizeStep('tr', 300, 300, null)).toBeNull();
  });
});
