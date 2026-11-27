import { describe, expect, it } from 'vitest';
import { isBlackOrWhiteShade, isPastedBlackOrWhiteShade } from './color-utils';

// Tiptap 3.20+ stores a pasted colour as authored; browsers used to hand the
// paste clean-up its rgb() form. Any format must be judged like that form.
describe('isPastedBlackOrWhiteShade', () => {
  it.each([
    ['#141414', 'rgb(20, 20, 20)'],
    ['#808080', 'rgb(128, 128, 128)'],
    ['#fff', 'rgb(255, 255, 255)'],
    ['#808080ff', 'rgb(128, 128, 128)'],
    ['hsl(0,0%,5%)', 'rgb(13, 13, 13)'],
    ['hsl(0, 0%, 98%)', 'rgb(250, 250, 250)'],
    ['rgba(0,0,0,1)', 'rgb(0, 0, 0)'],
    ['rgb(20 20 20)', 'rgb(20, 20, 20)'],
  ])('strips the grey %s, as its rgb form %s', (authored, rgb) => {
    expect(isBlackOrWhiteShade(rgb)).toBe(true);
    expect(isPastedBlackOrWhiteShade(authored)).toBe(true);
  });

  it.each([
    ['#333', 'rgb(51, 51, 51)'],
    ['#efefef', 'rgb(239, 239, 239)'],
    ['#cccccc', 'rgb(204, 204, 204)'],
    ['#80808080', 'rgba(128, 128, 128, 0.502)'],
    ['hsl(210, 60%, 40%)', 'rgb(41, 102, 163)'],
    ['rgba(0,0,0,0.5)', 'rgba(0, 0, 0, 0.5)'],
    ['#d93025', 'rgb(217, 48, 37)'],
  ])('keeps %s, as its rgb form %s', (authored, rgb) => {
    expect(isBlackOrWhiteShade(rgb)).toBe(false);
    expect(isPastedBlackOrWhiteShade(authored)).toBe(false);
  });

  it('leaves the fixed hex list to the load-time clean-up', () => {
    expect(isBlackOrWhiteShade('#efefef')).toBe(true);
    expect(isPastedBlackOrWhiteShade('#efefef')).toBe(false);
  });
});
