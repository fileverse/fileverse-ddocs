import { describe, it, expect } from 'vitest';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { readDocxSpacing, applyDocxSpacingToHtml } from './docx-spacing';
import { DOCX_STYLE_MAP } from './docx-import';

/**
 * The two structures that defeated the original matcher, rebuilt in OOXML so
 * the shapes under test are readable rather than buried in a binary:
 *
 *  - footnotes — mammoth appends the body as <ol><li><p>, so the HTML holds
 *    more blocks than the document has w:p, skewing any index-based pairing;
 *  - nested lists — the outer <li>'s textContent swallows its children, so
 *    text-based pairing has to read a block's OWN text only.
 */

const W =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R =
  'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';

const part = (name: string, type: string) =>
  `<Override PartName="/word/${name}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${type}+xml"/>`;

const buildDocx = (body: string) => {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
${part('document', 'document.main')}${part('footnotes', 'footnotes')}${part('numbering', 'numbering')}
</Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships ${R}>
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships ${R}>
<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`,
  );
  zip.file(
    'word/footnotes.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ${W}>
<w:footnote w:id="1"><w:p><w:r><w:t>A footnote body.</w:t></w:r></w:p></w:footnote>
</w:footnotes>`,
  );
  zip.file(
    'word/numbering.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:numbering ${W}>
<w:abstractNum w:abstractNumId="0">
<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl>
<w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<w:document ${W}><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
};

const run = (text: string, rPr = '') =>
  `<w:r>${
    rPr ? `<w:rPr>${rPr}</w:rPr>` : ''
  }<w:t xml:space="preserve">${text}</w:t></w:r>`;

const para = (after: string, runs: string, extraPPr = '') =>
  `<w:p><w:pPr><w:spacing w:after="${after}"/>${extraPPr}</w:pPr>${runs}</w:p>`;

const numPr = (ilvl: number) =>
  `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="1"/></w:numPr>`;

const DOC =
  para(
    '240',
    run(
      'Body with a note',
      '<w:color w:val="FF0000"/><w:rFonts w:ascii="Georgia"/><w:sz w:val="36"/>',
    ) + '<w:r><w:footnoteReference w:id="1"/></w:r>',
  ) +
  para(
    '0',
    run('top item', '<w:rFonts w:ascii="Georgia"/><w:sz w:val="24"/>'),
    numPr(0),
  ) +
  para(
    '0',
    run(
      'nested item',
      '<w:color w:val="000000"/><w:rFonts w:ascii="Verdana"/>',
    ),
    numPr(1),
  ) +
  para('0', run('plain tail'));

/** The real import pipeline, minus the editor insertion. */
const importDocx = async () => {
  const buffer = await buildDocx(DOC);
  const zip = await JSZip.loadAsync(buffer);
  const spacings = readDocxSpacing(
    await zip.file('word/document.xml')!.async('string'),
    `<w:styles ${W}/>`,
  );
  const { value: html } = await mammoth.convertToHtml({ buffer } as never, {
    styleMap: DOCX_STYLE_MAP,
    ignoreEmptyParagraphs: false,
  });
  return { html, spacings, result: applyDocxSpacingToHtml(html, spacings) };
};

const count = (haystack: string, needle: RegExp) =>
  (haystack.match(needle) || []).length;

describe('docx import against footnotes and nested lists', () => {
  it('stamps explicit spacing on every w:p despite the footnote skew', async () => {
    const { html, spacings, result } = await importDocx();

    // mammoth appends the footnote body, so the HTML holds more blocks than
    // the document has paragraphs. Every real paragraph must still be stamped
    // — no block may fall through to editor.css's default gap (TEC-2900).
    expect(count(html, /<p>|<li>/g)).toBeGreaterThan(spacings.length);
    expect(count(result, /margin-bottom:/g)).toBe(spacings.length);
  });

  it('leaves the footnote body alone', async () => {
    const { result } = await importDocx();

    expect(result).toContain('<ol><li id="footnote-1"><p>A footnote body.');
    expect(result).toContain('<sup><a href="#footnote-1"');
  });

  it("styles a nested list item from its own text, not its parent's", async () => {
    const { result } = await importDocx();

    // The outer <li>'s textContent is "top itemnested item"; pairing on that
    // would hand the child's run to the parent and lose one of the two.
    expect(result).toContain(
      '<span style="font-size: 16px; font-family: Georgia, serif;">top item</span>',
    );
    expect(result).toContain(
      '<span style="font-family: Verdana, Geneva, sans-serif;">nested item</span>',
    );
  });

  it('restores run formatting across the whole document', async () => {
    const { result } = await importDocx();

    expect(count(result, /font-family:/g)).toBe(3);
    expect(count(result, /font-size:/g)).toBe(2);
  });

  it('emits no black or white text that would vanish in one theme', async () => {
    const { result } = await importDocx();

    expect(result).toContain('color: rgb(255, 0, 0)');
    expect(result).not.toContain('color: rgb(0, 0, 0)');
    expect(result).not.toContain('color: rgb(255, 255, 255)');
  });

  it('emits font sizes in px so the size stepper stays coherent', async () => {
    const { result } = await importDocx();

    expect(result).not.toMatch(/font-size: [\d.]+pt/);
  });
});
