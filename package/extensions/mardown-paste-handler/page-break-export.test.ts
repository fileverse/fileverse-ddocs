import { describe, it, expect } from 'vitest';
import { turndownService, setOmitPageBreaks } from './index';

const PAGE_BREAK_HTML =
  '<p>before</p><br data-page-break="true" /><p>after</p>';

describe('pageBreak export', () => {
  it('emits === by default (Split View / .md download round-trip)', () => {
    const md = turndownService.turndown(PAGE_BREAK_HTML);
    expect(md).toContain('===');
  });

  it('drops the marker entirely with omitPageBreaks (blog publish)', () => {
    setOmitPageBreaks(true);
    try {
      const md = turndownService.turndown(PAGE_BREAK_HTML);
      expect(md).not.toContain('===');
      expect(md).toContain('before');
      expect(md).toContain('after');
    } finally {
      setOmitPageBreaks(false);
    }
  });
});
