import { describe, it, expect } from 'vitest';
import { turndownService, setMarkdownInlineStyles } from './index';
import {
  encodeSvgToDataUri,
  sanitizeSvgForEmbed,
  isSafeCssColor,
} from '../../utils/svg-embed';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
const svgSrc = encodeSvgToDataUri(SVG);

const figure = (inner: string) =>
  `<div data-type="resizable-media" dataalign="center">${inner}</div>`;

const exportStyled = (html: string) => {
  setMarkdownInlineStyles(true);
  try {
    return turndownService.turndown(html);
  } finally {
    setMarkdownInlineStyles(false);
  }
};

describe('image background export — styles mode', () => {
  it('raster figure img carries data attr AND a rendered style', () => {
    const md = exportStyled(
      figure('<img src="https://x/img.png" data-background-color="#FFFFFF" />'),
    );
    expect(md).toContain('data-background-color="#FFFFFF"');
    expect(md).toContain('style="background-color: #FFFFFF"');
  });

  it('inline svg root is stamped with the backdrop', () => {
    const md = exportStyled(
      figure(`<img src="${svgSrc}" data-background-color="#FFFFFF" />`),
    );
    expect(md).toContain('<svg');
    expect(md).toContain('data-background-color="#FFFFFF"');
    expect(md).toMatch(/<svg[^>]*background-color: #FFFFFF/);
  });

  it('no backdrop → no style emitted', () => {
    const md = exportStyled(figure('<img src="https://x/img.png" />'));
    expect(md).not.toContain('background-color');
  });
});

describe('image background export — plain .md svg', () => {
  it('bare inline svg keeps the backdrop', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(
      `<img src="${svgSrc}" data-background-color="#262626" />`,
    );
    expect(md).toMatch(/<svg[^>]*background-color: #262626/);
  });
});

describe('svg backdrop sanitization', () => {
  it('rejects unsafe color payloads', () => {
    expect(isSafeCssColor('#FFFFFF')).toBe(true);
    expect(isSafeCssColor('rgb(255, 0, 0)')).toBe(true);
    expect(isSafeCssColor('white')).toBe(true);
    expect(isSafeCssColor('red; background-image: url(//evil)')).toBe(false);
    expect(isSafeCssColor('url(javascript:alert(1))')).toBe(false);
  });

  it('sanitizeSvgForEmbed skips stamping an unsafe color', () => {
    const out = sanitizeSvgForEmbed(SVG, null, 'red; url(//evil)');
    expect(out).toContain('<svg');
    expect(out).not.toContain('evil');
  });
});
