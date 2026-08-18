import { Editor } from '@tiptap/core';

// Font-size and line-height helpers, extracted verbatim from
// components/editor-utils.tsx so hooks can use them without importing the
// toolbar module (avoids a components ↔ hooks import cycle).

export const FONT_SIZES = [
  8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 32, 36, 48, 60, 72, 96,
] as const;

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
  editor.state.doc.nodesBetween(from, to, (node, _pos, parent) => {
    if (!SPACING_TYPES.includes(node.type.name)) return;
    // The list item owns the spacing, so its inner paragraph must not drag the
    // reading to 'mixed'. Mirrors setParagraphSpacing.
    if (node.type.name === 'paragraph' && parent?.type.name === 'listItem') {
      return;
    }
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
