import { FLOATING_CARD_WIDTH } from '../components/inline-comment/constants';
import { FLOATING_COMMENT_RIGHT_SPACE } from '../components/inline-comment/comment-floating-layout';

export type ZoomLevel = 'fit' | '0.5' | '0.75' | '1' | '1.25' | '1.5' | '2';

export const ZOOM_PRESET_SCALES: readonly number[] = [
  0.5, 0.75, 1, 1.25, 1.5, 2,
];
export const FIT_MIN_SCALE = 0.5;
export const FIT_MAX_SCALE = 2;
export const FIT_GUTTER = 24;
// Slot gap (ml-[12px]) + card + the container's right padding.
export const COMMENT_COLUMN_WIDTH =
  12 + FLOATING_CARD_WIDTH + FLOATING_COMMENT_RIGHT_SPACE;

const EPSILON = 0.001;
const PRESET_LEVELS: readonly ZoomLevel[] = [
  '0.5',
  '0.75',
  '1',
  '1.25',
  '1.5',
  '2',
];

export const normalizeZoomLevel = (
  value: string | undefined | null,
): ZoomLevel => {
  if (value === 'fit' || value === '1.4') return 'fit';
  return PRESET_LEVELS.find((level) => level === value) ?? '1';
};

export const resolveZoomScale = (level: ZoomLevel, fitScale: number) =>
  level === 'fit' ? fitScale : Number(level);

export const stepZoomLevel = (
  level: ZoomLevel,
  direction: 1 | -1,
  fitScale: number,
): ZoomLevel => {
  const current = resolveZoomScale(level, fitScale);
  const ordered =
    direction === 1 ? PRESET_LEVELS : [...PRESET_LEVELS].reverse();
  const next = ordered.find((preset) =>
    direction === 1
      ? Number(preset) > current + EPSILON
      : Number(preset) < current - EPSILON,
  );
  return next ?? level;
};

export const computeFitScale = (
  canvasWidth: number,
  baseWidth: number,
  reservedWidth: number,
) => {
  if (canvasWidth <= 0 || baseWidth <= 0) return 1;
  const scale = (canvasWidth - reservedWidth) / baseWidth;
  const clamped = Math.min(FIT_MAX_SCALE, Math.max(FIT_MIN_SCALE, scale));
  // Down, so a rounding pixel never makes the page overflow.
  return Math.floor(clamped * 100 + 1e-9) / 100;
};

export const getZoomScale = (node: Element | null) => {
  const value = Number(
    node?.closest('[data-ddoc-zoom-layer]')?.getAttribute('data-ddoc-zoom'),
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
};

// Keeps the document point at the scroller's edge in place across a scale
// change. `layerStart` is the layer's offset in scroll-content coordinates.
export const anchorScroll = (
  scroll: number,
  layerStart: number,
  prevScale: number,
  nextScale: number,
) =>
  scroll > layerStart
    ? layerStart + ((scroll - layerStart) * nextScale) / prevScale
    : scroll;

// For chrome mounted inside the scaled layer: keeps its 100% size.
export const counterScaleStyle = (scale: number) =>
  scale === 1
    ? undefined
    : { transform: `scale(${1 / scale})`, transformOrigin: 'center' };

// floating-ui offset (layer units) that leaves a `gap`px screen gap for a
// counter-scaled float: the centre-origin shrink pulls its edge in by
// (scale - 1) * height / 2.
export const counterScaledOffset = (
  gap: number,
  scale: number,
  floatingHeight: number,
) => (gap - ((scale - 1) * floatingHeight) / 2) / scale;

// flip/shift padding (screen px) for a counter-scaled float: floating-ui
// measures its layout box, `scale` times the size it is drawn at.
export const counterScaledPadding = (scale: number, size: number) =>
  -((scale - 1) * size) / 2;

// Pointer deltas are screen pixels; widths inside the layer are layer units.
export const toLayoutDelta = (screenDelta: number, node: Element | null) =>
  screenDelta / getZoomScale(node);

// A fixed `zoomLevel` with no callback is inert (AGENTS.md); the shortcuts
// must then leave Mod+= / Mod+- to the browser.
export const canChangeZoom = (
  value: string | undefined,
  onChange: unknown,
  legacySetter: unknown,
) => value === undefined || !!onChange || !!legacySetter;

// The rail's min-content: the 148px outline plus its px-4. In landscape the
// sidebar's min-w-[182px] applies and the scroll row adds mx-[24px].
export const FIT_RAIL_WIDTH = 181;
export const FIT_LANDSCAPE_RAIL_WIDTH = 182;
export const LANDSCAPE_ROW_MARGIN = 24;

export const getFitReservedWidth = ({
  hasLeftRail,
  isCommentColumnVisible,
  isLandscape = false,
}: {
  hasLeftRail: boolean;
  isCommentColumnVisible: boolean;
  isLandscape?: boolean;
}) =>
  (hasLeftRail
    ? isLandscape
      ? FIT_LANDSCAPE_RAIL_WIDTH
      : FIT_RAIL_WIDTH
    : 0) +
  (isCommentColumnVisible ? COMMENT_COLUMN_WIDTH : 0) +
  (isLandscape ? 2 * LANDSCAPE_ROW_MARGIN : 0) +
  2 * FIT_GUTTER;
