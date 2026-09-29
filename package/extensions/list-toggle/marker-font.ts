/** Custom properties the marker CSS reads (docs/LIST_TOGGLE.md §3.9). */
export const MARKER_FONT_SIZE_VAR = '--ddoc-marker-font-size';
export const MARKER_FONT_FAMILY_VAR = '--ddoc-marker-font-family';

export type MarkerFont = { fontSize: string | null; fontFamily: string | null };
type Property = keyof MarkerFont;

/** A raw value, and whether the paragraph (not the run) declared it. */
export type Declared = { value: string; onParagraph: boolean } | null;
/** One voting run of an item's first paragraph. */
export type Run = Record<Property, Declared>;

const CONTEXT_FREE_UNITS = new Set([
  'px',
  'pt',
  'pc',
  'in',
  'cm',
  'mm',
  'q',
  'rem',
]);
const PARENT_RELATIVE_UNITS = new Set(['%', 'em']);
const ABSOLUTE_SIZE_KEYWORDS = new Set([
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
]);
const RELATIVE_SIZE_KEYWORDS = new Set(['larger', 'smaller']);
const GENERIC_FAMILIES = new Set([
  'serif',
  'sans-serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-serif',
  'ui-sans-serif',
  'ui-monospace',
  'ui-rounded',
  'math',
  'emoji',
  'fangsong',
]);
const CSS_WIDE_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);
const NUMBER_WITH_UNIT = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z]+|%)$/;

const isSet = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

/** A run's own value, else its paragraph's; an empty string counts as unset. */
export const declaredValue = (own: unknown, paragraph: unknown): Declared => {
  if (isSet(own)) return { value: own, onParagraph: false };
  if (isSet(paragraph)) return { value: paragraph, onParagraph: true };
  return null;
};

// Relative sizes resolve against the parent: the <p> for text, the <li> for the
// marker. They agree when the paragraph declared them or has no size of its own.
const canonicalSize = (raw: string, relativeAgrees: boolean): string | null => {
  const value = raw.trim().toLowerCase();
  if (ABSOLUTE_SIZE_KEYWORDS.has(value)) return value;
  if (RELATIVE_SIZE_KEYWORDS.has(value)) return relativeAgrees ? value : null;
  const match = NUMBER_WITH_UNIT.exec(value);
  if (!match) return null;
  const [, number, unit] = match;
  const canonical = `${Number(number)}${unit}`;
  if (CONTEXT_FREE_UNITS.has(unit)) return canonical;
  if (PARENT_RELATIVE_UNITS.has(unit)) return relativeAgrees ? canonical : null;
  return null;
};

/** Splits on commas outside quotes; null when a quote is left open. */
const splitFamilies = (raw: string): string[] | null => {
  const names: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (const char of raw) {
    if (!quote && char === ',') {
      names.push(current);
      current = '';
      continue;
    }
    if (quote && char === quote) quote = null;
    else if (!quote && (char === '"' || char === "'")) quote = char;
    current += char;
  }
  if (quote) return null;
  names.push(current);
  return names;
};

const canonicalFamily = (raw: string): string | null => {
  if (/var\(/i.test(raw)) return null;
  const names = splitFamilies(raw);
  if (!names) return null;
  const canonical: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    const quoted = /^(["'])[\s\S]*\1$/.test(trimmed);
    const bare = (quoted ? trimmed.slice(1, -1) : trimmed)
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    if (!bare || (!quoted && CSS_WIDE_KEYWORDS.has(bare))) return null;
    // A quoted "serif" names a font called serif, not the generic family.
    canonical.push(
      !quoted && GENERIC_FAMILIES.has(bare)
        ? bare
        : `"${bare.replace(/["\\]/g, '\\$&')}"`,
    );
  }
  return canonical.join(', ');
};

const vote = (
  property: Property,
  declared: Declared,
  paragraphHasOwnSize: boolean,
): string | null => {
  // ProseMirror appends a decoration's style to the inline style, so `;` would
  // end the declaration and start another.
  if (!declared || /[;{}]/.test(declared.value)) return null;
  return property === 'fontSize'
    ? canonicalSize(
        declared.value,
        declared.onParagraph || !paragraphHasOwnSize,
      )
    : canonicalFamily(declared.value);
};

const uniform = (votes: (string | null)[]): string | null =>
  votes.length > 0 &&
  votes[0] !== null &&
  votes.every((each) => each === votes[0])
    ? votes[0]
    : null;

/**
 * The marker takes a property only when every voting run agrees on it in
 * canonical form (docs/LIST_TOGGLE.md §3.9).
 */
export const resolveMarkerFont = (
  runs: readonly Run[],
  paragraphHasOwnSize: boolean,
): MarkerFont => ({
  fontSize: uniform(
    runs.map((run) => vote('fontSize', run.fontSize, paragraphHasOwnSize)),
  ),
  fontFamily: uniform(
    runs.map((run) => vote('fontFamily', run.fontFamily, paragraphHasOwnSize)),
  ),
});
