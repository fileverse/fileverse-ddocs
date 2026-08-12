import DOMPurify from 'dompurify';
import { toByteArray } from 'base64-js';
import { arrayBufferToBase64 } from './security';

const SVG_DATA_URI = /^data:image\/svg\+xml[;,]/i;
const SVG_NS = 'http://www.w3.org/2000/svg';

export const isSvgDataUri = (src: string): boolean => SVG_DATA_URI.test(src);

export const decodeSvgDataUri = (src: string): string | null => {
  if (!isSvgDataUri(src)) return null;
  const comma = src.indexOf(',');
  if (comma === -1) return null;
  const meta = src.slice(0, comma);
  const payload = src.slice(comma + 1);
  try {
    if (/;base64$/i.test(meta)) {
      return new TextDecoder().decode(toByteArray(payload.replace(/\s+/g, '')));
    }
    try {
      return decodeURIComponent(payload);
    } catch {
      return payload;
    }
  } catch {
    return null;
  }
};

export const sanitizeSvgForEmbed = (
  svgText: string,
  width?: string | null,
): string | null => {
  const clean = DOMPurify.sanitize(svgText, {
    USE_PROFILES: { svg: true, svgFilters: true },
  });
  if (!clean) return null;
  const body = new DOMParser().parseFromString(clean, 'text/html').body;
  const root = body.firstElementChild;
  if (
    !root ||
    root.nodeName.toLowerCase() !== 'svg' ||
    body.childElementCount !== 1
  ) {
    return null;
  }
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', SVG_NS);
  if (width && width !== '100%') root.setAttribute('width', width);
  const serialized = new XMLSerializer().serializeToString(root);
  // One raw HTML block for markdown-it: no blank lines anywhere, and the
  // opening tag ALONE on line 1 (CommonMark html_block rule 7 — see the
  // Global Constraints of the 2026-08-13 svg-embed plan).
  return serialized
    .replace(/<svg\b[^>]*>/, (m) => m.replace(/\s*\n\s*/g, ' ') + '\n')
    .replace(/\n(?:[ \t]*\n)+/g, '\n')
    .trim();
};

export const encodeSvgToDataUri = (svgText: string): string =>
  `data:image/svg+xml;base64,${arrayBufferToBase64(
    new TextEncoder().encode(svgText).buffer,
  )}`;
