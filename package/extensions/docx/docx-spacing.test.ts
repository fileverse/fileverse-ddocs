import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import {
  applyDocxSpacingToHtml,
  readDocxSpacing,
  readDocxSpacingFromArchive,
  type DocxParagraphSpacing,
} from './docx-spacing';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

const doc = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`;

const styles = (inner: string) =>
  `<?xml version="1.0"?><w:styles xmlns:w="${W}">${inner}</w:styles>`;

const para = (opts: { style?: string; spacing?: string; text?: string }) => {
  const pPr =
    opts.style || opts.spacing
      ? `<w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''}${
          opts.spacing ?? ''
        }</w:pPr>`
      : '';
  return `<w:p>${pPr}<w:r><w:t>${opts.text ?? ''}</w:t></w:r></w:p>`;
};

const NO_STYLES = styles('');

describe('readDocxSpacing', () => {
  it('converts twips to pt (a twip is a twentieth of a point)', () => {
    const xml = doc(
      para({ spacing: '<w:spacing w:before="240" w:after="400"/>' }),
    );

    expect(readDocxSpacing(xml, NO_STYLES)[0]).toMatchObject({
      spaceBefore: 12,
      spaceAfter: 20,
    });
  });

  // Word stores auto line spacing in 240ths of a line; ddoc stores a
  // percentage on a 120 base, so the conversion is exactly line / 2.
  it('converts auto line spacing to our percentage', () => {
    const xml = doc(
      para({ spacing: '<w:spacing w:line="276" w:lineRule="auto"/>' }),
    );

    expect(readDocxSpacing(xml, NO_STYLES)[0].lineHeight).toBe('138%');
  });

  it('ignores exact line spacing, which has no multiplier equivalent', () => {
    const xml = doc(
      para({ spacing: '<w:spacing w:line="360" w:lineRule="exact"/>' }),
    );

    expect(readDocxSpacing(xml, NO_STYLES)[0].lineHeight).toBeNull();
  });

  it('returns one entry per paragraph, in document order, with its text', () => {
    const xml = doc(
      para({ text: 'one', spacing: '<w:spacing w:after="200"/>' }) +
        para({ text: 'two' }),
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.text)).toEqual(['one', 'two']);
    expect(result[1].spaceAfter).toBeNull();
  });

  it('falls back to the spacing on the paragraph style', () => {
    const xml = doc(para({ style: 'Heading1', text: 'h' }));
    const sty = styles(
      `<w:style w:styleId="Heading1"><w:pPr><w:spacing w:before="360"/></w:pPr></w:style>`,
    );

    expect(readDocxSpacing(xml, sty)[0].spaceBefore).toBe(18);
  });

  it('lets direct formatting win over the style', () => {
    const xml = doc(
      para({ style: 'Heading1', spacing: '<w:spacing w:before="120"/>' }),
    );
    const sty = styles(
      `<w:style w:styleId="Heading1"><w:pPr><w:spacing w:before="360"/></w:pPr></w:style>`,
    );

    expect(readDocxSpacing(xml, sty)[0].spaceBefore).toBe(6);
  });

  it('inherits through the basedOn chain', () => {
    const xml = doc(para({ style: 'Child' }));
    const sty = styles(
      `<w:style w:styleId="Base"><w:pPr><w:spacing w:after="400"/></w:pPr></w:style>` +
        `<w:style w:styleId="Child"><w:basedOn w:val="Base"/></w:style>`,
    );

    expect(readDocxSpacing(xml, sty)[0].spaceAfter).toBe(20);
  });

  it('uses docDefaults as the base layer', () => {
    const xml = doc(para({ text: 'plain' }));
    const sty = styles(
      `<w:docDefaults><w:pPrDefault><w:pPr><w:spacing w:after="160"/></w:pPr></w:pPrDefault></w:docDefaults>`,
    );

    expect(readDocxSpacing(xml, sty)[0].spaceAfter).toBe(8);
  });

  // Word merges w:spacing attribute by attribute, not element by element:
  // a style supplying only w:before must survive direct formatting that
  // supplies only w:after.
  it('merges layers per attribute, not wholesale', () => {
    const xml = doc(
      para({ style: 'Body', spacing: '<w:spacing w:after="200"/>' }),
    );
    const sty = styles(
      `<w:style w:styleId="Body"><w:pPr><w:spacing w:before="600"/></w:pPr></w:style>`,
    );

    expect(readDocxSpacing(xml, sty)[0]).toMatchObject({
      spaceBefore: 30,
      spaceAfter: 10,
    });
  });

  it('clamps to the range the spacing attributes allow', () => {
    const xml = doc(para({ spacing: '<w:spacing w:before="99999"/>' }));

    expect(readDocxSpacing(xml, NO_STYLES)[0].spaceBefore).toBe(100);
  });
});

describe('applyDocxSpacingToHtml', () => {
  const spacing = (over: Partial<DocxParagraphSpacing>) => ({
    spaceBefore: null,
    spaceAfter: null,
    lineHeight: null,
    text: '',
    ...over,
  });

  it('writes the spacing as inline styles the editor already parses', () => {
    const html = '<p>one</p><p>two</p>';

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'one', spaceBefore: 12, spaceAfter: 8 }),
      spacing({ text: 'two', lineHeight: '138%' }),
    ]);

    expect(out).toContain('margin-top: 12pt');
    expect(out).toContain('margin-bottom: 8pt');
    expect(out).toContain('line-height: 138%');
  });

  it('leaves untouched paragraphs without a style attribute', () => {
    const html = '<p>one</p>';

    const out = applyDocxSpacingToHtml(html, [spacing({ text: 'one' })]);

    expect(out).not.toContain('style=');
  });

  it('covers headings and list items, not just paragraphs', () => {
    const html = '<h1>title</h1><ul><li>item</li></ul>';

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'title', spaceBefore: 24 }),
      spacing({ text: 'item', spaceAfter: 4 }),
    ]);

    expect(out).toContain('<h1 style="margin-top: 24pt');
    expect(out).toContain('<li style="margin-bottom: 4pt');
  });

  // Degrade to no spacing rather than confidently wrong spacing: mammoth
  // relocates text boxes and appends footnotes, so the two sequences can
  // legitimately diverge on complex documents.
  it('drops spacing entirely when the block count diverges', () => {
    const html = '<p>one</p><p>two</p>';

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'one', spaceBefore: 12 }),
    ]);

    expect(out).toBe(html);
  });

  it('drops spacing entirely when the text diverges', () => {
    const html = '<p>one</p><p>two</p>';

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'one', spaceBefore: 12 }),
      spacing({ text: 'ELSEWHERE', spaceBefore: 12 }),
    ]);

    expect(out).toBe(html);
  });

  it('tolerates whitespace differences when comparing text', () => {
    const html = '<p>one  two</p>';

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: ' one two ', spaceBefore: 12 }),
    ]);

    expect(out).toContain('margin-top: 12pt');
  });
});

describe('readDocxSpacingFromArchive', () => {
  const buildDocx = async (documentXml: string, stylesXml: string) => {
    const zip = new JSZip();
    zip.file('word/document.xml', documentXml);
    zip.file('word/styles.xml', stylesXml);
    return zip.generateAsync({ type: 'arraybuffer' });
  };

  it('pulls spacing out of the archive and applies it to the html', async () => {
    const buffer = await buildDocx(
      doc(para({ text: 'one', spacing: '<w:spacing w:after="400"/>' })),
      NO_STYLES,
    );

    const out = await readDocxSpacingFromArchive(buffer, '<p>one</p>');

    expect(out).toContain('margin-bottom: 20pt');
  });

  // The import must never fail because of the spacing pass — losing spacing
  // is recoverable, losing the document is not.
  it('returns the html untouched when the archive has no document.xml', async () => {
    const zip = new JSZip();
    zip.file('word/styles.xml', NO_STYLES);
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    expect(await readDocxSpacingFromArchive(buffer, '<p>one</p>')).toBe(
      '<p>one</p>',
    );
  });

  it('returns the html untouched when the buffer is not a zip', async () => {
    const buffer = new TextEncoder().encode('not a zip at all').buffer;

    expect(await readDocxSpacingFromArchive(buffer, '<p>one</p>')).toBe(
      '<p>one</p>',
    );
  });

  it('tolerates a missing styles.xml', async () => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      doc(para({ text: 'one', spacing: '<w:spacing w:before="240"/>' })),
    );
    const buffer = await zip.generateAsync({ type: 'arraybuffer' });

    expect(await readDocxSpacingFromArchive(buffer, '<p>one</p>')).toContain(
      'margin-top: 12pt',
    );
  });
});
