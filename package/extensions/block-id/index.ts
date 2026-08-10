import { Extension } from '@tiptap/core';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import { Plugin, PluginKey } from '@tiptap/pm/state';
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

// v2-only: registered in the flat extension set, never in v1. Gives every
// top-level block a stable uuid that survives edits and rides the Yjs doc,
// for deep links, block anchoring, and the floating handle.
export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_TYPES,
        attributes: {
          [BLOCK_ID_ATTR]: {
            default: null,
            // The new half of an Enter-split starts without an id and gets a
            // fresh one; the original half keeps its identity.
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
        key: new PluginKey('blockIdAssign'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) {
            return null;
          }

          // A remote peer running this same extension already gave its blocks
          // ids before the update was sent, so re-deriving them here would
          // only race that peer — and would put a write triggered by someone
          // else's edit on OUR undo stack.
          if (transactions.some(isChangeOrigin)) {
            return null;
          }

          // Shallow pass over top-level blocks only: assign missing ids and
          // re-id duplicates (paste copies ids along with content).
          let tr: typeof newState.tr | null = null;
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

            tr = tr ?? newState.tr;
            const newId = uuidv4();
            seenIds.add(newId);
            tr.setNodeMarkup(
              pos,
              undefined,
              { ...node.attrs, [BLOCK_ID_ATTR]: newId },
              node.marks,
            );
          });

          // Deliberately NOT marked `addToHistory: false`. Undo here is Yjs's
          // UndoManager, not prosemirror-history, and the y-sync binding
          // writes ONE Yjs transaction per dispatch, stamped with the meta of
          // the LAST transaction in the chain — which is this one. Setting the
          // flag therefore excludes the user's own edit from the undo stack
          // (and calls stopCapturing), so anything that creates a new block —
          // Enter, paste, select-all-then-delete — became unrecoverable. The
          // ids ride along in the same Yjs transaction as the edit that needed
          // them, which is exactly where they belong.
          return tr;
        },
      }),
    ];
  },
});
