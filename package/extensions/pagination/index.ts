import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { DecorationSet } from '@tiptap/pm/view';
import {
  PAGINATION_META,
  paginationPluginKey,
  spacerMapping,
  refuses,
  type PaginationMeta,
} from './meta';
import { createPageStore, DISABLED_PAGE_STATE } from './page-store';
import {
  controllers,
  PaginationView,
  type PaginationOptions,
  type PaginationStorage,
} from './pagination-view';
import { buildSpacerDecorations } from './spacers';

export { PAGINATION_META, paginationPluginKey };
export type { PaginationMeta, PaginationOptions, PaginationStorage };
export type { PassInfo } from './pagination-view';

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
            if (set === DecorationSet.empty) return set;
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
