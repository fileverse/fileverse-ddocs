# AGENTS.md

Guidance for coding agents (OpenAI Codex, Claude Code and others) working in this repository. This is the single source of truth: `CLAUDE.md` only imports this file, so edit `AGENTS.md`, never the shim.

## What this repo is

`@fileverse-dev/ddoc`: the Tiptap/ProseMirror editor, backed by Yjs, that powers ddocs.new. It is published to npm as an ES library. `package/` is the source; `index.ts` and `headless-editor-utils.ts` are the two bundle entries. `demo/` is a Vite app that imports the package source directly (`../../package/...`) and is the manual QA surface. The consuming app is the sibling repo `../ddocs.new` (see the section at the end).

## Commands

```bash
npm i                         # root deps (CI uses Node 22)
npm run build                 # tsc type-check + vite lib build -> dist/
npx tsc                       # type-check only (noEmit; covers package + entries, not tests or demo)
npm run lint                  # eslint --fix, zero warnings allowed; prettier runs through eslint
npm test                      # vitest run (jsdom); 121 files / ~1540 tests in ~24s
npx vitest run package/extensions/paragraph-spacing.test.ts   # one file
npx vitest run -t "treats 0 as an explicit value"             # one test by name
npx vitest package/extensions/docx                            # watch a directory
```

Demo app: `cd demo && npm i` once, then `cd demo && npx vite` (port 5173). Start it inside `demo/`: it is a real consumer with its own `demo/tailwind.config.js` (ddoc preset, scans the package source) and declares `@fileverse/ui` and `katex` itself; other shared deps resolve by walking up to the root `node_modules`. Live collaboration in the demo needs `VITE_COLLAB_WS_URL` (plus owner secret/contract vars, see `demo/src/App.tsx`) in a `.env`. If a rebuilt npm-linked `@fileverse/ui` is not picked up, delete `demo/node_modules/.vite` and restart with `--force`.

Release: `.github/workflows/release.yml` builds, tags `v<version>` and publishes to npm on every push to `main`; an unchanged version is a no-op. Version bumps are their own commit (`chore: package bump vX.Y.Z`). CI never publishes from a branch. To try branch work in ddocs.new before merging, bump `package.json` to a prerelease (`4.8.0-restore-position.0` style), commit it, run `npm run build && npm publish --tag <name>` (always pass `--tag`, otherwise the prerelease becomes `latest`), then bump the pin in ddocs.new.

## Architecture

### Entry points and hook composition

- `index.ts` exports `DdocEditor` (full editor), `PreviewDdocEditor` (read-only viewer), `useHeadlessEditor` / `getHeadlessExtensions` (no-DOM conversions), `DdocExportModal`, `useEditorCommands`, and the collab types and room-key crypto helpers.
- `headless-editor-utils.ts` is a separate entry (`@fileverse-dev/ddoc/headless-editor-utils`) exposing only the Yjs convertor / merge runtime, for consumers that must not load the editor.
- `package/ddoc-editor.tsx` is the large top-level component. Its state comes from `package/use-ddoc-editor.tsx`, a thin composition of:
  - `hooks/use-yjs-setup.ts`: owns the single `Y.Doc`, `y-indexeddb` persistence, the `SyncManager`, and the debounced `onChange` (which emits `Y.encodeStateAsUpdate` as base64).
  - `hooks/use-tab-manager.ts`: tab and subtab state for the UI. The writes live in `components/tabs/utils/tab-operations.ts` (one transaction each) and the tree in `getTabListFromNodes` (`tab-utils.ts`), over flat `tabs_*` roots plus `tabs_parent_registry`. One `Y.XmlFragment` per tab, tab id == fragment name, `'default'` is the first tab. A doc without subtabs must keep the 7.0 writes byte for byte (`utils/__tests__/existing-docs.test.ts`). See `docs/TABS_SPEC.md` §1.
  - `hooks/use-doc-schema-version.ts`: resolves v1/v2 and stamps new docs. Must stay after `useTabManager` in hook order because it reads the marker that `useTabManager` decoded synchronously during render.
  - `hooks/use-tab-editor.tsx`: builds one Tiptap `Editor` per tab via `buildExtensionsForTab`, keeps the 4 most recent warm (`use-tab-editor-cache.ts`), and handles hydration, ToC, page count and print.

### Layout contract

- `DdocEditor` is `h-full w-full` of its parent and never reads the viewport. The root (`.ddoc-editor-root`) is a flex column: navbar row (`components/editor-navbar.tsx`, the `renderNavbar` output as given, in flow inside the unstyled `.ddoc-navbar-row` that animates its collapse, or portalled into `navbarContainer` with no element; no `renderNavbar` means no navbar element, and its height comes from its content), toolbar row, `#editor-canvas`, tab-panel slot (a fixed 50px `shrink-0` row below 1280px that `DocumentMobileTabPanel` portals into, so the canvas ends above the panel and native drag autoscroll keeps its belt; the host footer sits outside the root and carries the safe-area inset).
- `#editor-canvas` is the one document scroller and carries `data-editor-scroll-container`, so the scrollbar sits at the editor's outer edge. `getEditorScrollContainer` returns the attributed element without checking that it scrolls, so the attribute must be on the element whose `scrollTop` changes. Do not move scrolling to an inner wrapper, and do not put `overflow` on anything between the sticky left rail and the canvas. Split View is the exception: the canvas is `overflow-hidden`, the right pane scrolls, and the attribute stays on the inner wrapper. `editorScrollContainerRef` is `isSplitViewActive ? contentWrapperRef : canvasRef`, so an effect keyed on the ref object re-binds when Split View toggles. The canvas's flex basis is `0px`, not `flex-1`'s `0%`: with a percentage basis in a parent without a definite height it grows on every metrics cycle.
- Editor chrome uses no `vh` / `dvh` / `vw` and no `position: fixed` (`layout-contract.test.ts` checks `ddoc-editor.tsx`). Sizes come from `--ddoc-canvas-w` / `--ddoc-canvas-h`, published by `hooks/use-canvas-metrics.ts`. Its `ResizeObserver` writes those custom properties straight onto the root; React state holds only the rail decisions (`shouldHideRight`, `shouldScroll`), and the first measurement (and the width store) is filled in a layout effect so the first paint is right. Presentation mode, the mobile comment sheet, popovers and dialogs stay viewport-level. Presentation mode's overlay (`.ddoc-presentation-overlay`) is its own `ddoc-editor` container, so its content follows the window, and it gets a null `EditorWidthContext`.
- The comment drawer hangs from `.ddoc-drawer-anchor`, a zero-height, full-width sticky line that must stay the canvas's direct child. It also holds `SearchReplace`, whose popover anchor must stay at the visible canvas's top-right, and gets `ddoc-drawer-anchor--presenting` in presentation mode so the drawer paints above the overlay. Full width because a sticky inset only offsets, it does not align to an edge; zero height and `pointer-events: none` (children reset to `auto`) so it takes no space or clicks. `DynamicDrawerV2` is always mounted and `fixed` internally: it is forced `!absolute`, and `overflow-x: clip` on `.ddoc-drawer-clip` (a positioned zero-height wrapper inside the anchor) keeps the closed drawer (at `right: 0`, translated out) from widening the canvas's scroll area. Never put the clip on the sticky anchor itself: iPad Safari then hides the open drawer entirely. Below 1280px the drawer is portalled into `.ddoc-mobile-comment-slot`, a root-level row after the tab-panel slot: iOS Safari clips the painting of a `fixed` element to a scrolling ancestor (layout and hit-testing stay correct), so the full-screen mobile sheet must not live inside the canvas.
- `DocumentOutline`, `DocumentTabsSidebar` and `DocumentMobileTabPanel` take an internal `layout` prop. `PreviewDdocEditor` and version history use the default `'viewport'`; only `DdocEditor` passes `'contained'`.
- Breakpoints inside the root follow the root's width: use the `ddoc-*:` Tailwind variants and `useEditorMediaQuery` / `useResponsive`. The preset (`tailwind.preset.cjs`, tested in `tailwind-preset.test.ts`) defines `ddoc-sm/md/mobile/lg/xl`, `ddoc-max-*` and the arbitrary `ddoc-min-[Npx]:` / `ddoc-max-[Npx]:`. Each emits a container-query form, active only when the root has `ddoc-editor-cq` (decided by `utils/container-query-support.ts`), plus a window `@media` fallback for elements outside a `.ddoc-editor-cq` root. So in `PreviewDdocEditor`, in browsers that fail the safety check and in elements portalled to `<body>` they behave like the screen variants. Screen variants (`md:`) and `useMediaQuery` are only for viewport-level overlays. On the same element and property a screen variant always overrides a `ddoc-*` variant, so never mix the two for one property. `DdocEditor` itself sits above the provider and passes `editorWidthStore` to those hooks directly. A direct `window.matchMedia` / `window.innerWidth` inside the root is a window check too; non-React code reads the width of `closest('.ddoc-editor-cq')` (`zoom-service.ts`). The safety check exists because early container-query engines trap `position: fixed` descendants (presentation, fullscreen toolbar, mobile sheets) inside the container; the fallback therefore keys off `ddoc-editor-cq`, never set `container-type` on `.ddoc-editor-root` directly, and never let the root shrink to fit its content.
- UI state (`zoomLevel`, `isNavbarVisible`, `showTOC`, `commentDrawerOpen`, `isPresentationMode`, `isSplitView`, `isFocusMode`) goes through `hooks/use-controllable-state.ts`. Add any new UI-state prop the same way: value, `onXChange`, internal default. Never give such a prop a default in the destructuring. Notifications run in `set`, never inside a React updater (Strict Mode runs those twice). A value with no callback is fixed: `zoomLevel="1"` alone makes zoom inert.
- A portalled navbar (`navbarContainer`) is hidden only in presentation mode; focus mode and `isNavbarVisible` leave the host's element alone. Its events bubble by React ancestry to the root.
- Known limits: one editor per page (global ids and `document.querySelector` fallbacks), `@fileverse/ui` components and `LinkPreviewCard` follow the window, the mobile comment sheet covers the viewport, Split View scroll restore is degraded (`docs/TAB_SCROLL_POSITION.md`).

### Yjs is the source of truth

- Content lives in the Y.Doc through `@tiptap/extension-collaboration`. `initialContent` is a base64 Yjs update, not Tiptap JSON; consumers persist the opaque blob.
- Writes that are not user edits (tab switch, schema stamp, tab seeding) use `ydoc.transact(fn, 'self')`. `'self'`-origin updates never reach `onChange`.
- Comment anchors are Yjs `RelativePosition`s painted as ProseMirror decorations (`extensions/comment/comment-decoration-plugin.ts`), not marks. Comment and suggestion state is a zustand store (`stores/comment-store.ts`, mounted by `CommentStoreProvider`). Suggestion mode never mutates the doc except on owner Accept (`extensions/suggestion/suggestion-tracking-extension.ts`).
- Collaboration transport is `package/sync-local/`: `SyncManager` drives the state machine in `collabStateMachine.ts` (`idle -> connecting -> syncing -> ready`, plus reconnecting / rotating / terminated), `socketClient.ts` is the wire, `crypto/room-key.ts` encrypts updates, `floor.ts` decides snapshots. Keys, UCANs and rotation callbacks arrive through `CollabConnectionConfig` and are opaque to the package.

### Two document schemas: v1 dBlock and v2 flat

Read `docs/FLAT_SCHEMA_V2.md` before touching block structure, keymaps, or anything that inserts nodes.

- v1 wraps every top-level block in a `dBlock` node (`extensions/d-block/`; the node view renders the block chrome). v2 is flat like stock Tiptap and gives blocks a persistent `BlockId`.
- The schema is stamped once per document in `ydoc.getMap('ddocMeta').get('schemaVersion')` (`utils/schema-version.ts`). No marker means v1. An existing doc never changes schema; `preferredSchemaVersion` (default 1) only affects a brand-new empty doc. A marker above `SUPPORTED_SCHEMA_VERSION` shows a "refresh to update" banner and creates no editor.
- `defaultExtensions({ schemaVersion })` in `extensions/default-extension.ts` is the fork. Four call paths must pass the version: `default-extension.ts` itself, `buildExtensionsForTab` and the AI re-fork in `use-tab-editor.tsx`, and `getHeadlessExtensions` in `use-headless-editor.tsx`. Anything registered inside `createDBlockExtension` needs a `Flat*` counterpart in the v2 branch.
- Write schema-agnostic code with `utils/block-schema.ts` (`schemaHasDBlock`, `wrapBlockNode`, `unwrapDBlocksInJSON`). Templates and other v1-shaped JSON stay in v1 shape as the source of truth and are unwrapped at insert time; never hand-rewrite them into flat JSON.
- Position arithmetic (`focus(pos + n)`, `insertContentAt(pos + n)`) must be computed and consumed in the same transaction or mapped through `tr.mapping`; wrapper offsets differ between schemas. `docs/POSITION_AUDIT.md` has the rule and the audited sites.

### Extensions and import/export

- `extensions/` holds custom Tiptap nodes, marks and plugins; `default-extension.ts` is the registry and its order affects keymap priority.
- Markdown import/export lives in `extensions/mardown-paste-handler/` (the misspelling is the real path; do not rename it), built on markdown-it and turndown. Docx import is `extensions/docx/` (mammoth); HTML, ODT and text export are extensions too. Headless conversions go through `getHeadlessExtensions` so they share the exact editor schema.
- Fonts: the package ships only system fonts. Consumers pass a `fonts` catalog that `utils/font-loader.ts` loads on demand (`docs/FONTS.md`).
- Lists: `extensions/list-toggle/` overrides `toggleList` for every trigger (and Backspace at the start of an item; Enter out of a nested list lifts the item, keeping its spacing) and both schemas with structural steps only (`docs/LIST_TOGGLE.md`). Markers take the item's font size and family through a display-only decoration when its first paragraph agrees (§3.9, print too). Never `replaceWith` a list: the comment store marks every comment inside it deleted. Comment anchors are Yjs relative positions and still die on any node type change until TEC-3181 lands; verify anchor survival with `resolveCommentAnchorRangeInState`, not the plugin's mapped decorations. Before a Tiptap upgrade, read §7 of that doc: what the engine relies on and which test catches each.

### Styling and bundling

- The package ships only the CSS it owns (`package/styles/index.css`, `editor.css`, a few component sheets; build is autoprefixer only, no `@tailwind` directives, no ui/KaTeX imports). `package/styles/css-ownership.test.ts` fails when a rule is not anchored to an editor-owned selector; run it before touching CSS. Class names in TSX rely on the consumer's Tailwind build: `tailwind.preset.cjs` (exported as `./tailwind`) composes the `@fileverse/ui` preset and adds the `mobile` breakpoint (960px).
- Consumers run one Tailwind build with `presets: [require('@fileverse-dev/ddoc/tailwind')]`, scan `node_modules/@fileverse-dev/ddoc/dist/**/*.{js,mjs}` (the dist is chunked; a single `index.es.js` entry misses classes) and `@fileverse/ui/dist/**/*.{js,mjs}`, and import stylesheets in this order: their Tailwind output, `@fileverse/ui/styles/base`, `katex/dist/katex.min.css`, `@fileverse-dev/ddoc/styles`. See the README's 5.0 setup and migration notes.
- Use `@fileverse/ui` primitives and its `LucideIcon` / `IconButton` for icons; do not hand-roll SVGs.
- `vite.config.ts` derives `external` from `dependencies` + `peerDependencies`, except the Tiptap/ProseMirror engine, `react-tweet`, `mammoth`, `tippy.js` and `@tippyjs/react`, which stay bundled; JSON and CSS imports are always bundled. Every runtime import must be declared in `package.json`. Read `docs/DIST_BUNDLING.md` before changing that list. `yjs` must remain a single instance (`resolve.dedupe`).

## Testing conventions

- Vitest + jsdom + Testing Library with globals on. Tests sit next to the code as `*.test.ts(x)` under `package/` and `demo/src/`.
- `utils/make-editor.ts` builds a jsdom editor with the real headless extension set. Collaboration owns the doc, so set content with `editor.commands.setContent(...)` after construction; the `content` constructor option is silently ignored. Destroy editors in `afterEach`.
- For extension-only tests, build a minimal `Editor` with `StarterKit` plus the extension under test (see `extensions/paragraph-spacing.test.ts`). Behaviour that differs by schema gets a v1 and a v2 case (see `extensions/undo-selection.test.ts`).
- Browser QA is manual in the demo. `scripts/parity-sweep.cjs` and `scripts/chrome-parity-probe.cjs` drive a real Chrome against the demo on port 5173 to compare v1 and v2.

## Conventions

- Branch names and PR titles are Linear ticket ids (`TEC-1234`).
- Prettier through eslint: single quotes, trailing commas, semicolons, 2-space indent.
- `docs/` holds the design specs and status notes (`FLAT_SCHEMA_V2.md`, `TABS_SPEC.md`, `PARAGRAPH_SPACING.md`, `FONTS.md`, `DDOCS_NEW_INTEGRATION.md`, `TAB_SCROLL_POSITION.md`, `FORMATTING_INHERITANCE.md`, `LIST_TOGGLE.md`, `DIST_BUNDLING.md`). Read the relevant one before changing that area.

## Consumer repo: ddocs.new

- Sibling checkout at `../ddocs.new` (Next.js, Turbopack). It has its own `CLAUDE.md` and `docs/SYSTEM.md`; read them when a change spans both repos. `docs/DDOCS_NEW_INTEGRATION.md` here is the flat-schema handoff written for that side.
- It installs the published package pinned to an exact version; there is no `npm link` workflow. `yjs` is pinned to one copy through its `overrides`, which is why `yjs` must stay external in this package's build.
- Its integration surface: `DdocEditor` (mounted in `components/ddoc-editor/ddoc-editor.tsx`), `PreviewDdocEditor` (viewer and version history), `useHeadlessEditor` (nine call sites: templates, imports, duplication, bulk upload), `useExportHeadlessEditorContent` with `DdocExportModal`, `handleContentPrint`, `mergeTabAwareYjsUpdates`, `buildVersionDiffSnapshot`, `useEditorCommands`, and the `@fileverse-dev/ddoc/types` entry. Styles come from `@fileverse-dev/ddoc/styles` (imported by its `app/ddoc-editor-styles.css` after `katex/dist/katex.min.css`, with `@fileverse/ui/styles/base` in the root layout), and its `tailwind.config.ts` uses `./tailwind` and scans `dist/**/*.{js,mjs}`. Changing the name or shape of any of these breaks the app.
- `preferredSchemaVersion` there is driven by `flatSchemaEnabled` in `utils/feature-flags.ts` (`NEXT_PUBLIC_FLAT_SCHEMA`, inlined at build time).
- It mounts `DdocEditor` in a `h-dvh flex flex-col` column with the editor in a `flex-1 min-h-0` child and the footer as an in-flow row after it; its CSS overrides for the toolbars are scoped to `.ddoc-editor-root`.
