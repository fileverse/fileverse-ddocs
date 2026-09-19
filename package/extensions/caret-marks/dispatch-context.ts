import { isChangeOrigin } from '@tiptap/extension-collaboration';
import type { Mark } from '@tiptap/pm/model';
import type { EditorState, PluginKey, Transaction } from '@tiptap/pm/state';
import { ReplaceAroundStep, type Step } from '@tiptap/pm/transform';

export type OldCaret = {
  wasEmpty: boolean;
  /** Opening position of the pre-root caret block, tracked per step; null once its opening token went. */
  pos: number | null;
  /** marksAcross of the last deletion inside that block; null when nothing was deleted there. */
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
};

export const EMPTY_CONTEXT: DispatchContext = {
  local: false,
  docChanged: false,
  oldCaret: null,
  pending: null,
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
  const contentFrom = pos + 1;
  const contentTo = contentFrom + block.content.size;
  let deletedMarks: readonly Mark[] | null = null;

  tr.steps.forEach((step, i) => {
    if (pos === null) return;
    if (block.content.size > 0) {
      // The block's content range in step i's own coordinates, and the marks
      // from the doc that step saw — never pre-root positions (review R4-3).
      const before = tr.mapping.slice(0, i);
      const from = before.map(contentFrom, -1);
      const to = before.map(contentTo, 1);
      const doc = tr.docs[i];
      step.getMap().forEach((oldStart, oldEnd) => {
        const a = Math.max(oldStart, from);
        const b = Math.min(oldEnd, to);
        if (a >= b) return;
        deletedMarks = doc.resolve(a).marksAcross(doc.resolve(b)) ?? [];
      });
    }
    pos = mapBlockPos(step, pos);
  });

  return { wasEmpty: block.content.size === 0, pos, deletedMarks };
};

const nextPending = (
  tr: Transaction,
  prev: Pending | null,
  key: PluginKey,
): Pending | null => {
  if (tr.storedMarksSet) {
    return { marks: tr.storedMarks, explicit: !tr.getMeta(key) };
  }
  // `insertText` etc. reposition the selection as a side effect of their own
  // step, which also flips `selectionSet`; only a step-free selectionSet is
  // a genuine navigation that should drop pending marks.
  if (!tr.docChanged && tr.selectionSet) return null;
  return prev;
};

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
      pending: nextPending(tr, null, key),
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
  return { ...prev, oldCaret, pending: nextPending(tr, prev.pending, key) };
};
