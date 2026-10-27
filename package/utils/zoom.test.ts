import { describe, expect, it } from 'vitest';
import {
  COMMENT_COLUMN_WIDTH,
  computeFitScale,
  getZoomScale,
  normalizeZoomLevel,
  resolveZoomScale,
  stepZoomLevel,
} from './zoom';
import { zoomLevels } from '../constants/zoom';

describe('normalizeZoomLevel', () => {
  it.each([
    ['1.4', 'fit'],
    ['fit', 'fit'],
    ['', '1'],
    [undefined, '1'],
    [null, '1'],
    ['abc', '1'],
    ['0', '1'],
    ['1.25', '1.25'],
    ['2', '2'],
  ])('%s -> %s', (input, out) => expect(normalizeZoomLevel(input)).toBe(out));
});

describe('stepZoomLevel', () => {
  it('steps through presets', () => {
    expect(stepZoomLevel('1', 1, 1)).toBe('1.25');
    expect(stepZoomLevel('1.25', -1, 1)).toBe('1');
  });
  it('never lands on fit and does not wrap', () => {
    expect(stepZoomLevel('2', 1, 1)).toBe('2');
    expect(stepZoomLevel('0.5', -1, 1)).toBe('0.5');
  });
  it('steps from fit to the nearest preset on that side', () => {
    expect(stepZoomLevel('fit', 1, 1.13)).toBe('1.25');
    expect(stepZoomLevel('fit', -1, 1.13)).toBe('1');
    expect(stepZoomLevel('fit', 1, 1.25)).toBe('1.5');
    expect(stepZoomLevel('fit', -1, 0.5)).toBe('fit');
  });
});

describe('computeFitScale', () => {
  it('fits the page into the width left after the reserve', () => {
    expect(computeFitScale(1400, 850, 148 + 48)).toBeCloseTo(1.42, 2);
  });
  it('accounts for the comment column', () => {
    expect(COMMENT_COLUMN_WIDTH).toBe(360);
    expect(
      computeFitScale(1400, 850, 148 + COMMENT_COLUMN_WIDTH + 48),
    ).toBeCloseTo(0.99, 2);
  });
  it('clamps and handles an unmeasured canvas', () => {
    expect(computeFitScale(200, 850, 0)).toBe(0.5);
    expect(computeFitScale(5000, 850, 0)).toBe(2);
    expect(computeFitScale(0, 850, 0)).toBe(1);
  });
});

it('resolveZoomScale reads fit from the computed scale', () => {
  expect(resolveZoomScale('fit', 1.13)).toBe(1.13);
  expect(resolveZoomScale('1.5', 1.13)).toBe(1.5);
});

describe('getZoomScale', () => {
  it('reads the closest layer', () => {
    document.body.innerHTML =
      '<div data-ddoc-zoom-layer data-ddoc-zoom="1.5"><p><span id="t"></span></p></div>';
    expect(getZoomScale(document.getElementById('t'))).toBe(1.5);
  });
  it('is 1 outside a layer or for a bad value', () => {
    document.body.innerHTML =
      '<span id="a"></span><div data-ddoc-zoom-layer data-ddoc-zoom="x"><i id="b"></i></div>';
    expect(getZoomScale(document.getElementById('a'))).toBe(1);
    expect(getZoomScale(document.getElementById('b'))).toBe(1);
    expect(getZoomScale(null)).toBe(1);
  });
});

it('lists the seven presets in order', () => {
  expect(zoomLevels.map((level) => level.title)).toEqual([
    'Fit',
    '50%',
    '75%',
    '100%',
    '125%',
    '150%',
    '200%',
  ]);
  expect(zoomLevels[0].value).toBe('fit');
});
