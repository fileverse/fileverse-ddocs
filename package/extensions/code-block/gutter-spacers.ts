import type { DecorationSource } from '@tiptap/pm/view';
import { inTextSpacerHeight } from '../pagination/spacers';

// Pages spacers inside a code block (docs/PAGES_MODE.md §12.4) move the code
// but not the line-number gutter. Returns, per gutter row, the spacer height
// to add before it: a spacer opens the first row starting at or after it.
export function gutterSpacers(
  innerDecorations: DecorationSource | undefined,
  rowStarts: number[],
): Map<number, number> {
  const out = new Map<number, number>();
  innerDecorations?.forEachSet((set) =>
    set.find().forEach((d) => {
      const height = inTextSpacerHeight(d.spec.key);
      if (!height) return;
      const row = rowStarts.findIndex((start) => start >= d.from);
      const at = row < 0 ? rowStarts.length : row;
      out.set(at, (out.get(at) ?? 0) + height);
    }),
  );
  return out;
}
