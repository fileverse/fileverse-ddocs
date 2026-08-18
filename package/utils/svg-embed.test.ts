import { describe, it, expect } from 'vitest';
import {
  isSvgDataUri,
  decodeSvgDataUri,
  sanitizeSvgForEmbed,
  encodeSvgToDataUri,
} from './svg-embed';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
const b64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));

describe('isSvgDataUri', () => {
  it('matches base64 svg data URIs', () => {
    expect(isSvgDataUri(`data:image/svg+xml;base64,${b64(SVG)}`)).toBe(true);
  });
  it('matches charset + utf8 variants', () => {
    expect(isSvgDataUri('data:image/svg+xml;charset=utf-8;base64,AAAA')).toBe(
      true,
    );
    expect(
      isSvgDataUri(`data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`),
    ).toBe(true);
    expect(isSvgDataUri(`data:image/svg+xml,${encodeURIComponent(SVG)}`)).toBe(
      true,
    );
  });
  it('rejects raster and non-data URIs', () => {
    expect(isSvgDataUri('data:image/png;base64,AAAA')).toBe(false);
    expect(isSvgDataUri('https://x.io/a.svg')).toBe(false);
  });
});

describe('decodeSvgDataUri', () => {
  it('decodes base64 payloads (unicode-safe)', () => {
    const uni = SVG.replace('<circle', '<title>héllo→</title><circle');
    expect(decodeSvgDataUri(`data:image/svg+xml;base64,${b64(uni)}`)).toBe(uni);
  });
  it('decodes percent-encoded payloads', () => {
    expect(
      decodeSvgDataUri(`data:image/svg+xml,${encodeURIComponent(SVG)}`),
    ).toBe(SVG);
  });
  it('returns raw payload when percent-decoding throws', () => {
    expect(decodeSvgDataUri('data:image/svg+xml,<svg>100%</svg>')).toBe(
      '<svg>100%</svg>',
    );
  });
  it('returns null for non-svg or malformed URIs', () => {
    expect(decodeSvgDataUri('data:image/png;base64,AAAA')).toBeNull();
    expect(decodeSvgDataUri('data:image/svg+xml;base64,@@@')).toBeNull();
  });
});

describe('sanitizeSvgForEmbed', () => {
  it('keeps clean svg and backfills xmlns', () => {
    const out = sanitizeSvgForEmbed(
      '<svg viewBox="0 0 4 4"><rect width="4" height="4"/></svg>',
    );
    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(out).toContain('<rect');
  });
  it('strips scripts and event handlers', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script><rect width="1" height="1"/></svg>',
    );
    expect(out).not.toContain('script');
    expect(out).not.toContain('onload');
    expect(out).toContain('<rect');
  });
  it('returns null when the root is not <svg>', () => {
    expect(sanitizeSvgForEmbed('<div>not svg</div>')).toBeNull();
    expect(sanitizeSvgForEmbed('plain text')).toBeNull();
  });
  it('removes blank lines and puts the opening tag alone on line 1', () => {
    const messy =
      '<svg\n  xmlns="http://www.w3.org/2000/svg"\n  viewBox="0 0 4 4">\n\n  <rect width="4" height="4"/>\n\n</svg>';
    const out = sanitizeSvgForEmbed(messy)!;
    expect(out).not.toMatch(/\n\s*\n/);
    expect(out.split('\n')[0]).toMatch(/^<svg[^>]*>$/);
  });
  it('removes indentation-interleaved blank lines (whitespace-only lines)', () => {
    const messy =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4">\n\n  \n  <rect width="4" height="4"/>\n</svg>';
    const out = sanitizeSvgForEmbed(messy)!;
    expect(out).not.toMatch(/\n[ \t]*\n/);
    expect(out).toContain('<rect');
  });
  it('single-line input gains a newline after the opening tag (html_block rule 7)', () => {
    const out = sanitizeSvgForEmbed(SVG)!;
    expect(out.split('\n')[0]).toMatch(/^<svg[^>]*>$/);
    expect(out).toContain('<circle');
  });
  it('applies width when given', () => {
    const out = sanitizeSvgForEmbed(SVG, '354')!;
    expect(out).toMatch(/<svg[^>]*width="354"/);
  });
  it('ignores default-size widths', () => {
    expect(sanitizeSvgForEmbed(SVG, '100%')).not.toContain('width="100%"');
    expect(sanitizeSvgForEmbed(SVG, null)).toContain('<svg');
  });
});

describe('encodeSvgToDataUri', () => {
  it('round-trips unicode through decode', () => {
    const uni = SVG.replace('<circle', '<title>héllo→</title><circle');
    expect(decodeSvgDataUri(encodeSvgToDataUri(uni))).toBe(uni);
  });
});
