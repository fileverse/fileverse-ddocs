import { describe, afterEach, it, expect, vi } from 'vitest';
import JSZip from 'jszip';
import {
  applyDocxSpacingToHtml,
  readDocxSpacing,
  readDocxSpacingFromArchive,
  type DocxParagraphSpacing,
} from './docx-spacing';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const WP =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const V = 'urn:schemas-microsoft-com:vml';

const doc = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:wp="${WP}" xmlns:v="${V}"><w:body>${body}</w:body></w:document>`;

const styles = (inner: string) =>
  `<?xml version="1.0"?><w:styles xmlns:w="${W}">${inner}</w:styles>`;

const para = (opts: {
  style?: string;
  spacing?: string;
  text?: string;
  alignment?: string;
}) => {
  const alignXml = opts.alignment ? `<w:jc w:val="${opts.alignment}"/>` : '';
  const pPr =
    opts.style || opts.spacing || opts.alignment
      ? `<w:pPr>${opts.style ? `<w:pStyle w:val="${opts.style}"/>` : ''}${
          opts.spacing ?? ''
        }${alignXml}</w:pPr>`
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

  it('matches mammoth by contributing no text for a line break', () => {
    const xml = doc(
      `<w:p><w:r><w:t>foo</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>bar</w:t></w:r></w:p>`,
    );
    // mammoth renders <p>foo<br />bar</p>, whose textContent is "foobar".
    expect(readDocxSpacing(xml, NO_STYLES)[0].text).toBe('foobar');
  });

  it('matches mammoth by using a non-breaking hyphen for w:noBreakHyphen', () => {
    const xml = doc(
      `<w:p><w:r><w:t>a</w:t><w:noBreakHyphen/><w:t>b</w:t></w:r></w:p>`,
    );
    expect(readDocxSpacing(xml, NO_STYLES)[0].text).toBe('a‑b');
  });
});

describe('readDocxSpacing paragraph alignment', () => {
  it('reads direct w:jc alignment on paragraph', () => {
    const xml = doc(
      para({ alignment: 'center', text: 'centered' }) +
        para({ alignment: 'right', text: 'right-aligned' }) +
        para({ alignment: 'both', text: 'justified' }) +
        para({ text: 'default' }),
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result[0].textAlign).toBe('center');
    expect(result[1].textAlign).toBe('right');
    expect(result[2].textAlign).toBe('justify');
    expect(result[3].textAlign).toBeNull();
  });

  it('inherits alignment from paragraph style and basedOn chain', () => {
    const xml = doc(
      para({ style: 'CenteredStyle', text: 'styled' }) +
        para({ style: 'ChildStyle', text: 'inherited' }),
    );
    const sty = styles(
      `<w:style w:styleId="CenteredStyle"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>` +
        `<w:style w:styleId="BaseRight"><w:pPr><w:jc w:val="right"/></w:pPr></w:style>` +
        `<w:style w:styleId="ChildStyle"><w:basedOn w:val="BaseRight"/></w:style>`,
    );

    const result = readDocxSpacing(xml, sty);
    expect(result[0].textAlign).toBe('center');
    expect(result[1].textAlign).toBe('right');
  });

  it('lets direct w:jc win over style alignment', () => {
    const xml = doc(
      para({ style: 'CenteredStyle', alignment: 'right', text: 'override' }),
    );
    const sty = styles(
      `<w:style w:styleId="CenteredStyle"><w:pPr><w:jc w:val="center"/></w:pPr></w:style>`,
    );

    const result = readDocxSpacing(xml, sty);
    expect(result[0].textAlign).toBe('right');
  });

  it('detects images in paragraph', () => {
    const xml = doc(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>` +
        `<w:p><w:r><w:pict><v:shape/></w:pict></w:r></w:p>` +
        `<w:p><w:r><v:imagedata/></w:r></w:p>` +
        para({ text: 'no image' }),
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result[0].hasImage).toBe(true);
    expect(result[0].textAlign).toBe('center');
    expect(result[1].hasImage).toBe(true);
    expect(result[2].hasImage).toBe(true);
    expect(result[3].hasImage).toBe(false);
  });

  it('normalizes start/end/distribute and handles case-insensitivity and invalid values', () => {
    const xml = doc(
      para({ alignment: 'start' }) +
        para({ alignment: 'END' }) +
        para({ alignment: 'Distribute' }) +
        para({ alignment: 'LEFT' }) +
        para({ alignment: 'unknownValue' }),
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result[0].textAlign).toBe('left');
    expect(result[1].textAlign).toBe('right');
    expect(result[2].textAlign).toBe('justify');
    expect(result[3].textAlign).toBe('left');
    expect(result[4].textAlign).toBeNull();
  });

  it('inherits alignment from docDefaults', () => {
    const xml = doc(para({ text: 'plain' }));
    const sty = styles(
      `<w:docDefaults><w:pPrDefault><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrDefault></w:docDefaults>`,
    );

    expect(readDocxSpacing(xml, sty)[0].textAlign).toBe('center');
  });
});

describe('applyDocxSpacingToHtml', () => {
  const spacing = (over: Partial<DocxParagraphSpacing>) => ({
    spaceBefore: null,
    spaceAfter: null,
    lineHeight: null,
    textAlign: null,
    hasImage: false,
    text: '',
    ...over,
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  // Degrade per block rather than document-wide: mammoth relocates text boxes
  // and appends footnotes, so the two sequences can legitimately diverge. A
  // block that cannot be verified is skipped alone.
  it('keeps spacing on matched blocks when the block count diverges', () => {
    const html = '<p>one</p><p>two</p>';
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'one', spaceBefore: 12 }),
    ]);

    expect(out).toContain('margin-top: 12pt');
    expect(out).toContain('<p>two</p>');
  });

  it('skips only the block whose text diverges', () => {
    const html = '<p>one</p><p>two</p>';
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'one', spaceBefore: 12 }),
      spacing({ text: 'ELSEWHERE', spaceBefore: 12 }),
    ]);

    expect(out).toContain('margin-top: 12pt');
    expect(out).toContain('<p>two</p>');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Skipped 1 of'),
    );
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

describe('readDocxSpacing edge cases', () => {
  it('survives a basedOn cycle instead of hanging', () => {
    const xml = doc(para({ style: 'A' }));
    const sty = styles(
      `<w:style w:styleId="A"><w:basedOn w:val="B"/></w:style>` +
        `<w:style w:styleId="B"><w:basedOn w:val="A"/><w:pPr><w:spacing w:after="200"/></w:pPr></w:style>`,
    );

    expect(readDocxSpacing(xml, sty)[0].spaceAfter).toBe(10);
  });

  it('ignores a style id that does not exist', () => {
    const xml = doc(para({ style: 'Missing' }));

    expect(readDocxSpacing(xml, NO_STYLES)[0].spaceAfter).toBeNull();
  });

  it('ignores atLeast line spacing, like exact', () => {
    const xml = doc(
      para({ spacing: '<w:spacing w:line="360" w:lineRule="atLeast"/>' }),
    );

    expect(readDocxSpacing(xml, NO_STYLES)[0].lineHeight).toBeNull();
  });

  it('ignores a line value with no rule at all', () => {
    const xml = doc(para({ spacing: '<w:spacing w:line="360"/>' }));

    expect(readDocxSpacing(xml, NO_STYLES)[0].lineHeight).toBeNull();
  });

  it('clamps a negative twip value to zero', () => {
    const xml = doc(para({ spacing: '<w:spacing w:before="-500"/>' }));

    expect(readDocxSpacing(xml, NO_STYLES)[0].spaceBefore).toBe(0);
  });

  it('reads paragraphs inside table cells, in document order', () => {
    const xml = doc(
      para({ text: 'before' }) +
        `<w:tbl><w:tr><w:tc>${para({ text: 'cell', spacing: '<w:spacing w:after="200"/>' })}</w:tc></w:tr></w:tbl>` +
        para({ text: 'after' }),
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result.map((p) => p.text)).toEqual(['before', 'cell', 'after']);
    expect(result[1].spaceAfter).toBe(10);
  });

  it('returns nothing for a document with no paragraphs', () => {
    expect(readDocxSpacing(doc(''), NO_STYLES)).toEqual([]);
  });
});

describe('applyDocxSpacingToHtml alignment & image', () => {
  it('applies text-align to paragraph and heading elements', () => {
    const html = '<p>center me</p><h1>right me</h1>';
    const spacings: DocxParagraphSpacing[] = [
      {
        spaceBefore: null,
        spaceAfter: null,
        lineHeight: null,
        textAlign: 'center',
        hasImage: false,
        text: 'center me',
      },
      {
        spaceBefore: null,
        spaceAfter: null,
        lineHeight: null,
        textAlign: 'right',
        hasImage: false,
        text: 'right me',
      },
    ];

    const result = applyDocxSpacingToHtml(html, spacings);
    expect(result).toBe(
      '<p style="text-align: center;">center me</p><h1 style="text-align: right;">right me</h1>',
    );
  });

  it('sets data-align and dataalign on img inside aligned paragraph', () => {
    const html = '<p><img src="test.png"></p>';
    const spacings: DocxParagraphSpacing[] = [
      {
        spaceBefore: null,
        spaceAfter: null,
        lineHeight: null,
        textAlign: 'right',
        hasImage: true,
        text: '',
      },
    ];

    const result = applyDocxSpacingToHtml(html, spacings);
    expect(result).toContain('data-align="right"');
    expect(result).toContain('dataalign="right"');
  });

  it('defaults image data-align to start when alignment is left', () => {
    const html = '<p><img src="test.png"></p>';
    const spacings: DocxParagraphSpacing[] = [
      {
        spaceBefore: null,
        spaceAfter: null,
        lineHeight: null,
        textAlign: 'left',
        hasImage: true,
        text: '',
        runs: [],
      },
    ];

    const result = applyDocxSpacingToHtml(html, spacings);
    expect(result).toContain('data-align="start"');
  });

  it('applies color, font-size, and font-family to text nodes within paragraph', () => {
    const html = '<p><strong>Red Bold</strong> and Normal Blue</p>';
    const spacings: DocxParagraphSpacing[] = [
      {
        spaceBefore: null,
        spaceAfter: null,
        lineHeight: null,
        textAlign: null,
        hasImage: false,
        text: 'Red Bold and Normal Blue',
        runs: [
          {
            text: 'Red Bold',
            color: '#FF0000',
            fontSize: '14pt',
            fontFamily: 'Calibri',
          },
          { text: ' and ', color: null, fontSize: null, fontFamily: null },
          {
            text: 'Normal Blue',
            color: '#0000FF',
            fontSize: '18pt',
            fontFamily: 'Arial',
          },
        ],
      },
    ];

    const result = applyDocxSpacingToHtml(html, spacings);
    expect(result).toContain(
      '<strong><span style="color: rgb(255, 0, 0); font-size: 14pt; font-family: Calibri;">Red Bold</span></strong>',
    );
    expect(result).toContain(
      '<span style="color: rgb(0, 0, 255); font-size: 18pt; font-family: Arial;">Normal Blue</span>',
    );
  });
});

describe('readDocxSpacing run formatting', () => {
  it('extracts direct color, font-size, and font-family from w:rPr', () => {
    const xml = doc(
      `<w:p><w:r><w:rPr><w:color w:val="FF0000"/><w:sz w:val="32"/><w:rFonts w:ascii="Arial"/></w:rPr><w:t>Custom Run</w:t></w:r></w:p>`,
    );

    const result = readDocxSpacing(xml, NO_STYLES);
    expect(result[0].runs).toHaveLength(1);
    expect(result[0].runs[0]).toEqual({
      text: 'Custom Run',
      color: '#FF0000',
      fontSize: '16pt',
      fontFamily: 'Arial',
    });
  });

  it('inherits run formatting from character styles and basedOn chain', () => {
    const xml = doc(
      `<w:p><w:r><w:rPr><w:rStyle w:val="ChildChar"/></w:rPr><w:t>Styled Run</w:t></w:r></w:p>`,
    );
    const sty = styles(
      `<w:style w:type="character" w:styleId="BaseChar"><w:rPr><w:color w:val="0000FF"/><w:sz w:val="28"/><w:rFonts w:ascii="Georgia"/></w:rPr></w:style>` +
        `<w:style w:type="character" w:styleId="ChildChar"><w:basedOn w:val="BaseChar"/><w:rPr><w:color w:val="00FF00"/></w:rPr></w:style>`,
    );

    const result = readDocxSpacing(xml, sty);
    expect(result[0].runs[0]).toEqual({
      text: 'Styled Run',
      color: '#00FF00',
      fontSize: '14pt',
      fontFamily: 'Georgia',
    });
  });

  it('does not bake in paragraph-style run properties', () => {
    const xml = doc(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>`,
    );
    const sty = styles(
      `<w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:sz w:val="40"/><w:color w:val="2e74b5"/></w:rPr></w:style>`,
    );

    // Heading identity belongs to the block type and editor.css, not to an
    // inline span the toolbar cannot explain.
    expect(readDocxSpacing(xml, sty)[0].runs[0]).toEqual({
      text: 'Title',
      color: null,
      fontSize: null,
      fontFamily: null,
    });
  });

  it('does not bake in document default run properties', () => {
    const xml = doc(`<w:p><w:r><w:t>Body</w:t></w:r></w:p>`);
    const sty = styles(
      `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>`,
    );

    expect(readDocxSpacing(xml, sty)[0].runs[0]).toEqual({
      text: 'Body',
      color: null,
      fontSize: null,
      fontFamily: null,
    });
  });
});

describe('applyDocxSpacingToHtml block matching', () => {
  const bare = (text: string): DocxParagraphSpacing => ({
    spaceBefore: null,
    spaceAfter: null,
    lineHeight: null,
    textAlign: 'center',
    hasImage: false,
    text,
    runs: [],
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("matches a nested list by each item's own text", () => {
    const html = '<ul><li>lvl0<ul><li>lvl1</li></ul></li></ul>';
    const result = applyDocxSpacingToHtml(html, [bare('lvl0'), bare('lvl1')]);
    // Both items styled: the outer li must not be judged by "lvl0lvl1".
    expect(result.match(/text-align: center/g)).toHaveLength(2);
  });

  it('ignores mammoth footnote blocks and reference markers', () => {
    const html =
      '<p>Text with a note<sup><a href="#footnote-0" id="footnote-ref-0">[1]</a></sup>.</p>' +
      '<ol><li id="footnote-0"><p>The note body. <a href="#footnote-ref-0">↑</a></p></li></ol>';
    // One w:p in document.xml: the footnote's paragraph lives in footnotes.xml.
    const result = applyDocxSpacingToHtml(html, [bare('Text with a note.')]);
    expect(result).toContain('text-align: center');
    // The footnote body must be left alone, not styled as a second block.
    expect(result.match(/text-align: center/g)).toHaveLength(1);
  });

  it('keeps superscript that is not a footnote reference', () => {
    const html = '<p>E = mc<sup>2</sup></p>';
    const result = applyDocxSpacingToHtml(html, [bare('E = mc2')]);
    expect(result).toContain('text-align: center');
  });

  it('skips only the paragraph that does not match', () => {
    const html = '<p>one</p><p>UNEXPECTED</p><p>three</p>';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = applyDocxSpacingToHtml(html, [
      bare('one'),
      bare('two'),
      bare('three'),
    ]);
    // The first and third still line up positionally and must survive.
    expect(result.match(/text-align: center/g)).toHaveLength(2);
    expect(result).toContain('<p>UNEXPECTED</p>');
  });

  it('still applies to the blocks it can when counts differ', () => {
    const html = '<p>one</p><p>two</p><p>extra</p>';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = applyDocxSpacingToHtml(html, [bare('one'), bare('two')]);
    expect(result.match(/text-align: center/g)).toHaveLength(2);
  });
});
