import JSZip from 'jszip';
import { SPACING_MAX_PT, SPACING_MIN_PT } from '../../utils/typography';

export type DocxRunFormatting = {
  text: string;
  color: string | null;
  fontSize: string | null;
  fontFamily: string | null;
};

/**
 * Paragraph spacing and formatting read straight out of the OOXML.
 *
 * Mammoth is a *semantic* converter — its README is explicit that it uses "the
 * semantic information in the document, and ignoring other details" — so it
 * never parses presentation attributes (spacing, text color, font size, font family).
 * Structure comes from mammoth; presentation values are merged here.
 */
export type DocxParagraphSpacing = {
  spaceBefore: number | null;
  spaceAfter: number | null;
  lineHeight: string | null;
  textAlign: string | null;
  hasImage: boolean;
  /** Paragraph text, used to verify alignment against mammoth's output. */
  text: string;
  runs: DocxRunFormatting[];
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

type RawRunProperties = {
  color?: string;
  fontSize?: string;
  fontFamily?: string;
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

/** Read direct run properties (w:color, w:sz, w:rFonts) */
const readRunPropertiesElement = (
  rPr: Element | null | undefined,
): RawRunProperties => {
  if (!rPr) return {};

  const colorEl = rPr.getElementsByTagName('w:color')[0];
  const colorVal = colorEl?.getAttribute('w:val');
  let color: string | undefined;
  if (colorVal && colorVal !== 'auto') {
    color = colorVal.startsWith('#')
      ? colorVal
      : /^[0-9a-fA-F]{3,8}$/.test(colorVal)
        ? `#${colorVal}`
        : undefined;
  }

  const szEl = rPr.getElementsByTagName('w:sz')[0];
  const szVal = szEl?.getAttribute('w:val');
  let fontSize: string | undefined;
  if (szVal) {
    const parsed = Number.parseFloat(szVal);
    if (!Number.isNaN(parsed) && parsed > 0) {
      const pt = Math.round((parsed / 2) * 10) / 10;
      fontSize = `${pt}pt`;
    }
  }

  const fontEl = rPr.getElementsByTagName('w:rFonts')[0];
  const fontFamily =
    fontEl?.getAttribute('w:ascii') ||
    fontEl?.getAttribute('w:hAnsi') ||
    fontEl?.getAttribute('w:cs') ||
    undefined;

  return {
    color,
    fontSize,
    fontFamily,
  };
};

const mergeSpacing = (...layers: RawSpacing[]): RawSpacing =>
  layers.reduce<RawSpacing>((merged, layer) => {
    const next = { ...merged };
    (['before', 'after', 'line', 'lineRule', 'jc'] as const).forEach((key) => {
      if (layer[key] !== undefined) next[key] = layer[key];
    });
    return next;
  }, {});

const mergeRunProperties = (...layers: RawRunProperties[]): RawRunProperties =>
  layers.reduce<RawRunProperties>((merged, layer) => {
    const next = { ...merged };
    (['color', 'fontSize', 'fontFamily'] as const).forEach((key) => {
      if (layer[key] !== undefined) next[key] = layer[key];
    });
    return next;
  }, {});

type StyleTable = {
  docDefaults: {
    spacing: RawSpacing;
    run: RawRunProperties;
  };
  byId: Map<
    string,
    {
      type: string;
      spacing: RawSpacing;
      run: RawRunProperties;
      basedOn: string | null;
    }
  >;
};

const readStyles = (stylesXml: string): StyleTable => {
  const doc = parseXml(stylesXml);

  const defaultPPr = doc
    .getElementsByTagName('w:pPrDefault')[0]
    ?.getElementsByTagName('w:pPr')[0];

  const defaultRPr = doc
    .getElementsByTagName('w:rPrDefault')[0]
    ?.getElementsByTagName('w:rPr')[0];

  const byId = new Map<
    string,
    {
      type: string;
      spacing: RawSpacing;
      run: RawRunProperties;
      basedOn: string | null;
    }
  >();

  Array.from(doc.getElementsByTagName('w:style')).forEach((style) => {
    const id = style.getAttribute('w:styleId');
    if (!id) return;
    const type = style.getAttribute('w:type') || 'paragraph';
    byId.set(id, {
      type,
      spacing: readSpacingElement(style.getElementsByTagName('w:pPr')[0]),
      run: readRunPropertiesElement(style.getElementsByTagName('w:rPr')[0]),
      basedOn:
        style.getElementsByTagName('w:basedOn')[0]?.getAttribute('w:val') ??
        null,
    });
  });

  return {
    docDefaults: {
      spacing: readSpacingElement(defaultPPr),
      run: readRunPropertiesElement(defaultRPr),
    },
    byId,
  };
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
    seen.add(current);
    const style = styles.byId.get(current);
    if (!style) break;
    chain.unshift(style.spacing);
    current = style.basedOn;
  }

  return mergeSpacing(styles.docDefaults.spacing, ...chain);
};

const resolveRunProperties = (
  rPr: Element | null | undefined,
  characterStyleId: string | null,
  paragraphStyleId: string | null,
  styles: StyleTable,
): RawRunProperties => {
  const layers: RawRunProperties[] = [];

  // 1. Paragraph style hierarchy
  let currentP = paragraphStyleId;
  const pChain: RawRunProperties[] = [];
  const pSeen = new Set<string>();
  while (currentP && !pSeen.has(currentP)) {
    pSeen.add(currentP);
    const style = styles.byId.get(currentP);
    if (!style) break;
    pChain.unshift(style.run);
    currentP = style.basedOn;
  }
  layers.push(...pChain);

  // 2. Character style hierarchy
  let currentC = characterStyleId;
  const cChain: RawRunProperties[] = [];
  const cSeen = new Set<string>();
  while (currentC && !cSeen.has(currentC)) {
    cSeen.add(currentC);
    const style = styles.byId.get(currentC);
    if (!style) break;
    cChain.unshift(style.run);
    currentC = style.basedOn;
  }
  layers.push(...cChain);

  // 3. Direct formatting
  layers.push(readRunPropertiesElement(rPr));

  return mergeRunProperties(...layers);
};

// Character-for-character parity with mammoth matters twice: the alignment gate
// compares this text against the DOM's, and spans are placed by offset into it.
// w:tab stays a space — mammoth emits a literal tab and `normalize` collapses both.
const runText = (run: Element): string => {
  let text = '';
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const el = child as Element;
      const tagName = el.localName || el.nodeName.replace(/^w:/, '');
      if (tagName === 't') {
        text += el.textContent ?? '';
      } else if (tagName === 'tab') {
        text += ' ';
      } else if (tagName === 'noBreakHyphen') {
        text += '\u2011';
      }
    }
  }
  return text;
};

const getParagraphRuns = (
  paragraph: Element,
  paragraphStyleId: string | null,
  styles: StyleTable,
): DocxRunFormatting[] => {
  const runElements = Array.from(paragraph.getElementsByTagName('w:r'));
  return runElements
    .map((r) => {
      const rPr = r.getElementsByTagName('w:rPr')[0];
      const rStyleId =
        rPr?.getElementsByTagName('w:rStyle')[0]?.getAttribute('w:val') ?? null;
      const resolved = resolveRunProperties(
        rPr,
        rStyleId,
        paragraphStyleId,
        styles,
      );
      return {
        text: runText(r),
        color: resolved.color ?? null,
        fontSize: resolved.fontSize ?? null,
        fontFamily: resolved.fontFamily ?? null,
      };
    })
    .filter((run) => run.text.length > 0);
};

const paragraphText = (paragraph: Element): string =>
  Array.from(paragraph.getElementsByTagName('w:r'))
    .map((run) => runText(run))
    .join('');

/**
 * One entry per w:p, in document order.
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

    const runs = getParagraphRuns(paragraph, styleId, styles);

    return {
      spaceBefore: toPt(raw.before),
      spaceAfter: toPt(raw.after),
      lineHeight: toLineHeight(raw),
      textAlign: normalizeAlignment(raw.jc),
      hasImage,
      text: paragraphText(paragraph),
      runs,
    };
  });
};

/** Blocks mammoth emits that map one-to-one onto a w:p. */
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li';

/** Mammoth's footnote/endnote list. Its paragraphs come from footnotes.xml,
 *  which is not read, so they have no w:p to zip against — and the li plus its
 *  nested p would otherwise be counted twice. */
const FOOTNOTE_BLOCK_SELECTOR = 'li[id^="footnote-"], li[id^="endnote-"]';

/** The injected [1] marker. Keyed on the anchor, not on sup — a document's own
 *  superscript must survive. */
const FOOTNOTE_REF_SELECTOR = 'a[href^="#footnote-"], a[href^="#endnote-"]';

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Text this block owns directly. A nested block — a sub-list's item, a
 *  footnote's paragraph — owns its own text and is skipped, which is what keeps
 *  the comparison one-to-one with a single w:p. */
const blockOwnText = (block: Element): string => {
  let text = '';
  for (const node of Array.from(block.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      text += node.nodeValue ?? '';
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const el = node as Element;
      if (el.matches(BLOCK_SELECTOR)) continue;
      if (el.matches(FOOTNOTE_REF_SELECTOR)) continue;
      text += blockOwnText(el);
    }
  }
  return text;
};

/**
 * Apply run styling (color, fontSize, fontFamily) to DOM Text nodes within a block.
 */
export const applyRunStylesToBlock = (
  block: HTMLElement,
  runs: DocxRunFormatting[],
): void => {
  const styledRuns = runs.filter(
    (r) => r.color !== null || r.fontSize !== null || r.fontFamily !== null,
  );
  if (styledRuns.length === 0) return;

  let offset = 0;
  const intervals: { start: number; end: number; run: DocxRunFormatting }[] =
    [];
  for (const run of runs) {
    const start = offset;
    const end = offset + run.text.length;
    if (run.color || run.fontSize || run.fontFamily) {
      intervals.push({ start, end, run });
    }
    offset = end;
  }
  if (intervals.length === 0) return;

  const textNodes: Text[] = [];
  const walker = block.ownerDocument.createTreeWalker(
    block,
    4 /* NodeFilter.SHOW_TEXT */,
  );
  let tn: Node | null;
  while ((tn = walker.nextNode())) {
    textNodes.push(tn as Text);
  }

  let curOffset = 0;
  for (const node of textNodes) {
    const nodeLen = node.nodeValue ? node.nodeValue.length : 0;
    if (nodeLen === 0) continue;
    const nodeStart = curOffset;
    const nodeEnd = curOffset + nodeLen;
    curOffset = nodeEnd;

    let activeNode = node;
    let activeStart = nodeStart;

    for (const interval of intervals) {
      if (interval.end <= activeStart || interval.start >= nodeEnd) continue;

      const overlapStart = Math.max(interval.start, activeStart);
      const overlapEnd = Math.min(interval.end, nodeEnd);

      const splitOffset1 = overlapStart - activeStart;
      let targetNode = activeNode;

      if (splitOffset1 > 0) {
        targetNode = activeNode.splitText(splitOffset1);
        activeStart = overlapStart;
      }

      const overlapLen = overlapEnd - overlapStart;
      if (targetNode.nodeValue && targetNode.nodeValue.length > overlapLen) {
        const remaining = targetNode.splitText(overlapLen);
        activeNode = remaining;
        activeStart = overlapEnd;
      }

      const span = block.ownerDocument.createElement('span');
      if (interval.run.color) span.style.color = interval.run.color;
      if (interval.run.fontSize) span.style.fontSize = interval.run.fontSize;
      if (interval.run.fontFamily)
        span.style.fontFamily = interval.run.fontFamily;

      targetNode.parentNode?.replaceChild(span, targetNode);
      span.appendChild(targetNode);
    }
  }
};

/**
 * Zip spacing, alignment, image alignment, and run formatting onto mammoth's HTML.
 */
export const applyDocxSpacingToHtml = (
  html: string,
  spacings: DocxParagraphSpacing[],
): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR)).filter(
    (block) =>
      !block.matches(FOOTNOTE_BLOCK_SELECTOR) &&
      !block.closest(FOOTNOTE_BLOCK_SELECTOR),
  );

  // Positional, so every block is verified rather than trusted — mammoth
  // relocates text boxes and appends footnotes. A block that does not match is
  // skipped alone, rather than costing the whole document its formatting.
  let skipped = 0;

  blocks.forEach((block, index) => {
    const spacing = spacings[index];
    if (!spacing) {
      skipped += 1;
      return;
    }
    if (normalize(blockOwnText(block)) !== normalize(spacing.text)) {
      skipped += 1;
      return;
    }

    const { spaceBefore, spaceAfter, lineHeight, textAlign, hasImage, runs } =
      spacing;
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

    if (runs && runs.length > 0) {
      applyRunStylesToBlock(element, runs);
    }
  });

  if (skipped > 0) {
    console.warn(
      `Skipped ${skipped} of ${blocks.length} blocks while applying .docx formatting`,
    );
  }

  return doc.body.innerHTML;
};

/**
 * Read spacing, alignment, image presence, and run formatting from .docx archive
 * and apply onto mammoth's HTML.
 */
export const readDocxSpacingFromArchive = async (
  arrayBuffer: ArrayBuffer,
  html: string,
): Promise<string> => {
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);

    const documentXml = await zip.file('word/document.xml')?.async('string');
    if (!documentXml) return html;

    const stylesXml =
      (await zip.file('word/styles.xml')?.async('string')) ??
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>';

    return applyDocxSpacingToHtml(
      html,
      readDocxSpacing(documentXml, stylesXml),
    );
  } catch (error) {
    console.warn('Could not read formatting from .docx', error);
    return html;
  }
};
