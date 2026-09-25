import { JSONContent } from '@tiptap/core';
import { Editor } from '@tiptap/react';
import { searchForSecureImageNodeAndEmbedImageContent } from '../extensions/mardown-paste-handler';
import { IpfsImageFetchPayload } from '../types';
import { dedupeResolvedExtensions } from './helpers';

/**
 * Splits a ProseMirror document straight into per-slide documents.
 *
 * The existing presentation pipeline goes doc -> HTML -> Markdown -> HTML,
 * which silently drops every construct Markdown cannot express: multi-column
 * blocks, paragraph-level font sizes, callouts and other custom nodes. This
 * module walks the document nodes instead, so a slide is always a real
 * ProseMirror doc and nothing is lost on the way to the stage.
 */

export interface DocToSlidesOptions {
  /** Soft cap on rendered lines before a slide is broken. */
  maxLinesPerSlide?: number;
  /** Soft cap on characters before a slide is broken. */
  maxCharsPerSlide?: number;
  /** Soft cap on words before a slide is broken. */
  maxWordsPerSlide?: number;
  /** Characters that fit on one rendered line, used to estimate wrapping. */
  charsPerLine?: number;
  /**
   * Whether to guess at overflow from character and line counts. Disabled when
   * the deck will afterwards be measured against the real stage, since counting
   * characters splits slides that visibly had room to spare.
   */
  applyOverflowLimits?: boolean;
}

/** The slide stage: 1080px wide, 16/9, with `py-[48px]` above and below. */
const STAGE_WIDTH_PX = 1080;
const STAGE_HEIGHT_PX = Math.round((STAGE_WIDTH_PX * 9) / 16);
const STAGE_VERTICAL_PADDING_PX = 96;
const STAGE_CONTENT_HEIGHT_PX = STAGE_HEIGHT_PX - STAGE_VERTICAL_PADDING_PX;

export const SLIDE_SPLIT_DEFAULTS: Required<DocToSlidesOptions> = {
  maxLinesPerSlide: 7,
  maxCharsPerSlide: 1000,
  maxWordsPerSlide: 250,
  charsPerLine: 60,
  applyOverflowLimits: true,
};

/** Top-level nodes are wrapped in dBlock; unwrap to the node that matters. */
const getInnerNode = (node: JSONContent): JSONContent =>
  node?.type === 'dBlock' && node.content?.length ? node.content[0] : node;

const getNodeText = (node?: JSONContent): string => {
  if (!node) return '';
  if (node.type === 'text') return node.text ?? '';
  if (!node.content?.length) return '';
  return node.content.map(getNodeText).join('');
};

const countWords = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

const MEDIA_TYPES = new Set([
  'resizableMedia',
  'image',
  'secureImage',
  'iframe',
  'twitterEmbed',
]);

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

const isHeading = (node: JSONContent, level: number): boolean =>
  node.type === 'heading' && node.attrs?.level === level;

const isMedia = (node: JSONContent): boolean =>
  MEDIA_TYPES.has(node.type ?? '');

/**
 * Nodes worth a slide even with no text of their own. Everything else that is
 * textless is padding — the trailing-node extension keeps an empty paragraph
 * at the end of every document, which must not become a blank final slide.
 */
const RENDERS_WITHOUT_TEXT = new Set([
  ...MEDIA_TYPES,
  'table',
  'horizontalRule',
  'codeBlock',
]);

const hasRenderableContent = (node?: JSONContent): boolean => {
  if (!node) return false;
  if (RENDERS_WITHOUT_TEXT.has(node.type ?? '')) return true;
  if (node.type === 'text' && (node.text ?? '').trim().length > 0) return true;
  return (node.content ?? []).some(hasRenderableContent);
};

/**
 * Rough height of a node in "lines". Headings and media are weighted heavier
 * because the presentation stylesheet renders them much larger than body text.
 */
const estimateLines = (node: JSONContent, charsPerLine: number): number => {
  const inner = getInnerNode(node);

  switch (inner.type) {
    case 'heading':
      return inner.attrs?.level === 1 ? 3 : inner.attrs?.level === 2 ? 2 : 1;

    case 'table':
      return (inner.content?.length ?? 1) + 1;

    case 'codeBlock':
      return Math.max(1, getNodeText(inner).split('\n').length);

    case 'columns':
      // Columns sit side by side, so the block is only as tall as its
      // tallest column rather than the sum of all of them.
      return Math.max(
        1,
        ...(inner.content ?? []).map((column) =>
          (column.content ?? []).reduce(
            (sum, child) => sum + estimateLines(child, charsPerLine),
            0,
          ),
        ),
      );

    default:
      break;
  }

  if (isMedia(inner)) return 4;

  if (LIST_TYPES.has(inner.type ?? '')) {
    return Math.max(1, inner.content?.length ?? 1);
  }

  const text = getNodeText(inner);
  return Math.max(1, Math.ceil(text.length / charsPerLine));
};

interface SlideAccumulator {
  blocks: JSONContent[];
  lines: number;
  chars: number;
  words: number;
}

const emptyAccumulator = (): SlideAccumulator => ({
  blocks: [],
  lines: 0,
  chars: 0,
  words: 0,
});

const toSlideDoc = (blocks: JSONContent[]): JSONContent => ({
  type: 'doc',
  content: blocks,
});

/**
 * A slide holding nothing but a single media node is rendered edge to edge
 * rather than as body content, matching the previous `solo-slide-image`
 * behaviour of the Markdown pipeline.
 */
export const isSoloMediaSlide = (slide: JSONContent): boolean => {
  const blocks = slide.content ?? [];
  if (blocks.length !== 1) return false;
  return isMedia(getInnerNode(blocks[0]));
};

export const splitDocIntoSlides = (
  doc: JSONContent,
  options: DocToSlidesOptions = {},
): JSONContent[] => {
  const {
    maxLinesPerSlide,
    maxCharsPerSlide,
    maxWordsPerSlide,
    charsPerLine,
    applyOverflowLimits,
  } = { ...SLIDE_SPLIT_DEFAULTS, ...options };

  const slides: JSONContent[] = [];
  let current = emptyAccumulator();

  const flush = () => {
    if (current.blocks.length > 0) {
      slides.push(toSlideDoc(current.blocks));
    }
    current = emptyAccumulator();
  };

  const push = (block: JSONContent) => {
    const inner = getInnerNode(block);
    const text = getNodeText(inner);
    current.blocks.push(block);
    current.lines += estimateLines(block, charsPerLine);
    current.chars += text.length;
    current.words += countWords(text);
  };

  const overflows = (block: JSONContent): boolean => {
    if (current.blocks.length === 0) return false;
    const inner = getInnerNode(block);
    const text = getNodeText(inner);
    return (
      current.lines + estimateLines(block, charsPerLine) > maxLinesPerSlide ||
      current.chars + text.length > maxCharsPerSlide ||
      current.words + countWords(text) > maxWordsPerSlide
    );
  };

  (doc.content ?? []).forEach((block) => {
    const inner = getInnerNode(block);

    // Explicit author-controlled break; the node itself is not rendered.
    if (inner.type === 'pageBreak') {
      flush();
      return;
    }

    // A heading opens a new slide and sits at the top of it. Whatever follows
    // packs in underneath for as long as there is room, so a title and its
    // content stay together instead of the title being stranded alone.
    if (isHeading(inner, 1) || isHeading(inner, 2)) {
      flush();
      push(block);
      return;
    }

    // Without measurement the only way to keep a full-bleed image slide from
    // absorbing the text around it is to promote it eagerly. When the deck is
    // measured afterwards, real overflow decides instead.
    if (applyOverflowLimits && isMedia(inner) && current.blocks.length === 0) {
      slides.push(toSlideDoc([block]));
      return;
    }

    if (applyOverflowLimits && overflows(block)) flush();
    push(block);
  });

  flush();

  return slides.filter(hasRenderableContent);
};

/**
 * Whether the environment performs layout. jsdom parses markup but reports
 * every height as 0, so measurement has to fall back to the estimates there.
 */
const canMeasureLayout = (): boolean => {
  if (typeof document === 'undefined' || !document.body) return false;

  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;left:-99999px;top:0;width:100px;';
  probe.innerHTML = '<p style="height:10px">probe</p>';
  document.body.appendChild(probe);

  const measurable = probe.scrollHeight > 0;
  probe.remove();

  return measurable;
};

/**
 * Hidden stand-in for the slide stage, styled identically so measurements
 * reflect what the presentation will actually render.
 */
const createStageMeasurementHost = (fontScale: number) => {
  const host = document.createElement('div');
  host.className = 'presentation-mode';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `
    position: absolute;
    left: -99999px;
    top: 0;
    width: ${STAGE_WIDTH_PX}px;
    visibility: hidden;
    pointer-events: none;
  `;
  host.style.setProperty('--slide-font-scale', String(fontScale));

  const content = document.createElement('div');
  content.className = 'ProseMirror';
  host.appendChild(content);
  document.body.appendChild(host);

  return { host, content };
};

/**
 * Descends through single-child wrappers to the element whose children can
 * actually be divided. A slide holding one list arrives as
 * `div > ul > li…`, so the list items are the only useful break points.
 */
/**
 * Breaking these apart would destroy the layout rather than paginate it: the
 * two halves of a side-by-side block belong on the same slide, and a table
 * split mid-way loses its header row.
 */
const NEVER_DIVIDE_SELECTOR =
  '[data-type="columns"], [data-type="column"], table';

/** Only list items are safe to paginate between. */
const DIVISIBLE_TAGS = new Set(['UL', 'OL']);

const findDivisibleElement = (root: Element): Element | null => {
  let node: Element | null = root;

  while (node) {
    if (node.matches(NEVER_DIVIDE_SELECTOR)) return null;

    if (DIVISIBLE_TAGS.has(node.tagName) && node.children.length > 1) {
      return node;
    }

    if (node.children.length !== 1) return null;

    node = node.firstElementChild;
  }

  return null;
};

/** A block whose only real content is a heading. */
const isHeadingBlock = (element: Element): boolean =>
  /^H[1-6]$/.test(element.tagName) ||
  !!element.querySelector('h1, h2, h3, h4, h5, h6');

/** Rebuilds a block keeping only children in `[from, to)`. */
const withChildRange = (html: string, from: number, to: number): string => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  const root = wrapper.firstElementChild;
  if (!root) return html;

  const target = findDivisibleElement(root);
  if (!target) return html;

  Array.from(target.children).forEach((child, index) => {
    if (index < from || index >= to) child.remove();
  });

  // Keep numbering continuous when an ordered list spans slides.
  if (target.tagName === 'OL' && from > 0) {
    const start = Number(target.getAttribute('start') ?? '1');
    target.setAttribute('start', String(start + from));
  }

  return wrapper.innerHTML;
};

/**
 * Divides one oversized block — typically a long list — by breaking between
 * its children rather than letting it run off the slide.
 *
 * `precedingHtml` is whatever already sits on the slide, so the split accounts
 * for the space a heading above it has already used.
 */
const divideToFit = (
  html: string,
  precedingHtml: string,
  heightOf: (html: string) => number,
): { head: string; tail: string } | null => {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;

  const root = wrapper.firstElementChild;
  if (!root) return null;

  const target = findDivisibleElement(root);
  if (!target) return null;

  const total = target.children.length;
  if (total <= 1) return null;

  let take = total - 1;
  while (
    take >= 1 &&
    heightOf(precedingHtml + withChildRange(html, 0, take)) >
      STAGE_CONTENT_HEIGHT_PX
  ) {
    take--;
  }

  // Not even one child fits alongside what is already there.
  if (take < 1) return null;

  return {
    head: withChildRange(html, 0, take),
    tail: withChildRange(html, take, total),
  };
};

/**
 * Breaks slides that genuinely overflow the stage, and only those.
 *
 * Character and line counts are a poor proxy for height: they split slides
 * that plainly had room left. Measuring the rendered result means a title and
 * its content stay on one slide whenever they actually fit.
 */
export const fitSlidesToStage = (
  slides: string[],
  fontScale: number = 1,
): string[] => {
  if (slides.length === 0 || !canMeasureLayout()) return slides;

  const { host, content } = createStageMeasurementHost(fontScale);

  const heightOf = (html: string): number => {
    content.innerHTML = html;
    return content.scrollHeight;
  };

  const htmlOf = (elements: Element[]): string =>
    elements.map((element) => element.outerHTML).join('');

  try {
    const fitted: string[] = [];
    const pending = [...slides];

    while (pending.length > 0) {
      const slide = pending.shift() as string;

      const measuredHeight = heightOf(slide);

      if (measuredHeight <= STAGE_CONTENT_HEIGHT_PX) {
        fitted.push(slide);
        continue;
      }

      const container = document.createElement('div');
      container.innerHTML = slide;
      const blocks = Array.from(container.children);

      // One oversized block, typically a long list: break between its
      // children instead of letting it run off the slide.
      if (blocks.length <= 1) {
        const divided = divideToFit(slide, '', heightOf);

        if (divided) {
          fitted.push(divided.head);
          pending.unshift(divided.tail);
        } else {
          // Genuinely indivisible — a single paragraph or image that is
          // simply taller than the stage.
          fitted.push(slide);
        }

        continue;
      }

      // Largest run of whole blocks that still fits.
      let fitCount = blocks.length - 1;
      while (
        fitCount > 0 &&
        heightOf(htmlOf(blocks.slice(0, fitCount))) > STAGE_CONTENT_HEIGHT_PX
      ) {
        fitCount--;
      }

      const headHtml = htmlOf(blocks.slice(0, fitCount));
      const nextBlock = blocks[fitCount];

      // Whole blocks alone would strand a heading on a slide of its own with
      // its content pushed to the next one. Carry as much of the following
      // block as the remaining space allows.
      const carried = nextBlock
        ? divideToFit(nextBlock.outerHTML, headHtml, heightOf)
        : null;

      if (carried) {
        fitted.push(headHtml + carried.head);
        pending.unshift(carried.tail + htmlOf(blocks.slice(fitCount + 1)));
        continue;
      }

      // The next block cannot be divided — a columns layout, a table, an
      // image. If everything that fits so far is just headings, keep them with
      // that block and accept the overflow: a title alone on a slide with its
      // content on the next one is a worse outcome than a slide that runs a
      // little long.
      if (nextBlock && blocks.slice(0, fitCount).every(isHeadingBlock)) {
        fitted.push(htmlOf(blocks.slice(0, fitCount + 1)));
        pending.unshift(htmlOf(blocks.slice(fitCount + 1)));
        continue;
      }

      // Otherwise emit at least one whole block so the remainder always
      // shrinks and the loop terminates.
      const emitCount = Math.max(fitCount, 1);
      fitted.push(htmlOf(blocks.slice(0, emitCount)));
      pending.unshift(htmlOf(blocks.slice(emitCount)));
    }

    return fitted;
  } finally {
    host.remove();
  }
};

export interface BuildSlidesOptions extends DocToSlidesOptions {
  /** Current presenter font scale, so measurement matches what is on screen. */
  fontScale?: number;
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
}

/**
 * The font size in effect for a node's first run of text.
 *
 * Sizes arrive two ways: as a `textStyle` mark on the text itself, and as an
 * attribute on the paragraph. Both are checked, nearest first.
 */
const firstFontSize = (node?: JSONContent): string | null => {
  if (!node) return null;

  const markSize = node.marks?.find(
    (mark) => mark.type === 'textStyle' && mark.attrs?.fontSize,
  )?.attrs?.fontSize;
  if (markSize) return String(markSize);

  if (node.attrs?.fontSize) return String(node.attrs.fontSize);

  for (const child of node.content ?? []) {
    const found = firstFontSize(child);
    if (found) return found;
  }

  return null;
};

/**
 * Copies each list item's own text size onto the item.
 *
 * A native list marker is sized by its `<li>`, but an explicit size lives on
 * the mark or paragraph inside it. The marker therefore kept the base size
 * while its text grew, and the mismatch widened as the presenter font scale
 * went up. Giving the item the same size lets the marker follow its text.
 */
export const matchListMarkersToText = (node: JSONContent): JSONContent => {
  const content = node.content?.map(matchListMarkersToText);

  if (node.type !== 'listItem') {
    return content ? { ...node, content } : node;
  }

  const fontSize = firstFontSize(node);

  return {
    ...node,
    ...(content ? { content } : {}),
    ...(fontSize ? { attrs: { ...node.attrs, fontSize } } : {}),
  };
};

/**
 * Makes explicitly-sized text obey the presenter font scale.
 *
 * An inline `font-size` beats any stylesheet rule, so text carrying its own
 * size ignored the scale entirely while everything around it grew and shrank.
 * Rewriting the value into the same multiplication the stylesheet uses puts
 * both under one control.
 *
 * Values already expressed as `calc(...)` are left alone: the pattern requires
 * a digit after the colon, so it cannot wrap its own output twice.
 */
export const scaleInlineFontSizes = (html: string): string =>
  html.replace(
    /font-size:\s*(-?[\d.]+)(px|rem|em|pt)/gi,
    (_match, value, unit) =>
      `font-size: calc(var(--slide-font-scale, 1) * ${value}${unit})`,
  );

/**
 * Serialises slide documents back to HTML through the editor's own schema.
 *
 * Round-tripping via renderHTML/parseHTML is lossless by construction, so
 * columns, font sizes and other custom nodes survive — unlike the Markdown
 * detour this replaces. Slides stay `string[]`, which keeps the preview panel,
 * PDF export and share links working unchanged.
 */
const renderSlideDocsToHtml = (
  editor: Editor,
  slideDocs: JSONContent[],
): string[] => {
  const temporaryEditor = new Editor({
    extensions: dedupeResolvedExtensions(
      editor.extensionManager.extensions,
    ).filter(
      (extension) =>
        ![
          'collaboration',
          'aiAutocomplete',
          // suggestionTracking's filterTransaction rejects every doc-changing
          // transaction while the source editor is in suggestion mode, which
          // would silently leave each slide empty.
          'suggestionTracking',
        ].includes(extension.name),
    ),
  });

  try {
    return slideDocs.map((slideDoc) => {
      temporaryEditor.commands.setContent(matchListMarkersToText(slideDoc));
      return scaleInlineFontSizes(temporaryEditor.getHTML());
    });
  } finally {
    temporaryEditor.destroy();
  }
};

/**
 * Builds the presentation deck straight from the editor document.
 *
 * Secure images are still inlined first, matching the behaviour of the
 * Markdown pipeline this supersedes, so IPFS-backed images render on a slide.
 */
export const buildSlidesFromDoc = async (
  editor: Editor,
  options: BuildSlidesOptions = {},
): Promise<string[]> => {
  const {
    ipfsImageFetchFn,
    fetchV1ImageFn,
    fontScale = 1,
    ...splitOptions
  } = options;

  const docWithEmbeddedImages =
    await searchForSecureImageNodeAndEmbedImageContent(
      editor.state.doc,
      ipfsImageFetchFn,
      fetchV1ImageFn,
      true,
    );

  // When the stage can be measured, structural breaks are the only ones worth
  // guessing at — real overflow decides the rest.
  const measurable = canMeasureLayout();

  const slideDocs = splitDocIntoSlides(docWithEmbeddedImages.toJSON(), {
    applyOverflowLimits: !measurable,
    ...splitOptions,
  });

  if (slideDocs.length === 0) return [];

  const slidesHtml = renderSlideDocsToHtml(editor, slideDocs);

  return measurable ? fitSlidesToStage(slidesHtml, fontScale) : slidesHtml;
};
