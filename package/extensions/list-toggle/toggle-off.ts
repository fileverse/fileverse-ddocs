import type { Node as ProseMirrorNode, NodeType } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { liftOut } from './lift-out';
import { childPos, isDBlock, nodeRangeAt, type SharedList } from './shared';
import { edgesToParagraphs } from './spacing';

/**
 * Toggle off when the list's parent is not a list item (spec §3.4): the
 * covered items leave the list, each body child becoming its own block at
 * the list's level. Items are processed last to first, so every edit lands
 * at or after the item's start and earlier items keep their positions.
 */
export const toggleOffTopLevel = (
  tr: Transaction,
  shared: SharedList,
  firstIndex: number,
  lastIndex: number,
  dBlockType: NodeType | undefined,
): true => {
  const { node: list, depth, pos: listPos } = shared;
  const throughDBlock = isDBlock(tr.doc.resolve(listPos).parent);
  const splitDepth = throughDBlock ? 2 : 1;
  const liftTarget = throughDBlock ? depth - 2 : depth - 1;
  const wrapper = throughDBlock ? (dBlockType as NodeType) : null;

  for (let i = lastIndex; i >= firstIndex; i--) {
    const itemPos = childPos(list, listPos, i);
    const item = tr.doc.nodeAt(itemPos) as ProseMirrorNode;
    edgesToParagraphs(tr, itemPos, item);

    // Body children after the first paragraph, lifted whole, last to first.
    let offset = item.content.size;
    for (let k = item.childCount - 1; k >= 1; k--) {
      const child = item.child(k);
      offset -= child.nodeSize;
      liftOut(tr, nodeRangeAt(tr, itemPos + 1 + offset), liftTarget, wrapper);
    }

    // Isolate the now single-paragraph item in its own list, then lift the paragraph.
    const single = tr.doc.nodeAt(itemPos) as ProseMirrorNode;
    const $item = tr.doc.resolve(itemPos);
    if ($item.index() + 1 < $item.parent.childCount) {
      tr.split(itemPos + single.nodeSize, splitDepth);
    }
    const hasPrevious = $item.index() > 0;
    if (hasPrevious) tr.split(itemPos, splitDepth);
    const isolatedPos = itemPos + (hasPrevious ? 2 * splitDepth : 0);
    // Resolve inside the paragraph: at the item's content start blockRange() is the item.
    const paragraphRange = tr.doc.resolve(isolatedPos + 2).blockRange();
    if (paragraphRange) tr.lift(paragraphRange, depth - 1);
  }
  return true;
};
