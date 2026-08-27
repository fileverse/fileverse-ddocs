import { Extension } from '@tiptap/core';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from '@tiptap/pm/transform';
import { v4 as uuidv4 } from 'uuid';

export const BLOCK_ID_ATTR = 'blockId';

// Node types that carry a persistent id when they sit at the top level of a
// flat (v2) doc. The attribute is declared globally, so nested occurrences
// (a paragraph inside a callout) have it too, but only top-level blocks get
// ids assigned; nested ones stay null.
const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'taskList',
  'blockquote',
  'codeBlock',
  'table',
  'callout',
  'resizableMedia',
  'actionButton',
  'iframe',
  'embeddedTweet',
  'horizontalRule',
  'pageBreak',
  'columns',
];

const blockIdAssignmentPluginKey = new PluginKey('blockIdAssign');

type InlineChangeContext = {
  block: ProseMirrorNode;
  blockIndex: number;
};

const getInlineChangeContext = (
  doc: ProseMirrorNode,
  from: number,
  to: number,
): InlineChangeContext | null => {
  if (from < 0 || to < from || to > doc.content.size) {
    return null;
  }

  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  if ($from.depth < 1 || !$from.sameParent($to) || !$from.parent.isTextblock) {
    return null;
  }

  return {
    block: $from.node(1),
    blockIndex: $from.index(0),
  };
};

const hasValidBlockId = (node: ProseMirrorNode) => {
  const id = node.attrs[BLOCK_ID_ATTR];
  return typeof id === 'string' && id.length > 0;
};

// Skip the full ID check only when an edit clearly stays inside one block and
// that block keeps the same type and ID. If we are unsure, check every block.
const transactionRequiresBlockIdValidation = (transaction: Transaction) => {
  if (!transaction.docChanged) {
    return false;
  }

  return transaction.steps.some((step, index) => {
    // Bold, italic, links, and similar formatting cannot change block IDs.
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      return false;
    }

    // Normal typing uses ReplaceStep. Other step types may change blocks, so
    // check every ID when we see one.
    if (!(step instanceof ReplaceStep)) {
      return true;
    }

    const beforeDoc = transaction.docs[index] ?? transaction.before;
    const afterDoc = transaction.docs[index + 1] ?? transaction.doc;

    // Enter, split, join, and block paste can change the number of blocks and
    // may create missing or copied IDs.
    if (beforeDoc.childCount !== afterDoc.childCount) {
      return true;
    }

    let hasChangedRange = false;
    let requiresValidation = false;

    step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
      hasChangedRange = true;
      const before = getInlineChangeContext(beforeDoc, oldStart, oldEnd);
      const after = getInlineChangeContext(afterDoc, newStart, newEnd);

      // Typing is safe only when it starts and ends in the same block, and the
      // block keeps the same type and ID. Otherwise, check every block.
      if (
        !before ||
        !after ||
        before.blockIndex !== after.blockIndex ||
        before.block.type !== after.block.type ||
        !hasValidBlockId(before.block) ||
        before.block.attrs[BLOCK_ID_ATTR] !== after.block.attrs[BLOCK_ID_ATTR]
      ) {
        requiresValidation = true;
      }
    });

    return !hasChangedRange || requiresValidation;
  });
};

// v2 only: give every top-level block a stable ID for links and block controls.
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_TYPES,
        attributes: {
          [BLOCK_ID_ATTR]: {
            default: null,
            // After Enter splits a block, the new block gets a new ID while
            // the original block keeps its ID.
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute('data-block-id'),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes[BLOCK_ID_ATTR]
                ? { 'data-block-id': attributes[BLOCK_ID_ATTR] as string }
                : {},
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdAssignmentPluginKey,
        appendTransaction: (transactions, _oldState, newState) => {
          const changedTransactions = transactions.filter(
            (transaction) => transaction.docChanged,
          );
          if (changedTransactions.length === 0) {
            return null;
          }

          if (
            changedTransactions.every((transaction) =>
              transaction.getMeta(blockIdAssignmentPluginKey),
            )
          ) {
            // This is our own repair. It was already checked, so skip it.
            return null;
          }

          // The remote editor already handled its IDs. Do not create another
          // local repair or add someone else's change to our undo history.
          if (transactions.some(isChangeOrigin)) {
            return null;
          }

          if (
            changedTransactions.every(
              (transaction) =>
                !transactionRequiresBlockIdValidation(transaction),
            )
          ) {
            // Typing or formatting did not change any blocks or IDs, so do not
            // check every block after this keystroke.
            return null;
          }

          // Check top-level blocks: add missing IDs and replace copied IDs.
          const tr = newState.tr;
          let modified = false;
          const seenIds = new Set<string>();

          newState.doc.forEach((node, pos) => {
            if (!(BLOCK_ID_ATTR in node.attrs)) {
              return;
            }

            const id = node.attrs[BLOCK_ID_ATTR] as string | null;
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              return;
            }

            const newId = uuidv4();
            seenIds.add(newId);
            modified = true;
            tr.setNodeMarkup(
              pos,
              undefined,
              { ...node.attrs, [BLOCK_ID_ATTR]: newId },
              node.marks,
            );
          });

          // Keep this repair in the same undo action as the user's edit.
          // Mark it so the guard above skips the next check.
          return modified ? tr.setMeta(blockIdAssignmentPluginKey, true) : null;
        },
      }),
    ];
  },
});
