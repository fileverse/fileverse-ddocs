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
  return Math.round(clamped * 100) / 100;
};

export const getZoomScale = (node: Element | null) => {
  const value = Number(
    node?.closest('[data-ddoc-zoom-layer]')?.getAttribute('data-ddoc-zoom'),
  );
  return Number.isFinite(value) && value > 0 ? value : 1;
};
