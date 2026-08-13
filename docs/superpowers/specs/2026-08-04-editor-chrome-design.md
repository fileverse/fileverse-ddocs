# Editor Chrome Redesign — container padding + floating block controls

**Ticket:** TEC-2515 (dblock overhaul, phase 1 "chrome first")
**Date:** 2026-08-04
**Scope decision:** Chrome only. Position-mapping fixes and list-keymap work are separate follow-up PRs. Flat schema (v2) comes later, per Mohit's sequencing comment on the ticket.

## Problem

Every dBlock renders as a flex row that carries its own horizontal padding and a
non-editable gutter `<section>` (plus/grip/collapse buttons) *inside* the
contenteditable, while `.ProseMirror` has zero horizontal padding. Template
buttons are portaled into the editable DOM. Consequences (root-cause analysis on
TEC-2515): caret renders at the far-left flex edge for any non-text selection
state (divider/image tickets), template buttons can receive the caret,
hand-tuned per-breakpoint asymmetric insets, and translateY/items-center CSS
hacks that desync caret/click/handle geometry.

Reference architecture (verified live on template.tiptap.dev): flat blocks,
padding on the `.ProseMirror` container, one absolutely-positioned drag handle
outside the editable DOM.

## Design

### A. Layout core

- `.ProseMirror` owns the page inset, applied in `editor.css`:
  - md+ (desktop/tablet): `padding: 72px 80px 20vh`
  - below md (mobile): `padding: 24px 16px 20vh 36px` — left is 36px to leave
    room for the collapse chevron, which remains visible on mobile
  - Note the breakpoints are intentionally different axes: *padding* switches
    at `md`, while *plus/grip visibility* gates at `lg` (mirrors current
    behavior). Tablets (md–lg) get desktop padding with chevron-only chrome.
  - Existing bottom-spacer workarounds in scroll containers are audited during
    implementation and removed where the 20vh bottom padding makes them
    redundant.
- `DBlockNodeView` shrinks to a plain wrapper: `div[data-type=d-block]` →
  `contentDOM`. Deleted: gutter section, content shell, flex row,
  `items-center`, `justify-center`, all per-block `px-*`/`pl-*`/`pr-*` classes,
  `stopEvent` gutter logic, view registry registration.
- Kept on the wrapper (still semantic): `d-block-hidden` (collapse
  decorations), `invalid-content` (isCorrupted), `is-table` width cap,
  presentation/preview-mode classes.
- CSS compensation hacks removed with the flex row: `h1/h2/h3 { transform:
  translateY(...) }`; heading alignment in preview mode re-expressed without
  flex-reversal (`flex-row-reverse` + inverted `justify-*` mapping goes away).
- Presentation mode: per-block `px-4 md:px-[80px]` moves to the presentation
  container.
- Result: doc JSON byte-identical; only rendered DOM/CSS changes. Caret
  geometry becomes standard — gap cursors and node boundaries render inside the
  text column.

### B. Floating chrome

- New deps: `@tiptap/extension-drag-handle-react` + `@tiptap/extension-node-range`
  (official, open source in Tiptap 3; same stack as the Notion-like template).
- `<DragHandle editor={editor}>` renders as a **sibling of `EditorContent`**,
  positioned by floating-ui in the left margin of the hovered block.
  `onNodeChange({ node, pos })` replaces the view-registry hover machinery.
- Button cluster inside the handle (existing components re-homed):
  - **Plus** — insert block below (Alt: above); same `insertContentAt` logic.
  - **Grip** — opens existing `DBlockMenu` backed by `use-content-item-actions`,
    anchored to the floating cluster; Alt-click = delete.
  - **Collapse** / **Copy-link** — for heading blocks, driven by
    `getDBlockRenderMeta(node, pos)`.
- Visibility rules (carried over from current behavior):
  - below `lg`: plus/grip hidden; **collapse chevron still shows** (as today —
    `shouldShowCollapse` is not screen-gated); preview mode shows copy-link on
    headings.
  - presentation-preview: no chrome.
- `DBlockToolbarProvider` slims to rendering the `DragHandle` + menu; registry,
  pointerover/focusin listeners, and refresh-key state are deleted.
- Template overlay: same trigger logic (single empty dBlock, selection inside),
  but portaled to an absolutely-positioned overlay **sibling of
  `EditorContent`**, placed via the first block's `getBoundingClientRect`,
  recomputed on transaction + resize. Buttons can no longer receive the caret.
- Drag mechanics come from the extension (node-range slice → `view.dragging`);
  dBlock keeps `draggable: true`; `data-drag-handle` GripButton wiring removed.
- **Flagged risk:** dBlock is `selectable: false`; if the drag-handle
  extension's node-range selection misbehaves with it, fallback is a thin
  custom `dragstart` on the grip that sets `view.dragging = { slice, move:
  true }` for the dBlock at `pos` (~20 lines, no design change).

### C. Deletions, edge surfaces, verification

**Deleted:** `dblock-view-registry.ts`; gutter/shell/`stopEvent` code in
`dblock-node-view.ts` (~229 → ~60 lines); hover/refresh machinery in
`dblock-toolbar.tsx`; translateY hacks; per-block padding classes.

**Kept/reused:** buttons, tooltips, `DBlockMenu`, `use-content-item-actions`,
`getDBlockRenderMeta`, collapse plugin.

**Untouched (follow-ups):** Enter/Backspace keymaps, media-conversion plugin,
upload flow, action buttons, schema, exports, comments.

**Edge surfaces to verify:**
- Columns (`column.content: 'dBlock+'`): nested blocks currently get their own
  gutter; DragHandle positioning inside columns is the likeliest tuning spot.
- Presentation/preview modes (padding + reduced cluster).
- Mobile: chevron-only chrome in the 36px left margin; right inset 16px.
- `is-table` width cap on the simplified wrapper.

**Verification:**
- Existing vitest suites are command/selection-level and should pass; any test
  asserting gutter DOM is updated alongside the change it documents.
- Manual QA keyed to tickets: divider caret, image-upload caret, template
  buttons, drag (top-level / columns / tables), collapse, copy-link, split
  view, focus mode, mobile layout.
- Live check in demo app (clear `demo/node_modules/.vite` first — known linked
  UI cache issue).

**Rollout:** default behavior (no flag), minor version bump, changelog note to
the app team flagging visible changes: mobile inset change and handle position.

## Dependency safety (Shai-Hulud npm worm, active as of 2026-08-04)

Context: self-replicating npm supply-chain attack starting 2026-08-04 (keyv /
flat-cache / file-entry-cache / cacheable* families + 434 and growing
worm-spread packages; payload runs via `preinstall`, published with valid
provenance). Repo audited 2026-08-04: lockfile pins pre-attack majors
(`keyv@4.5.4`, `flat-cache@3.2.0`, `file-entry-cache@6.0.1`), no IoC files, no
`.vscode/tasks.json` / repo `.claude/settings.json` infection.

Protocol for the new installs in this branch:

1. **Verify publish dates first**: `npm view <pkg> time --json` — only accept
   versions of `@tiptap/extension-drag-handle-react`,
   `@tiptap/extension-drag-handle`, `@tiptap/extension-node-range` (and any new
   transitive deps) published **before 2026-08-04**.
2. **Exact-pin** the three packages in `package.json` (no `^`/`~`).
3. **Install with `--ignore-scripts`** (targeted flag for this install, not a
   blanket `.npmrc` setting — esbuild/swc binaries need their scripts on fresh
   installs). None of the Tiptap packages require install scripts.
4. **Lockfile diff review** after install: every added entry checked against
   the compromised list, publish date, and for unexpected
   `preinstall`/`postinstall` scripts.
5. **npm `overrides`** pinning `keyv`, `flat-cache`, `file-entry-cache`, and
   `cacheable-request` to their current lockfile majors, so no future range
   resolution can pull the poisoned versions.
6. **No `npm update` / floating installs** while the attack is active; CI and
   teammates use `npm ci` only.
