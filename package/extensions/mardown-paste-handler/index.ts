/* eslint-disable @typescript-eslint/no-explicit-any */
import { Editor, Extension, InputRule } from '@tiptap/core';
import MarkdownIt from 'markdown-it';
import { Plugin, TextSelection } from 'prosemirror-state';
import DOMPurify from 'dompurify';
import {
  Fragment,
  DOMParser as ProseMirrorDOMParser,
  Node as PMNode,
  Slice,
} from 'prosemirror-model';
import markdownItFootnote from 'markdown-it-footnote';
import TurndownService from 'turndown';
import { arrayBufferToBase64, decryptImage } from '../../utils/security';
import { DEFAULT_LINE_HEIGHT } from '../line-height';
import { toByteArray } from 'base64-js';
import { inlineLoader } from '../../utils/inline-loader';
import { IpfsImageFetchPayload, IpfsImageUploadResponse } from '../../types';
import { isLikelyLatex } from '../../utils/is-likely-latex';
import { sanitizeCustomCss } from '../../utils/sanitize-css';
import { getTemporaryEditor } from '../../utils/helpers';
import { resolveEditorColorVars } from '../../utils/colors';
import {
  compressImage,
  getCompressedBase64Image,
  isValidBase64Image,
} from '../../utils/image-compression';
import { markdownHtmlGuardPlugin } from './mark-down-html-guard-plugin';
import { parseHeadingLink } from '../../utils/heading-link';
import { isAllowedEmbedSrc } from '../../utils/is-allowed-embed-src';
import { shieldMathRegions } from '../../utils/math-region-shield';
import { TWITTER_REGEX } from '../../constants/twitter';
import {
  escapeOutsideMath,
  hasMathRegions,
} from '../../utils/math-aware-escape';
import {
  isSvgDataUri,
  decodeSvgDataUri,
  sanitizeSvgForEmbed,
  encodeSvgToDataUri,
  stripStyleBlocksOutsideSvg,
} from '../../utils/svg-embed';

// Initialize MarkdownIt for converting Markdown back to HTML with footnote support.
const markdownIt = new MarkdownIt({ html: true })
  .use(markdownItFootnote)
  .use(markdownHtmlGuardPlugin);

// Initialize TurndownService for converting HTML to Markdown
export const turndownService = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

const getPrefix = (node: TurndownService.Node) => {
  const prefix = node.nodeName;
  if (!prefix) return '';

  switch (node.nodeName) {
    case 'H1':
      return '#';
    case 'H2':
      return '##';
    case 'H3':
      return '###';
    default:
      return '';
  }
};

turndownService.addRule('heading', {
  filter: ['h1', 'h2', 'h3'],
  replacement: function (content, node) {
    const prefix = getPrefix(node);
    const replacedContent = content.replace(/\n\n===\n\n/g, '<br>');
    return `${prefix} ${replacedContent}`;
  },
});

// Block-level styling (alignment from TextAlign, margins from ParagraphSpacing,
// line-height from LineHeight) has no markdown representation, so in styles mode
// a styled block is emitted as raw HTML carrying them all. The inner content
// stays HTML — CommonMark does not parse markdown inside a block-level HTML
// element — and each extension's parseHTML reads its property back on import.
// Plain .md export drops block styles (markdown purity).
//
// One rule for all three properties, not one rule each: turndown picks a single
// replacement per node, so competing rules would silently drop whichever lost.
//
// Only non-default values are emitted, and that gate is load-bearing. Every
// block carries a line-height (LineHeight defaults to 138%), so emitting
// unconditionally would route the entire document through this rule and turn
// the whole export — and the Split View pane — into raw HTML. left/start is the
// visual default for alignment, so it counts as unstyled too.
// Added after 'heading' so it wins for styled headings; unstyled blocks fall
// through to '#'/paragraph handling.
const styledBlockDeclarations = (element: HTMLElement): string[] => {
  const declarations: string[] = [];
  const align = element.style?.textAlign;
  if (align && align !== 'left' && align !== 'start') {
    declarations.push(`text-align: ${align}`);
  }
  const marginTop = element.style?.marginTop;
  if (marginTop) declarations.push(`margin-top: ${marginTop}`);
  const marginBottom = element.style?.marginBottom;
  if (marginBottom) declarations.push(`margin-bottom: ${marginBottom}`);
  const lineHeight = element.style?.lineHeight;
  if (lineHeight && lineHeight !== DEFAULT_LINE_HEIGHT) {
    declarations.push(`line-height: ${lineHeight}`);
  }
  return declarations;
};

// No 'LI': the custom 'listItem' rule below is registered later, and turndown
// checks later rules first, so it always wins for <li>. Carrying list-item
// spacing would mean emitting the whole <ul>/<ol> as raw HTML rather than a
// markdown list — a bigger trade than this rule should make on its own.
// Consequence: list-item spacing does not survive .md export or the Split View
// round-trip, though it is fine in the editor, HTML export, and PDF.
const STYLED_BLOCK_TAGS = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P'];

turndownService.addRule('blockStyle', {
  filter: (node) => {
    if (!emitInlineStyles) return false;
    if (!STYLED_BLOCK_TAGS.includes(node.nodeName)) return false;
    return styledBlockDeclarations(node as HTMLElement).length > 0;
  },
  replacement: function (_content, node) {
    const el = node as HTMLElement;
    const tag = el.nodeName.toLowerCase();
    const style = styledBlockDeclarations(el).join('; ');
    return `\n\n<${tag} style="${style}">${el.innerHTML}</${tag}>\n\n`;
  },
});

// Add this new rule after the other turndownService rules
turndownService.addRule('taskListItem', {
  filter: (node) => {
    const parent = node.parentElement;
    return (
      node.nodeName === 'LI' && parent?.getAttribute('data-type') === 'taskList'
    );
  },
  replacement: function (content, node) {
    const isChecked =
      (node as HTMLElement).getAttribute('data-checked') === 'true';
    content = content
      .replace(/^\n+/, '') // remove leading newlines
      .replace(/\n+$/, '') // remove trailing newlines
      .replace(/\n\s*/gm, '\n') // normalize all newlines to single space
      .replace(/\n/gm, '\n    '); // indent
    return `- [${isChecked ? 'x' : ' '}] ${content}${
      node.nextSibling ? '\n' : ''
    }`;
  },
});

// Custom rule for page breaks
turndownService.addRule('pageBreak', {
  filter: function (node) {
    return (
      node.nodeName === 'BR' &&
      (node as HTMLElement).getAttribute('data-page-break') === 'true'
    );
  },
  replacement: function () {
    return omitPageBreaks ? '' : '\n\n===\n\n';
  },
});

// Custom rule for tables
turndownService.addRule('table', {
  filter: 'table',
  replacement: function (_content, node) {
    const table = node as HTMLTableElement;
    const rows = Array.from(table.rows);

    // Process header
    const headers = Array.from(rows[0].cells).map((cell) => {
      inTableCell = true;
      try {
        return turndownService.turndown(cell.innerHTML).trim();
      } finally {
        inTableCell = false;
      }
    });
    const maxColumnWidths = headers.map((header) => header.length);

    // Process body and update maxColumnWidths
    const bodyRows = rows.slice(1).map((row) => {
      return Array.from(row.cells).map((cell, index) => {
        let cellContent = cell.innerHTML.trim();

        // Handle lists
        if (cell.querySelector('ul, ol')) {
          const listType = cell.querySelector('ul') ? 'ul' : 'ol';
          const listItems = Array.from(cell.querySelectorAll('li')).map(
            (li) => li.textContent?.trim() || '',
          );
          cellContent = `<${listType}><li>${listItems.join(
            '</li><li>',
          )}</li></${listType}>`;
        } else {
          inTableCell = true;
          try {
            cellContent = turndownService.turndown(cellContent);
          } finally {
            inTableCell = false;
          }
        }

        maxColumnWidths[index] = Math.max(
          maxColumnWidths[index],
          cellContent.length,
        );
        return cellContent;
      });
    });

    // Create aligned rows
    const createAlignedRow = (row: string[]) => {
      return (
        '| ' +
        row
          .map((cell, index) => {
            const padding = ' '.repeat(
              Math.max(0, maxColumnWidths[index] - cell.length),
            );
            return cell + padding;
          })
          .join(' | ') +
        ' |'
      );
    };

    const headerRow = createAlignedRow(headers);
    const separator =
      '| ' +
      maxColumnWidths.map((width) => '-'.repeat(width)).join(' | ') +
      ' |';
    const bodyRowsFormatted = bodyRows.map((row) => createAlignedRow(row));

    return `\n\n${headerRow}\n${separator}\n${bodyRowsFormatted.join(
      '\n',
    )}\n\n`;
  },
});

// Custom rule for inline code
turndownService.addRule('inlineCode', {
  filter: function (node) {
    return node.nodeName === 'CODE' && node.parentNode?.nodeName !== 'PRE';
  },
  replacement: function (content) {
    return '`' + content + '`';
  },
});

turndownService.addRule('listItem', {
  filter: 'li',
  replacement: function (content, node, options) {
    content = content
      .replace(/^\n+/, '') // remove leading newlines
      .replace(/\n+$/, '') // remove trailing newlines
      .replace(/^\s*(===)\s*$/gm, '') // remove ALL page-break artifacts inside list items
      .replace(/\n/gm, '\n    '); // indent

    let prefix = options.bulletListMarker + ' ';
    const parent: any = node.parentNode;
    if (parent && parent.nodeName === 'OL') {
      const start = parent.getAttribute('start');
      const index = Array.prototype.indexOf.call(parent.children, node);
      prefix = (start ? Number(start) + index : index + 1) + '. ';
    }

    // Calculate the nesting level
    let level = 0;
    let currentNode = node.parentNode;
    while (
      currentNode &&
      (currentNode.nodeName === 'UL' || currentNode.nodeName === 'OL')
    ) {
      level++;
      currentNode = currentNode.parentNode;
    }

    // Add indentation based on nesting level
    if (level > 1) {
      prefix = '    '.repeat(level - 1) + prefix;
    }

    // Only add newline if it's not a nested list item or if it's the last item in its list
    const needsNewline = !node.nextSibling || level === 1;
    return prefix + content + (needsNewline ? '\n' : '');
  },
});

// Custom rules for iframe — emit raw <iframe> HTML so embeds (YouTube/Vimeo
// etc.) round-trip through markdown instead of degrading to a bare link.
// markdown-it runs with html:true and the guard plugin allows <iframe>; on
// import the Iframe extension's parseHTML re-validates src via
// isAllowedEmbedSrc, so a disallowed src never becomes a node again.
turndownService.addRule('iframe', {
  filter: ['iframe'],
  replacement: function (_content, node) {
    const el = node as HTMLElement;
    const src = el.getAttribute('src');
    if (!src) return '';
    if (!isAllowedEmbedSrc(src)) return `[${src}](${src})`;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const width = el.getAttribute('width');
    const height = el.getAttribute('height');
    const size =
      (width ? ` width="${esc(width)}"` : '') +
      (height ? ` height="${esc(height)}"` : '');
    return `\n\n<iframe src="${esc(src)}"${size}></iframe>\n\n`;
  },
});

// Video nodes have no markdown equivalent — without a rule they serialize to
// NOTHING and one Split View edit deletes every video from the doc. Emit the
// element back as raw HTML, carrying all attributes (src + the IPFS/encryption
// attrs of secure uploads) so the resizable-media extension parses it back
// into a complete video node. Presentation-only attributes are dropped.
const VIDEO_SKIP_ATTRS = new Set(['controls', 'style', 'class', 'draggable']);
turndownService.addRule('video', {
  filter: ['video'],
  replacement: function (_content, node) {
    const el = node as HTMLElement;
    if (!el.getAttribute('src') && !el.getAttribute('ipfsHash')) return '';
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const attrs = Array.from(el.attributes)
      .filter((a) => !VIDEO_SKIP_ATTRS.has(a.name) && a.value)
      .map((a) => `${a.name}="${esc(a.value)}"`)
      .join(' ');
    // Open tag alone on its line so CommonMark treats this as an HTML block
    // (type 7) — `<video ...></video>` on one line would not qualify.
    return `\n\n<video ${attrs}>\n</video>\n\n`;
  },
});

// Twitter embeds are a <div data-tweet-id> — keep it as inline HTML so it
// round-trips back into an embeddedTweet node (div survives DOMPurify).
turndownService.addRule('embeddedTweet', {
  filter: (node) =>
    node.nodeName === 'DIV' &&
    !!(node as HTMLElement).getAttribute('data-tweet-id'),
  replacement: function (_content, node) {
    const id = (node as HTMLElement).getAttribute('data-tweet-id');
    if (!id) return '';
    // Plain .md keeps the bare URL — portable, and import re-embeds it. The
    // styles (blog) export emits a static link card instead: no third-party
    // widget script, and the destination stylesheet styles .tweet-embed.
    // Import round-trips the card via the node's div[data-tweet-id] parse
    // rule. Single html block: inner newlines only, no blank lines.
    const url = `https://twitter.com/i/status/${id}`;
    if (!emitInlineStyles) return `\n\n${url}\n\n`;
    return (
      `\n\n<div data-tweet-id="${id}" class="tweet-embed">\n` +
      `<a href="${url}" target="_blank" rel="noopener noreferrer">View post on X</a>\n` +
      `<span class="tweet-embed-url">${url}</span>\n` +
      `</div>\n\n`
    );
  },
});

// Custom rule for superscript
turndownService.addRule('superscript', {
  filter: 'sup',
  replacement: function (content) {
    return '<sup>' + content + '</sup>';
  },
});

// Custom rule for subscript
turndownService.addRule('subscript', {
  filter: 'sub',
  replacement: function (content) {
    return '<sub>' + content + '</sub>';
  },
});

// Custom rule for math expressions - preserve content without escaping
turndownService.addRule('mathExpression', {
  filter: function (node) {
    // Check if the node or its parents have katex-related classes
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      const className = element.className || '';
      if (
        className.includes('katex') ||
        className.includes('math-inline') ||
        className.includes('math-display')
      ) {
        return true;
      }
    }
    return false;
  },
  replacement: function (_, node) {
    // Get the raw text content without escaping
    const textContent = (node as HTMLElement).textContent || '';
    return textContent;
  },
});

// Math nodes serialize (via getHTML) as <span data-type="inlineMath"
// data-latex="...">. In styles mode (Split View seed / "Markdown with CSS")
// keep that span as raw HTML so the node round-trips losslessly — the
// MathExtension's parseHTML reads it back via data-latex. Plain .md export
// stays $latex$/$$latex$$ text (no import-side reparse; markdown purity
// wins there) — delimiter count follows data-display, see below.
turndownService.addRule('inlineMathNode', {
  filter: (node) =>
    node.nodeName === 'SPAN' &&
    (node as HTMLElement).getAttribute('data-type') === 'inlineMath',
  replacement: function (_content, node) {
    const el = node as HTMLElement;
    const latex = el.getAttribute('data-latex') || '';
    if (!latex) return '';
    const display = el.getAttribute('data-display');
    const delim = display === 'yes' ? '$$' : '$';
    if (!emitInlineStyles) return `${delim}${latex}${delim}`;
    const esc = (v: string) =>
      v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    const evaluate = el.getAttribute('data-evaluate');
    // The inner $…$ body must be ENTITY-FREE: pandoc keeps entities verbatim
    // inside tex_math_dollars and its HTML writer re-escapes the `&`, so an
    // `&lt;` here reaches MathJax as literal `&lt;` — the `&` reads as a TeX
    // alignment char ("Misplaced &", TEC-2634). `<` becomes \lt (same glyph,
    // no tag-open ambiguity; trailing space so a following letter can't
    // extend the macro); `&`/`>` stay raw — markdown-it re-encodes them
    // correctly on import, and the editor restores from data-latex anyway.
    const body = latex.replace(/</g, '\\lt ');
    return `<span data-type="inlineMath" data-latex="${esc(latex)}"${
      display ? ` data-display="${esc(display)}"` : ''
    }${evaluate ? ` data-evaluate="${esc(evaluate)}"` : ''}>${delim}${body}${delim}</span>`;
  },
});

// Helper function to check if text looks like a mathematical formula
function looksLikeFormula(text: string): boolean {
  // Check for patterns that indicate mathematical notation
  // Must have: brackets/parens AND (numbers OR operators)
  // eslint-disable-next-line no-useless-escape
  const hasBrackets = /[\[\]()]/.test(text);
  const hasNumbers = /\d/.test(text);
  const hasOperators = /[+\-*/,]/.test(text);

  // Exclude markdown links/images
  const isMarkdownLink =
    /!\[.*\]\(.*\)/.test(text) || /\[.*\]\(.*\)/.test(text);

  return hasBrackets && (hasNumbers || hasOperators) && !isMarkdownLink;
}

// Escape override: math regions verbatim, prose escaped (incl. `^` for
// pandoc's +superscript). See utils/math-aware-escape.ts.
turndownService.escape = (function (originalEscape) {
  return function (this: unknown, text: string) {
    return escapeOutsideMath(text, (s) => originalEscape.call(this, s));
  };
})(turndownService.escape);

// Custom rule for emphasis/italic tags within formula context
// This handles the case where * was interpreted as italic during input
turndownService.addRule('formulaEmphasis', {
  filter: function (node) {
    // Check if this is an <em> or <i> tag
    if (node.nodeName !== 'EM' && node.nodeName !== 'I') {
      return false;
    }

    // Get the parent paragraph text to check context
    let parent = node.parentElement;
    while (parent && parent.nodeName !== 'P') {
      parent = parent.parentElement;
    }

    if (!parent) return false;

    const fullText = parent.textContent || '';

    // If the full paragraph looks like a formula, treat this <em> as part of it
    return looksLikeFormula(fullText);
  },
  replacement: function (content) {
    // Return content wrapped with * but don't escape the content itself
    // This reconstructs the original *...* that was misinterpreted
    return '*' + content + '*';
  },
});

// SVG media exports as raw inline markup — VB: "embed the SVG into the md
// and html directly" (TEC-2680). null → caller falls back to base64 form.
const inlineSvgFromSrc = (
  src: string,
  width?: string | null,
  backgroundColor?: string | null,
): string | null => {
  if (!isSvgDataUri(src)) return null;
  const text = decodeSvgDataUri(src);
  return text ? sanitizeSvgForEmbed(text, width, backgroundColor) : null;
};

// The backdrop attr lives on the exported img, or on the node-view wrapper
// the img was serialized from — check both.
const mediaBackgroundColor = (el: HTMLElement): string | null =>
  el.getAttribute('data-background-color') || el.style?.backgroundColor || null;

// Custom rules for image
turndownService.addRule('img', {
  filter: ['img'],
  replacement: function (_content, node) {
    const el = node as HTMLElement;
    const src = el.getAttribute('src') || '';
    const svg = inTableCell
      ? null
      : inlineSvgFromSrc(
          src,
          el.getAttribute('width'),
          mediaBackgroundColor(el),
        );
    if (svg) return `\n\n${svg}\n\n`;
    const alt = el.getAttribute('alt') || '';
    return src ? `![${alt}](${src})` : '';
  },
});

// In styles mode (the Split View seed exports with embedImages:false), an
// image that carries node state beyond its src — IPFS/encryption attributes,
// or a background-color backdrop — is serialized as raw <img> HTML preserving
// those attributes, instead of the lossy ![](src) markdown. The import path
// restores the node from the attributes with NO upload. Plain .md export still
// embeds base64 (self-contained file), so this rule must not fire there: it
// requires a non-data src.
// NOTE: added AFTER the generic 'img' rule on purpose — turndown checks the
// most recently added rule first, and both match <img>. `style` is skipped
// because the background-color also round-trips via data-background-color.
const IMG_SKIP_ATTRS = new Set(['style', 'class', 'draggable']);
turndownService.addRule('secureImageRef', {
  filter: (node) => {
    if (!emitInlineStyles || node.nodeName !== 'IMG') return false;
    const el = node as HTMLElement;
    if ((el.getAttribute('src') || '').startsWith('data:')) return false;
    return (
      !!el.getAttribute('ipfsHash') ||
      !!el.getAttribute('data-background-color') ||
      !!el.style?.backgroundColor
    );
  },
  replacement: function (_content, node) {
    const el = node as HTMLElement;
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const attrs = Array.from(el.attributes)
      .filter((a) => !IMG_SKIP_ATTRS.has(a.name) && a.value)
      .map((a) => `${a.name}="${esc(a.value)}"`)
      .join(' ');
    return `\n\n<img ${attrs} />\n\n`;
  },
});

// Media wrapper → <figure> (styles mode). Alignment, resize width, and the
// caption are node-view-only presentation in the editor; the figure carries
// them through markdown so the published blog and a Split View re-import show
// the same image the editor does (TEC-2634 P0: alignment + captions). Plain
// .md export keeps the portable ![alt](src) form via the rules above.
const MEDIA_FIGURE_SKIP_ATTRS = new Set([
  'style',
  'class',
  'draggable',
  'controls',
  'dataalign',
  'datafloat',
  'data-type',
]);
turndownService.addRule('mediaFigure', {
  filter: (node) =>
    emitInlineStyles &&
    node.nodeName === 'DIV' &&
    (node as HTMLElement).getAttribute('data-type') === 'resizable-media',
  replacement: function (_content, node) {
    const el = node as HTMLElement;
    const media = el.querySelector('img, video');
    if (!media) return '';
    const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const isDefaultSize = (name: string, value: string) =>
      (name === 'width' && value === '100%') ||
      (name === 'height' && value === 'auto');
    const attrs = Array.from(media.attributes)
      .filter(
        (a) =>
          a.value &&
          !MEDIA_FIGURE_SKIP_ATTRS.has(a.name) &&
          !isDefaultSize(a.name, a.value),
      )
      .map((a) => `${a.name}="${esc(a.value)}"`)
      .join(' ');
    const background =
      mediaBackgroundColor(media as HTMLElement) || mediaBackgroundColor(el);
    const svg =
      media.nodeName === 'IMG'
        ? inlineSvgFromSrc(
            media.getAttribute('src') || '',
            media.getAttribute('width'),
            background,
          )
        : null;
    // The generic attr copy skips `style` (node-view junk), so the backdrop
    // is re-emitted as a single controlled declaration — data-background-color
    // alone can't render on the published page (CSS can't read arbitrary
    // colors out of a data attribute).
    const backgroundStyle = background
      ? ` style="background-color: ${esc(background)}"`
      : '';
    const mediaHtml = svg
      ? svg
      : media.nodeName === 'VIDEO'
        ? `<video ${attrs}${backgroundStyle}>\n</video>`
        : `<img ${attrs}${backgroundStyle} />`;
    const align =
      el.getAttribute('dataalign') ||
      media.getAttribute('dataalign') ||
      'center';
    const float =
      el.getAttribute('datafloat') || media.getAttribute('datafloat');
    const caption = el
      .querySelector('[data-type="media-caption"], .media-caption')
      ?.innerHTML.trim();
    const figAttrs =
      ` data-align="${esc(align)}"` +
      (float ? ` data-float="${esc(float)}"` : '');
    const captionHtml = caption ? `<figcaption>${caption}</figcaption>\n` : '';
    // No blank lines inside: the figure must stay ONE html block for both
    // markdown-it (import) and pandoc (publish) so nothing inside is
    // re-parsed as markdown.
    return `\n\n<figure data-type="resizable-media"${figAttrs}>\n${mediaHtml}\n${captionHtml}</figure>\n\n`;
  },
});

// Columns (styles mode): the div structure is the round-trip carrier — blank
// lines INSIDE each column keep the inner content parsed as markdown by both
// markdown-it (import) and pandoc (publish, markdown_in_html_blocks), while
// the outer tags stay single HTML blocks. Grid styling ships in the blog
// template CSS (TEC-2634 P0 item 7). Plain export keeps flattening.
turndownService.addRule('columnsBlock', {
  filter: (node) =>
    emitInlineStyles &&
    node.nodeName === 'DIV' &&
    (node as HTMLElement).getAttribute('data-type') === 'columns',
  replacement: function (content, node) {
    const el = node as HTMLElement;
    const layout = /layout-([\w-]+)/.exec(el.className || '')?.[1];
    const layoutAttr = layout ? ` data-layout="${layout}"` : '';
    return `\n\n<div data-type="columns"${layoutAttr}>\n${content.trim()}\n</div>\n\n`;
  },
});
turndownService.addRule('columnItem', {
  filter: (node) =>
    emitInlineStyles &&
    node.nodeName === 'DIV' &&
    (node as HTMLElement).getAttribute('data-type') === 'column',
  replacement: function (content, node) {
    const position = (node as HTMLElement).getAttribute('data-position');
    const posAttr = position ? ` data-position="${position}"` : '';
    return `\n<div data-type="column"${posAttr}>\n\n${content.trim()}\n\n</div>\n`;
  },
});

// Custom rules for strikethrough
turndownService.addRule('strikethrough', {
  filter: 's',
  replacement: function (content) {
    return '<s>' + content + '</s>';
  },
});

// --- Inline styling fidelity ---------------------------------------------
// Markdown has no native syntax for text color / font / size / highlight /
// underline, but inline HTML is valid markdown and `markdownIt` runs with
// html:true. We emit the styling as inline HTML on export so it round-trips:
// on import, DOMPurify keeps `style`/`data-color` and the Color, FontFamily,
// FontSize, Highlight and Underline extensions parse it back into marks.

// Opt-in: only emit inline styling for the "Markdown with CSS" export.
// When false, these rules don't match → turndown drops the tags (clean .md).
let emitInlineStyles = false;
export const setMarkdownInlineStyles = (enabled: boolean) => {
  emitInlineStyles = enabled;
};

// Standalone exports (downloads, blog publish) resolve `var(--color-editor-*)`
// to concrete hex so colors render outside the editor. The Split View seed
// (embedImages:false) opts out: it round-trips back into the doc, where the var
// must survive to stay theme-responsive.
let resolveColorVarsForExport = false;
export const setResolveColorVars = (enabled: boolean) => {
  resolveColorVarsForExport = enabled;
};

// Blog publish opts out of page breaks: a pagination marker has no meaning on
// a scrolling web page, and its `===` form rendered as literal text there
// (TEC-2634 P0 item 5). Split View / .md download keep `===` — the import
// lane restores it to a pageBreak node.
let omitPageBreaks = false;
export const setOmitPageBreaks = (enabled: boolean) => {
  omitPageBreaks = enabled;
};

// The table rule's nested `turndownService.turndown(cell.innerHTML)` parses
// each cell as a detached fragment, so ancestry (closest('td')) is lost by
// the time other rules run — this flag is the only way they can tell they're
// inside a table cell, whose pipe rows must stay single-line.
let inTableCell = false;

// Color / font-family / font-size live on a styled <span> (TextStyle marks).
turndownService.addRule('inlineTextStyle', {
  filter: (node) =>
    emitInlineStyles &&
    node.nodeName === 'SPAN' &&
    !!(
      (node as HTMLElement).style?.color ||
      (node as HTMLElement).style?.fontFamily ||
      (node as HTMLElement).style?.fontSize
    ),
  replacement: function (content, node) {
    const style = (node as HTMLElement).style;
    const css = [
      style.color &&
        `color: ${
          resolveColorVarsForExport
            ? resolveEditorColorVars(style.color)
            : style.color
        }`,
      style.fontFamily && `font-family: ${style.fontFamily}`,
      style.fontSize && `font-size: ${style.fontSize}`,
    ]
      .filter(Boolean)
      .join('; ');
    if (!css || !content) return content;
    return `<span style="${css}">${content}</span>`;
  },
});

// Highlight renders as <mark> (background color / data-color).
turndownService.addRule('highlightMark', {
  filter: (node) => emitInlineStyles && node.nodeName === 'MARK',
  replacement: function (content, node) {
    if (!content) return content;
    const el = node as HTMLElement;
    const color = el.style?.backgroundColor || el.getAttribute('data-color');
    return color
      ? `<mark style="background-color: ${color}">${content}</mark>`
      : `<mark>${content}</mark>`;
  },
});

// Underline has no markdown syntax — keep it as <u>.
turndownService.addRule('underline', {
  filter: (node) => emitInlineStyles && node.nodeName === 'U',
  replacement: function (content) {
    return content ? `<u>${content}</u>` : content;
  },
});

// Custom rules for callout
turndownService.addRule('callout', {
  filter: (node) =>
    node.nodeName === 'ASIDE' &&
    (node as HTMLElement).getAttribute('data-type') === 'callout',
  replacement: function (_content, node) {
    const childNodes = Array.from((node as HTMLElement).childNodes);
    const parsedContent = childNodes
      .map((child) => {
        if (child.nodeType === Node.ELEMENT_NODE) {
          return turndownService.turndown((child as HTMLElement).outerHTML);
        } else if (child.nodeType === Node.TEXT_NODE) {
          return turndownService.turndown(child.textContent || '');
        }
        return '';
      })
      .join('\n\n');

    return `<aside class="callout">\n${parsedContent.trim()}\n</aside>\n\n`;
  },
});

turndownService.addRule('linkDefinition', {
  filter: (node) => {
    const text = (node.textContent || '').trim();
    return node.nodeName === 'P' && /^\[[^\]]+\]:\s+\S+/.test(text);
  },
  replacement: (_content, node) => {
    // Use the raw DOM text, not Turndown's escaped content
    const text = (node.textContent || '').trim();
    return text + '\n\n';
  },
});

// Define the command type
declare module '@tiptap/core' {
  interface Storage {
    markdownPasteHandler: { customCSS: string };
  }
  interface Commands {
    uploadMarkdownFile: {
      uploadMarkdownFile: (
        ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
        onError?: (error: string) => void,
      ) => any;
    };
    exportMarkdownFile: {
      exportMarkdownFile: (props?: {
        title?: string;
        returnMDFile?: boolean;
        metadataFormat?: 'yaml' | 'reference-links';
        metadata?: Record<string, string>;
        includeStyles?: boolean;
        /**
         * Embed secure images as base64 data URLs (default true — makes the
         * downloaded .md self-contained). Split View seeds with false so
         * images stay as attribute references and are never re-uploaded.
         */
        embedImages?: boolean;
        /**
         * Drop page breaks instead of emitting `===` — blog publish only,
         * where a pagination marker would render as literal text.
         */
        omitPageBreaks?: boolean;
      }) => any;
    };
  }
}

const MarkdownPasteHandler = (
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>,
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>,
) =>
  Extension.create({
    name: 'markdownPasteHandler',

    // The document's custom CSS, mirrored here by ddoc-editor so the
    // exportMarkdownFile command can embed it as a <style> block — the export
    // has no other access to documentStyling.
    addStorage() {
      return { customCSS: '' as string };
    },

    addProseMirrorPlugins() {
      // transformPasted is ProseMirror's DROP hook as well as its paste hook
      // (prosemirror-view editHandlers.drop). On a drop the insertion point is
      // the MOUSE, not the caret, so the openStart override below must not run
      // — keying it off the selection there would split whatever paragraph the
      // pointer landed in. handleDOMEvents.drop runs before editHandlers.drop,
      // so this flag is set in time and cleared once the drop has been handled.
      let dropInFlight = false;

      return [
        new Plugin({
          props: {
            handleDOMEvents: {
              drop: () => {
                dropInFlight = true;
                queueMicrotask(() => {
                  dropInFlight = false;
                });
                return false;
              },
            },
            // Non-markdown clipboard HTML goes through ProseMirror's native
            // paste, which faithfully keeps the stacks of empty <p> that
            // sites like Wikipedia put between sections. Collapse interior
            // runs of empty paragraphs to one; the first and last slice
            // children are never touched (they can be open-ended and merge
            // into surrounding blocks).
            transformPasted: (slice, view) => {
              const isEmptyParagraphChild = (node: PMNode) => {
                if (node.type.name === 'paragraph')
                  return node.childCount === 0;
                return (
                  node.type.name === 'dBlock' &&
                  node.childCount === 1 &&
                  node.firstChild!.type.name === 'paragraph' &&
                  node.firstChild!.childCount === 0
                );
              };

              const total = slice.content.childCount;

              let content = slice.content;
              if (total >= 3) {
                const kept: PMNode[] = [];
                let previousWasEmpty = false;
                slice.content.forEach((child, _offset, index) => {
                  const isEmpty = isEmptyParagraphChild(child);
                  const isEdge = index === 0 || index === total - 1;
                  if (!isEdge && isEmpty && previousWasEmpty) {
                    return;
                  }
                  previousWasEmpty = isEmpty;
                  kept.push(child);
                });
                if (kept.length !== total) content = Fragment.fromArray(kept);
              }

              // An open slice start makes ProseMirror merge the first pasted
              // block's INLINE content into the block at the cursor, which
              // keeps its own attributes — so the first paragraph of a Google
              // Docs paste silently lost its line height, spacing and
              // alignment while every later one kept them.
              //
              // Only when the target block is empty: there is nothing to merge
              // with, and the pasted block should simply become that block.
              // Pasting into a block that has text still merges, which is what
              // you want mid-sentence.
              // Scoped to PARAGRAPHS, not every textblock: an empty heading
              // is a block the user deliberately created, and letting the
              // pasted paragraph become it would silently drop the level.
              // Widened past `selection.empty` to any text selection covering
              // its whole paragraph — pasting over a fully selected paragraph
              // leaves the same empty target and lost the same attributes.
              const { selection } = view.state;
              const { $from, $to } = selection;
              const targetIsEmptied =
                selection instanceof TextSelection &&
                $from.parent === $to.parent &&
                $from.parent.type === view.state.schema.nodes.paragraph &&
                $from.parentOffset === 0 &&
                $to.parentOffset === $to.parent.content.size;

              const openStart =
                !dropInFlight && targetIsEmptied && content.childCount > 0
                  ? 0
                  : slice.openStart;

              if (content === slice.content && openStart === slice.openStart) {
                return slice;
              }
              return new Slice(content, openStart, slice.openEnd);
            },
            handlePaste: (view, event) => {
              const clipboardData = event.clipboardData;
              if (!clipboardData) return false;

              // Get the Markdown content from the clipboard
              const copiedData = clipboardData.getData('text/plain');

              // When a heading link URL is pasted without text selection,
              // insert it as a named link using the heading's actual text.
              const { empty } = view.state.selection;
              if (empty && copiedData) {
                const trimmed = copiedData.trim();
                const parsed = parseHeadingLink(trimmed);
                if (parsed?.headingEl?.textContent) {
                  event.preventDefault();
                  this.editor
                    .chain()
                    .focus()
                    .insertContent({
                      type: 'text',
                      text: parsed.headingEl.textContent,
                      marks: [
                        {
                          type: 'link',
                          attrs: { href: trimmed },
                        },
                      ],
                    })
                    .run();
                  return true;
                }
              }

              event.preventDefault();

              // Pasted text containing a raw <iframe> tag: if its src is on
              // the embed allowlist, insert as an embed; otherwise drop in
              // as literal text. Else tiptap-markdown's `html: true` paste
              // path either turns it into an HTML iframe with an arbitrary
              // src (XSS) or our schema drops it (leaving nothing).
              if (copiedData && /<iframe\b/i.test(copiedData)) {
                const srcMatch = copiedData.match(
                  /<iframe\b[^>]*\bsrc=(?:"([^"]*)"|'([^']*)')/i,
                );
                const src = srcMatch?.[1] ?? srcMatch?.[2];
                if (isAllowedEmbedSrc(src)) {
                  const widthMatch = copiedData.match(
                    /\bwidth=(?:"([^"]*)"|'([^']*)')/i,
                  );
                  const heightMatch = copiedData.match(
                    /\bheight=(?:"([^"]*)"|'([^']*)')/i,
                  );
                  const width = parseInt(
                    widthMatch?.[1] ?? widthMatch?.[2] ?? '',
                    10,
                  );
                  const height = parseInt(
                    heightMatch?.[1] ?? heightMatch?.[2] ?? '',
                    10,
                  );
                  this.editor
                    .chain()
                    .focus()
                    .setIframe({
                      src,
                      width: Number.isFinite(width) ? width : 640,
                      height: Number.isFinite(height) ? height : 360,
                    })
                    .run();
                } else {
                  view.dispatch(view.state.tr.insertText(copiedData));
                }
                return true;
              }

              // Check if we're in a code block
              const { state } = view;
              const { selection } = state;
              const { $from } = selection;
              const isInCodeBlock = $from.parent.type.name === 'codeBlock';

              // If we're in a code block, insert the raw content
              if (isInCodeBlock) {
                const transaction = state.tr.insertText(copiedData);
                view.dispatch(transaction);
                return true;
              }

              // Check if the copied content is Markdown
              if (isMarkdown(copiedData)) {
                handleMarkdownContent(view, copiedData, ipfsImageUploadFn);
                return true;
              }

              return false;
            },
          },
        }),
      ];
    },

    addCommands() {
      return {
        uploadMarkdownFile:
          (
            ipfsImageUploadFn?: (
              file: File,
            ) => Promise<IpfsImageUploadResponse>,
            onError?: (error: string) => void,
          ) =>
          async ({ view }: any) => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.md, text/markdown';
            input.onchange = async (event: any) => {
              const files = event.target.files;
              if (files.length > 0) {
                const file = files[0];
                if (
                  file.type === 'text/markdown' ||
                  file.name.endsWith('.md')
                ) {
                  const { showLoader, removeLoader } = inlineLoader(
                    this.editor,
                    'Importing MD file ...',
                  );
                  const loader = showLoader();
                  const reader = new FileReader();
                  reader.onload = async (e) => {
                    const content = e.target?.result as string;
                    await handleMarkdownContent(
                      view,
                      content,
                      ipfsImageUploadFn,
                    );
                    removeLoader(loader);
                  };
                  reader.readAsText(file);
                } else {
                  onError?.(
                    `Oops! That file type isn't supported. Give it another go with a .md file.`,
                  );
                }
              }
            };
            input.click();
            return true;
          },
        exportMarkdownFile:
          (props?: {
            title?: string;
            returnMDFile?: boolean;
            metadataFormat?: 'yaml' | 'reference-links';
            metadata?: Record<string, string>;
            includeStyles?: boolean;
            embedImages?: boolean;
            omitPageBreaks?: boolean;
          }) =>
          async ({ editor }: { editor: Editor }): Promise<string> => {
            const { showLoader, removeLoader } = inlineLoader(
              editor,
              'Exporting MD file ...',
            );

            const loader = showLoader();
            let temporalEditor: any = null;

            // finally-cleanup: a throw anywhere here (image fetch, turndown)
            // must not leave the inline loader stuck, the temp editor alive,
            // or the styles flag flipped for later plain exports.
            try {
              const originalDoc: any = editor.state.doc;

              // embedImages:false (Split View seed) keeps secure images as
              // attribute references — no per-image IPFS fetch/decrypt, and
              // the secureImageRef turndown rule serializes them as raw
              // <img> HTML instead of base64.
              const docWithEmbedImageContent: any =
                props?.embedImages === false
                  ? originalDoc
                  : await searchForSecureImageNodeAndEmbedImageContent(
                      originalDoc,
                      ipfsImageFetchFn,
                      fetchV1ImageFn,
                      true,
                    );

              temporalEditor = getTemporaryEditor(
                editor,
                docWithEmbedImageContent.toJSON(),
              );

              const inlineHtml = temporalEditor.getHTML();
              // Emit inline-CSS styling only for the "Markdown with CSS" export.
              let markdown: string;
              try {
                setMarkdownInlineStyles(Boolean(props?.includeStyles));
                setResolveColorVars(
                  Boolean(props?.includeStyles) && props?.embedImages !== false,
                );
                setOmitPageBreaks(Boolean(props?.omitPageBreaks));
                markdown = turndownService.turndown(inlineHtml);
              } finally {
                setMarkdownInlineStyles(false);
                setResolveColorVars(false);
                setOmitPageBreaks(false);
              }

              // Enforce the invariant: exactly one doc-level <style> block,
              // and only the canonical custom CSS. Strip any stray <style>
              // the content may carry (e.g. an old doc polluted before the
              // import-side fix), then, in "with styles" mode, prepend the
              // single custom-CSS block so the downloaded .md is
              // self-contained and never duplicated. Style elements INSIDE
              // inline <svg> are content, not doc CSS — they stay (scoped by
              // sanitizeSvgForEmbed).
              markdown = stripStyleBlocksOutsideSvg(markdown);
              // sanitizeCustomCss scopes the author CSS to `body` (the rendered
              // doc's root, mirroring the editor's `.ProseMirror`) AND strips
              // injection vectors — breakout, url()/@import exfiltration,
              // position:fixed overlays. The returned string is already
              // `body { … }`-wrapped, so the downloaded .md is self-contained
              // and safe to render on any html:true markdown renderer.
              const safeCSS = props?.includeStyles
                ? sanitizeCustomCss(
                    editor.storage?.markdownPasteHandler?.customCSS || '',
                    'body',
                  )
                : '';
              if (safeCSS) {
                markdown = `<style>\n${safeCSS}\n</style>\n\n${markdown}`;
              }

              const metadataEntries: Record<string, string> = {
                title: props?.title || 'Untitled',
                date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
                ...props?.metadata,
              };
              // Known false-positive: custom CSS with `$=` selectors can trigger hasMathRegions, but harmless (metadata-only).
              if (
                props?.metadataFormat === 'reference-links' &&
                !metadataEntries.pandoc &&
                hasMathRegions(markdown)
              ) {
                metadataEntries.pandoc = '--mathjax';
              }

              let markdownWithMeta: string;

              if (props?.metadataFormat === 'reference-links') {
                const refs = Object.entries(metadataEntries)
                  .map(([key, value]) => `[${key}]: <> (${value})`)
                  .join('\n');
                markdownWithMeta = refs + '\n\n' + markdown;
              } else {
                const frontmatter =
                  '---\n' +
                  Object.entries(metadataEntries)
                    .map(([key, value]) => {
                      if (Array.isArray(value)) {
                        return `${key}:\n${value.map((v: string) => `  - ${v}`).join('\n')}`;
                      }
                      return `${key}: ${value}`;
                    })
                    .join('\n') +
                  '\n---\n\n';
                markdownWithMeta = frontmatter + markdown;
              }

              if (props?.returnMDFile) {
                return markdownWithMeta;
              }

              const blob = new Blob([markdownWithMeta], {
                type: 'text/markdown;charset=utf-8',
              });
              return URL.createObjectURL(blob);
            } finally {
              temporalEditor?.destroy();
              removeLoader(loader);
            }
          },
      };
    },

    addInputRules() {
      return [
        new InputRule({
          find: /<sup>(.*?)<\/sup>/,
          handler: ({ state, range, match }) => {
            const { tr } = state;
            const start = range.from;
            const end = range.to;
            const content = match[1];
            tr.replaceWith(
              start,
              end,
              this.editor.schema.text(content, [
                this.editor.schema.marks.superscript.create(),
              ]),
            );
          },
        }),
        new InputRule({
          find: /<sub>(.*?)<\/sub>/,
          handler: ({ state, range, match }) => {
            const { tr } = state;
            const start = range.from;
            const end = range.to;
            const content = match[1];
            tr.replaceWith(
              start,
              end,
              this.editor.schema.text(content, [
                this.editor.schema.marks.subscript.create(),
              ]),
            );
          },
        }),
        new InputRule({
          // Matches `^...^` allowing multiple digits and words (spaces) between
          // the carets; the closing caret commits the superscript.
          find: /(\S*)\^((?:[^^]|\\\^)+)\^$/,
          handler: ({ state, range, match }) => {
            if (/^\s|\s$/.test(match[2])) {
              return null;
            }
            const { tr } = state;
            const start = range.from + match[1].length;
            const end = range.to;
            const content = match[2].replace(/\\\^/g, '^');
            tr.replaceWith(
              start,
              end,
              this.editor.schema.text(content, [
                this.editor.schema.marks.superscript.create(),
              ]),
            );
          },
        }),
        new InputRule({
          find: /(\S*)~((?:[^~]|\\~)+)~$/,
          handler: ({ state, range, match }) => {
            if (/^\s|\s$/.test(match[2])) {
              return null;
            }
            const { tr } = state;
            const start = range.from + match[1].length;
            const end = range.to;
            const content = match[2].replace(/\\~/g, '~');
            tr.replaceWith(
              start,
              end,
              this.editor.schema.text(content, [
                this.editor.schema.marks.subscript.create(),
              ]),
            );
          },
        }),
        new InputRule({
          find: /(?:^|\s)\[([^\]]+)\]\((\S+)\)/,
          handler: ({ state, range, match }) => {
            const { tr } = state;
            const [fullMatch, linkText, url] = match;
            const start = range.from;
            const end = range.to;

            if (fullMatch) {
              const nodeBeforeLink = state.doc.resolve(start).nodeBefore;
              const needsSpace =
                nodeBeforeLink &&
                nodeBeforeLink.isText &&
                nodeBeforeLink.text?.endsWith(' ');

              if (needsSpace) {
                tr.insertText(' ', start);
              }

              tr.replaceWith(
                needsSpace ? start + 1 : start,
                needsSpace ? end + 1 : end,
                this.editor.schema.text(linkText, [
                  this.editor.schema.marks.link.create({ href: url }),
                ]),
              );
            }
          },
        }),
        new InputRule({
          find: /===\s*$/m,
          handler: ({ state, range }) => {
            const { tr } = state;
            // v1: replace the dBlock around the paragraph (2 levels up).
            // Flat v2: replace the paragraph itself (1 level up).
            const hasDBlock = Boolean(state.schema.nodes.dBlock);
            const start = range.from - (hasDBlock ? 2 : 1);
            const end = range.to;

            const containerName = state.doc.nodeAt(start)?.type.name;
            const isReplaceableContainer = hasDBlock
              ? containerName === 'dBlock'
              : containerName === 'paragraph';
            // Create a page break node
            if (isReplaceableContainer) {
              tr.replaceWith(
                start,
                end,
                this.editor.schema.nodes.pageBreak.create(),
              );
            }
          },
        }),
      ];
    },
  });

function isMarkdown(content: string): boolean {
  // Ignore LaTeX math blocks before checking other Markdown elements
  if (
    content.match(/\$\$[^$]*\$\$/g) !== null ||
    content.match(/\$[^$\n]*\$/g) !== null ||
    isLikelyLatex(content) // need to add when copy pasting formula within editor without wrapping around $..$ and it identifies other formula characters with markdown charactes such as ^
  ) {
    return false; // Treat as LaTeX, not Markdown
  }

  // Check if content looks like a mathematical formula with brackets and operators
  // Pattern: contains brackets [] or () AND contains numbers AND contains operators like * or /
  // This prevents formulas like [[15, -19]*[18,20], (4*6)] from being treated as markdown
  const trimmed = content.trim();
  // eslint-disable-next-line no-useless-escape
  const hasBrackets = /[\[\]()]/.test(trimmed);
  const hasNumbers = /\d/.test(trimmed);
  const hasMultiplyOrDivide = /[*/]/.test(trimmed);

  if (hasBrackets && hasNumbers && hasMultiplyOrDivide) {
    return false; // Treat as formula, not Markdown
  }

  return (
    content.match(/^#{1,6}\s/) !== null || // Headings
    content.startsWith('*') ||
    content.startsWith('-') ||
    content.startsWith('>') ||
    content.startsWith('```') ||
    content.match(/\[.*\]\(.*\)/) !== null || // Links
    content.match(/!\[.*\]\(.*\)/) !== null || // Images
    content.match(/\*\*(.*?)\*\*/g) !== null || // Bold
    content.match(/\*(.*?)\*/g) !== null || // Italic
    content.match(/`{1,3}[^`]+`{1,3}/g) !== null ||
    content.match(/<sup>(.*?)<\/sup>/g) !== null ||
    content.match(/<sub>(.*?)<\/sub>/g) !== null ||
    content.match(/\^[^\s^]+\^/g) !== null || // New superscript syntax
    content.match(/~([^\s~](?:[^~]*[^\s~])?)~/g) !== null || // New subscript syntax
    content.match(/^===\s*$/m) !== null // Page break
  );
}

function base64ToFile(base64Data: string, contentType: string): File {
  const byteCharacters = atob(base64Data);
  const len = byteCharacters.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = byteCharacters.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: contentType });
  return new File([blob], 'image', { type: contentType });
}

type Base64UploadResult = {
  ipfsUrl: string;
  encryptionKey: string;
  nonce: string;
  downloadUrl: string;
  ipfsHash: string;
  authTag: string;
  contentType: string;
};

// Same-content uploads are deduped: Split View reparses the whole markdown on
// every debounced edit, so without this an image pasted as base64 into the
// markdown pane would be re-encrypted and re-uploaded to IPFS on every pause
// in typing. Keyed by the full data URL; bounded FIFO so held base64 strings
// can't grow without limit.
const base64UploadCache = new Map<string, Base64UploadResult>();
const BASE64_UPLOAD_CACHE_MAX = 20;

async function uploadBase64ImageContent(
  base64Image: string,
  ipfsImageUploadFn: (file: File) => Promise<IpfsImageUploadResponse>,
) {
  const cached = base64UploadCache.get(base64Image);
  if (cached) return cached;

  // Remove the data URL prefix. e.g., "data:image/jpeg;base64,"
  const prefixMatch = base64Image.match(
    /^(data:(image\/[a-zA-Z0-9.+-]+);base64,)/,
  );
  if (!prefixMatch) {
    throw new Error('Invalid base64 image string.');
  }
  const contentType = prefixMatch[2];
  const base64Data = base64Image.slice(prefixMatch[1].length);

  const file = base64ToFile(base64Data, contentType);
  const { encryptionKey, nonce, ipfsUrl, ipfsHash, authTag } =
    await ipfsImageUploadFn(file);

  const result: Base64UploadResult = {
    ipfsUrl,
    encryptionKey,
    nonce,
    downloadUrl: URL.createObjectURL(file),
    ipfsHash,
    authTag,
    contentType,
  };
  base64UploadCache.set(base64Image, result);
  if (base64UploadCache.size > BASE64_UPLOAD_CACHE_MAX) {
    base64UploadCache.delete(base64UploadCache.keys().next().value as string);
  }
  return result;
}

export const stripFrontmatter = (markdown: string): string => {
  const fmRegex = /^---\n[\s\S]*?\n---\n*/;
  // Remove frontmatter and *all* leading blank lines after it
  return markdown.replace(fmRegex, '').replace(/^\s*\n/, '');
};

export async function handleMarkdownContent(
  view: any,
  content: string,
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
  options?: { breaks?: boolean; replaceAll?: boolean },
) {
  // Remove YAML frontmatter before parsing
  let cleanMarkdown = stripFrontmatter(content);

  // Custom CSS is styling, never document content. Strip every doc-level
  // <style> block so it can't leak into the doc — DOMPurify is inconsistent
  // (it drops a leading multi-line block but keeps an inline/single-line
  // one), which is how a stray <style> ends up as a text node and re-exports
  // as a duplicate. The canonical block is handled separately (Split View
  // seed / export prepend). Style elements INSIDE inline <svg> are content
  // (Illustrator colors via <style> + classes) and must survive import.
  cleanMarkdown = stripStyleBlocksOutsideSvg(cleanMarkdown);

  // Shield $…$/$$…$$ regions from everything below (markdown-it escape
  // stripping, the asterisk regexes, the sup/sub regexes) — restored verbatim
  // just before sanitization, so imported TeX reaches pandoc untouched.
  const mathShield = shieldMathRegions(cleanMarkdown);
  cleanMarkdown = mathShield.shielded;

  // Protect formulas from being interpreted as markdown by escaping asterisks
  // Only escape asterisks that are clearly part of math expressions (e.g., 4*6, [1,2]*[3,4])
  // Use precise patterns to avoid breaking markdown formatting like **bold**, *italic*, or lists
  cleanMarkdown = cleanMarkdown.replace(
    /(\d)\*(\d)/g, // Match digit*digit (e.g., 4*6)
    '$1\\*$2',
  );
  cleanMarkdown = cleanMarkdown.replace(
    /(\])\*(\[)/g, // Match ]*[ (e.g., [1,2]*[3,4])
    '$1\\*$2',
  );
  cleanMarkdown = cleanMarkdown.replace(
    /(\))\*(\()/g, // Match )*( (e.g., (a+b)*(c+d))
    '$1\\*$2',
  );

  // Convert Markdown to HTML. `breaks` (single newline → <br>) is opt-in for
  // Split View so a single Enter shows as a new line on the right;
  // paste/import keep CommonMark semantics (single newline = space). The
  // shared instance is reset in a finally so a throwing render can't leak
  // breaks:true into every later paste/import in the session.
  let convertedHtml: string;
  try {
    if (options?.breaks) markdownIt.set({ breaks: true });
    convertedHtml = markdownIt.render(cleanMarkdown);
  } finally {
    if (options?.breaks) markdownIt.set({ breaks: false });
  }

  // Parse the HTML string into DOM nodes
  const parser = new DOMParser();
  const doc = parser.parseFromString(convertedHtml, 'text/html');

  // Remove <p> if it's empty
  const topLevelPs = doc.querySelectorAll('body > p');
  topLevelPs.forEach((p) => {
    if (p.childNodes.length === 0) {
      if (p.textContent === '') {
        p.remove();
      }
    }
  });

  // Replace <aside class="callout"> with <aside data-type="callout">
  const calloutAsides = doc.querySelectorAll('aside.callout');
  calloutAsides.forEach((el) => {
    el.setAttribute('data-type', 'callout');
    el.removeAttribute('class');
  });

  // remove extra <p> tags inside <aside data-type="callout">
  const callouts = doc.querySelectorAll('aside[data-type="callout"]');
  callouts.forEach((aside) => {
    const ps = aside.querySelectorAll('p');
    ps.forEach((p) => {
      const isEmpty = Array.from(p.childNodes).every((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          return node.nodeName === 'BR';
        }
        if (node.nodeType === Node.TEXT_NODE) {
          return node.textContent?.trim() === '';
        }
        return false;
      });

      if (isEmpty) {
        if (p.parentNode) {
          p.parentNode.removeChild(p);
        }
      }
    });
  });

  // Handle todo lists
  const lists = doc.getElementsByTagName('ul');
  for (let i = 0; i < lists.length; i++) {
    const list = lists[i];
    const items = list.getElementsByTagName('li');
    let isTodoList = false;

    for (let j = 0; j < items.length; j++) {
      const item = items[j];
      const text = item.textContent || '';
      const todoMatch = text.match(/^\[([ x])\]\s*(.*)/i);

      if (todoMatch) {
        isTodoList = true;
        const isChecked = todoMatch[1].toLowerCase() === 'x';
        const content = todoMatch[2];

        // Set attributes for task list
        item.setAttribute('data-type', 'taskItem');
        item.setAttribute('data-checked', isChecked.toString());
        item.textContent = content;
      }
    }

    if (isTodoList) {
      list.setAttribute('data-type', 'taskList');
    }
  }

  // Re-embed bare tweet URLs: a paragraph that is just a tweet URL becomes a
  // <div data-tweet-id> so it parses back into an embeddedTweet node — the
  // inverse of how it's exported (see the turndown embeddedTweet rule). So a
  // tweet round-trips through markdown everywhere (paste/import/Split View).
  // Named links like [text](tweet-url) are left alone.
  const tweetParas = Array.from(doc.getElementsByTagName('p'));
  for (const p of tweetParas) {
    const text = (p.textContent || '').trim();
    const match = text.match(TWITTER_REGEX);
    if (match && match[0] === text) {
      const tweetDiv = doc.createElement('div');
      tweetDiv.setAttribute('data-tweet-id', match[2]);
      p.replaceWith(tweetDiv);
    }
  }

  // Inline <svg> → sanitized data-URI <img>: after encoding, the svg text is
  // opaque to the document-level DOMPurify pass below, so sanitization must
  // happen here. From this point the existing image pipeline (re-upload,
  // figure parse, node creation) handles it like any other image.
  const svgEls = Array.from(doc.getElementsByTagName('svg'));
  for (const svgEl of svgEls) {
    // Lift the backdrop off the root before encoding: it becomes the img's
    // data-background-color (→ the node attr, editable later) instead of a
    // value baked immutably into the data URI. Export stamps it back on.
    const background =
      svgEl.getAttribute('data-background-color') ||
      svgEl.style?.backgroundColor ||
      null;
    svgEl.removeAttribute('data-background-color');
    if (svgEl.style?.backgroundColor) {
      svgEl.style.removeProperty('background-color');
      if (!svgEl.getAttribute('style')) svgEl.removeAttribute('style');
    }
    const clean = sanitizeSvgForEmbed(svgEl.outerHTML);
    if (!clean) {
      svgEl.remove();
      continue;
    }
    const img = doc.createElement('img');
    img.setAttribute('src', encodeSvgToDataUri(clean));
    const width = svgEl.getAttribute('width');
    if (width && width !== '100%') img.setAttribute('width', width);
    if (background) img.setAttribute('data-background-color', background);
    svgEl.replaceWith(img);
  }

  // Handle images
  const paragraphs = doc.getElementsByTagName('p');
  for (let i = paragraphs.length - 1; i >= 0; i--) {
    const p = paragraphs[i];
    if (p.childNodes.length === 1 && p.firstChild?.nodeName === 'IMG') {
      p.parentNode?.replaceChild(p.firstChild, p);
    }
  }
  const images = Array.from(doc.getElementsByTagName('img'));

  if (ipfsImageUploadFn) {
    for (const imgElement of images) {
      const src = imgElement.getAttribute('src') || '';
      if (src.startsWith('data:image')) {
        try {
          const uploadResult = await uploadBase64ImageContent(
            src,
            ipfsImageUploadFn,
          );
          imgElement.setAttribute('ipfsUrl', uploadResult.ipfsUrl);
          imgElement.setAttribute('src', uploadResult.downloadUrl);
          imgElement.setAttribute('media-type', 'secure-img');
          imgElement.setAttribute('encryptionKey', uploadResult.encryptionKey);
          imgElement.setAttribute('nonce', uploadResult.nonce);
          imgElement.setAttribute('version', '2');
          imgElement.setAttribute('ipfsHash', uploadResult.ipfsHash);
          imgElement.setAttribute('mimeType', uploadResult.contentType);
          imgElement.setAttribute('authTag', uploadResult.authTag);
        } catch (error) {
          console.error('Error uploading secure image to IPFS:', error);
        }
      }
    }
  }

  // Get the modified HTML content
  convertedHtml = doc.body.innerHTML;

  const subsupRegex = /<(sup|sub)>(.*?)<\/\1>/g;
  const superscriptRegex = /\^([^\s^]+)\^/g;
  const subscriptRegex = /~([^\s~](?:[^~]*[^\s~])?)~/g;

  // Process superscript and subscript tags in the HTML string
  convertedHtml = convertedHtml.replace(subsupRegex, (content) => {
    return `${content}`;
  });

  // Process markdown-style superscript and subscript
  convertedHtml = convertedHtml.replace(
    superscriptRegex,
    '<sup data-type="sup">$1</sup>',
  );

  convertedHtml = convertedHtml.replace(
    subscriptRegex,
    '<sub data-type="sub">$1</sub>',
  );

  // Reinsert the shielded math regions (HTML-escaped) BEFORE sanitization so
  // DOMPurify stays the last gate over the full document.
  convertedHtml = mathShield.restore(convertedHtml);

  // Sanitize the converted HTML. iframe is allowed through here because the
  // Iframe extension's parseHTML drops any src that fails isAllowedEmbedSrc;
  // video is explicit so media round-trips don't depend on DOMPurify defaults.
  convertedHtml = DOMPurify.sanitize(convertedHtml, {
    ADD_TAGS: ['div', 'iframe', 'video'],
    ADD_ATTR: [
      'style',
      'data-color',
      'data-tweet-id',
      'data-type',
      'data-page-break',
      'url',
      'src',
      'media-type',
      'encryptedKey',
      'iv',
      'privateKey',
      'encryptionKey',
      'nonce',
      'ipfsUrl',
      'ipfsHash',
      'mimeType',
      'version',
      'authTag',
      // Media alignment attrs (no data- prefix, so not auto-allowed).
      'dataalign',
      'datafloat',
    ],
  });

  // Parse the sanitized HTML string into DOM nodes
  const domContent = parser.parseFromString(convertedHtml, 'text/html').body;

  // Convert the DOM nodes to ProseMirror nodes using ProseMirror's DOMParser
  const proseMirrorNodes = ProseMirrorDOMParser.fromSchema(
    view.state.schema,
  ).parse(domContent);

  // Post-process: replace "===" paragraphs with pageBreak nodes (v1 wraps
  // them in a dBlock; flat v2 has them top-level), and collapse runs of
  // empty paragraphs — pasted HTML (Wikipedia and friends) carries stacks of
  // empty <p> that render as huge gaps. A single empty paragraph is kept as
  // possible intent; consecutive ones are junk.
  const isEmptyParagraphBlock = (child: PMNode) => {
    if (child.type.name === 'paragraph') return child.childCount === 0;
    return (
      child.type.name === 'dBlock' &&
      child.childCount === 1 &&
      child.firstChild!.type.name === 'paragraph' &&
      child.firstChild!.childCount === 0
    );
  };

  const newChildren: PMNode[] = [];
  let previousWasEmptyParagraph = false;
  proseMirrorNodes.forEach((child: PMNode) => {
    if (isEmptyParagraphBlock(child)) {
      if (!previousWasEmptyParagraph) {
        newChildren.push(child);
      }
      previousWasEmptyParagraph = true;
      return;
    }
    previousWasEmptyParagraph = false;

    if (child.type.name === 'dBlock' && child.childCount === 1) {
      const inner = child.firstChild!;
      if (
        inner.type.name === 'paragraph' &&
        inner.textContent.trim() === '==='
      ) {
        newChildren.push(view.state.schema.nodes.pageBreak.create());
        return;
      }
    }
    if (child.type.name === 'paragraph' && child.textContent.trim() === '===') {
      newChildren.push(view.state.schema.nodes.pageBreak.create());
      return;
    }
    newChildren.push(child);
  });

  const finalDoc = proseMirrorNodes.copy(Fragment.fromArray(newChildren));

  // Insert the content and apply the transaction.
  const transaction = view.state.tr;
  if (options?.replaceAll) {
    // Replace the WHOLE document, addressed by range — not by selection.
    // Split View's apply can await image uploads above, and a selection
    // change during that await (a click, a tab switch) must not turn the
    // full-doc replace into an insert-at-cursor.
    transaction.replaceWith(0, view.state.doc.content.size, finalDoc.content);
  } else {
    transaction.replaceSelectionWith(finalDoc, false);
  }
  view.dispatch(transaction);
}

export default MarkdownPasteHandler;

async function recreateNodeWithImageContent(
  node: PMNode,
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>,
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>,
  shouldCompress: boolean = false,
): Promise<PMNode> {
  const { version, mimeType, ipfsHash, ...attrs } = node.attrs;
  // SVG is text — canvas compression would rasterize it (or wrap JPEG bytes
  // in an image/svg+xml data URI). It ships uncompressed; TEC-2680.
  const isSvg = mimeType === 'image/svg+xml';
  let buffer: ArrayBuffer;

  try {
    if (version == '2' && ipfsImageFetchFn) {
      const { encryptionKey, url: ipfsUrl, nonce, authTag } = attrs as any;
      const result = await ipfsImageFetchFn({
        encryptionKey,
        ipfsUrl,
        nonce,
        ipfsHash,
        mimeType,
        authTag,
      });
      // No compression here: the shared shouldCompress block below handles
      // it with a Blob stamped from the node's mimeType. The decrypted File
      // is typeless (penumbra), so compressing it directly always failed
      // ("must be an image File or Blob") and would double-compress once
      // the mime-stamp fix lands.
      buffer = await result.file.arrayBuffer();
    } else {
      const { url, encryptedKey, iv, privateKey } = attrs;
      if (!url || !encryptedKey || !iv || !privateKey) return node;

      const imageBuffer = await fetchV1ImageFn?.(url);
      if (!imageBuffer) return node;

      // Ensure privateKey is passed as a proper ArrayBuffer (BufferSource).
      // toByteArray may return a Uint8Array backed by ArrayBufferLike (e.g. SharedArrayBuffer),
      // so create a copy into a new Uint8Array which has a standard ArrayBuffer to satisfy TS/WebCrypto.
      const pkBytes = toByteArray(privateKey);
      const pkCopy = new Uint8Array(pkBytes); // copies into a new ArrayBuffer

      const decrypted = await decryptImage({
        encryptedKey,
        iv,
        privateKey: pkCopy.buffer,
        imageBuffer,
      });
      if (!decrypted) return node;

      buffer = decrypted;
    }
    if (shouldCompress && !isSvg) {
      const imgBlob = new Blob([buffer], { type: mimeType || 'image/jpeg' });
      const compressed = await compressImage(imgBlob, 'MEDIUM', false);

      buffer = await compressed.arrayBuffer();
    }
    const base64 = arrayBufferToBase64(buffer);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;
    const newAttrs = { ...node.attrs, src: dataUrl };

    return node.type.createChecked(newAttrs, node.content, node.marks);
  } catch (err) {
    console.error('Error processing image node:', err);
    return node;
  }
}

type StackItem = {
  node: PMNode;
  index: number;
  childResults: PMNode[];
  parent: StackItem | null;
  newNode?: Node; // once we build it
};

export async function searchForSecureImageNodeAndEmbedImageContent(
  originalDoc: PMNode,
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>,
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>,
  shouldCompress: boolean = false,
): Promise<PMNode> {
  // We'll do a post-order traversal using a stack
  // so that we can handle children first, then build the parent node.

  // Each stack item has:
  //  node: the original node
  //  index: which child index we're processing
  //  childResults: the array of new child nodes we've built
  //  parent: reference to the parent stack item (for building up the tree)
  const rootItem: StackItem = {
    node: originalDoc,
    index: 0,
    childResults: [],
    parent: null,
  };

  const stack: StackItem[] = [rootItem];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];

    // If we've not visited all children...
    if (current.index < current.node.childCount) {
      const childNode = current.node.child(current.index);
      // push a new item for that child
      const childItem: StackItem = {
        node: childNode,
        index: 0,
        childResults: [],
        parent: current,
      };
      current.index++;
      stack.push(childItem);
      continue;
    }

    // All children are processed => we can build/transform this node
    if (!current.newNode) {
      if (current.node.attrs['media-type'] === 'secure-img') {
        current.newNode = (await recreateNodeWithImageContent(
          current.node,
          ipfsImageFetchFn,
          fetchV1ImageFn,
          shouldCompress,
        )) as any;
      } else if (
        current.node.attrs['media-type'] === 'img' &&
        shouldCompress &&
        isValidBase64Image(current.node.attrs['src'] as string) &&
        !isSvgDataUri(current.node.attrs['src'] as string)
      ) {
        const { compressedBase64, mimeType } = await getCompressedBase64Image(
          current.node.attrs['src'],
          'MEDIUM',
        );
        const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${compressedBase64}`;
        const newAttrs = { ...current.node.attrs, src: dataUrl };

        current.newNode = current.node.type.createChecked(
          newAttrs,
          current.node.content,
          current.node.marks,
        ) as any;
      } else {
        // Not a secure image => just copy node with new children
        // Build a Fragment from our childResults
        const newFrag = Fragment.fromArray(current.childResults);
        current.newNode = current.node.copy(newFrag) as any;
      }
    }

    // Now we have built a `newNode`.
    // Pop from stack, and add this newNode to parent's childResults (unless we're the root).
    stack.pop();

    if (current.parent) {
      current.parent.childResults.push(current.newNode as any);
    } else {
      // If no parent => this is the root => we are done, return newNode
      return current.newNode as any;
    }
  }

  // we never get here because we return inside
  // the block above when we pop the root item.
  throw new Error('transformDocIterative: unexpected stack exit');
}
