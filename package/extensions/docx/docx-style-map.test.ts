import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { DOCX_STYLE_MAP } from './docx-import';

const FIXTURE = path.join(
  __dirname,
  '__fixtures__',
  'gdocs-manual-formatting.docx',
);

const convert = async (styleMap?: string[]) => {
  const buffer = fs.readFileSync(FIXTURE);
  const { value } = await mammoth.convertToHtml({ buffer } as never, {
    styleMap,
    ignoreEmptyParagraphs: false,
  });
  return value;
};

describe('DOCX_STYLE_MAP', () => {
  it('carries underlined runs through to <u>', async () => {
    const html = await convert(DOCX_STYLE_MAP);
    expect(html).toContain('<u>Underline</u>');
    expect(html).toContain('<u>underline, double underline, </u>');
  });

  it('carries highlighted runs through to <mark> with the OOXML colour', async () => {
    const html = await convert(DOCX_STYLE_MAP);
    expect(html).toContain(
      '<mark data-color="#FFFF00">yellow highlight</mark>',
    );
    expect(html).toContain('<mark data-color="#00FFFF">cyan highlight.</mark>');
  });

  it('is what produces them — mammoth drops both on its own', async () => {
    const html = await convert();
    expect(html).not.toContain('<u>');
    expect(html).not.toContain('<mark');
  });
});
