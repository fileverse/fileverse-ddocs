import type { FontDescriptor } from '../types';

const catalog = new Map<string, FontDescriptor>();
const registered = new Set<string>();

/** "Poppins, sans-serif" -> "Poppins"; "'Times New Roman', serif" -> "Times New Roman" */
export function primaryToken(family: string): string {
  const first = family.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '');
}

/**
 * Registers each catalog font with the browser without downloading it. A
 * FontFace added to document.fonts but never `.load()`-ed behaves like a CSS
 * `@font-face` rule: the UA fetches it lazily the first time rendered text
 * (local edit, paste, undo, or a remote Yjs update) matches the family — which
 * is why no document-scanning extension is needed.
 *
 * Merges into the existing catalog and never clears it, so a second editor
 * mounting without a `fonts` prop can't wipe fonts other editors on the same
 * page still need. The CSS face name is derived from the family stack, not the
 * cosmetic `name`, so the registered face actually matches styled content.
 */
export function registerFonts(fonts: FontDescriptor[]): void {
  if (typeof document === 'undefined') return;
  for (const f of fonts) {
    const cssName = primaryToken(f.family);
    if (!f.url || registered.has(cssName)) continue;
    registered.add(cssName);
    catalog.set(cssName, f);

    const entries: Array<[number, string]> =
      typeof f.url === 'string'
        ? [[400, f.url]]
        : Object.entries(f.url).map(([w, u]) => [Number(w), u]);
    for (const [weight, url] of entries) {
      const face = new FontFace(cssName, `url(${url}) format('woff2')`, {
        weight: String(weight),
        display: 'swap',
      });
      document.fonts.add(face); // registered, NOT downloaded
    }
  }
}

export function getRegisteredFonts(): FontDescriptor[] {
  return [...catalog.values()];
}

/**
 * Forces a download and resolves once the face is ready. Used by the picker
 * click so applying a font doesn't flash the fallback. `document.fonts.load`
 * deduplicates internally, so no custom promise cache is needed.
 */
export function ensureLoaded(family: string): Promise<unknown> {
  if (typeof document === 'undefined') return Promise.resolve();
  const cssName = primaryToken(family);
  // Only catalog fonts have a downloadable face. "default" and system/baseline
  // fonts have nothing to fetch, and passing their raw value (a reserved word
  // or an unquoted multi-word stack) to FontFaceSet.load throws "Invalid font
  // shorthand" in strict engines. Quote the single registered face name.
  if (!cssName || !catalog.has(cssName)) return Promise.resolve();
  // Swallow load failures (e.g. a 404 woff2) so a font click never surfaces an
  // unhandled rejection — font-display: swap keeps text readable regardless.
  return document.fonts.load(`16px "${cssName}"`).catch(() => {});
}
