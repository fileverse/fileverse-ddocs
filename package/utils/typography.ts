import { Editor } from '@tiptap/core';
import { ownsSpacingAt } from '../extensions/paragraph-spacing';

// Font-size and line-height helpers, extracted verbatim from
// components/editor-utils.tsx so hooks can use them without importing the
// toolbar module (avoids a components ↔ hooks import cycle).

export const FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 32, 36, 48, 60, 72, 96,
] as const;

/** The font picker's entries. Its values are what `setFontFamily` stores, so
 *  anything written from elsewhere has to use the same stack to be recognised
 *  as the active font — and to inherit the fallbacks. */
export const FONT_STACK: Record<string, string> = {
  Arial: 'Arial, Arial, Helvetica, sans-serif',
  Calibri: 'Calibri, sans-serif',
  'Comic Sans MS': 'Comic Sans MS, Comic Sans',
  Cursive: 'Cursive',
  Georgia: 'Georgia, serif',
  Impact: 'Impact, Charcoal, sans-serif',
  'Lucida Grande': 'Lucida Sans Unicode, Lucida Grande, sans-serif',
  Monospace: 'monospace',
  Palatino: 'Palatino Linotype, Book Antiqua, Palatino, serif',
  Serif: 'serif',
  'Times New Roman': 'Times New Roman, serif',
  'Trebuchet MS': 'Trebuchet MS, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
};

/** A family the picker knows becomes its full stack; anything else is passed
 *  through, so an unrecognised font still renders under its own name. */
export const toEditorFontStack = (family: string): string =>
  FONT_STACK[family] ?? family;

export const getFontSizeOptions = (editor?: Editor) => {
  return FONT_SIZES.map((size) => ({
    title: `${size}`,
    value: `${size}px`,
    label: size.toString(),
    command: (editor: Editor) => {
      editor.chain().focus().setFontSize(`${size}px`).run();
    },
    isActive: () => editor?.isActive('fontSize', { size: `${size}px` }),
  }));
};

export const getCurrentFontSize = (
  editor: Editor | null,
  currentSize: string,
) => {
  if (!editor) return '';
  return currentSize ? currentSize.replace('px', '') : '';
};

// Line height conversion helpers: UI shows numbers (1, 1.15, 1.5, etc.) but stores as percentages (120%, 138%, 180%, etc.)
// Formula: percentage = uiValue * 120
const LINE_HEIGHT_BASE = 120; // 1 in UI = 120% in storage

export const uiValueToPercentage = (uiValue: string): string => {
  const num = parseFloat(uiValue);
  return `${Math.round(num * LINE_HEIGHT_BASE)}%`;
};

/**
 * CSS line-height comes in three shapes and ddoc stores percentages, so the
 * attribute needs one meaning. A unitless ratio is exactly percentage / 100,
 * so it normalises losslessly — Google Docs pastes `line-height:1.38`, which
 * is `138%`. Absolute units cannot become a ratio without knowing the font
 * size, so they are passed through untouched rather than guessed at.
 */
export const normalizeLineHeight = (
  value: string | null | undefined,
): string | null => {
  if (!value) return null;
  const trimmed = value.replace(/['"]+/g, '').trim();
  if (!trimmed) return null;
  if (trimmed.endsWith('%')) return trimmed;
  if (/^-?\d*\.?\d+$/.test(trimmed)) {
    return `${Math.round(Number.parseFloat(trimmed) * 100)}%`;
  }
  return trimmed;
};

export const percentageToUiValue = (percentage: string): string => {
  // Normalise first: documents pasted before line-height normalisation still
  // hold a bare ratio, and dividing that by 120 as though it were a percentage
  // is what collapsed 1.38 to 1%.
  const normalized = normalizeLineHeight(percentage);
  if (!normalized?.endsWith('%')) return '';
  const num = Number.parseFloat(normalized.replace('%', ''));
  if (Number.isNaN(num)) return '';
  return String(Number((num / LINE_HEIGHT_BASE).toFixed(4)));
};

export const LINE_HEIGHT_OPTIONS = [
  { value: '120%', label: '1', uiValue: '1', description: '' },
  { value: '138%', label: '1.15', uiValue: '1.15', description: '(Default)' },
  { value: '180%', label: '1.5', uiValue: '1.5', description: '' },
  { value: '240%', label: '2', uiValue: '2', description: '' },
  { value: '300%', label: '2.5', uiValue: '2.5', description: '' },
  { value: '360%', label: '3', uiValue: '3', description: '' },
];

export const getLineHeightOptions = () => LINE_HEIGHT_OPTIONS;

// Paragraph-spacing bounds. Freeform pt input, so the field needs a sane
// ceiling; 0 stays a legal value (it kills the CSS default gap).
export const SPACING_MIN_PT = 0;
export const SPACING_MAX_PT = 100;

/**
 * What "Add space before/after paragraph" writes, matching Google Docs.
 *
 * A real value rather than null: null would hand the block back to the
 * stylesheet, and the toggle only offers "Add" when the stylesheet is already
 * giving it nothing — so restoring null would leave the gap at zero and the
 * menu item would appear to do nothing.
 */
export const SPACING_ADD_PT = 12;

const SPACING_TYPES = ['paragraph', 'heading', 'listItem'];

/** A value shared by every block in the selection, or `'mixed'`. */
export type SpacingReading<T> = T | 'mixed';

export type SpacingSelection = {
  spaceBefore: SpacingReading<number | null>;
  spaceAfter: SpacingReading<number | null>;
  lineHeight: SpacingReading<string | null>;
};

/**
 * Read spacing across the current selection, the single place the dialog and
 * any read-back should use. `'mixed'` means the selected blocks disagree — the
 * caller must render that as an empty field and leave the attribute alone on
 * apply, rather than stamping one block's value onto the rest.
 */
export const readSpacingSelection = (
  editor: Editor | null,
): SpacingSelection => {
  const empty: SpacingSelection = {
    spaceBefore: null,
    spaceAfter: null,
    lineHeight: null,
  };
  if (!editor) return empty;

  const seen: Record<keyof SpacingSelection, Set<unknown>> = {
    spaceBefore: new Set(),
    spaceAfter: new Set(),
    lineHeight: new Set(),
  };

  const { from, to } = editor.state.selection;
  editor.state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!SPACING_TYPES.includes(node.type.name)) return;
    // The list item owns the spacing, so its inner paragraph must not drag the
    // reading to 'mixed'. Mirrors setParagraphSpacing.
    if (node.type.name === 'paragraph' && parent?.type.name === 'listItem') {
      return;
    }
    // Nor may an enclosing item: a cursor in a sub-bullet reports every
    // ancestor item, whose spacing is not what the dialog is reading.
    if (!ownsSpacingAt(node, pos, from, to)) return;
    seen.spaceBefore.add(node.attrs.spaceBefore ?? null);
    seen.spaceAfter.add(node.attrs.spaceAfter ?? null);
    seen.lineHeight.add(node.attrs.lineHeight ?? null);
  });

  const collapse = <T>(values: Set<unknown>): SpacingReading<T | null> => {
    if (values.size === 0) return null;
    if (values.size > 1) return 'mixed';
    return [...values][0] as T | null;
  };

  return {
    spaceBefore: collapse<number>(seen.spaceBefore),
    spaceAfter: collapse<number>(seen.spaceAfter),
    lineHeight: collapse<string>(seen.lineHeight),
  };
};

export const getCurrentLineHeight = (
  editor: Editor | null,
  currentLineHeight?: string,
) => {
  if (!editor) return '1.15';
  // currentLineHeight is stored as percentage, find matching label
  if (currentLineHeight && currentLineHeight.includes('%')) {
    const option = LINE_HEIGHT_OPTIONS.find(
      (opt) => opt.value === currentLineHeight,
    );
    return option ? option.label : percentageToUiValue(currentLineHeight);
  }
  return currentLineHeight || '1.15';
};

const PT_PER_PX = 0.75;

/**
 * getComputedStyle returns resolved pixels in a browser. jsdom does no layout
 * and hands back whatever the stylesheet said, so anything that is not px is
 * treated as unknown rather than parsed into a wrong number.
 */
const computedPxToPt = (value: string | undefined): number => {
  if (!value || !value.endsWith('px')) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isNaN(parsed) ? 0 : Math.round(parsed * PT_PER_PX);
};

export type EffectiveSpacing = {
  spaceBefore: SpacingReading<number>;
  spaceAfter: SpacingReading<number>;
};

/**
 * The spacing a block actually renders with: its explicit attribute when set,
 * otherwise whatever the stylesheet resolves to.
 *
 * Read from the rendered DOM because there is no single default to hardcode —
 * the gap depends on viewport, schema version, element type, and whether the
 * block is the first or last child. Both the "add/remove space" menu items and
 * the custom spacing dialog need the real number, not the attribute.
 */
export const readEffectiveSpacing = (
  editor: Editor | null,
): EffectiveSpacing => {
  const seen = {
    spaceBefore: new Set<number>(),
    spaceAfter: new Set<number>(),
  };
  if (!editor) return { spaceBefore: 0, spaceAfter: 0 };

  const { from, to } = editor.state.selection;
  editor.state.doc.nodesBetween(from, to, (node, pos, parent) => {
    if (!SPACING_TYPES.includes(node.type.name)) return;
    if (node.type.name === 'paragraph' && parent?.type.name === 'listItem') {
      return;
    }
    if (!ownsSpacingAt(node, pos, from, to)) return;
    // Both edges already disagree — every remaining block collapses to
    // 'mixed' whatever it reads, so stop paying for style recalcs. This is
    // what makes the reading affordable in a per-transaction selector: a
    // drag-select across a long document stops measuring almost immediately.
    if (seen.spaceBefore.size > 1 && seen.spaceAfter.size > 1) return false;

    // getComputedStyle forces a style recalc, so it is called only for the
    // edges that have no attribute to answer with. nodeDOM itself is a map
    // lookup and costs nothing.
    let computed: CSSStyleDeclaration | undefined;
    const measure = () => {
      if (!computed) {
        const dom = editor.view.nodeDOM(pos);
        if (dom instanceof HTMLElement) computed = window.getComputedStyle(dom);
      }
      return computed;
    };

    seen.spaceBefore.add(
      node.attrs.spaceBefore ?? computedPxToPt(measure()?.marginTop),
    );
    seen.spaceAfter.add(
      node.attrs.spaceAfter ?? computedPxToPt(measure()?.marginBottom),
    );
  });

  const collapse = (values: Set<number>): SpacingReading<number> => {
    if (values.size === 0) return 0;
    if (values.size > 1) return 'mixed';
    return [...values][0];
  };

  return {
    spaceBefore: collapse(seen.spaceBefore),
    spaceAfter: collapse(seen.spaceAfter),
  };
};

/**
 * Which half of the Google-Docs-style toggle to offer.
 *
 * "Add space before paragraph" only appears once the block genuinely has no
 * gap — the stylesheet's default counts, so a fresh paragraph offers "Remove"
 * first. A mixed selection counts as having a gap, since removing is the
 * action that leaves every block in the same state.
 */
export const spacingToggleAction = (
  effective: SpacingReading<number>,
): 'add' | 'remove' => (effective === 0 ? 'add' : 'remove');
