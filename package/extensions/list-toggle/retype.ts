import type { NodeType } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { joinNeighbours, type SharedList } from './shared';

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
