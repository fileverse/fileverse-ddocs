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

// Colors reach raw markup (svg root style, figure img style) — allow only
// shapes that cannot carry CSS payloads: hex, simple names, rgb()/hsl().
export const isSafeCssColor = (value: string): boolean =>
  /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
  /^[a-z]{3,20}$/i.test(value) ||
  /^(?:rgb|rgba|hsl|hsla)\([\d\s.,%/-]+\)$/i.test(value);

// An inline <svg>'s <style> is DOCUMENT-scoped in HTML — its rules hit the
// whole published page and collide across svgs (two Illustrator exports both
// define .st0). So every kept style block is rewritten: selectors get a
// per-svg scope-class prefix, at-rules are dropped, and declarations that
// reach outward (external url(), @import, expression()) are removed.
// url(#fragment) stays — that's how gradients/filters are referenced.
const SCOPE_PREFIX = 'svg-scope-';
const SCOPE_STRIP_RE = /\.svg-scope-[\w-]+\s+/g;

const hashText = (text: string): string => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
};

const dropAtRules = (css: string): string => {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '@') {
      const semi = css.indexOf(';', i);
      const brace = css.indexOf('{', i);
      if (brace === -1 || (semi !== -1 && semi < brace)) {
        i = semi === -1 ? css.length : semi + 1;
      } else {
        let depth = 1;
        let j = brace + 1;
        while (j < css.length && depth) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          j++;
        }
        i = j;
      }
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
};

const isSafeDecl = (decl: string): boolean =>
  !/expression\s*\(/i.test(decl) &&
  !/javascript\s*:/i.test(decl) &&
  !/url\(\s*['"]?(?!#)/i.test(decl) &&
  // image-set()/image() accept bare URL strings with no url() wrapper.
  !/image(?:-set)?\s*\(/i.test(decl);

const scopeSvgStyles = (root: Element): void => {
  const styles = Array.from(root.querySelectorAll('style'));
  if (!styles.length) return;
  const normalized = styles.map((el) =>
    dropAtRules(
      (el.textContent || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(SCOPE_STRIP_RE, ''),
    ),
  );
  const scopeClass = `${SCOPE_PREFIX}${hashText(normalized.join('\n'))}`;
  styles.forEach((el, idx) => {
    const rules: string[] = [];
    const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(normalized[idx]))) {
      const selector = m[1]
        .split(',')
        .map((part) => part.trim())
        // A leading combinator (`~ p` → `.scope ~ p`) would match the svg's
        // SIBLINGS instead of its descendants — reject those parts.
        .filter((part) => part && !/^[>+~|]/.test(part))
        .map((part) => `.${scopeClass} ${part}`)
        .join(', ');
      const decls = m[2]
        .split(';')
        .map((d) => d.trim())
        .filter((d) => d.includes(':') && isSafeDecl(d))
        .join('; ');
      if (selector && decls) rules.push(`${selector} { ${decls} }`);
    }
    if (rules.length) el.textContent = rules.join('\n');
    else el.remove();
  });
  if (!root.querySelector('style')) return;
  const classes = (root.getAttribute('class') || '')
    .split(/\s+/)
    .filter((c) => c && !c.startsWith(SCOPE_PREFIX));
  root.setAttribute('class', [...classes, scopeClass].join(' '));
};

export const sanitizeSvgForEmbed = (
  svgText: string,
  width?: string | null,
  backgroundColor?: string | null,
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
  scopeSvgStyles(root);
  if (width && width !== '100%') {
    // The resize width replaces the file's own box. Keeping the file's
    // height next to the new width skews the element (a square viewBox in
    // a wide box letterboxes the drawing and the backdrop paints the bars),
    // so move the drawing's ratio into a viewBox and drop the fixed height.
    if (!root.getAttribute('viewBox')) {
      const w = parseFloat(root.getAttribute('width') || '');
      const h = parseFloat(root.getAttribute('height') || '');
      if (w > 0 && h > 0) root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    root.setAttribute('width', width);
    if (root.getAttribute('viewBox')) root.removeAttribute('height');
  } else {
    // No resize width and no usable width on the file: an <img> falls back
    // to a 150px default while an inline <svg> fills its container, so the
    // editor and the published page disagree. Pin the natural size from the
    // viewBox (scaled by a concrete height when the file declares one).
    // Percentage lengths carry no size — treat them as absent.
    const attrWidth = root.getAttribute('width');
    if (!attrWidth || attrWidth.includes('%')) {
      const box = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/);
      const vbW = parseFloat(box[2]);
      const vbH = parseFloat(box[3]);
      if (vbW > 0) {
        const attrHeight = root.getAttribute('height');
        const hPx =
          attrHeight && !attrHeight.includes('%')
            ? parseFloat(attrHeight)
            : NaN;
        const natural = hPx > 0 && vbH > 0 ? hPx * (vbW / vbH) : vbW;
        root.setAttribute('width', String(Math.round(natural * 100) / 100));
        if (attrHeight && attrHeight.includes('%')) {
          root.removeAttribute('height');
        }
      }
    }
  }
  if (backgroundColor && isSafeCssColor(backgroundColor)) {
    // data- attr is the round-trip carrier (import lifts it back onto the
    // img node); the style is what the published page actually renders.
    root.setAttribute('data-background-color', backgroundColor);
    const style = root.getAttribute('style');
    root.setAttribute(
      'style',
      `${style ? `${style.replace(/;\s*$/, '')}; ` : ''}background-color: ${backgroundColor}`,
    );
  }
  const serialized = new XMLSerializer().serializeToString(root);
  // One raw HTML block for markdown-it: no blank lines anywhere, and the
  // opening tag ALONE on line 1 (CommonMark html_block rule 7 — see the
  // Global Constraints of the 2026-08-13 svg-embed plan).
  return serialized
    .replace(/<svg\b[^>]*>/, (m) => m.replace(/\s*\n\s*/g, ' ') + '\n')
    .replace(/\n(?:[ \t]*\n)+/g, '\n')
    .trim();
};

// The markdown pipelines enforce "no stray <style> blocks" with a blanket
// strip. An inline svg legitimately carries one (Illustrator exports color
// via <style> + classes), so the strip must skip svg interiors. Regions are
// found by depth-counting so nested svgs stay intact; an unbalanced <svg
// with no close tag fails open (nothing after it is stripped).
export const stripStyleBlocksOutsideSvg = (text: string): string => {
  const stripStray = (chunk: string) =>
    chunk.replace(/<style\b[^>]*>[\s\S]*?<\/style>\s*/gi, '');
  let out = '';
  let cursor = 0;
  let depth = 0;
  let regionStart = -1;
  const tagRe = /<svg\b|<\/svg\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text))) {
    if (m[0].toLowerCase().startsWith('<svg')) {
      if (depth === 0) {
        out += stripStray(text.slice(cursor, m.index));
        regionStart = m.index;
      }
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const end = m.index + m[0].length;
        out += text.slice(regionStart, end);
        cursor = end;
      }
    }
  }
  out += depth > 0 ? text.slice(regionStart) : stripStray(text.slice(cursor));
  return out;
};

export const encodeSvgToDataUri = (svgText: string): string =>
  `data:image/svg+xml;base64,${arrayBufferToBase64(
    new TextEncoder().encode(svgText).buffer,
  )}`;
