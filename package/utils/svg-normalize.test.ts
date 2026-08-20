import { describe, it, expect } from 'vitest';
import {
  normalizeSvgDimensions,
  normalizeSvgFile,
  readFileText,
} from './svg-normalize';

const XMLNS = 'http://www.w3.org/2000/svg';

const parse = (text: string) => {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  return doc.documentElement;
};

describe('normalizeSvgDimensions', () => {
  it('pins width and height from the viewBox when width is a percentage', () => {
    // Same shape as artifact-style diagrams (the Firefox 0-height case).
    const out = normalizeSvgDimensions(
      `<svg width="100%" viewBox="0 0 680 290" role="img" style="" xmlns="${XMLNS}"><title>t</title><rect x="1" y="1" width="10" height="10"/></svg>`,
    );
    expect(out).not.toBeNull();
    const root = parse(out as string);
    expect(root.getAttribute('width')).toBe('680');
    expect(root.getAttribute('height')).toBe('290');
    // Content and unrelated attributes survive.
    expect(root.getAttribute('viewBox')).toBe('0 0 680 290');
    expect(root.getAttribute('role')).toBe('img');
    expect((out as string).includes('<title>t</title>')).toBe(true);
    expect((out as string).includes('<rect')).toBe(true);
  });

  it('pins from the viewBox when width and height are absent', () => {
    const out = normalizeSvgDimensions(
      `<svg viewBox="0 0 10 20" xmlns="${XMLNS}"><circle cx="5" cy="5" r="4"/></svg>`,
    );
    const root = parse(out as string);
    expect(root.getAttribute('width')).toBe('10');
    expect(root.getAttribute('height')).toBe('20');
  });

  it('derives the missing height from a concrete width and the viewBox ratio', () => {
    const out = normalizeSvgDimensions(
      `<svg width="340" viewBox="0 0 680 290" xmlns="${XMLNS}"/>`,
    );
    const root = parse(out as string);
    expect(root.getAttribute('width')).toBe('340');
    expect(root.getAttribute('height')).toBe('145');
  });

  it('derives the missing width from a concrete height', () => {
    const out = normalizeSvgDimensions(
      `<svg height="145" viewBox="0 0 680 290" xmlns="${XMLNS}"/>`,
    );
    const root = parse(out as string);
    expect(root.getAttribute('width')).toBe('340');
    expect(root.getAttribute('height')).toBe('145');
  });

  it('replaces a percentage height alongside a concrete width', () => {
    const out = normalizeSvgDimensions(
      `<svg width="680" height="100%" viewBox="0 0 680 290" xmlns="${XMLNS}"/>`,
    );
    const root = parse(out as string);
    expect(root.getAttribute('height')).toBe('290');
  });

  it('returns null when width and height are already concrete', () => {
    expect(
      normalizeSvgDimensions(
        `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="${XMLNS}"/>`,
      ),
    ).toBeNull();
  });

  it('returns null without a usable viewBox', () => {
    expect(
      normalizeSvgDimensions(`<svg width="100%" xmlns="${XMLNS}"/>`),
    ).toBeNull();
    expect(
      normalizeSvgDimensions(
        `<svg width="100%" viewBox="0 0 0 0" xmlns="${XMLNS}"/>`,
      ),
    ).toBeNull();
  });

  it('returns null on malformed XML (fail-open)', () => {
    expect(normalizeSvgDimensions('<svg width="100%"')).toBeNull();
    expect(normalizeSvgDimensions('not svg at all')).toBeNull();
  });

  it('accepts comma-separated viewBox values', () => {
    const out = normalizeSvgDimensions(
      `<svg viewBox="0,0,100,50" xmlns="${XMLNS}"/>`,
    );
    const root = parse(out as string);
    expect(root.getAttribute('width')).toBe('100');
    expect(root.getAttribute('height')).toBe('50');
  });
});

describe('normalizeSvgFile', () => {
  it('rewraps a dimensionless SVG file with pinned dimensions', async () => {
    const file = new File(
      [`<svg width="100%" viewBox="0 0 680 290" xmlns="${XMLNS}"/>`],
      'chart.svg',
      { type: 'image/svg+xml' },
    );
    const out = await normalizeSvgFile(file);
    expect(out).not.toBe(file);
    expect(out.name).toBe('chart.svg');
    expect(out.type).toBe('image/svg+xml');
    const root = parse(await readFileText(out));
    expect(root.getAttribute('width')).toBe('680');
    expect(root.getAttribute('height')).toBe('290');
  });

  it('returns the same File instance when nothing changes', async () => {
    const file = new File(
      [`<svg width="16" height="16" xmlns="${XMLNS}"/>`],
      'icon.svg',
      { type: 'image/svg+xml' },
    );
    expect(await normalizeSvgFile(file)).toBe(file);
  });

  it('ignores non-SVG files', async () => {
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    expect(await normalizeSvgFile(file)).toBe(file);
  });
});
