import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Selection, type Transaction } from '@tiptap/pm/state';

/**
 * Replace the current (tr) selection with a block node, expanding over an
 * empty parent (the just-emptied host paragraph, or the empty dBlock a
 * caller left behind after deleting its child), then park the caret in the
 * first textblock AFTER the inserted node — creating a trailing
 * dBlock+paragraph when the node became the last block.
 *
 * Without the explicit placement, atom block inserts strand the selection
 * at the dBlock boundary: the caret renders at the block edge and the next
 * insert command silently fails (TEC-2539).
 */
export function replaceSelectionWithBlockNode(
  tr: Transaction,
  node: ProseMirrorNode,
): void {
  const schema = node.type.schema;
  let { from, to } = tr.selection;
  const { $from } = tr.selection;

  if (tr.selection.empty && $from.depth > 0 && $from.parent.content.size === 0) {
    from = $from.before();
    to = $from.after();
  }

  tr.replaceRangeWith(from, to, node);

  // replaceRangeWith may have expanded the range while fitting; locate the
  // inserted node around the mapped position.
  const mapped = tr.mapping.map(from, -1);
  let nodePos: number | null = null;
  tr.doc.nodesBetween(
    Math.max(0, mapped - 2),
    Math.min(tr.doc.content.size, mapped + node.nodeSize + 2),
    (child, childPos) => {
      if (nodePos == null && child.type === node.type) nodePos = childPos;
    },
  );
  if (nodePos == null) return;

  const afterPos = Math.min(nodePos + node.nodeSize, tr.doc.content.size);
  let selection = Selection.findFrom(tr.doc.resolve(afterPos), 1, true);

  if (!selection) {
    // The node landed last, so there is no textblock after it to hold the
    // caret — append one. v1 needs it inside a dBlock wrapper; the flat
    // schema takes the paragraph directly.
    const dBlockType = schema.nodes.dBlock;
    const paragraphType = schema.nodes.paragraph;
    if (paragraphType) {
      const end = tr.doc.content.size;
      tr.insert(
        end,
        dBlockType
          ? dBlockType.create(null, paragraphType.create())
          : paragraphType.create(),
      );
      selection = Selection.findFrom(tr.doc.resolve(end), 1, true);
    }
  }

  if (selection) tr.setSelection(selection);
  tr.scrollIntoView();
}
