import type { Editor } from '@tiptap/core';
import {
  TableOfContents,
  type TableOfContentsStorage,
} from '@tiptap/extension-table-of-contents';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, type Transaction } from '@tiptap/pm/state';

type EditorWithTableOfContentsStorage = {
  storage?: {
    tableOfContents?: TableOfContentsStorage | null;
  };
};

const getTableOfContentsStorage = (
  target:
    | Editor
    | EditorWithTableOfContentsStorage
    | TableOfContentsStorage
    | null
    | undefined,
): TableOfContentsStorage | null => {
  if (!target) {
    return null;
  }

  if ('anchors' in target && 'content' in target) {
    return target;
  }

  return target.storage?.tableOfContents ?? null;
};

export const clearTableOfContentsStorage = (
  target:
    | Editor
    | EditorWithTableOfContentsStorage
    | TableOfContentsStorage
    | null
    | undefined,
) => {
  const storage = getTableOfContentsStorage(target);

  if (!storage) {
    return false;
  }

  storage.anchors = [];
  storage.content = [];

  return true;
};

export const getHeadingSignature = (doc: ProseMirrorNode) => {
  const headings: string[] = [];

  doc.descendants((node) => {
    if (node.type.name !== 'heading') {
      return true;
    }

    headings.push(
      [node.attrs.id ?? '', node.attrs.level ?? '', node.textContent].join(':'),
    );
    return false;
  });

  return headings.join('|');
};

// Check both sides of a changed range so inserting, deleting, converting, or
// moving a heading is detected even when it exists in only one document.
const rangeTouchesHeading = (
  doc: ProseMirrorNode,
  from: number,
  to: number,
) => {
  const start = Math.max(0, Math.min(from, doc.content.size));
  const end = Math.max(start, Math.min(to, doc.content.size));
  let touchesHeading = false;

  const endpointTouchesHeading = (pos: number) => {
    const $pos = doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type.name === 'heading') {
        return true;
      }
    }

    return false;
  };

  if (endpointTouchesHeading(start) || endpointTouchesHeading(end)) {
    return true;
  }

  doc.nodesBetween(start, end, (node) => {
    if (node.type.name === 'heading') {
      touchesHeading = true;
      return false;
    }

    return !touchesHeading;
  });

  return touchesHeading;
};

export const transactionCouldTouchHeading = (transaction: Transaction) => {
  if (!transaction.docChanged) {
    return false;
  }

  let touchesHeading = false;

  transaction.mapping.maps.forEach((map, index) => {
    if (touchesHeading) {
      return;
    }
    const beforeDoc = transaction.docs[index] ?? transaction.before;
    const afterDoc = transaction.docs[index + 1] ?? transaction.doc;

    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      touchesHeading ||=
        rangeTouchesHeading(beforeDoc, oldStart, oldEnd) ||
        rangeTouchesHeading(afterDoc, newStart, newEnd);
    });
  });

  return touchesHeading;
};

export const DdocTableOfContents = TableOfContents.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];

    // Keep Tiptap's ID assignment/duplicate repair intact, but do not enter
    // its document-wide scan for transactions unrelated to headings.
    return plugins.map((plugin) => {
      const appendTransaction = plugin.spec.appendTransaction;
      if (!appendTransaction) {
        return plugin;
      }

      return new Plugin({
        ...plugin.spec,
        appendTransaction(transactions, oldState, newState) {
          if (!transactions.some(transactionCouldTouchHeading)) {
            return null;
          }

          return appendTransaction.call(this, transactions, oldState, newState);
        },
      });
    });
  },

  onTransaction(event) {
    // The parent rebuild traverses the full document, so paragraph typing and
    // mark-only formatting must return before calling it.
    if (!transactionCouldTouchHeading(event.transaction)) {
      return;
    }

    this.parent?.(event);
  },

  onDestroy(event) {
    this.parent?.(event);
    clearTableOfContentsStorage(this.storage);
  },
});
