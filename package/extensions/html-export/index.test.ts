import { describe, expect, it } from 'vitest';
import { sanitizeHtmlExportBody } from '.';

describe('sanitizeHtmlExportBody', () => {
  it('preserves horizontal rules', () => {
    expect(sanitizeHtmlExportBody('<p>Before</p><hr><p>After</p>')).toBe(
      '<p>Before</p><hr><p>After</p>',
    );
  });

  it('preserves image sources and alternative text', () => {
    const html = sanitizeHtmlExportBody(
      '<img src="data:image/png;base64,AAAA" alt="Cover">',
    );

    expect(html).toBe(
      '<img src="data:image/png;base64,AAAA" alt="Cover">',
    );
  });

  // The whole of TEC-2701 reaches an export through this one attribute, which
  // the allow-list mostly inherits from a constant named for Mermaid SVGs.
  // Nothing else pins the property, so trimming that constant would strip
  // every block style from an export with the SVG tests still green.
  it('preserves the block styling that carries spacing into an export', () => {
    const html = sanitizeHtmlExportBody(
      '<p style="margin-top: 12pt; margin-bottom: 8pt; line-height: 138%;">one</p>',
    );

    expect(html).toContain('margin-top: 12pt');
    expect(html).toContain('margin-bottom: 8pt');
    expect(html).toContain('line-height: 138%');
  });

  it('preserves Mermaid SVG paths', () => {
    const html = sanitizeHtmlExportBody(
      '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"></path></svg>',
    );

    expect(html).toContain('<svg viewBox="0 0 10 10">');
    expect(html).toContain('<path d="M0 0 L10 10"></path>');
  });
});
