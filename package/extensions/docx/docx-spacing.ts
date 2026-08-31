import JSZip from 'jszip';
import { SPACING_MAX_PT, SPACING_MIN_PT } from '../../utils/typography';

/**
 * Paragraph spacing read straight out of the OOXML.
 *
 * Mammoth is a *semantic* converter — its README is explicit that it uses "the
 * semantic information in the document, and ignoring other details" — so it
 * never parses w:spacing at all. Structure still comes from mammoth; only the
 * presentational values we model are read here, from the same arrayBuffer.
 */
export type DocxParagraphSpacing = {
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineHeight: string | null;
  textAlign: string | null;
  hasImage: boolean;
  /** Paragraph text, used to verify alignment against mammoth's output. */
  text: string;
};

/** Word measures spacing in twips — a twentieth of a point. */
const TWIPS_PER_PT = 20;

/** Auto line spacing is in 240ths of a line; ddoc stores a percentage on a
 * 120 base, so percentage = line / 240 * 120 = line / 2. */
const AUTO_LINE_PER_PERCENT = 2;

type RawSpacing = {
  before?: string;
  after?: string;
  line?: string;
  lineRule?: string;
  jc?: string;
};

const toPt = (twips: string | undefined): number | null => {
  if (twips === undefined) return null;
  const parsed = Number.parseFloat(twips);
  if (Number.isNaN(parsed)) return null;
  return Math.min(
    SPACING_MAX_PT,
    Math.max(SPACING_MIN_PT, Math.round(parsed / TWIPS_PER_PT)),
  );
};

const toLineHeight = (raw: RawSpacing): string | null => {
  // 'exact' and 'atLeast' are absolute measurements with no multiplier
  // equivalent, and ddoc's lineHeight is a percentage — so they are dropped
  // rather than guessed at from an assumed font size.
  if (raw.line === undefined || raw.lineRule !== 'auto') return null;
  const parsed = Number.parseFloat(raw.line);
  if (Number.isNaN(parsed)) return null;
  return `${Math.round(parsed / AUTO_LINE_PER_PERCENT)}%`;
};

const normalizeAlignment = (val?: string): string | null => {
  if (!val) return null;
  switch (val.toLowerCase()) {
    case 'left':
    case 'start':
      return 'left';
    case 'center':
      return 'center';
    case 'right':
    case 'end':
      return 'right';
    case 'both':
    case 'distribute':
      return 'justify';
    default:
      return null;
  }
};

const parseXml = (xml: string): Document =>
  new DOMParser().parseFromString(xml, 'application/xml');

/** The w:spacing child of a w:pPr, as raw attributes. */
const readSpacingElement = (pPr: Element | null | undefined): RawSpacing => {
  const spacing = pPr?.getElementsByTagName('w:spacing')[0];
  const jc =
    pPr?.getElementsByTagName('w:jc')[0]?.getAttribute('w:val') ?? undefined;

  const attr = (name: string) => {
    const value = spacing?.getAttribute(`w:${name}`);
    return value === null ? undefined : value;
  };
  return {
    before: attr('before'),
    after: attr('after'),
    line: attr('line'),
    lineRule: attr('lineRule'),
    jc,
  };
};

/** Later layers win, but attribute by attribute — a style supplying only
 * w:before must survive direct formatting that supplies only w:after. */
const mergeSpacing = (...layers: RawSpacing[]): RawSpacing =>
  layers.reduce<RawSpacing>((merged, layer) => {
    const next = { ...merged };
    (['before', 'after', 'line', 'lineRule', 'jc'] as const).forEach((key) => {
      if (layer[key] !== undefined) next[key] = layer[key];
    });
    return next;
  }, {});

type StyleTable = {
  docDefaults: RawSpacing;
  byId: Map<string, { spacing: RawSpacing; basedOn: string | null }>;
};

const readStyles = (stylesXml: string): StyleTable => {
  const doc = parseXml(stylesXml);

  const defaultPPr = doc
    .getElementsByTagName('w:pPrDefault')[0]
    ?.getElementsByTagName('w:pPr')[0];

  const byId = new Map<
    string,
    { spacing: RawSpacing; basedOn: string | null }
  >();

  Array.from(doc.getElementsByTagName('w:style')).forEach((style) => {
    const id = style.getAttribute('w:styleId');
    if (!id) return;
    byId.set(id, {
      spacing: readSpacingElement(style.getElementsByTagName('w:pPr')[0]),
      basedOn:
        style.getElementsByTagName('w:basedOn')[0]?.getAttribute('w:val') ??
        null,
    });
  });

  return { docDefaults: readSpacingElement(defaultPPr), byId };
};

/** Walk basedOn to the root, then merge back down so the nearest style wins. */
const resolveStyleSpacing = (
  styleId: string | null,
  styles: StyleTable,
): RawSpacing => {
  const chain: RawSpacing[] = [];
  const seen = new Set<string>();
  let current = styleId;

  while (current && !seen.has(current)) {
    seen.add(current); // a malformed basedOn cycle must not hang the import
    const style = styles.byId.get(current);
    if (!style) break;
    chain.unshift(style.spacing);
    current = style.basedOn;
  }

  return mergeSpacing(styles.docDefaults, ...chain);
};

const paragraphText = (paragraph: Element): string =>
  Array.from(paragraph.getElementsByTagName('w:t'))
    .map((node) => node.textContent ?? '')
    .join('');

/**
 * One entry per w:p, in document order — the same order mammoth emits its
 * blocks in, which is what makes them zippable.
 */
export const readDocxSpacing = (
  documentXml: string,
  stylesXml: string,
): DocxParagraphSpacing[] => {
  const styles = readStyles(stylesXml);
  const doc = parseXml(documentXml);

  return Array.from(doc.getElementsByTagName('w:p')).map((paragraph) => {
    const pPr = paragraph.getElementsByTagName('w:pPr')[0];
    const styleId =
      pPr?.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? null;

    const raw = mergeSpacing(
      resolveStyleSpacing(styleId, styles),
      readSpacingElement(pPr),
    );

    const hasImage =
      paragraph.getElementsByTagName('w:drawing').length > 0 ||
      paragraph.getElementsByTagName('w:pict').length > 0 ||
      paragraph.getElementsByTagName('v:imagedata').length > 0;

    return {
      spaceBefore: toPt(raw.before),
      spaceAfter: toPt(raw.after),
      lineHeight: toLineHeight(raw),
      textAlign: normalizeAlignment(raw.jc),
      hasImage,
      text: paragraphText(paragraph),
    };
  });
};

/** Blocks mammoth emits that map one-to-one onto a w:p. */
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Zip the spacing onto mammoth's HTML as inline styles, which the LineHeight
 * and ParagraphSpacing attributes already parse back on import.
 *
 * Alignment is positional, so it is verified rather than trusted: mammoth
 * relocates text boxes and appends footnotes, and `ignoreEmptyParagraphs`
 * has to stay off for the counts to line up at all. On any divergence the
 * HTML is returned untouched — no spacing is better than spacing on the
 * wrong paragraphs, which is silent and hard to trace.
 */
export const applyDocxSpacingToHtml = (
  html: string,
  spacings: DocxParagraphSpacing[],
): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR));

  if (blocks.length !== spacings.length) return html;

  const aligned = blocks.every(
    (block, index) =>
      normalize(block.textContent ?? '') === normalize(spacings[index].text),
  );
  if (!aligned) return html;

  blocks.forEach((block, index) => {
    const { spaceBefore, spaceAfter, lineHeight, textAlign, hasImage } =
      spacings[index];
    const element = block as HTMLElement;
    if (spaceBefore !== null) element.style.marginTop = `${spaceBefore}pt`;
    if (spaceAfter !== null) element.style.marginBottom = `${spaceAfter}pt`;
    if (lineHeight !== null) element.style.lineHeight = lineHeight;
    if (textAlign !== null) element.style.textAlign = textAlign;

    if (hasImage || element.querySelectorAll('img').length > 0) {
      const images = element.querySelectorAll('img');
      images.forEach((img) => {
        const align =
          textAlign === 'center'
            ? 'center'
            : textAlign === 'right'
              ? 'right'
              : 'start';
        img.setAttribute('data-align', align);
        img.setAttribute('dataalign', align);
      });
    }
  });

  return doc.body.innerHTML;
};

/**
 * Read the spacing out of the .docx archive and zip it onto mammoth's HTML.
 *
 * Reuses the arrayBuffer mammoth is already given, so the file is not read
 * twice. Every failure path returns the original HTML: losing spacing is
 * recoverable, losing the import is not.
 */
export const readDocxSpacingFromArchive = async (
  arrayBuffer: ArrayBuffer,
  html: string,
): Promise<string> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);

    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return html;

    // styles.xml is optional — a document can carry direct formatting only.
    const stylesXml =
      (await zip.file('word/styles.xml')?.async('string')) ??
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>';

    return applyDocxSpacingToHtml(
      html,
      readDocxSpacing(documentXml, stylesXml),
    );
  } catch (error) {
    // Reported, not swallowed silently: a failure here is invisible in the
    // imported document (spacing simply does not appear) and is otherwise
    // very hard to tell apart from a document that had no spacing.
    console.warn('Could not read spacing from .docx', error);
    return html;
  }
};
