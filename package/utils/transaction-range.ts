import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

/**
 * True when [from, to] in `doc` starts or ends inside a node of `typeName`,
 * or contains one. Cost is proportional to the range, not the document.
 */
export const rangeTouchesNodeType = (
  doc: ProseMirrorNode,
  from: number,
  to: number,
  typeName: string,
) => {
  const start = Math.max(0, Math.min(from, doc.content.size));
  const end = Math.max(start, Math.min(to, doc.content.size));

  const endpointInside = (pos: number) => {
    const $pos = doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === typeName) return true;
    }
    return false;
  };

  if (endpointInside(start) || endpointInside(end)) return true;

  let touches = false;
  doc.nodesBetween(start, end, (node) => {
    if (node.type.name === typeName) {
      touches = true;
      return false;
    }
    return !touches;
  });
  return touches;
};

/**
 * True when a transaction's changed ranges can reach a node of `typeName`:
 * a range starts or ends inside one, or contains one (insert, delete, paste,
 * remote sync). Typing elsewhere in the document is false. Meant for gating
 * work that would otherwise walk the whole document on every transaction.
 */
export const transactionTouchesNodeType = (
  transaction: Transaction,
  typeName: string,
) => {
  if (!transaction.docChanged) return false;

  let touches = false;
  transaction.mapping.maps.forEach((map, index) => {
    if (touches) return;
    const beforeDoc = transaction.docs[index] ?? transaction.before;
    const afterDoc = transaction.docs[index + 1] ?? transaction.doc;
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      touches ||=
        rangeTouchesNodeType(beforeDoc, oldStart, oldEnd, typeName) ||
        rangeTouchesNodeType(afterDoc, newStart, newEnd, typeName);
    });
  });
  return touches;
};
