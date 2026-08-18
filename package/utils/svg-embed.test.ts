import { describe, it, expect } from 'vitest';
import {
  isSvgDataUri,
  decodeSvgDataUri,
  sanitizeSvgForEmbed,
  encodeSvgToDataUri,
  stripStyleBlocksOutsideSvg,
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
  it('drops the file height when stamping a width so the viewBox ratio holds', () => {
    const sized =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200px" height="200px" viewBox="0 0 200 200"><rect width="200" height="200"/></svg>';
    const out = sanitizeSvgForEmbed(sized, '666')!;
    expect(out).toMatch(/<svg[^>]*width="666"/);
    expect(out).not.toMatch(/<svg[^>]*height=/);
    expect(out).toContain('viewBox="0 0 200 200"');
  });
  it('synthesizes a viewBox from the file box when none exists', () => {
    const noViewBox =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100"/></svg>';
    const out = sanitizeSvgForEmbed(noViewBox, '666')!;
    expect(out).toContain('viewBox="0 0 200 100"');
    expect(out).toMatch(/<svg[^>]*width="666"/);
    expect(out).not.toMatch(/<svg[^>]*height=/);
  });
  it('pins a natural width from the viewBox when the file has none', () => {
    const out = sanitizeSvgForEmbed(SVG)!;
    expect(out).toMatch(/<svg[^>]*width="10"/);
    expect(sanitizeSvgForEmbed(SVG, '100%')).toMatch(/<svg[^>]*width="10"/);
  });
  it('treats a percentage file width as absent and replaces it', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 50 50"><rect width="50" height="50"/></svg>',
    )!;
    expect(out).toMatch(/<svg[^>]*width="50"/);
  });
  it('derives natural width from a concrete height and the viewBox ratio', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" height="200" viewBox="0 0 400 400"><rect width="400" height="400"/></svg>',
    )!;
    expect(out).toMatch(/<svg[^>]*width="200"/);
    expect(out).toMatch(/<svg[^>]*height="200"/);
  });
  it('leaves a concrete file width alone when no resize width is given', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>',
    )!;
    expect(out).toMatch(/<svg[^>]*width="200"/);
  });
  it('keeps the file height when no resize width is given', () => {
    const sized =
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>';
    const out = sanitizeSvgForEmbed(sized)!;
    expect(out).toMatch(/<svg[^>]*height="100"/);
  });
});

describe('svg style scoping', () => {
  const STYLED =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style type="text/css">.st0{fill:#FFDF0A;}</style><path class="st0" d="M0 0h5v5z"/></svg>';

  it('keeps the style block and scopes its selectors to the svg', () => {
    const out = sanitizeSvgForEmbed(STYLED)!;
    expect(out).toContain('<style');
    expect(out).toContain('FFDF0A');
    expect(out).toMatch(/\.svg-scope-[a-z0-9]+ \.st0 \{/);
    expect(out).toMatch(/<svg[^>]*class="[^"]*svg-scope-[a-z0-9]+/);
  });

  it('neutralizes page-level selectors by scoping them', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><style>body{display:none}</style><rect width="4" height="4"/></svg>',
    )!;
    expect(out).toMatch(/\.svg-scope-[a-z0-9]+ body \{/);
    expect(out).not.toMatch(/<style[^>]*>\s*body\s*\{/);
  });

  it('drops @import and external url() but keeps url(#fragment)', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><style>@import url(http://evil.example/x.css);.a{fill:url(http://evil.example/y)}.b{fill:url(#grad)}</style><rect class="b" width="4" height="4"/></svg>',
    )!;
    expect(out).not.toContain('@import');
    expect(out).not.toContain('evil.example');
    expect(out).toContain('url(#grad)');
  });

  it('drops image-set() smuggled URLs and sibling-combinator selectors', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><style>.a{background:image-set("//evil.example/x.png" 1x)}~ figcaption{display:none}.b{fill:red}</style><rect class="b" width="4" height="4"/></svg>',
    )!;
    expect(out).not.toContain('image-set');
    expect(out).not.toContain('figcaption');
    expect(out).toMatch(/\.svg-scope-[a-z0-9]+ \.b \{/);
  });

  it('drops a style block whose every rule is unsafe', () => {
    const out = sanitizeSvgForEmbed(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 4"><style>.a{background:url(http://evil.example/z)}</style><rect width="4" height="4"/></svg>',
    )!;
    expect(out).not.toContain('<style');
    expect(out).not.toContain('svg-scope-');
  });

  it('is idempotent: re-sanitizing scoped output does not double-prefix', () => {
    const once = sanitizeSvgForEmbed(STYLED)!;
    const twice = sanitizeSvgForEmbed(once)!;
    expect(twice).not.toMatch(/svg-scope-[a-z0-9]+ \.svg-scope-/);
    expect((twice.match(/svg-scope-/g) || []).length).toBe(
      (once.match(/svg-scope-/g) || []).length,
    );
  });
});

describe('stripStyleBlocksOutsideSvg', () => {
  it('strips a doc-level style block', () => {
    const out = stripStyleBlocksOutsideSvg(
      '<style>body{color:red}</style>\n# Title',
    );
    expect(out).not.toContain('<style');
    expect(out).toContain('# Title');
  });

  it('keeps a style inside svg while stripping ones outside', () => {
    const md =
      '<style>body{}</style>\n<svg viewBox="0 0 4 4">\n<style>.a{fill:red}</style>\n<rect class="a"/>\n</svg>\n<style>.x{}</style>';
    const out = stripStyleBlocksOutsideSvg(md);
    expect(out).toContain('.a{fill:red}');
    expect(out).not.toContain('body{}');
    expect(out).not.toContain('.x{}');
  });

  it('handles nested svgs as one region', () => {
    const md =
      '<svg viewBox="0 0 4 4"><svg viewBox="0 0 2 2"></svg><style>.a{fill:red}</style></svg>';
    expect(stripStyleBlocksOutsideSvg(md)).toContain('.a{fill:red}');
  });

  it('fails open on an unclosed svg', () => {
    const md = '<svg viewBox="0 0 4 4"><style>.a{fill:red}</style>';
    expect(stripStyleBlocksOutsideSvg(md)).toBe(md);
  });
});

describe('encodeSvgToDataUri', () => {
  it('round-trips unicode through decode', () => {
    const uni = SVG.replace('<circle', '<title>héllo→</title><circle');
    expect(decodeSvgDataUri(encodeSvgToDataUri(uni))).toBe(uni);
  });
});
