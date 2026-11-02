import { Extension } from '@tiptap/core';
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import {
  Plugin,
  PluginKey,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import { DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { PageSetup } from '../../types';
import { getZoomScale } from '../../utils/zoom';
import { collectLeaves, SPACER_CLASS } from './collect-leaves';
import { PAGE_GAP, PageGrid, type Orientation } from './page-grid';
import { createPageStore, DISABLED_PAGE_STATE } from './page-store';
import { place, type Placement, type Spacer } from './place';
import {
  createSettleGuard,
  editStaysInOneTextblock,
  PassScheduler,
  SETTLE_CAP,
} from './scheduler';
import { buildSpacerDecorations, spacerKey, spacersMatch } from './spacers';

export const PAGINATION_META = 'ddocPagination';
export const paginationPluginKey = new PluginKey<DecorationSet>('pagination');

export type PaginationMeta = { enabled: boolean } | { spacers: Spacer[] };

export type PaginationOptions = {
  pageSetup?: PageSetup;
  orientation?: Orientation;
  zoom?: number;
  enabled: boolean;
  running: boolean;
};

export type PaginationStorage = {
  pageSetup?: PageSetup;
  orientation?: Orientation;
  zoom?: number;
  enabled: boolean;
  running: boolean;
  failed: boolean;
  store: ReturnType<typeof createPageStore>;
  flush(): Placement | null;
  lastPass: PassInfo | null;
  isIdle(): boolean;
};

export type PassInfo = {
  count: number;
  timings: { collect: number; place: number; emit: number };
  dispatched: boolean;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagination: {
      setPagination: (options: PaginationOptions) => ReturnType;
    };
  }
  interface Storage {
    pagination: PaginationStorage;
  }
}

const controllers = new WeakMap<PaginationStorage, PaginationView>();

// Zero Yjs writes (docs/PAGES_MODE.md §12.11): a pagination transaction with
// steps is never applied, in any build.
const refuses = (tr: Transaction) => {
  if (tr.getMeta(PAGINATION_META) === undefined || !tr.steps.length) {
    return false;
  }
  console.error('ddoc pagination: refusing a transaction with steps');
  return true;
};

const dispatchMeta = (view: EditorView, meta: PaginationMeta) => {
  const tr = view.state.tr.setMeta(PAGINATION_META, meta);
  if (!refuses(tr)) view.dispatch(tr);
};

// Only kind and pos matter to the skip rule; the key starts with the kind.
const spacersIn = (set: DecorationSet): Spacer[] =>
  set.find().map((d) => ({
    kind: String(d.spec.key).split(':')[0] as Spacer['kind'],
    pos: d.from,
    height: 0,
    page: 0,
    print: true,
  }));

const signature = (spacers: Spacer[]) =>
  spacers.map((s) => `${s.pos}|${spacerKey(s)}`).join(',');

function mapPlacement(p: Placement, trs: readonly Transaction[]): Placement {
  if (!trs.length) return p;
  const map = (pos: number) => trs.reduce((at, tr) => tr.mapping.map(at), pos);
  return {
    ...p,
    breaks: p.breaks.map((b) => ({ ...b, pos: map(b.pos) })),
    pageStarts: p.pageStarts.map((s) => ({ ...s, pos: map(s.pos) })),
    spacers: p.spacers.map((s) => ({ ...s, pos: map(s.pos) })),
  };
}

// y-sync applies every remote change, undo and redo as one whole-doc replace,
// which would drop every spacer. Map through the range that really changed;
// unchanged nodes are reused, so the diff is cheap.
function spacerMapping(tr: Transaction): Mapping {
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

// Bottom of the last content element in the view.dom frame, unscaled.
function contentBottom(view: EditorView): number {
  let last = view.dom.lastElementChild;
  while (last?.classList.contains(SPACER_CLASS)) {
    last = last.previousElementSibling;
  }
  if (!last) return 0;
  const top = view.dom.getBoundingClientRect().top;
  return (last.getBoundingClientRect().bottom - top) / getZoomScale(view.dom);
}

const mark = (name: string, start: number) => {
  const end = performance.now();
  try {
    performance.measure(`ddoc:pagination:${name}`, { start, end });
    performance.clearMeasures(`ddoc:pagination:${name}`);
  } catch {
    // User Timing is optional.
  }
  return end;
};

class PaginationView {
  private scheduler: PassScheduler | null = null;
  private observer: ResizeObserver | null = null;
  private heights = new Map<Element, number>();
  private guard = createSettleGuard();
  private force = false;
  // Edits since the last pass, and the spacers as they were before them.
  private edits: Transaction[] = [];
  private spacersBefore: Spacer[] = [];
  private lastBottom: number | null = null;
  private passCount = 0;

  constructor(
    private view: EditorView,
    private storage: PaginationStorage,
  ) {
    this.sync();
  }

  // Follows storage: starts or stops, and a call while running forces a pass.
  sync() {
    if (!this.storage.enabled) {
      this.view.dom.style.minHeight = '';
      this.passCount = 0;
      this.storage.lastPass = null;
    }
    if (!this.storage.running || this.storage.failed) {
      this.stop();
      return;
    }
    if (!this.scheduler) this.start();
    this.trigger(true);
  }

  noteEdit(tr: Transaction, before: DecorationSet) {
    if (!this.scheduler) return;
    if (!this.edits.length) this.spacersBefore = spacersIn(before);
    this.edits.push(tr);
  }

  update(view: EditorView, prev: EditorState) {
    if (!this.scheduler || view.state.doc === prev.doc) return;
    try {
      this.guard.reset();
      if (this.caretOverflows()) this.trigger(false);
      else this.scheduler.onEdit(this.edits);
    } catch (error) {
      this.fail(error);
    }
  }

  // Runs pending passes, settle follow-ups included, until idle.
  flush() {
    for (let i = 0; i <= SETTLE_CAP && this.scheduler?.isPending(); i++) {
      this.scheduler.flush();
    }
  }

  isIdle() {
    return !this.scheduler?.isPending();
  }

  destroy() {
    this.stop();
    if (controllers.get(this.storage) === this) {
      controllers.delete(this.storage);
    }
  }

  private start() {
    this.scheduler = new PassScheduler({
      run: () => this.run(),
      isComposing: () => this.view.composing,
    });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver((entries) => this.onResize(entries));
    }
    document.fonts?.addEventListener?.('loadingdone', this.onFonts);
    this.view.dom.addEventListener('compositionend', this.onCompositionEnd);
    this.edits = [];
    this.lastBottom = null;
  }

  private stop() {
    if (!this.scheduler) return;
    this.scheduler.destroy();
    this.scheduler = null;
    this.observer?.disconnect();
    this.observer = null;
    this.heights.clear();
    document.fonts?.removeEventListener?.('loadingdone', this.onFonts);
    this.view.dom.removeEventListener('compositionend', this.onCompositionEnd);
    this.edits = [];
  }

  // Settle passes keep the guard's count; edits and other triggers reset it.
  private trigger(reset: boolean) {
    if (!this.scheduler) return;
    if (reset) this.guard.reset();
    this.force = true;
    this.scheduler.now();
  }

  private onFonts = () => this.trigger(true);

  // After ProseMirror's own handler, so view.composing is already false.
  private onCompositionEnd = () => {
    setTimeout(() => this.scheduler?.compositionEnd(), 0);
  };

  private onResize(entries: ResizeObserverEntry[]) {
    let moved = false;
    for (const { target } of entries) {
      const height = (target as HTMLElement).offsetHeight;
      if (this.heights.has(target) && this.heights.get(target) !== height) {
        this.heights.set(target, height);
        moved = true;
      }
    }
    // Growth from typing waits for that edit's own debounced pass; our own
    // spacers' resizes are filtered by the height refresh after a dispatch.
    if (moved && !this.edits.length) this.trigger(true);
  }

  // Held Enter or a long paste: the caret's block ends outside a page's text,
  // or on a page the last pass did not have.
  private caretOverflows(): boolean {
    const { pageSetup, orientation } = this.storage;
    const { $head } = this.view.state.selection;
    if (!pageSetup || !$head.depth || !$head.parent.isTextblock) return false;
    const el = this.view.nodeDOM($head.before());
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (!rect.height) return false;
    const top = this.view.dom.getBoundingClientRect().top;
    const bottom = (rect.bottom - top) / getZoomScale(this.view.dom);
    const grid = new PageGrid(pageSetup.paper, orientation);
    const page = grid.pageAt(bottom);
    return (
      bottom > grid.contentBottomOf(page) ||
      bottom < grid.contentTopOf(page) ||
      page >= (this.storage.store.get().pageCount ?? 1)
    );
  }

  private observeChildren(refresh: boolean) {
    const observer = this.observer;
    if (!observer) return;
    const current = new Set<Element>();
    for (const el of Array.from(this.view.dom.children)) {
      if (el.classList.contains(SPACER_CLASS)) continue;
      current.add(el);
      if (!this.heights.has(el)) observer.observe(el);
      if (refresh || !this.heights.has(el)) {
        this.heights.set(el, (el as HTMLElement).offsetHeight);
      }
    }
    for (const el of Array.from(this.heights.keys())) {
      if (current.has(el)) continue;
      observer.unobserve(el);
      this.heights.delete(el);
    }
  }

  private run() {
    try {
      this.pass();
    } catch (error) {
      this.fail(error);
    }
  }

  private pass() {
    const { view, storage } = this;
    const { pageSetup, store } = storage;
    if (!pageSetup) return;
    const forced = this.force;
    const edits = this.edits;
    this.force = false;
    this.edits = [];
    const last = store.get().placement;
    if (
      !forced &&
      last &&
      this.lastBottom !== null &&
      editStaysInOneTextblock(edits, this.spacersBefore) &&
      Math.abs(contentBottom(view) - this.lastBottom) < 0.5
    ) {
      const mapped = mapPlacement(last, edits);
      store.set({ placement: mapped, pageStarts: mapped.pageStarts });
      this.record({ collect: 0, place: 0, emit: 0 }, false);
      return;
    }

    const t0 = performance.now();
    const grid = new PageGrid(pageSetup.paper, storage.orientation);
    const leaves = collectLeaves(view, grid.textHeight);
    const t1 = mark('collect', t0);
    const placement = place(leaves, grid);
    const t2 = mark('place', t1);
    const current = paginationPluginKey.getState(view.state);
    const changed = !current || !spacersMatch(current, placement.spacers);
    const sig = signature(placement.spacers);
    // a/b/a: keep b in the view and the store, and stop (§12.5).
    if (changed && this.guard.repeats(sig)) {
      this.record({ collect: t1 - t0, place: t2 - t1, emit: 0 }, false);
      return;
    }
    if (changed) dispatchMeta(view, { spacers: placement.spacers });
    this.lastBottom = contentBottom(view);
    this.observeChildren(changed);
    const t3 = mark('emit', t2);

    // Style write after every read of the pass.
    const minHeight = `${placement.pageCount * (grid.height + PAGE_GAP) - PAGE_GAP}px`;
    if (view.dom.style.minHeight !== minHeight) {
      view.dom.style.minHeight = minHeight;
    }
    store.set({
      enabled: true,
      pageCount: placement.pageCount,
      pageStarts: placement.pageStarts,
      placement,
    });
    this.record({ collect: t1 - t0, place: t2 - t1, emit: t3 - t2 }, changed);
    if (!changed) {
      this.guard.reset();
    } else if (this.guard.next(sig) === 'continue') {
      this.trigger(false);
    }
  }

  private record(timings: PassInfo['timings'], dispatched: boolean) {
    this.storage.lastPass = { count: ++this.passCount, timings, dispatched };
  }

  // The editor goes inert until reload and renders as one column.
  private fail(error: unknown) {
    console.error('ddoc pagination: pass failed', error);
    this.storage.failed = true;
    this.stop();
    this.view.dom.style.minHeight = '';
    this.storage.store.set({
      pageCount: null,
      pageStarts: [],
      placement: null,
    });
    try {
      dispatchMeta(this.view, { spacers: [] });
    } catch {
      // The view is gone.
    }
  }
}

export const Pagination = Extension.create<
  Record<string, never>,
  PaginationStorage
>({
  name: 'pagination',

  addStorage() {
    return {
      enabled: false,
      running: false,
      failed: false,
      store: createPageStore(),
      flush: () => null,
      lastPass: null,
      isIdle: () => true,
    };
  },

  // Storage is copied out of addStorage, so flush binds to the final object.
  onBeforeCreate() {
    const storage = this.storage;
    storage.flush = () => {
      controllers.get(storage)?.flush();
      return storage.failed ? null : storage.store.get().placement;
    };
    storage.isIdle = () => controllers.get(storage)?.isIdle() ?? true;
  },

  addCommands() {
    return {
      setPagination:
        (options) =>
        ({ tr, dispatch }) => {
          if (!dispatch) return true;
          const s = this.storage;
          const enabled =
            options.enabled && options.pageSetup?.mode === 'pages';
          const running = enabled && options.running;
          const next = {
            pageSetup: options.pageSetup,
            orientation: options.orientation,
            zoom: options.zoom,
            enabled,
            running,
          };
          const prev = {
            pageSetup: s.pageSetup,
            orientation: s.orientation,
            zoom: s.zoom,
            enabled: s.enabled,
            running: s.running,
          };
          if (JSON.stringify(next) === JSON.stringify(prev)) return true;
          Object.assign(s, next);
          if (enabled !== prev.enabled) {
            tr.setMeta(PAGINATION_META, { enabled });
            s.store.set(enabled ? { enabled } : DISABLED_PAGE_STATE);
          }
          controllers.get(s)?.sync();
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const storage = this.storage;
    return [
      new Plugin<DecorationSet>({
        key: paginationPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set) {
            const meta = tr.getMeta(PAGINATION_META) as
              | PaginationMeta
              | undefined;
            if (meta && 'spacers' in meta) {
              return buildSpacerDecorations(tr.doc, meta.spacers);
            }
            if (meta?.enabled === false) return DecorationSet.empty;
            if (!tr.docChanged) return set;
            controllers.get(storage)?.noteEdit(tr, set);
            return set.map(spacerMapping(tr), tr.doc);
          },
        },
        filterTransaction: (tr) => !refuses(tr),
        props: {
          decorations: (state) => paginationPluginKey.getState(state),
        },
        view: (view) => {
          const controller = new PaginationView(view, storage);
          controllers.set(storage, controller);
          return controller;
        },
      }),
    ];
  },
});
