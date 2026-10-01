import {
  Fragment,
  Slice,
  type Node as ProseMirrorNode,
  type NodeType,
} from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { ReplaceAroundStep } from '@tiptap/pm/transform';
import {
  childPos,
  isDBlock,
  isolateItem,
  joinNeighbours,
  type SharedList,
} from './shared';
import { edgesToItem, edgesToParagraphs } from './spacing';

/** bullet ↔ numbered: the items are valid in both list types (spec §3.5). */
export const retypeList = (
  tr: Transaction,
  shared: SharedList,
  listType: NodeType,
): true => {
  tr.setNodeMarkup(shared.pos, listType);
  joinNeighbours(tr, shared.depth);
  return true;
};

/**
 * Covered items only, each isolated so both wrappers can be swapped in one
 * ReplaceAroundStep around the untouched body — a setNodeMarkup sequence is
 * invalid at every intermediate step (taskList(listItem)).
 */
export const retypeItems = (
  tr: Transaction,
  shared: SharedList,
  firstIndex: number,
  lastIndex: number,
  listType: NodeType,
  itemType: NodeType,
): true => {
  const { node: list, depth, pos: listPos } = shared;
  const splitDepth = isDBlock(tr.doc.resolve(listPos).parent) ? 2 : 1;
  const toTask = itemType.name === 'taskItem';

  for (let i = lastIndex; i >= firstIndex; i--) {
    const itemPos = childPos(list, listPos, i);
    const item = tr.doc.nodeAt(itemPos) as ProseMirrorNode;
    const isolatedPos = isolateItem(tr, itemPos, splitDepth);
    const listStart = isolatedPos - 1;

    if (toTask) edgesToParagraphs(tr, isolatedPos, item);
    const replacement = listType.create(
      null,
      itemType.create(toTask ? { checked: false } : null),
    );
    tr.step(
      new ReplaceAroundStep(
        listStart,
        listStart + 2 + item.nodeSize,
        listStart + 2,
        listStart + item.nodeSize,
        new Slice(Fragment.from(replacement), 0, 0),
        2,
        true,
      ),
    );
    if (!toTask) edgesToItem(tr, isolatedPos);
  }

  // Fold the single-item lists back into one, then join same-type neighbours.
  const firstListPos =
    childPos(list, listPos, firstIndex) -
    1 +
    (firstIndex > 0 ? 2 * splitDepth : 0);
  const unitStart = splitDepth === 2 ? firstListPos - 1 : firstListPos;
  for (let i = firstIndex; i < lastIndex; i++) {
    const unit = tr.doc.nodeAt(unitStart) as ProseMirrorNode;
    tr.join(unitStart + unit.nodeSize, splitDepth);
  }
  joinNeighbours(tr, depth);
  return true;
};
