import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import {
  AddMarkStep,
  AddNodeMarkStep,
  AttrStep,
  RemoveMarkStep,
  RemoveNodeMarkStep,
} from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CARET_MARKS_ATTR, parseMarks } from '../caret-marks/caret-style';

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

const NO_FONT: MarkerFont = { fontSize: null, fontFamily: null };

/** The document adapter: a `listItem`'s marker font from its first paragraph. */
export const markerFont = (item: ProseMirrorNode): MarkerFont => {
  const paragraph = item.firstChild;
  if (item.type.name !== 'listItem' || !paragraph?.isTextblock) return NO_FONT;
  const legacy = paragraph.attrs;
  const runOf = (marks: readonly Mark[]): Run => {
    const textStyle = marks.find((mark) => mark.type.name === 'textStyle');
    return {
      fontSize: declaredValue(textStyle?.attrs.fontSize, legacy.fontSize),
      fontFamily: declaredValue(textStyle?.attrs.fontFamily, legacy.fontFamily),
    };
  };
  const runs: Run[] = [];
  if (paragraph.content.size === 0) {
    // An empty paragraph votes with its caret stamp: what typing would produce.
    runs.push(
      runOf(parseMarks(paragraph.type.schema, legacy[CARET_MARKS_ATTR])),
    );
  } else {
    paragraph.forEach((child) => {
      if (child.isText && /\S/.test(child.text ?? '')) {
        runs.push(runOf(child.marks));
      }
    });
  }
  return resolveMarkerFont(runs, isSet(legacy.fontSize));
};

/** The inline style carrying a marker font to its `<li>`; null for the default. */
export const markerFontStyle = ({
  fontSize,
  fontFamily,
}: MarkerFont): string | null => {
  const parts: string[] = [];
  if (fontSize) parts.push(`${MARKER_FONT_SIZE_VAR}: ${fontSize}`);
  if (fontFamily) parts.push(`${MARKER_FONT_FAMILY_VAR}: ${fontFamily}`);
  return parts.length ? parts.join('; ') : null;
};

const decorationsIn = (doc: ProseMirrorNode, from: number, to: number) => {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'listItem') {
      const style = markerFontStyle(markerFont(node));
      if (style) {
        decorations.push(
          Decoration.node(pos, pos + node.nodeSize, { style }, { style }),
        );
      }
    }
    return !node.isTextblock;
  });
  return decorations;
};

/**
 * The top-level block ranges a transaction changed, merged so each block is
 * rebuilt once (M-3). Mark and attr steps have empty step maps, so their own
 * positions are read as well.
 */
export const changedBlockRanges = (tr: Transaction): [number, number][] => {
  const size = tr.doc.content.size;
  const clamp = (pos: number) => Math.max(0, Math.min(pos, size));
  const widened: [number, number][] = [];
  tr.steps.forEach((step, index) => {
    const raw: [number, number][] = [];
    step
      .getMap()
      .forEach((_oldStart, _oldEnd, newStart, newEnd) =>
        raw.push([newStart, newEnd]),
      );
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      raw.push([step.from, step.to]);
    }
    if (
      step instanceof AttrStep ||
      step instanceof AddNodeMarkStep ||
      step instanceof RemoveNodeMarkStep
    ) {
      raw.push([step.pos, step.pos + 1]);
    }
    const later = tr.mapping.slice(index + 1);
    raw.forEach(([start, end]) => {
      const $start = tr.doc.resolve(clamp(later.map(start, -1)));
      const $end = tr.doc.resolve(clamp(later.map(end, 1)));
      widened.push([
        $start.depth ? $start.before(1) : $start.pos,
        $end.depth ? $end.after(1) : $end.pos,
      ]);
    });
  });
  widened.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  widened.forEach(([from, to]) => {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  });
  return merged;
};

export const markerFontPluginKey = new PluginKey<DecorationSet>(
  'listMarkerFont',
);

/** Display only: decorations carry each marker's font, the document is never written. */
export const markerFontPlugin = () =>
  new Plugin<DecorationSet>({
    key: markerFontPluginKey,
    state: {
      init: (_, state) =>
        DecorationSet.create(
          state.doc,
          decorationsIn(state.doc, 0, state.doc.content.size),
        ),
      apply: (tr, set) => {
        if (!tr.docChanged) return set;
        let next = set.map(tr.mapping, tr.doc);
        // Diff, not rebuild: removing every decoration of a long list is
        // quadratic in PM, and a keystroke rarely changes any marker.
        const key = (d: Decoration) => `${d.from}:${d.to}:${d.spec.style}`;
        changedBlockRanges(tr).forEach(([from, to]) => {
          const current = next
            .find(from, to)
            .filter((d) => d.from >= from && d.to <= to);
          const fresh = decorationsIn(tr.doc, from, to);
          const kept = new Set(current.map(key));
          const wanted = new Set(fresh.map(key));
          const stale = current.filter((d) => !wanted.has(key(d)));
          const added = fresh.filter((d) => !kept.has(key(d)));
          if (stale.length) next = next.remove(stale);
          if (added.length) next = next.add(tr.doc, added);
        });
        return next;
      },
    },
    props: {
      decorations: (state) => markerFontPluginKey.getState(state),
    },
  });

/** A text node's run: its nearest styled element up to the `<p>` declares it. */
const domRun = (text: Text, paragraph: HTMLElement): Run => {
  const nearest = (property: 'fontSize' | 'fontFamily') => {
    for (
      let el = text.parentElement;
      el && el !== paragraph;
      el = el.parentElement
    ) {
      if (el.style[property]) return el.style[property];
    }
    return null;
  };
  return {
    fontSize: declaredValue(nearest('fontSize'), paragraph.style.fontSize),
    fontFamily: declaredValue(
      nearest('fontFamily'),
      paragraph.style.fontFamily,
    ),
  };
};

/** Text inside `data-type` is a serialized atom (inline math), not a run (M-2). */
const insideAtom = (text: Text, paragraph: HTMLElement) => {
  for (
    let el = text.parentElement;
    el && el !== paragraph;
    el = el.parentElement
  ) {
    if (el.hasAttribute('data-type')) return true;
  }
  return false;
};

/**
 * The HTML adapter for print: sets the marker font on every `li` whose first
 * `<p>` agrees, by the same rule as the editor. Run before math rendering.
 */
export const applyMarkerFonts = (root: ParentNode) => {
  root.querySelectorAll('li').forEach((li) => {
    if (li.getAttribute('data-type') === 'taskItem') return;
    const paragraph = li.firstElementChild;
    if (!(paragraph instanceof HTMLElement) || paragraph.tagName !== 'P') {
      return;
    }
    const runs: Run[] = [];
    const walker = paragraph.ownerDocument.createTreeWalker(
      paragraph,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      if (/\S/.test(text.data) && !insideAtom(text, paragraph)) {
        runs.push(domRun(text, paragraph));
      }
    }
    const font = resolveMarkerFont(runs, paragraph.style.fontSize !== '');
    if (font.fontSize) {
      li.style.setProperty(MARKER_FONT_SIZE_VAR, font.fontSize);
    }
    if (font.fontFamily) {
      li.style.setProperty(MARKER_FONT_FAMILY_VAR, font.fontFamily);
    }
  });
};
