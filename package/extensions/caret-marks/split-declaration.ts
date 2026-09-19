import type { Editor } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import {
  CARET_MARKS_ATTR,
  caretStyle,
  filterSplittable,
  stampAttrs,
} from './caret-style';

export type SplitCapture = {
  style: Mark[];
  pos: number;
  sourceWasEmpty: boolean;
};

// Read from `tr`, before delegating: Tiptap's command `state` is a facade
// refreshed from the working transaction, so a style read afterwards sees
// the new empty paragraph and would clear the bold the split preserved.
export const captureSplit = (
  tr: Transaction,
  editor: Editor,
): SplitCapture | null => {
  const { $from } = tr.selection;
  const block = $from.parent;
  if (!block.isTextblock) return null;
  return {
    style: filterSplittable(caretStyle(tr, block), editor),
    pos: $from.before(),
    sourceWasEmpty: block.content.size === 0,
  };
};

// Enter at offset 0 leaves an empty line behind the caret where no rule
// reaches; stamp it here. setStoredMarks must stay last: any later step
// erases the declaration.
export const declareSplit = (tr: Transaction, capture: SplitCapture) => {
  if (!capture.sourceWasEmpty) {
    const left = tr.doc.nodeAt(capture.pos);
    if (
      left?.isTextblock &&
      left.content.size === 0 &&
      CARET_MARKS_ATTR in left.attrs
    ) {
      tr.setNodeMarkup(
        capture.pos,
        undefined,
        stampAttrs(left.attrs, capture.style),
      );
    }
  }
  tr.setStoredMarks(capture.style);
};
