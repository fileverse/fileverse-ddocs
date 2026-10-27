import { toLayoutDelta } from '../../utils/zoom';

export type ResizeCorner = 'tl' | 'tr' | 'bl' | 'br';

// Left corners grow the media when the pointer moves left.
export const getCornerResizeStep = (
  corner: ResizeCorner,
  lastClientX: number,
  clientX: number,
  media: Element | null,
): { direction: 'left' | 'right'; delta: number } | null => {
  const diff = lastClientX - clientX;
  if (diff === 0) return null;
  const isLeftCorner = corner === 'tl' || corner === 'bl';
  const movedLeft = diff > 0;
  return {
    direction: isLeftCorner === movedLeft ? 'right' : 'left',
    delta: toLayoutDelta(Math.abs(diff), media),
  };
};
