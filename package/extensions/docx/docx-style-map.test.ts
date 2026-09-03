import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { DOCX_STYLE_MAP } from './docx-import';

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** The smallest archive mammoth will read. */
const buildDocx = (body: string) => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W}><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

const run = (text: string, rPr: string) =>
  `<w:r><w:rPr>${rPr}</w:rPr><w:t xml:space="preserve">${text}</w:t></w:r>`;

const DOC =
  `<w:p>${run('Underline', '<w:u w:val="single"/>')}</w:p>` +
  `<w:p>${run('yellow highlight', '<w:highlight w:val="yellow"/>')}</w:p>` +
  `<w:p>${run('cyan highlight.', '<w:highlight w:val="cyan"/>')}</w:p>`;

const convert = async (styleMap?: string[]) => {
  const buffer = await buildDocx(DOC);
  const { value } = await mammoth.convertToHtml({ buffer } as never, {
    styleMap,
    ignoreEmptyParagraphs: false,
  });
  return value;
};

describe('DOCX_STYLE_MAP', () => {
  it('carries underlined runs through to <u>', async () => {
    expect(await convert(DOCX_STYLE_MAP)).toContain('<u>Underline</u>');
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
