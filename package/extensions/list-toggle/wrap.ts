import type {
  Node as ProseMirrorNode,
  NodeRange,
  NodeType,
} from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { findWrapping } from '@tiptap/pm/transform';
import { isDBlock, joinNeighbours, rowBlocks } from './shared';

const WRAPPABLE = new Set(['paragraph', 'heading']);

/** A heading's attrs that paragraph also defines (textAlign, spacing, caretMarks…). */
const paragraphAttrs = (heading: ProseMirrorNode, paragraph: NodeType) =>
  Object.fromEntries(
    Object.entries(heading.attrs).filter(
      ([key]) => key in (paragraph.spec.attrs ?? {}),
    ),
  );

/**
 * Wraps the row blocks of `range` into one list (spec §3.3). Blocks are
 * wrapped last to first on their original positions: a wrap only touches
 * positions at or after its block, and in v2 the boundary between two
 * neighbours is ambiguous under mapping (both wraps insert there).
 */
export const wrapRow = (
  tr: Transaction,
  range: NodeRange,
  listType: NodeType,
  paragraph: NodeType,
): boolean => {
  const { blocks, throughDBlock } = rowBlocks(range);
  if (!blocks.every((block) => WRAPPABLE.has(block.node.type.name))) {
    return false;
  }
  const joinDepth = throughDBlock || isDBlock(range.parent) ? 2 : 1;

  for (const block of [...blocks].reverse()) {
    let node = tr.doc.nodeAt(block.pos) as ProseMirrorNode;
    if (node.type.name === 'heading') {
      tr.setBlockType(block.pos, block.pos + node.nodeSize, paragraph, (n) =>
        paragraphAttrs(n, paragraph),
      );
      node = tr.doc.nodeAt(block.pos) as ProseMirrorNode;
    }
    const blockRange = tr.doc.resolve(block.pos + 1).blockRange();
    const wrapping = blockRange && findWrapping(blockRange, listType);
    if (!blockRange || !wrapping) return false;
    tr.wrap(blockRange, wrapping);
  }

  // Each block is now its own list; fold the rest into the first one.
  const unitStart = throughDBlock ? blocks[0].pos - 1 : blocks[0].pos;
  for (let i = 1; i < blocks.length; i++) {
    const unit = tr.doc.nodeAt(unitStart) as ProseMirrorNode;
    tr.join(unitStart + unit.nodeSize, joinDepth);
  }
  joinNeighbours(tr, range.depth + 1 + (throughDBlock ? 1 : 0));
  return true;
};
