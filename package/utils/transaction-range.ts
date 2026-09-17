import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { ReplaceStep } from '@tiptap/pm/transform';

type TouchedNodeTypes = {
  // Every node a changed range starts or ends inside, or overlaps: the
  // enclosing blocks of the caret included.
  touched: Set<string>;
  // Only nodes that lie entirely inside a changed range: what an edit
  // inserted, deleted or replaced as a whole. Typing never lists anything
  // here (the text node it extends reaches past the range).
  contained: Set<string>;
};

const collectNodeTypesInRange = (
  doc: ProseMirrorNode,
  from: number,
  to: number,
  into: TouchedNodeTypes,
) => {
  const start = Math.max(0, Math.min(from, doc.content.size));
  const end = Math.max(start, Math.min(to, doc.content.size));

  // Ancestors of each endpoint: a change strictly inside a node (typing in a
  // code block) is not visited by nodesBetween when the range is empty at
  // that node's boundary, so walk up from both ends.
  for (const pos of [start, end]) {
    const $pos = doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      into.touched.add($pos.node(depth).type.name);
    }
  }

  doc.nodesBetween(start, end, (node, pos) => {
    into.touched.add(node.type.name);
    if (pos >= start && pos + node.nodeSize <= end) {
      into.contained.add(node.type.name);
    }
    return true;
  });
};

// One walk per transaction, shared by every gate that asks "could this
// transaction have touched a node of type X" (code block highlighting, the
// page count's structural check, the table of contents). Keyed on the
// transaction object so repeated questions about the same transaction, from
// plugins that each see it, cost one Set lookup. Remote collaboration
// updates arrive as a single whole-document ReplaceStep, so without the
// cache each gate would walk the entire document per remote keystroke.
const touchedTypesCache = new WeakMap<Transaction, TouchedNodeTypes>();

const collectTransactionNodeTypes = (
  transaction: Transaction,
): TouchedNodeTypes => {
  const cached = touchedTypesCache.get(transaction);
  if (cached) return cached;

  const types: TouchedNodeTypes = {
    touched: new Set<string>(),
    contained: new Set<string>(),
  };
  if (transaction.docChanged) {
    transaction.mapping.maps.forEach((map, index) => {
      const beforeDoc = transaction.docs[index] ?? transaction.before;
      const afterDoc = transaction.docs[index + 1] ?? transaction.doc;
      map.forEach((oldStart, oldEnd, newStart, newEnd) => {
        collectNodeTypesInRange(beforeDoc, oldStart, oldEnd, types);
        collectNodeTypesInRange(afterDoc, newStart, newEnd, types);
      });
    });
  }

  touchedTypesCache.set(transaction, types);
  return types;
};

/**
 * Node type names that a transaction's changed ranges start or end inside,
 * or overlap (insert, delete, paste, remote sync). Typing lists the text
 * and its enclosing blocks. Empty for transactions that do not change the
 * document.
 */
export const transactionTouchedNodeTypes = (
  transaction: Transaction,
): ReadonlySet<string> => collectTransactionNodeTypes(transaction).touched;

const transactionContainedNodeTypes = (
  transaction: Transaction,
): ReadonlySet<string> => collectTransactionNodeTypes(transaction).contained;

const stepOnlyChangesText = (step: unknown) => {
  // Anything that is not a plain replacement changes shape or presentation
  // rather than characters: setNodeMarkup (line height, paragraph spacing,
  // heading level) is a ReplaceAroundStep, bold and font size are mark steps.
  if (!(step instanceof ReplaceStep)) return false;
  // An open slice is a split or a join, which adds or removes a block.
  if (step.slice.openStart !== 0 || step.slice.openEnd !== 0) return false;

  let inlineOnly = true;
  step.slice.content.forEach((node) => {
    if (!node.isInline) inlineOnly = false;
  });
  return inlineOnly;
};

/**
 * True when a transaction only adds or removes characters inside blocks that
 * already exist: ordinary typing and deleting. False for splits and joins,
 * attribute changes (line height, paragraph spacing, heading level), marks
 * (bold, font size), inserted or deleted whole nodes, and the whole-document
 * replacement a remote collaboration update arrives as.
 *
 * Used to decide whether a page measurement of the document can be scaled by
 * its character count instead of being taken again.
 */
export const transactionOnlyChangesText = (transaction: Transaction) => {
  if (!transaction.docChanged) return true;
  if (!transaction.steps.every(stepOnlyChangesText)) return false;

  // A deletion is a plain replacement whatever it removed, so check what the
  // changed ranges covered whole: deleting an image or a table is not a text
  // edit even though the step shape says replacement.
  for (const typeName of transactionContainedNodeTypes(transaction)) {
    if (typeName !== 'text') return false;
  }
  return true;
};

/**
 * True when a transaction can reach a node of `typeName`. Meant for gating
 * work that would otherwise walk the whole document on every transaction.
 */
export const transactionTouchesNodeType = (
  transaction: Transaction,
  typeName: string,
) => transactionTouchedNodeTypes(transaction).has(typeName);
