# Dist bundling: what ships inlined and what stays external (TEC-3028)

## Problem

`npm pack` showed a single `dist/use-headless-editor-*.mjs` chunk of ~4.6 MB (4.5 MB raw / 1.0 MB gzip on 5.1.13). The tarball was 1.6 MB packed / 6.9 MB unpacked, and `dist/headless-editor-utils.es.js` (0.24 KB) imported that whole chunk.

## Root cause

`vite.config.ts` externalized only the peer dependencies. Rollup therefore inlined every runtime `dependency` into the dist: emojibase-data (881 KB), katex (602 KB), the mammoth stack (~750 KB with bluebird, xmldom, dingbat-to-unicode, underscore and xmlbuilder), highlight.js (376 KB), prettier (228 KB), jszip, odf-kit, markdown-it and the rest.

Both entries (`index.ts` and `headless-editor-utils.ts`) reach `createHeadlessEditorRuntime`, so Rollup put everything they share into one chunk named after `use-headless-editor`. Inlining also hid two other problems:

- Some packages the source imports were never declared. `prettier` was a devDependency only, and `markdown-it` and `tippy.js` resolved only because of hoisting.
- Consumers that already depend on a package (ddocs.new has its own `katex` and `prettier`) shipped it twice.

## Fix

`vite.config.ts` builds its `external` list from `dependencies` plus `peerDependencies` in `package.json`. Every declared package is external (subpaths included) except the ones listed below. A new runtime dependency only has to be added to `package.json`.

Three groups stay bundled. Each one was found by a failing check, not by assumption:

| Bundled | Why it cannot be external |
| --- | --- |
| `@tiptap/*`, `prosemirror-*`, `@_ueberdosis/prosemirror-tables`, `y-prosemirror`, `tiptap-markdown`, `@aarkue/tiptap-math-extension` | Tiptap's own packages use caret ranges (`starter-kit@3.11.0` depends on `@tiptap/core ^3.11.0`). A consumer install floats them to the latest 3.x beside our pinned `@tiptap/core@3.11.0`: a fresh install got 3.32.0 for 37 packages, and ddocs.new already has 3.20.2. External, the editor would run on two `@tiptap/core` copies at untested versions. Bundled, it runs the exact set this repo tests. |
| `react-tweet` | Its JS imports its own `.module.css`, which Node cannot load. ddocs.new's `legacy-content-initialization.test.tsx` imports the real package under Vitest, so the dist must load in plain Node. Its styles stay in `style.css`. |
| `mammoth` | Its `browser` field swaps in a browser `unzip.js`. The Node build rejects the `{ arrayBuffer }` input we pass, so .docx import fails outside a bundler. Bundling pins the browser build. |

Two more rules:

- **JSON and CSS imports are never external.** Node ESM refuses a JSON import without `with { type: 'json' }`, and Vite 5's `vite:build-import-analysis` strips static import attributes, so the attribute cannot survive into the dist.
- **Two lazy chunks.** The emoji data (`emoji-utils.tsx`, so `emojiSearch` is now async) and mammoth (the in-editor and headless .docx import) load through dynamic `import()`. Each becomes its own chunk, fetched on the first emoji query or the first .docx import.

The invariant is that no external package may depend on a bundled engine package, or it would bring its own copy. This holds today.

## Result (5.1.13 → 5.1.14)

| | Before | After |
| --- | --- | --- |
| `use-headless-editor` chunk | 4.50 MB (gzip 1,005 KB) | 1.36 MB (gzip 355 KB) |
| `index.es.js` | 1.15 MB | 783 KB |
| Lazy chunks | – | emoji data 1.07 MB (gzip 102 KB), mammoth 527 KB |
| Tarball packed / unpacked | 1.6 MB / 6.9 MB | 856 kB / 4.2 MB |
| Scratch consumer app: total JS / largest chunk | 9.91 MB / 6.19 MB | 9.72 MB / 5.22 MB |
| `style.css` | 68.41 kB | byte-identical |

## Verifying a change to the external list

1. `npm run build`, then check that every bare import in `dist/*.mjs` and `dist/*.js` is declared in `package.json`.
2. `npm pack`, install the tarball into a scratch app with fresh `node_modules`, and run a production Vite build.
3. In that app, under Vitest with jsdom, `import()` every external specifier the dist uses. Then run a headless JSON→Yjs conversion, a Markdown import and a .docx import.
4. Compare the app's bundle size against the same app built with the previous tarball.

## Open

- `headless-editor-utils` still imports the whole shared chunk, including `@fileverse/ui` and React. A truly editor-free entry needs the sync runtime split out of `use-headless-editor.tsx`.
- The shared chunk is now mostly our own code (~720 KB) and the engine (~800 KB). The viewer split in `BUNDLE_OPTIMIZATION_NOTES.md` is the next lever.
