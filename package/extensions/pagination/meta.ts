import { isChangeOrigin } from '@tiptap/extension-collaboration';
import { PluginKey, type Transaction } from '@tiptap/pm/state';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import type { DecorationSet, EditorView } from '@tiptap/pm/view';
import type { Spacer } from './place';

export const PAGINATION_META = 'ddocPagination';
export const paginationPluginKey = new PluginKey<DecorationSet>('pagination');

export type PaginationMeta = { enabled: boolean } | { spacers: Spacer[] };

// Zero Yjs writes (docs/PAGES_MODE.md §12.11): a pagination transaction with
// steps is never applied, in any build.
export const refuses = (tr: Transaction) => {
  if (tr.getMeta(PAGINATION_META) === undefined || !tr.steps.length) {
    return false;
  }
  console.error('ddoc pagination: refusing a transaction with steps');
  return true;
};

export const dispatchMeta = (view: EditorView, meta: PaginationMeta) => {
  const tr = view.state.tr.setMeta(PAGINATION_META, meta);
  if (!refuses(tr)) view.dispatch(tr);
};

// y-sync applies every remote change, undo and redo as one whole-doc replace,
// which would drop every spacer. Map through the range that really changed;
// unchanged nodes are reused, so the diff is cheap.
export function spacerMapping(tr: Transaction): Mapping {
  if (!isChangeOrigin(tr)) return tr.mapping;
  const a = tr.before.content;
  const b = tr.doc.content;
  const start = a.findDiffStart(b);
  if (start === null) return new Mapping();
  let { a: endA, b: endB } = a.findDiffEnd(b) ?? { a: a.size, b: b.size };
  const overlap = start - Math.min(endA, endB);
  if (overlap > 0) {
    endA += overlap;
    endB += overlap;
  }
  return new Mapping([new StepMap([start, endA - start, endB - start])]);
}
