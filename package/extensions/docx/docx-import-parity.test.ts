import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readDocxSpacingFromArchive } from './docx-spacing';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';

const createDocxArchive = async (
  documentXml: string,
  stylesXml?: string,
): Promise<ArrayBuffer> => {
  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  if (stylesXml) {
    zip.file('word/styles.xml', stylesXml);
  }
  return zip.generateAsync({ type: 'arraybuffer' });
};

describe('DOCX Import Parity End-to-End', () => {
  it('zips paragraph margins, lineHeight, alignment, and image data-align together', async () => {
    const documentXml = `<?xml version="1.0"?>
      <w:document xmlns:w="${W}" xmlns:wp="${WP}">
        <w:body>
          <w:p>
            <w:pPr>
              <w:spacing w:before="240" w:after="480" w:line="240" w:lineRule="auto"/>
              <w:jc w:val="center"/>
            </w:pPr>
            <w:r><w:t>Centered title</w:t></w:r>
          </w:p>
          <w:p>
            <w:pPr>
              <w:jc w:val="right"/>
            </w:pPr>
            <w:r><w:drawing><wp:inline/></w:drawing></w:r>
          </w:p>
        </w:body>
      </w:document>`;

    const arrayBuffer = await createDocxArchive(documentXml);

    // Mammoth output with underline & highlight
    const mammothHtml =
      '<p><u>Centered</u> <mark data-color="#FFFF00">title</mark></p><p><img src="data:image/png;base64,123" /></p>';

    const finalHtml = await readDocxSpacingFromArchive(
      arrayBuffer,
      mammothHtml,
    );

    expect(finalHtml).toContain(
      'style="margin-top: 12pt; margin-bottom: 24pt; line-height: 120%; text-align: center;"',
    );
    expect(finalHtml).toContain('<u>Centered</u>');
    expect(finalHtml).toContain('<mark data-color="#FFFF00">title</mark>');
    expect(finalHtml).toContain('data-align="end"');
  });

  it('zips run formatting (color, font size, font family) onto mammoth html', async () => {
    const documentXml = `<?xml version="1.0"?>
      <w:document xmlns:w="${W}">
        <w:body>
          <w:p>
            <w:r>
              <w:rPr>
                <w:color w:val="FF0000"/>
                <w:sz w:val="36"/>
                <w:rFonts w:ascii="Arial"/>
              </w:rPr>
              <w:t>Red 18pt Arial</w:t>
            </w:r>
            <w:r>
              <w:t> and </w:t>
            </w:r>
            <w:r>
              <w:rPr>
                <w:color w:val="0000FF"/>
                <w:sz w:val="24"/>
                <w:rFonts w:ascii="Georgia"/>
              </w:rPr>
              <w:t>Blue 12pt Georgia</w:t>
            </w:r>
          </w:p>
        </w:body>
      </w:document>`;

    const arrayBuffer = await createDocxArchive(documentXml);

    const mammothHtml = '<p>Red 18pt Arial and Blue 12pt Georgia</p>';

    const finalHtml = await readDocxSpacingFromArchive(
      arrayBuffer,
      mammothHtml,
    );

    expect(finalHtml).toContain(
      '<span style="color: rgb(255, 0, 0); font-size: 24px; font-family: Arial, Arial, Helvetica, sans-serif;">Red 18pt Arial</span>',
    );
    expect(finalHtml).toContain(
      '<span style="color: rgb(0, 0, 255); font-size: 16px; font-family: Georgia, serif;">Blue 12pt Georgia</span>',
    );
  });
});
