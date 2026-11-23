import { isChangeOrigin } from '@tiptap/extension-collaboration';
import { Mark } from '@tiptap/pm/model';
import {
  Selection,
  type EditorState,
  type PluginKey,
  type Transaction,
} from '@tiptap/pm/state';
import { ReplaceAroundStep, type Step } from '@tiptap/pm/transform';

export type OldCaret = {
  wasEmpty: boolean;
  /** Opening position of the pre-root caret block, tracked per step; null once its opening token went. */
  pos: number | null;
  /**
   * marksAcross of the last deletion inside that block; null when nothing was
   * deleted there. Meaningful only while `pos !== null` (the block survived).
   */
  deletedMarks: readonly Mark[] | null;
};
export type Pending = { marks: readonly Mark[] | null; explicit: boolean };

/**
 * Provenance of the dispatch in progress. ProseMirror's append loop hands a
 * hook only the transactions it has not seen, so the root's origin, stored
 * marks and steps live here, rebuilt at every root transaction.
 */
export type DispatchContext = {
  local: boolean;
  docChanged: boolean;
  oldCaret: OldCaret | null;
  pending: Pending | null;
  /** The root deleted a selection spanning the whole document's text. */
  wholeDocDelete: boolean;
};

export const EMPTY_CONTEXT: DispatchContext = {
  local: false,
  docChanged: false,
  oldCaret: null,
  pending: null,
  wholeDocDelete: false,
};

export const isRootTransaction = (tr: Transaction) =>
  !tr.getMeta('appendedTransaction');

export const isLocalRoot = (tr: Transaction) =>
  !isChangeOrigin(tr) && tr.getMeta('addToHistory') !== false;

// setNodeMarkup re-issues a node's tokens around its content (the gap): the
// block survives at `pos` although its opening token was replaced.
const isWrapperReplacement = (step: Step, pos: number) =>
  step instanceof ReplaceAroundStep &&
  step.from === pos &&
  step.gapFrom === step.from + 1 &&
  step.gapTo === step.to - 1;

// `deleted`, not `deletedAfter`: a zero-width insertion at `pos` reports
// deletedAfter too, and would pronounce the block dead when a paragraph is
// merely inserted in front of it.
const mapBlockPos = (step: Step, pos: number): number | null => {
  const result = step.getMap().mapResult(pos, 1);
  if (result.deleted && !isWrapperReplacement(step, pos)) return null;
  return result.pos;
};

const trackOldCaret = (
  tr: Transaction,
  oldState: EditorState,
): OldCaret | null => {
  const { $from } = oldState.selection;
  const block = $from.parent;
  if (!block.isTextblock) return null;

  let pos: number | null = $from.before();
  // The block's content range, carried forward step by step so it is always
  // in the current step's own coordinates (mapping a slice per step is
  // quadratic, and a select-all reflow runs thousands of steps).
  let from = pos + 1;
  let to = from + block.content.size;
  let deletedMarks: readonly Mark[] | null = null;

  tr.steps.forEach((step, i) => {
    if (pos === null) return;
    const map = step.getMap();
    if (block.content.size > 0) {
      // The marks from the doc that step saw — never pre-root positions.
      const doc = tr.docs[i];
      map.forEach((oldStart, oldEnd) => {
        const a = Math.max(oldStart, from);
        const b = Math.min(oldEnd, to);
        if (a >= b) return;
        deletedMarks = doc.resolve(a).marksAcross(doc.resolve(b)) ?? [];
      });
      from = map.map(from, -1);
      to = map.map(to, 1);
    }
    pos = mapBlockPos(step, pos);
  });

  return { wasEmpty: block.content.size === 0, pos, deletedMarks };
};

// Tiptap's bare `focus()` ends in `setStoredMarks(tr.storedMarks)` when the
// selection is unchanged: a step-free re-set of the marks the state already
// holds re-affirms them, it declares nothing, so A1 must not stamp for it.
const reaffirmsMarks = (tr: Transaction, oldState: EditorState) =>
  !tr.docChanged &&
  oldState.storedMarks !== null &&
  tr.storedMarks !== null &&
  Mark.sameSet(tr.storedMarks, oldState.storedMarks);

const nextPending = (
  tr: Transaction,
  prev: Pending | null,
  key: PluginKey,
  oldState: EditorState,
): Pending | null => {
  if (tr.storedMarksSet) {
    return {
      marks: tr.storedMarks,
      explicit: tr.getMeta(key) === undefined && !reaffirmsMarks(tr, oldState),
    };
  }
  // `insertText` etc. reposition the selection as a side effect of their own
  // step, which also flips `selectionSet`; only a step-free selectionSet is
  // a genuine navigation that should drop pending marks.
  if (!tr.docChanged && tr.selectionSet) return null;
  return prev;
};

// Same test as @tiptap/core's keymap clear-document plugin.
const isWholeDocumentSelected = ({ selection, doc }: EditorState) =>
  !selection.empty &&
  selection.from === Selection.atStart(doc).from &&
  selection.to === Selection.atEnd(doc).to;

// Tiptap 3.33.1's keymap appends setStoredMarks(null) after that delete; 3.11
// did not, so it is not a clear (Rule A3 keeps the deleted text's marks).
const isWholeDocClear = (tr: Transaction, prev: DispatchContext) =>
  prev.wholeDocDelete && tr.storedMarksSet && tr.storedMarks === null;

export const applyDispatchContext = (
  tr: Transaction,
  prev: DispatchContext,
  oldState: EditorState,
  key: PluginKey,
): DispatchContext => {
  if (isRootTransaction(tr)) {
    return {
      local: isLocalRoot(tr),
      docChanged: tr.docChanged,
      oldCaret: trackOldCaret(tr, oldState),
      pending: nextPending(tr, null, key, oldState),
      wholeDocDelete: tr.docChanged && isWholeDocumentSelected(oldState),
    };
  }
  const oldCaret =
    prev.oldCaret && prev.oldCaret.pos !== null
      ? {
          ...prev.oldCaret,
          pos: tr.steps.reduce<number | null>(
            (pos, step) => (pos === null ? null : mapBlockPos(step, pos)),
            prev.oldCaret.pos,
          ),
        }
      : prev.oldCaret;
  return {
    ...prev,
    oldCaret,
    pending: isWholeDocClear(tr, prev)
      ? prev.pending
      : nextPending(tr, prev.pending, key, oldState),
  };
};
