import renderMathInElement from 'katex/contrib/auto-render';
import { getRegisteredFonts, primaryToken } from './font-loader';
import type { FontDescriptor } from '../types';

const A4_HEIGHT_INCHES = 11.69;
const A4_WIDTH_INCHES = 8.27;
const PAGE_MARGIN_VERTICAL_INCHES = 0.83;
const PAGE_MARGIN_HORIZONTAL_INCHES = 0.83;
const CSS_DPI = 96;
const CONTENT_PRINT_TITLE = 'Print Preview';
const CONTENT_PRINT_MEASUREMENT_HOST_ID = 'content-print-measurement-host';
const CONTENT_PRINT_RESOURCE_TIMEOUT_MS = 5000;

/**
 * Generates an @font-face block per registered font (and per weight, for
 * per-weight URL maps) so the print iframe can resolve consumer-provided
 * fonts. URLs come from the same catalog the editor uses; the iframe shares
 * the parent origin so same-origin asset URLs resolve directly.
 */
const buildRegisteredFontFaceCss = (): string => {
  const faces: string[] = [];
  for (const desc of getRegisteredFonts() as FontDescriptor[]) {
    if (!desc.url) continue;
    // Derive the CSS face name from the family stack, not the cosmetic `name`,
    // so the @font-face matches the styled content in the iframe.
    const cssName = primaryToken(desc.family);
    const entries: Array<[number, string]> =
      typeof desc.url === 'string'
        ? [[400, desc.url]]
        : Object.entries(desc.url).map(([w, u]) => [Number(w), u]);
    for (const [weight, url] of entries) {
      faces.push(
        `@font-face{font-family:"${cssName}";src:url("${url}") format('woff2');font-weight:${weight};font-style:normal;font-display:swap;}`,
      );
    }
  }
  return faces.join('');
};
const KATEX_STYLESHEET_URL =
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css';
const KATEX_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js';
const KATEX_AUTORENDER_SCRIPT_URL =
  'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js';

const PRINTABLE_PAGE_WIDTH_PX = Math.floor(
  (A4_WIDTH_INCHES - PAGE_MARGIN_HORIZONTAL_INCHES * 2) * CSS_DPI,
);
const PRINTABLE_PAGE_HEIGHT_PX = Math.floor(
  (A4_HEIGHT_INCHES - PAGE_MARGIN_VERTICAL_INCHES * 2) * CSS_DPI,
);

const CONTENT_STYLES = `
  .print-content-root {
    font-family: Arial, sans-serif;
    line-height: 1.6;
    margin: 0;
  }
  .print-content-root img {
    max-width: 100%;
    height: auto;
    aspect-ratio: auto;
    display: block;
    margin-left: auto;
    margin-right: auto;
  }
  .print-content-root [data-type='resizable-media'] {
    border: none;
  }
  .print-content-root [data-type='resizable-media'] > img[width='100%'] {
    width: auto;
  }
  .print-content-root [data-type='resizable-media'][dataalign='start'] > img,
  .print-content-root [data-type='resizable-media'][dataalign='left'] > img {
    margin-left: 0;
  }
  .print-content-root [data-type='resizable-media'][dataalign='end'] > img,
  .print-content-root [data-type='resizable-media'][dataalign='right'] > img {
    margin-right: 0;
  }
  .print-content-root h3 {
    font-weight: 600;
    color: #0D0D0D;
    font-size: 20px;
    line-height: 1.2;
  }
  .print-content-root p {
    line-height: 1.5;
    color: #0D0D0D;
    font-size: 16px;
  }
  .print-content-root ul,
  .print-content-root ol {
    font-size: 16px;
    line-height: 1.5;
    /* Longhands so an inline margin-top from authored spacing is not fighting
       a shorthand that also resets the bottom. */
    margin-top: 0;
    margin-bottom: 16px;
    padding-left: 24px;
  }
  .print-content-root input[type='checkbox'] {
    -webkit-appearance: none;
    appearance: none;
    background-color: #fff;
    margin: 0;
    cursor: pointer;
    width: 1.5em;
    height: 1.5em;
    position: relative;
    border: 2px solid black;
    margin-right: .5rem;
    display: grid;
    place-content: center;
    font-family: 'Inter', sans-serif;
  }
  .print-content-root input[type='checkbox']::before {
    content: '';
    width: 1em;
    height: 1em;
    transform: scale(0);
    transition: 120ms transform ease-in-out;
    box-shadow: inset 1em 1em;
    transform-origin: center;
    clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
  }
  .print-content-root input[type='checkbox']:checked::before {
    transform: scale(1);
  }
  .print-content-root li:has(input[type="checkbox"]) {
    list-style-type: none;
    transform: translateX(-16px);
    font-size: 24px;
    display: flex;
    align-items: center;
  }
  .print-content-root ol {
    list-style-type: decimal;
  }
  .print-content-root ol ol {
    list-style-type: lower-latin;
  }
  .print-content-root ol ol ol {
    list-style-type: lower-roman;
  }
  .print-content-root table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
    font-size: 16px;
  }
  .print-content-root th {
    background: #F8F9FA;
    font-weight: 600;
    text-align: left;
  }
  .print-content-root td,
  .print-content-root th {
    border: 1px solid #E8EBEC;
    padding: 12px;
  }
  .print-content-root pre {
    background: #F8F9FA;
    padding: 16px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 12px;
    margin: 16px 0;
  }
  .print-content-root blockquote {
    border-left: 4px solid #E8EBEC;
    margin: 16px 0;
    padding-left: 16px;
    font-style: italic;
  }
  .print-content-root [data-type="columns"] {
    width: 100%;
    display: flex;
    flex-direction: row;
    justify-content: space-between;
  }
  .print-content-root .katex {
    font-size: 1.1em;
  }
  .print-content-root .katex-display {
    margin: 1em 0;
    overflow-x: auto;
    overflow-y: hidden;
    text-align: center;
  }
  .print-content-root .katex-display > .katex {
    display: inline-block;
    text-align: initial;
  }
  .print-page {
    page-break-after: always;
    box-sizing: border-box;
  }
  .print-page:last-child {
    page-break-after: auto;
  }
  .print-content-root .tab-title-page {
    min-height: calc(${A4_HEIGHT_INCHES}in - ${PAGE_MARGIN_VERTICAL_INCHES * 2}in);
    display: flex;
    align-items: flex-start;
    justify-content: flex-start;
    text-align: left;
    padding: 0 1rem;
    box-sizing: border-box;
  }
  .print-content-root .tab-title-page__text {
    margin: 0;
    font-size: 36px;
    line-height: 1.2;
    font-weight: 600;
    color: #0d0d0d;
    word-break: break-word;
  }
`;

const CONTENT_MEDIA_STYLES = `
  @media print {
    @page {
      margin: ${PAGE_MARGIN_VERTICAL_INCHES}in ${PAGE_MARGIN_HORIZONTAL_INCHES}in;
    }
    html {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    body {
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      margin: 0;
    }
    body:before,
    body:after,
    head:before,
    head:after,
    div:before,
    div:after,
    html:before,
    html:after {
      content: none !important;
      display: none !important;
    }
  }
`;

const createMeasurementContentRoot = (
  iframeDocument: Document,
  host: HTMLDivElement,
  sectionsHtml: string,
) => {
  const contentRoot = iframeDocument.createElement('div');

  contentRoot.className = 'print-content-root';
  contentRoot.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${PRINTABLE_PAGE_WIDTH_PX}px;
    visibility: hidden;
    pointer-events: none;
  `;

  contentRoot.innerHTML = sectionsHtml;

  host.appendChild(contentRoot);

  return contentRoot;
};
const CONTENT_PRINT_KATEX_OPTIONS = {
  delimiters: [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false },
  ],
  throwOnError: false,
};

interface PageCounter {
  getPageCount: (content: string) => Promise<number>;
  destroy: () => void;
}

interface ContentPrintMeasurementFrame {
  iframe: HTMLIFrameElement;
  iframeDocument: Document;
  host: HTMLDivElement;
}

const getSectionHtml = (nodes: Node[]) => {
  const sectionDiv = document.createElement('div');
  nodes.forEach((node) => sectionDiv.appendChild(node));
  return sectionDiv.innerHTML;
};

// Preserve explicit empty pages around manual breaks so the live estimate
// matches what print/export will generate for trailing or consecutive breaks.
export const splitContentIntoPrintSections = (content: string): string[] => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = content;

  const sections: string[] = [];
  let currentSectionContent: Node[] = [];
  let endedWithPageBreak = false;

  Array.from(tempDiv.childNodes).forEach((node) => {
    const isPageBreak =
      node instanceof HTMLElement &&
      node.getAttribute('data-page-break') === 'true';

    if (isPageBreak) {
      sections.push(getSectionHtml(currentSectionContent));
      currentSectionContent = [];
      endedWithPageBreak = true;
      return;
    }

    currentSectionContent.push(node);
    endedWithPageBreak = false;
  });

  if (
    currentSectionContent.length > 0 ||
    endedWithPageBreak ||
    sections.length === 0
  ) {
    sections.push(getSectionHtml(currentSectionContent));
  }

  return sections;
};

const getPrintSectionsHtml = (sections: string[]) =>
  sections
    .map(
      (sectionContent) => `
        <div class="print-page">
            ${sectionContent}
        </div>
    `,
    )
    .join('');

const contentLikelyContainsMath = (html: string) =>
  CONTENT_PRINT_MATH_PATTERN.test(html) ||
  html.includes('data-type="equation"') ||
  html.includes('class="katex"') ||
  html.includes('class="katex-display"');

const CONTENT_PRINT_MATH_PATTERN = /(^|[^\\])\$(\$)?[\s\S]+?\$(\$)?/;

// Both the browser print iframe and the measurement iframe should start from
// the same head/styles so the live estimate stays aligned with export layout.
const buildContentPrintHead = ({
  includePrintMediaStyles = true,
  includeMathScripts = false,
  includeRemoteStylesheets = true,
}: {
  includePrintMediaStyles?: boolean;
  includeMathScripts?: boolean;
  includeRemoteStylesheets?: boolean;
}) => `
  <head>
    <style>${buildRegisteredFontFaceCss()}</style>
    ${
      includeRemoteStylesheets
        ? `
    <link rel="stylesheet" href="${KATEX_STYLESHEET_URL}" />
    `
        : ''
    }

    ${
      includeMathScripts
        ? `
    <script defer src="${KATEX_SCRIPT_URL}"></script>
    <script defer src="${KATEX_AUTORENDER_SCRIPT_URL}"></script>
    `
        : ''
    }

    <title>${CONTENT_PRINT_TITLE}</title>
    <style>
      ${includePrintMediaStyles ? CONTENT_MEDIA_STYLES : ''}
      ${CONTENT_STYLES}
    </style>
  </head>
`;

// Class for the print host injected into the live document. Content prints via
// the host page (not an iframe) because iOS WebKit's iframe print pipeline is
// unreliable — it prints the host page or a blank page. Chrome/Firefox on iOS
// share WebKit's rendering but use their own print pipelines, so only a
// page-level print with print-media scoping is reliable across them.
const PRINT_HOST_CLASS = 'ddoc-print-host';

// Restores the document baseline the iframe used to get "for free" from the UA
// stylesheet. In the live app document the global reset (e.g. Tailwind
// preflight) zeroes margins and collapses heading sizes, so the print content
// must re-declare its own typography/spacing. Scoped to `.print-content-root`
// and intentionally left off KaTeX-rendered nodes (a blanket reset would break
// math). Declared before CONTENT_STYLES so existing overrides still win.
const MAIN_DOCUMENT_PRINT_BASELINE = `
  .print-content-root {
    color: #0D0D0D;
    background: #fff;
    color-scheme: light;
    font-size: 16px;
    line-height: 1.6;
  }
  /* Longhands, not the margin shorthand: authored spacing arrives as an inline
     margin-top or margin-bottom, and a shorthand here would keep overriding
     whichever side the author left unset. */
  .print-content-root h1 { font-size: 2em; font-weight: 600; line-height: 1.2; margin-top: 0; margin-bottom: 0.67em; color: #0D0D0D; }
  .print-content-root h2 { font-size: 1.5em; font-weight: 600; line-height: 1.2; margin-top: 0; margin-bottom: 0.83em; color: #0D0D0D; }
  .print-content-root h3 { font-size: 1.17em; font-weight: 600; line-height: 1.2; margin-top: 0; margin-bottom: 1em; color: #0D0D0D; }
  .print-content-root h4 { font-size: 1em; font-weight: 600; margin-top: 0; margin-bottom: 1.33em; color: #0D0D0D; }
  .print-content-root h5 { font-size: 0.83em; font-weight: 600; margin-top: 0; margin-bottom: 1.67em; color: #0D0D0D; }
  .print-content-root h6 { font-size: 0.67em; font-weight: 600; margin-top: 0; margin-bottom: 2.33em; color: #0D0D0D; }
  .print-content-root p { margin-top: 0; margin-bottom: 12px; }
  .print-content-root ul { list-style: disc; }
  .print-content-root ol { list-style: decimal; }
  .print-content-root ul, .print-content-root ol { margin-top: 0; margin-bottom: 16px; padding-left: 24px; }
  .print-content-root li { margin-top: 0; margin-bottom: 4px; }
  .print-content-root a { color: #3B82F6; text-decoration: underline; }
  .print-content-root strong, .print-content-root b { font-weight: 600; }
  .print-content-root em, .print-content-root i { font-style: italic; }
  .print-content-root hr { border: none; border-top: 1px solid #E8EBEC; margin: 16px 0; }
  .print-content-root img { max-width: 100%; height: auto; }
  .print-content-root code { font-family: monospace; }
`;

// Styles injected alongside the print host. The host is hidden on screen and
// revealed only for print, while every other top-level node in the page is
// hidden during print — so the printout contains the document content alone.
const buildMainDocumentPrintStyles = () => `
  ${buildRegisteredFontFaceCss()}
  .${PRINT_HOST_CLASS} { display: none; }
  ${MAIN_DOCUMENT_PRINT_BASELINE}
  ${CONTENT_STYLES}
  ${CONTENT_MEDIA_STYLES}
  @media print {
    /* The app shell often pins html/body to the viewport height with
       overflow hidden; left as-is it clips the printout to a single page and
       skews the margins. Reset it so content paginates freely. */
    html, body {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      margin: 0 !important;
      padding: 0 !important;
      overflow: visible !important;
    }
    /* Mobile WebKit honors @page margins unreliably, so only the vertical
       (per-page) margins ride on @page. Horizontal margins are applied as
       container padding, which every page inherits because the content column
       width is constant across page breaks. */
    @page { margin: ${PAGE_MARGIN_VERTICAL_INCHES}in 0; }
    body > *:not(.${PRINT_HOST_CLASS}) { display: none !important; }
    .${PRINT_HOST_CLASS} {
      display: block !important;
      position: static !important;
      height: auto !important;
      max-height: none !important;
      overflow: visible !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .${PRINT_HOST_CLASS} .print-content-root {
      box-sizing: border-box;
      padding-left: ${PAGE_MARGIN_HORIZONTAL_INCHES}in !important;
      padding-right: ${PAGE_MARGIN_HORIZONTAL_INCHES}in !important;
    }
  }
`;

const buildContentPrintMeasurementDocument = () => `
  <!doctype html>
  <html>
    ${buildContentPrintHead({
      includePrintMediaStyles: true,
      includeRemoteStylesheets: false, // Do not block on fonts/stylesheets here, else typing becomes network-bound.
    })}
    <body>
      <div id="${CONTENT_PRINT_MEASUREMENT_HOST_ID}"></div>
    </body>
  </html>
`;

const waitForAnimationFrame = (view: Window | null | undefined = window) =>
  new Promise<void>((resolve) => {
    const requestFrame = view?.requestAnimationFrame?.bind(view);

    if (requestFrame) {
      requestFrame(() => resolve());
      return;
    }

    window.setTimeout(() => resolve(), 16);
  });

const waitForMeasurementImages = async (container: ParentNode) => {
  const images = Array.from(container.querySelectorAll('img'));

  if (images.length === 0) {
    return;
  }

  await Promise.all(
    images.map(
      (image) =>
        new Promise<void>((resolve) => {
          if (image.complete) {
            resolve();
            return;
          }

          const ownerWindow = image.ownerDocument.defaultView ?? window;
          const cleanup = () => {
            image.removeEventListener('load', onLoad);
            image.removeEventListener('error', onError);
            ownerWindow.clearTimeout(timeoutId);
          };

          const onLoad = () => {
            cleanup();
            resolve();
          };

          const onError = () => {
            cleanup();
            resolve();
          };

          const timeoutId = ownerWindow.setTimeout(() => {
            cleanup();
            resolve();
          }, CONTENT_PRINT_RESOURCE_TIMEOUT_MS);

          image.addEventListener('load', onLoad, { once: true });
          image.addEventListener('error', onError, { once: true });
        }),
    ),
  );
};

const createMeasurementIframe = () => {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.tabIndex = -1;
  iframe.style.cssText = `
    position: absolute;
    left: -9999px;
    top: 0;
    width: ${PRINTABLE_PAGE_WIDTH_PX}px;
    height: ${PRINTABLE_PAGE_HEIGHT_PX}px;
    visibility: hidden;
    pointer-events: none;
    border: 0;
  `;
  document.body.appendChild(iframe);

  return iframe;
};

const createContentPrintMeasurementFrame = async (
  iframe: HTMLIFrameElement,
): Promise<ContentPrintMeasurementFrame> => {
  const iframeDocument = iframe.contentDocument;

  if (!iframeDocument) {
    throw new Error('Unable to access print measurement iframe document.');
  }

  iframeDocument.open();
  iframeDocument.write(buildContentPrintMeasurementDocument());
  iframeDocument.close();

  const host = iframeDocument.getElementById(
    CONTENT_PRINT_MEASUREMENT_HOST_ID,
  ) as HTMLDivElement | null;

  if (!host) {
    throw new Error('Unable to initialize print measurement host.');
  }

  // The host mirrors the printable page width so the estimated heights are
  // based on export-style wrapping instead of the editor viewport.
  host.style.cssText = `
    position: relative;
    width: ${PRINTABLE_PAGE_WIDTH_PX}px;
    min-height: ${PRINTABLE_PAGE_HEIGHT_PX}px;
    overflow: hidden;
  `;

  return {
    iframe,
    iframeDocument,
    host,
  };
};

export const createPageCounter = (): PageCounter => {
  const iframe = createMeasurementIframe();
  const framePromise = createContentPrintMeasurementFrame(iframe);

  let isDestroyed = false;
  let latestRequestId = 0;

  return {
    getPageCount: async (content: string): Promise<number> => {
      const requestId = ++latestRequestId;

      const sections = splitContentIntoPrintSections(content); // preserve page-break semantics, else page count diverges from print/export.

      if (sections.length === 0 || isDestroyed) {
        return 1;
      }

      let frame: ContentPrintMeasurementFrame;

      try {
        frame = await framePromise;
      } catch {
        return 1;
      }

      if (isDestroyed || requestId !== latestRequestId) {
        return 1;
      }

      const sectionsHtml = getPrintSectionsHtml(sections);

      // Create a fresh root per request, else concurrent estimates will
      // measure and clear the same subtree.
      const contentRoot = createMeasurementContentRoot(
        frame.iframeDocument,
        frame.host,
        sectionsHtml,
      );

      try {
        // Gate KaTeX work on the HTML, else every estimate pays the math
        // rendering cost whether or not equations exist.
        if (contentLikelyContainsMath(sectionsHtml)) {
          renderMathInElement(contentRoot, CONTENT_PRINT_KATEX_OPTIONS);
          await waitForAnimationFrame(frame.iframe.contentWindow);
        }

        if (isDestroyed || requestId !== latestRequestId) {
          return 1;
        }

        // Wait for images before measuring, else late loads will undercount
        // the section height.
        await waitForMeasurementImages(contentRoot);

        if (isDestroyed || requestId !== latestRequestId) {
          return 1;
        }

        await waitForAnimationFrame(frame.iframe.contentWindow);

        if (isDestroyed || requestId !== latestRequestId) {
          return 1;
        }

        const sectionElements = Array.from(
          contentRoot.querySelectorAll<HTMLElement>('.print-page'),
        );

        const pageCount = sectionElements.reduce((total, sectionElement) => {
          const contentHeight = Math.max(
            sectionElement.scrollHeight,
            Math.ceil(sectionElement.getBoundingClientRect().height),
          );

          return (
            total +
            Math.max(1, Math.ceil(contentHeight / PRINTABLE_PAGE_HEIGHT_PX))
          );
        }, 0);

        return Math.max(1, pageCount);
      } finally {
        if (contentRoot.parentNode) {
          contentRoot.parentNode.removeChild(contentRoot);
        }
      }
    },

    destroy: () => {
      isDestroyed = true;
      latestRequestId += 1;

      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    },
  };
};

export const handlePrint = (slides: string[]) => {
  const slidesHTML = slides
    .map(
      (slideContent) => `
        <div class="print-slide">
            <div class="slide-wrapper">
                <div class="slide-content ProseMirror presentation-mode">
                    ${slideContent}
                </div>
            </div>
        </div>
    `,
    )
    .join('');

  const printContent = `
        <!DOCTYPE html>
        <html>
            <head>
                <style>${buildRegisteredFontFaceCss()}</style>
                <style>
                    @media print {
                        @page {
                            size: landscape;
                            margin: 0;
                        }
                        
                        body {
                            margin: 0;
                            font-family: 'Inter', sans-serif;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }

                        .print-slide {
                            page-break-after: always;
                            width: 100vw;
                            height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            background: #E8EBEC;
                        }

                        .slide-wrapper {
                            width: 1080px;
                            height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            background: white;
                            border-radius: 8px;
                            padding: 48px;
                            box-sizing: border-box;
                        }

                        .slide-content {
                            width: 100%;
                            height: 100%;
                            display: flex;
                            flex-direction: column;
                            padding: 0 64px;
                            box-sizing: border-box;
                            overflow: hidden;
                        }

                        /* Typography */
                        .ProseMirror h1 {
                            font-size: 82px;
                            font-weight: 700;
                            margin: 0 0 24px 0;
                            color: #0D0D0D;
                            line-height: 1.2;
                        }

                        .ProseMirror h2 {
                            font-size: 40px;
                            font-weight: 700;
                            margin: 0 0 16px 0;
                            color: #0D0D0D;
                            line-height: 1.2;
                        }

                        .ProseMirror h3 {
                            font-size: 24px;
                            font-weight: 600;
                            margin: 0 0 16px 0;
                            color: #0D0D0D;
                            line-height: 1.2;
                        }

                        .ProseMirror p {
                            font-size: 24px;
                            line-height: 1.5;
                            margin: 0 0 16px 0;
                            color: #0D0D0D;
                        }

                        /* Lists */
                        .ProseMirror ul,
                        .ProseMirror ol {
                            font-size: 24px;
                            line-height: 1.5;
                            margin: 0 0 16px 0;
                            padding-left: 24px;
                        }

                        .ProseMirror li {
                            margin-bottom: 8px;
                        }

                        /* Task List Styles */
                        input[type='checkbox'] {
                            -webkit-appearance: none;
                            appearance: none;
                            background-color: #fff;
                            margin: 0;
                            cursor: pointer;
                            width: 1.5em;
                            height: 1.5em;
                            position: relative;
                            border: 2px solid black;
                            margin-right: .5rem;
                            display: grid;
                            place-content: center;
                        }

                        input[type='checkbox']::before {
                            content: '';
                            width: 1em;
                            height: 1em;
                            transform: scale(0);
                            transition: 120ms transform ease-in-out;
                            box-shadow: inset 1em 1em;
                            transform-origin: center;
                            clip-path: polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%);
                        }

                        input[type='checkbox']:checked::before {
                            transform: scale(1);
                        }

                        li:has(input[type="checkbox"]) {
                            list-style-type: none;
                            font-size: 24px;
                            display: flex;
                            align-items: center;
                            margin: 0 0 24px 0;
                        }

                        /* Tables */
                        .ProseMirror table {
                            width: 100%;
                            border-collapse: collapse;
                            margin: 16px 0;
                            font-size: 20px;
                        }

                        .ProseMirror th {
                            background: #F8F9FA;
                            font-weight: 600;
                            text-align: left;
                        }

                        .ProseMirror td,
                        .ProseMirror th {
                            border: 1px solid #E8EBEC;
                            padding: 12px;
                        }

                        /* Images */
                        .ProseMirror img {
                            max-width: 720px;
                            max-height: calc(100vh - 96px);
                            display: block;
                            margin: 16px auto;
                            position: relative;
                            box-sizing: border-box;
                            aspect-ratio: auto;
                        }

                        /* Code blocks */
                        .ProseMirror pre {
                            background: #F8F9FA;
                            padding: 16px;
                            border-radius: 4px;
                            font-family: monospace;
                            font-size: 16px;
                            margin: 16px 0;
                        }

                        /* Blockquotes */
                        .ProseMirror blockquote {
                            border-left: 4px solid #E8EBEC;
                            margin: 16px 0;
                            padding-left: 16px;
                            font-style: italic;
                        }

                        /* Flex containers */
                        .ProseMirror div[style*="display: flex"] {
                            display: flex !important;
                            gap: 16px;
                        }

                        .ProseMirror div[style*="flex-direction: row"] {
                            flex-direction: row !important;
                        }

                        .ProseMirror div[style*="flex-direction: column"] {
                            flex-direction: column !important;
                        }

                        /* Hide UI elements */
                        .preview-panel,
                        .toolbar,
                        .icon-button {
                            display: none !important;
                        }
                    }
                </style>
            </head>
            <body>
                ${slidesHTML}
                <script>
                    window.onload = () => {
                        window.print();
                        window.onafterprint = () => window.close();
                    }
                </script>
            </body>
        </html>
    `;

  printHelper(printContent);
};

export const handleContentPrint = (content: string) => {
  const sectionsHtml = getPrintSectionsHtml(
    splitContentIntoPrintSections(content),
  );

  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-ddoc-print', 'true');
  styleEl.textContent = buildMainDocumentPrintStyles();

  const host = document.createElement('div');
  host.className = PRINT_HOST_CLASS;
  host.setAttribute('aria-hidden', 'true');

  const contentRoot = document.createElement('div');
  contentRoot.className = 'print-content-root';
  contentRoot.innerHTML = sectionsHtml;
  host.appendChild(contentRoot);

  document.head.appendChild(styleEl);
  document.body.appendChild(host);

  // KaTeX is bundled with the package, so render math directly against the host
  // — no CDN scripts or cross-document load to race against.
  try {
    renderMathInElement(contentRoot, CONTENT_PRINT_KATEX_OPTIONS);
  } catch {
    // Math rendering is best-effort; print regardless.
  }

  const state: { fallback?: ReturnType<typeof setTimeout> } = {};
  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    if (state.fallback) clearTimeout(state.fallback);
    if (styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    if (host.parentNode) host.parentNode.removeChild(host);
  };
  window.addEventListener('afterprint', cleanup);
  // Safety net: some mobile browsers don't reliably fire afterprint.
  state.fallback = setTimeout(cleanup, 60000);

  // Defer one frame so the injected node is committed before printing.
  requestAnimationFrame(() => window.print());
};

const printHelper = (content: string) => {
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.48)';
  overlay.style.zIndex = '9999';

  document.body.appendChild(overlay);

  // Render the print iframe off-screen. If it sits anywhere within the
  // viewport, mobile browsers (iOS Safari, Android Chrome) print the host page
  // — navbar and app UI included — instead of the iframe's own document.
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.top = '0';
  iframe.style.left = '-9999px';
  iframe.style.width = '1px';
  iframe.style.height = '1px';
  iframe.style.border = 'none';
  iframe.style.zIndex = '-1';

  document.body.appendChild(iframe);

  const printDocument =
    iframe.contentDocument || iframe.contentWindow?.document;
  if (!printDocument) {
    // Cleanup if iframe creation fails
    document.body.removeChild(overlay);
    return;
  }

  // Add cleanup timeout as a fallback
  const cleanupTimeout = setTimeout(() => {
    if (document.body.contains(overlay)) {
      document.body.removeChild(overlay);
    }
    if (document.body.contains(iframe)) {
      document.body.removeChild(iframe);
    }
  }, 30000); // 30 second timeout

  printDocument.open();
  printDocument.write(content);
  printDocument.close();

  const iframeWindow = iframe.contentWindow;
  if (iframeWindow) {
    iframeWindow.onafterprint = () => {
      clearTimeout(cleanupTimeout);
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    };

    // Add error handling for print
    iframeWindow.onerror = () => {
      clearTimeout(cleanupTimeout);
      if (document.body.contains(overlay)) {
        document.body.removeChild(overlay);
      }
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    };
  }
};
