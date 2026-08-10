import { Extension } from '@tiptap/core';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';

/**
 * Undo/redo here is Yjs's UndoManager, and its selection restore lags one step
 * behind the change it just applied: bold a word, colour a second, italicise a
 * third, then undo three times and you get the *previous* word highlighted
 * each time — the bubble menu opens over text that did not change.
 *
 * y-prosemirror rebuilds the whole document on undo (`tr.replace(0, size, …)`),
 * so the transaction's own step maps span everything and say nothing about
 * what moved. Diff the two documents instead and put the selection on the
 * range that genuinely differs.
 */

// The y-sync meta carries `isUndoRedoOperation`, but reading it by plugin key
// would mean importing y-tiptap directly — a transitive dependency whose
// PluginKey instance is not guaranteed to be the one Collaboration used, and a
// mismatched key silently reads back `undefined`. Match on the shape instead.
const isUndoRedo = (transaction: Transaction): boolean => {
  if (!isChangeOrigin(transaction)) {
    return false;
  }
  const meta = (transaction as unknown as { meta?: Record<string, unknown> })
    .meta;
  return Object.values(meta ?? {}).some(
    (value) =>
      typeof value === 'object' &&
      value !== null &&
      (value as { isUndoRedoOperation?: unknown }).isUndoRedoOperation === true,
  );
};

export const undoSelectionKey = new PluginKey<boolean>('undoSelection');

/**
 * True while the current selection is one this plugin placed. The bubble menu
 * reads it so a toolbar never appears over a selection the user did not make
 * with their own gesture; the next click, drag or keystroke clears it.
 */
export const isUndoRedoSelection = (state: EditorState): boolean =>
  undoSelectionKey.getState(state) === true;

export const UndoSelection = Extension.create({
  name: 'undoSelection',

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: undoSelectionKey,
        state: {
          init: () => false,
          apply: (transaction, value) => {
            if (transaction.getMeta(undoSelectionKey) === true) {
              return true;
            }
            return transaction.selectionSet || transaction.docChanged
              ? false
              : value;
          },
        },
        appendTransaction: (transactions, oldState, newState) => {
          const undoRedo = transactions.some(
            (transaction) => transaction.docChanged && isUndoRedo(transaction),
          );
          if (!undoRedo) {
            return null;
          }

          const from = oldState.doc.content.findDiffStart(newState.doc.content);
          if (from === null || from === undefined) {
            return null;
          }
          const ends = oldState.doc.content.findDiffEnd(newState.doc.content);
          if (!ends) {
            return null;
          }

          // `ends.b` is the end of the differing range in the NEW document.
          // An undo that only removed content leaves it before `from`.
          const to = Math.min(
            Math.max(from, ends.b),
            newState.doc.content.size,
          );

          const tr = newState.tr
            .setSelection(
              TextSelection.between(
                newState.doc.resolve(Math.min(from, newState.doc.content.size)),
                newState.doc.resolve(to),
              ),
            )
            .setMeta(undoSelectionKey, true);

          // Deliberately NOT `addToHistory: false` — see the note in
          // extensions/block-id. This changes no content, so it records
          // nothing either way, and the flag would leak onto the y-sync write
          // for this whole dispatch.
          return tr;
        },
      }),
    ];
  },
});
