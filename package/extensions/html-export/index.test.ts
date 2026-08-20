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

  it('preserves Mermaid SVG paths', () => {
    const html = sanitizeHtmlExportBody(
      '<svg viewBox="0 0 10 10"><path d="M0 0 L10 10"></path></svg>',
    );

    expect(html).toContain('<svg viewBox="0 0 10 10">');
    expect(html).toContain('<path d="M0 0 L10 10"></path>');
  });
});
