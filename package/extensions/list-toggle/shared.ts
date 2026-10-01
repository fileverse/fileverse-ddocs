import type {
  Node as ProseMirrorNode,
  NodeRange,
  ResolvedPos,
} from '@tiptap/pm/model';
import { NodeRange as PMNodeRange } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const ITEM_TYPES = new Set(['listItem', 'taskItem']);

/** The engine moves spacing itself; the stage-1 list-exit plugin skips transactions carrying this meta. */
export const LIST_TOGGLE_META = 'listToggle';

export const isList = (node: ProseMirrorNode | null | undefined) =>
  !!node && LIST_TYPES.has(node.type.name);
export const isListItemNode = (node: ProseMirrorNode | null | undefined) =>
  !!node && ITEM_TYPES.has(node.type.name);
export const isDBlock = (node: ProseMirrorNode | null | undefined) =>
  node?.type.name === 'dBlock';

export type SharedList = { node: ProseMirrorNode; depth: number; pos: number };

/** The innermost list containing BOTH ends of the selection (spec §3.2). */
export const sharedList = (
  $from: ResolvedPos,
  $to: ResolvedPos,
): SharedList | null => {
  for (let d = Math.min($from.depth, $to.depth); d >= 1; d--) {
    if ($from.before(d) === $to.before(d) && isList($from.node(d))) {
      return { node: $from.node(d), depth: d, pos: $from.before(d) };
    }
  }
  return null;
};

export type RowBlock = { pos: number; node: ProseMirrorNode };

/**
 * The children of range.parent inside the range. Where those children are
 * v1 dBlocks (the doc, a column) each is looked through to its single block.
 */
export const rowBlocks = (range: NodeRange) => {
  const parent = range.parent;
  const throughDBlock = isDBlock(parent.child(range.startIndex));
  const blocks: RowBlock[] = [];
  let pos = range.start;
  for (let i = range.startIndex; i < range.endIndex; i++) {
    const child = parent.child(i);
    blocks.push(
      throughDBlock
        ? { pos: pos + 1, node: child.firstChild as ProseMirrorNode }
        : { pos, node: child },
    );
    pos += child.nodeSize;
  }
  return { blocks, throughDBlock };
};

/** Position of `parent.child(index)` when `parent` sits at `parentPos`. */
export const childPos = (
  parent: ProseMirrorNode,
  parentPos: number,
  index: number,
) => {
  let pos = parentPos + 1;
  for (let i = 0; i < index; i++) pos += parent.child(i).nodeSize;
  return pos;
};

/** A NodeRange covering exactly the node that starts at `pos`. */
export const nodeRangeAt = (tr: Transaction, pos: number) => {
  const $start = tr.doc.resolve(pos);
  const $end = tr.doc.resolve(
    pos + ($start.nodeAfter as ProseMirrorNode).nodeSize,
  );
  return new PMNodeRange($start, $end, $start.depth);
};

/**
 * Tiptap dispatches a chain's transaction even when a command returned
 * false; preventDispatch is the only way to make "false" mean "nothing".
 */
export const refuse = (tr: Transaction): false => {
  tr.setMeta('preventDispatch', true);
  return false;
};

/**
 * Joins the list at `listDepth` around tr.selection.$from with a same-type
 * list right after it, then right before it (spec §3.6). Neighbours are
 * read through v1 dBlocks, and the join then cuts two levels.
 */
export const joinNeighbours = (tr: Transaction, listDepth: number) => {
  const $from = tr.selection.$from;
  if ($from.depth < listDepth) return;
  const list = $from.node(listDepth);
  if (!isList(list)) return;
  const throughDBlock = isDBlock($from.node(listDepth - 1));
  const unitPos = throughDBlock
    ? $from.before(listDepth) - 1
    : $from.before(listDepth);
  const $unit = tr.doc.resolve(unitPos);
  const unit = $unit.nodeAfter as ProseMirrorNode;
  const listOf = (node: ProseMirrorNode | null | undefined) =>
    (throughDBlock ? node?.firstChild : node) ?? null;
  const depth = throughDBlock ? 2 : 1;
  const index = $unit.index();
  const after =
    index + 1 < $unit.parent.childCount ? $unit.parent.child(index + 1) : null;
  if (after && listOf(after)?.type === list.type) {
    tr.join(unitPos + unit.nodeSize, depth);
  }
  const before = $unit.nodeBefore;
  if (before && listOf(before)?.type === list.type) {
    tr.join(unitPos, depth);
  }
};

/** Splits the list so the item at itemPos is alone in its own list; returns the item's new position. */
export const isolateItem = (
  tr: Transaction,
  itemPos: number,
  splitDepth: number,
) => {
  const item = tr.doc.nodeAt(itemPos) as ProseMirrorNode;
  const $item = tr.doc.resolve(itemPos);
  if ($item.index() + 1 < $item.parent.childCount) {
    tr.split(itemPos + item.nodeSize, splitDepth);
  }
  const hasPrevious = $item.index() > 0;
  if (hasPrevious) tr.split(itemPos, splitDepth);
  return itemPos + (hasPrevious ? 2 * splitDepth : 0);
};

/** For UI "Text" entries: the list a toggle-off would act on, if any. */
export const listAtSelection = (state: EditorState) => {
  const { $from, $to } = state.selection;
  const shared = sharedList($from, $to);
  if (!shared) return null;
  return {
    listType: shared.node.type.name,
    itemType: (shared.node.firstChild as ProseMirrorNode).type.name,
  };
};
