import { describe, it, expect } from 'vitest';
import { turndownService, setMarkdownInlineStyles } from './index';
import { encodeSvgToDataUri } from '../../utils/svg-embed';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
const svgSrc = encodeSvgToDataUri(SVG);

const HOSTILE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4"/></svg>';
const hostileSvgSrc = encodeSvgToDataUri(HOSTILE_SVG);

const wrapper = (inner: string, wrapperAttrs = 'dataalign="center"') =>
  `<div data-type="resizable-media" ${wrapperAttrs}>${inner}</div>`;

const captioned = (captionHtml: string) =>
  `<div data-type="media-caption-wrapper"><div data-type="media-caption" class="media-caption">${captionHtml}</div></div>`;

const exportStyled = (html: string) => {
  setMarkdownInlineStyles(true);
  try {
    return turndownService.turndown(html);
  } finally {
    setMarkdownInlineStyles(false);
  }
};

describe('svg export — plain .md', () => {
  it('emits bare inline <svg> instead of ![](data:…)', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(`<img src="${svgSrc}" />`);
    expect(md).toContain('<circle');
    expect(md).not.toContain('data:image/svg');
  });

  it('keeps raster images as ![](data:…)', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(
      '<img src="data:image/png;base64,AAAA" alt="chart" />',
    );
    expect(md).toContain('![chart](data:image/png;base64,AAAA)');
  });

  it('falls back to ![](data:…) for a corrupt svg payload', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(
      '<img src="data:image/svg+xml;base64,@@@" alt="broken" />',
    );
    expect(md).toContain('![broken](data:image/svg+xml;base64,@@@)');
  });

  it('keeps a table row intact when a cell contains an svg image', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(
      `<table><tr><td><img src="${svgSrc}" alt="chart" /></td></tr></table>`,
    );
    expect(md).not.toContain('<svg');
    const pipeRow = md
      .split('\n')
      .find(
        (line) => line.includes('|') && line.includes('data:image/svg+xml'),
      );
    expect(pipeRow).toBeDefined();
  });
});

describe('svg export — styles mode (blog)', () => {
  it('wraps sanitized <svg> in the media figure with alignment', () => {
    const md = exportStyled(
      wrapper(`<img src="${svgSrc}" />`, 'dataalign="right"'),
    );
    expect(md).toContain(
      '<figure data-type="resizable-media" data-align="right">',
    );
    expect(md).toContain('<svg');
    expect(md).toContain('<circle');
    expect(md).not.toContain('<img');
  });

  it('keeps the caption beside the svg', () => {
    const md = exportStyled(
      wrapper(`<img src="${svgSrc}" />${captioned('my caption')}`),
    );
    expect(md).toContain('<svg');
    expect(md).toContain('<figcaption>my caption</figcaption>');
    const svgIndex = md.indexOf('<svg');
    const captionIndex = md.indexOf('<figcaption>');
    expect(svgIndex).toBeGreaterThan(-1);
    expect(captionIndex).toBeGreaterThan(svgIndex);
  });

  it('applies the node resize width to the svg root', () => {
    const md = exportStyled(wrapper(`<img src="${svgSrc}" width="354" />`));
    expect(md).toMatch(/<svg[^>]*width="354"/);
  });

  it('strips scripts from a hostile svg payload', () => {
    const md = exportStyled(wrapper(`<img src="${hostileSvgSrc}" />`));
    expect(md).not.toContain('script');
    expect(md).toContain(
      '<figure data-type="resizable-media" data-align="center">',
    );
    expect(md).toContain('<svg');
    expect(md).toContain('<circle');
  });

  it('emits no blank lines inside the figure block', () => {
    const md = exportStyled(
      wrapper(`<img src="${svgSrc}" />${captioned('my caption')}`),
    );
    const figureBlock = md.slice(
      md.indexOf('<figure'),
      md.indexOf('</figure>') + '</figure>'.length,
    );
    expect(figureBlock).not.toMatch(/\n\s*\n/);
  });
});
