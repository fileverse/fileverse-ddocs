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
npm test                      # vitest run (jsdom); 84 files / ~736 tests in ~20s
npx vitest run package/extensions/paragraph-spacing.test.ts   # one file
npx vitest run -t "treats 0 as an explicit value"             # one test by name
npx vitest package/extensions/docx                            # watch a directory
```

Demo app: `cd demo && npm i` once, then from the repo root `npx vite demo` (port 5173). The demo resolves shared deps by walking up to the root `node_modules`. Live collaboration in the demo needs `VITE_COLLAB_WS_URL` (plus owner secret/contract vars, see `demo/src/App.tsx`) in a `.env`. If a rebuilt npm-linked `@fileverse/ui` is not picked up, delete `demo/node_modules/.vite` and restart with `--force`.

Release: `.github/workflows/release.yml` builds, tags `v<version>` and publishes to npm on every push to `main`; an unchanged version is a no-op. Version bumps are their own commit (`chore: package bump vX.Y.Z`). CI never publishes from a branch. To try branch work in ddocs.new before merging, bump `package.json` to a prerelease (`4.8.0-restore-position.0` style), commit it, run `npm run build && npm publish --tag <name>` (always pass `--tag`, otherwise the prerelease becomes `latest`), then bump the pin in ddocs.new.

## Architecture

### Entry points and hook composition

- `index.ts` exports `DdocEditor` (full editor), `PreviewDdocEditor` (read-only viewer), `useHeadlessEditor` / `getHeadlessExtensions` (no-DOM conversions), `DdocExportModal`, `useEditorCommands`, and the collab types and room-key crypto helpers.
- `headless-editor-utils.ts` is a separate entry (`@fileverse-dev/ddoc/headless-editor-utils`) exposing only the Yjs convertor / merge runtime, for consumers that must not load the editor.
- `package/ddoc-editor.tsx` is the large top-level component. Its state comes from `package/use-ddoc-editor.tsx`, a thin composition of:
  - `hooks/use-yjs-setup.ts`: owns the single `Y.Doc`, `y-indexeddb` persistence, the `SyncManager`, and the debounced `onChange` (which emits `Y.encodeStateAsUpdate` as base64).
  - `hooks/use-tab-manager.ts`: tab CRUD over the `ddocTabs` Y.Map. One `Y.XmlFragment` per tab, tab id == fragment name, `'default'` is the first/legacy tab. See `docs/TABS_SPEC.md`.
  - `hooks/use-doc-schema-version.ts`: resolves v1/v2 and stamps new docs. Must stay after `useTabManager` in hook order because it reads the marker that `useTabManager` decoded synchronously during render.
  - `hooks/use-tab-editor.tsx`: builds one Tiptap `Editor` per tab via `buildExtensionsForTab`, keeps the 4 most recent warm (`use-tab-editor-cache.ts`), and handles hydration, ToC, page count and print.

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

### Styling and bundling

- Tailwind plus the `@fileverse/ui` design system. `package/styles/index.css` imports the ui styles, KaTeX and highlight.js; `editor.css` holds editor-specific rules. The `mobile` breakpoint is 960px. Consumers must add `dist/index.es.js` to their Tailwind `content`.
- Use `@fileverse/ui` primitives and its `LucideIcon` / `IconButton` for icons; do not hand-roll SVGs.
- `vite.config.ts` externalizes react, `@fileverse/ui`, framer-motion, frimousse, mermaid, yjs, `@fileverse/crypto`, `@dnd-kit/*` and viem. A new peer dependency must be added to both `peerDependencies` and that `external` list. `yjs` must remain a single instance (`resolve.dedupe`).

## Testing conventions

- Vitest + jsdom + Testing Library with globals on. Tests sit next to the code as `*.test.ts(x)` under `package/` and `demo/src/`.
- `utils/make-editor.ts` builds a jsdom editor with the real headless extension set. Collaboration owns the doc, so set content with `editor.commands.setContent(...)` after construction; the `content` constructor option is silently ignored. Destroy editors in `afterEach`.
- For extension-only tests, build a minimal `Editor` with `StarterKit` plus the extension under test (see `extensions/paragraph-spacing.test.ts`). Behaviour that differs by schema gets a v1 and a v2 case (see `extensions/undo-selection.test.ts`).
- Browser QA is manual in the demo. `scripts/parity-sweep.cjs` and `scripts/chrome-parity-probe.cjs` drive a real Chrome against the demo on port 5173 to compare v1 and v2.

## Conventions

- Branch names and PR titles are Linear ticket ids (`TEC-1234`).
- Prettier through eslint: single quotes, trailing commas, semicolons, 2-space indent.
- `docs/` holds the design specs and status notes (`FLAT_SCHEMA_V2.md`, `TABS_SPEC.md`, `PARAGRAPH_SPACING.md`, `FONTS.md`, `DDOCS_NEW_INTEGRATION.md`, `TAB_SCROLL_POSITION.md`). Read the relevant one before changing that area. `docs/superpowers/` holds dated specs and plans from past tickets.

## Consumer repo: ddocs.new

- Sibling checkout at `../ddocs.new` (Next.js, Turbopack). It has its own `CLAUDE.md` and `docs/SYSTEM.md`; read them when a change spans both repos. `docs/DDOCS_NEW_INTEGRATION.md` here is the flat-schema handoff written for that side.
- It installs the published package pinned to an exact version; there is no `npm link` workflow. `yjs` is pinned to one copy through its `overrides`, which is why `yjs` must stay external in this package's build.
- Its integration surface: `DdocEditor` (mounted in `components/ddoc-editor/ddoc-editor.tsx`), `PreviewDdocEditor` (viewer and version history), `useHeadlessEditor` (nine call sites: templates, imports, duplication, bulk upload), `useExportHeadlessEditorContent` with `DdocExportModal`, `handleContentPrint`, `mergeTabAwareYjsUpdates`, `buildVersionDiffSnapshot`, `useEditorCommands`, and the `@fileverse-dev/ddoc/types` entry. Styles come from `@fileverse-dev/ddoc/styles`, and `dist/index.es.js` is in its Tailwind `content`. Changing the name or shape of any of these breaks the app.
- `preferredSchemaVersion` there is driven by `flatSchemaEnabled` in `utils/feature-flags.ts` (`NEXT_PUBLIC_FLAT_SCHEMA`, inlined at build time).
