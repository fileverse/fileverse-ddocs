# TEC-2515 — what's left

Status note kept alongside `FLAT_SCHEMA_V2.md`. Last updated 2026-08-06.

**Where this stands:** every package-side item is done. What remains before
#552 merges is coordination, not code (section 1); everything else is the
ddocs.new integration in section 3, which is deliberately not started.

**Decision (Mohit, 2026-08-06):** no release pressure. PR #552
(`integration/tec2515-x-v2` → `main`) carries both tracks and merges as one
unit; #551 does not need to land separately. Everything below is what stands
between here and that merge, plus what follows it.

## 1. Before #552 merges

| # | Item | Owner | Notes |
|---|---|---|---|
| 1.1 | ~~Read-only preview collapse + copy-link chrome for the flat schema~~ | us | **Done** (`497c460`). Supplied as a widget decoration from the collapse plugin, sharing v1's classes and icons via `heading-chrome-icons.ts`. Same always-render + CSS `[contenteditable='false']` gate as v1, for the same staleness reason. |
| 1.2 | Bhavesh reviews the integration fixes on his code | Bhavesh | Two of them are **v1 bugs, not v2 bugs**, and matter to #551 on their own: (a) the `.drag-handle` z-index race — DOM insertion order alone decided whether the cluster or the editor surface painted on top, so the cluster was unclickable whenever the handle mounted first; (b) the collapse toggle scrolled to the caret unconditionally, so collapsing a heading part-way down a document threw the reader back to the top. |
| 1.3 | Decide #551's fate | Mohit | Merging #552 absorbs it. His commits keep their attribution, but the PR closes rather than merges — worth telling him rather than letting him find out. |
| 1.4 | Version number for the combined release | Mohit | His branch bumped to `4.4.0`. Confirm that is still the right number for both tracks together. |
| 1.5 | Re-merge + re-verify if `main` moves | us | Two known conflict points: the `editorProps.attributes` literal and `editor.css`. |

## 2. Package work — done (`497c460`)

All of the flat-schema parity gaps below are closed and verified with trusted
input in both schemas.

- ~~**URL-to-media conversion is v1-only.**~~ `getDBlockMediaCandidate` now
  understands both shapes (wrapper vs. bare paragraph, with the replaced range
  following the same split) and the plugin is registered for v2 through
  `FlatMediaConversion`.
- ~~**Template overlay never shows on a blank v2 doc.**~~ Detection no longer
  requires a `dBlock` first child or the `[data-type="d-block"]` DOM marker.
  Templates stay authored in v1 shape as the single source of truth and are
  run through `unwrapDBlocksInJSON` at insert time.
- ~~**Fonts parity nuance.**~~ The trailing paragraph is now identified by
  position (last top-level child, still empty) as well as by v1's class
  attribute, so v2's stock trailing node is skipped the same way.
- **Found while doing the above:** `getHeadingLinkSlug` resolved the heading
  through the wrapper and so returned null for every flat heading, which made
  copy-link dead in v2 even where the button rendered. Now shape-agnostic,
  matching `getDBlockRenderMeta`.

Still deferred, deliberately:

- **Dead code, once v1 retires.** `createInputRule` (zero consumers), the
  `isDBlockEmpty` checks in ai-autocomplete, `extensions/doc.ts`, and the
  `.node-dBlock` CSS. Removing these while v1 is live buys nothing and risks
  the schema we still ship.

## 2b. Parity sweep — 20 features, all matching

Run 2026-08-06. Both schemas were driven through the same scripted actions in
a real browser and their results compared. A check only counts if it produced
real evidence — four early versions "passed" against an empty document and had
to be rewritten before they meant anything.

All 20 match: export markdown, export HTML (text + tag vocabulary), title
extraction, character/word count, table of contents, comments, search and
replace, undo/redo, copy-paste round trip, list indent/outdent, markdown to
slides, read-only render, node commands (heading/list/code/quote/task), block
duplicate and delete, tables (create, add row, add column, delete), page
break, suggestion highlight marks, split-view markdown serialization, media
insert, and columns.

**One real break found and fixed** (`0128a3b`): `extractTitleFromContent`
walked two levels down, so every flat-schema document came out untitled —
it feeds export filenames from seven call sites. Covered by tests now.

Worth noting how it was found: it was invisible to a `dBlock` grep, because
the file never mentions dBlock — it just assumed the wrapper's shape. The
same is true of the `getHeadingLinkSlug` and template-overlay breaks found
earlier. Static search cleared all three; only running them exposed the bugs.

## 3. M3 — ddocs.new (not started, deliberately)

Nothing here begins until we are confident in the package. All sites are
already audited and located.

- `utils/ddoc-title-manager.ts:120-180` — `extractTitleFromContent` assumes the
  wrapper level and fails silently on v2, leaving documents titled "Untitled".
  ~5 lines. **Must fix before any v2 doc exists.**
- `utils/diff/node-diff-renderer.ts:272` — version-history diff needs a flat
  branch. Cross-schema diff is deferrable: a document never changes schema.
- `components/ddoc-editor/ddoc-editor.tsx:864` — pass `preferredSchemaVersion`
  behind a `NEXT_PUBLIC_*` flag (follow the `useTeamWorkspacesEnabled` pattern
  in `utils/feature-flags.ts`). **This is the switch that creates the first v2
  document.**
- `use-create-page.tsx` — pass `{ schemaVersion: 2 }` to the package's
  `getYjsConvertor()` when creating as v2; the package unwraps the template
  JSON and stamps the marker inside the blob (headless support landed
  package-side with the M3 prep).
- Keep the `yjs` / `y-indexeddb` / `y-protocols` overrides in lockstep with the
  package's peers.
- `tests/utils/selectors.ts:13` — E2E selectors couple to node-view DOM.

## 4. The one hard ordering constraint

The unsupported-version guard must be **live in production** before any v2
document exists anywhere. Stale browser tabs running older code have no
version concept and would write dBlock structure into a flat document through
Yjs, corrupting it with no undo.

Merging #552 satisfies this, but only once a release actually ships from it.
Confirm that has happened before flipping the ddocs.new flag in 3.

## 5. Split out as separate work

- **Tab switching pauses (~200ms).** A warm switch — both editors cached, 700
  blocks each — is one synchronous blocking task, so it is JS and layout in
  the click handler rather than progressive rendering. Profile: `setAttribute`
  30ms, ProseMirror `updateStateInner` 29ms, `compareDeep` 12ms,
  `nodesBetween` 11ms, the rest unattributed layout. Unconfirmed hypothesis:
  inactive panels are `position: absolute` and flip to `relative` on
  activation, forcing a full reflow of a large document, plus two React
  commits per switch. This is the tabs architecture rather than TEC-2515, and
  changing how inactive panels are laid out risks scroll position and
  measurement, so it is deliberately not bundled here.

## 6. Not ours / still open elsewhere

- **Keymap shrink (Phase 3)** has not happened. `dblock.ts` is still 1090
  lines; #551 touched it by 4 lines. The Enter/Backspace handlers keep their
  magic offsets and region rebuilds in v1. v2 does not need them at all, so
  this is only worth doing if v1 is going to live a long time.
- **TEC-2617** (style syncing one side only) should be split out — the
  evidence points at awareness/sync, not dBlock.
- Three vague ticket items awaiting scoping from Vijay.

## 7. Accepted, no action

- The cluster hides below 1024px, while the codebase convention elsewhere is
  1280/1000. Intentional per Bhavesh's spec; flagged only for consistency.
- `setPageBreak` immediately after `setHorizontalRule` consumes the rule. Same
  in both schemas, pre-existing command composition, unrelated to the schema.
- The node search in `block-insert.ts` uses a ±2 window and takes the first
  same-type match, which can find a preceding sibling of the same type in an
  edge case. Caret placement only.
