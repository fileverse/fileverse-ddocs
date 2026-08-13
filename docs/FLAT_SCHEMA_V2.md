# Flat Schema v2 Spec

Owner: Mohit (v2 track), Bhavesh (chrome + point fixes track).
Parent ticket: [TEC-2515](https://linear.app/fileverse/issue/TEC-2515/editor-improvement-dblock-issues).
Last updated: 2026-08-06.

**Status: M0-M2 built and verified; M3 not started.** Both tracks are combined
in PR #552 (`integration/tec2515-x-v2`), which also carries Bhavesh's chrome
work. Package-side parity is confirmed by a 20-feature v1-vs-v2 sweep
(`scripts/parity-sweep.cjs`, all matching). What is left, and what is
deliberately deferred, is tracked in `TEC2515_REMAINING.md` — read that for
current state; this document describes the design.

Sections below are marked where the built code diverged from the original
plan. The plan is kept rather than rewritten, because the reasoning still
explains why things are shaped the way they are.

## Why

Today every top-level block is wrapped in a `dBlock` node whose node view puts chrome (gutter, buttons, per-block padding) inside the editable document. Root-cause analysis on TEC-2515 traced most open editor bugs to this wrapper: caret rendering at the row edge, cursor jumps from unmapped positions, and 764 lines of custom Enter/Backspace handling in `dblock.ts` that breaks lists and destroys collaborators' cursor positions under Yjs.

v2 removes the wrapper for new documents. The document becomes flat, like Tiptap's Notion template:

```
v1 (today)                          v2 (flat)
doc                                 doc
├─ dBlock ─ paragraph               ├─ paragraph
├─ dBlock ─ heading                 ├─ heading
└─ dBlock ─ bulletList              └─ bulletList
```

Old documents are not migrated. They keep the v1 schema and today's code path indefinitely. Migration is explicitly out of scope for this spec.

## Settled decisions

| Decision | Outcome |
|---|---|
| Old docs | Stay v1 forever (until a future, separate migration project) |
| New docs after flip | All v2, including template-created docs. No opt-in stage |
| Who writes the schema marker | The package, on the first render of a new doc (`useDocSchemaVersion`) |
| Where the marker lives | `schemaVersion` in the `ddocMeta` Y.Map of the doc itself, following the existing tab-metadata pattern. No marker = v1 |
| Safety check | Ships with the combined PR, and must be live in a real release before the ddocs.new flag is ever flipped (see Ordering constraints) |
| Block IDs | v2 blocks carry a persistent unique ID attribute from day one (cheap at birth, avoids a future migration) |
| Templates | Move to v2 via a runtime unwrap util. The v1-shaped template JSONs in both repos stay untouched as source of truth |
| ddocs.new flag | `NEXT_PUBLIC_*` env var following the existing `utils/feature-flags.ts` pattern |

## Architecture

### The marker

Each doc carries `schemaVersion` in a Yjs map (same pattern as `ddocTabs` / `tabs_state`). Absence of the marker means v1, so every existing doc is v1 by definition without being touched.

The marker is written in exactly one place: `useDocSchemaVersion`
(`package/hooks/use-doc-schema-version.ts`), in the `useMemo` that calls
`ydoc.transact(...)` with the `'self'` origin.

> Earlier drafts of this doc placed the write in `applyResolvedTabState`
> (tab seeding). It moved during implementation: the version has to be
> readable on the *first* render, because it decides which extension set the
> editor is built with. `useTabManager` decodes `initialContent` into the ydoc
> synchronously during render, and `useDocSchemaVersion` is called immediately
> after it (`use-ddoc-editor.tsx`) so the marker is already readable when the
> extensions are assembled. Hence the hook-order comment at the top of that
> file — it must stay after `useTabManager`.

All four conditions must hold before anything is written:

- the doc has no marker yet,
- content is resolved (IndexedDB can no longer replay a marker),
- the doc is genuinely new (`isNewDdoc`: owner, no collab, no initial content),
- and `preferredSchemaVersion >= 2`.

That last one is why a v1 doc never gets a marker at all: **with today's
default of 1, the write never executes.** A breakpoint there stays silent
until a consumer explicitly asks for v2. Absence of the marker *is* the v1
signal — see `getDocSchemaVersion` in `package/utils/schema-version.ts`, which
treats anything non-numeric as 1.

### Mode selection on open

```
open doc
  ├─ marker absent or 1   → v1 extension set (today's editor, unchanged)
  ├─ marker 2             → v2 extension set (flat)
  └─ marker > supported   → read-only + "refresh to update" banner (safety check)
```

The version is read before extensions are built. Extensions are assembled per tab (`buildExtensionsForTab`), and all tabs share the doc's version.

### The extension fork

`defaultExtensions()` in `package/extensions/default-extension.ts` gains a schema-version parameter. Four call paths must respect it; missing any one silently breaks v2 docs in that path:

1. Main assembly: `default-extension.ts` (`createDBlockExtension`, `Document`, `TrailingNode` are the v1-only entries)
2. Per-tab: `buildExtensionsForTab` in `package/hooks/use-tab-editor.tsx`
3. Headless (exports, import, print): `getHeadlessExtensions` in `package/hooks/use-headless-editor.tsx`
4. The AI path re-fork in `use-tab-editor.tsx` (filters out `dBlock` and re-adds it; must be version-aware)

As built, the v2 branch also registers what the dBlock extension used to
supply on its own: `FlatDocument`, `FlatHeadingCollapse` (the collapse plugin
plus the read-only preview heading chrome), `FlatMediaConversion` (URL to
media), `BlockId`, and `AiWriterSpaceTrigger`. Anything registered *inside*
`createDBlockExtension` needs an equivalent here — that is the failure mode
this list exists to prevent.

### The v2 schema

Two content-spec changes. As built these are *additional* node types rather
than edits, so the v1 specs are untouched and both can coexist in one bundle:

- `package/extensions/document/document.ts`: `Document` keeps `content: '(dBlock|columns|pageBreak)+'`; `FlatDocument` extends it with `'(block|columns|pageBreak)+'`
- `package/extensions/multi-column/column.ts`: `Column` keeps `content: 'dBlock+'`; `FlatColumn` extends it with `'block+'`

The M1 wrinkles resolved as follows: the group questions were not a problem in
practice, and removing `priority: 1000` did reshuffle keymap resolution — which
is the point, since v2 wants stock Tiptap handlers. Position arithmetic that
assumed the wrapper was swept separately (`POSITION_AUDIT.md`).

Housekeeping: `package/extensions/doc.ts` is a dead duplicate top-node (still
unimported, still present). Deleting it is deferred with the rest of the v1
dead-code cleanup, so nothing is removed while v1 is the shipping schema.

### New-doc version preference

`DdocProps` gains `preferredSchemaVersion?: 1 | 2` (default 1). It applies only when the package detects a genuinely new doc (owner, no collab, no initial content — computed in `use-ddoc-editor.tsx` and passed to `useDocSchemaVersion`; `use-tab-manager.ts` derives the same condition separately for tab seeding). Existing docs always follow their marker; the prop is ignored for them.

The default is 1 on purpose, and it is not a placeholder. The package is a
published library: if 2 were the default, merely bumping the dependency would
silently change the storage format of every new document, before the safety
check has spread and before the consuming app has been taught the new shape.
Off-by-default makes the flip a deliberate, revertible act. It should become 2
eventually, in a **major** version, once the guard has soaked and ddocs.new is
creating v2 documents for real.

Consequences that fall out for free:

- Flipping the flag off stops creating v2 docs but never breaks existing ones
- Duplicating a doc copies the encoded Yjs blob, so the marker travels with it and duplicates keep their source's version automatically

## Milestones

### M0: Safety check (ships first, next regular release)

- Define the `schemaVersion` field (`ddocMeta` Y.Map) and read helpers
- The check: if a doc's version is higher than the package supports, no editor is created at all (no y-sync binding) and the package renders a "refresh to update" banner in both the main and preview editors
- This ships while every doc in existence is v1, so it is dormant. That is the point: by the time v2 launches, even stale browser tabs have the check
- The marker write moved to M1, and then out of tab seeding entirely — see The marker above. `applyResolvedTabState` runs for both new-doc seeding *and* ongoing self-heal of existing docs, so an unconditional write there would have stamped old docs
- **Changed after the fact:** M0 was originally meant to ship on its own, ahead of everything else. Mohit decided (2026-08-06) that nothing ships separately — the guard rides the combined PR. The soak requirement did not go away, it just moved: the constraint is now that a release containing the guard must be live *before* the ddocs.new flag is flipped

### M1: v2 skeleton that types

- The two-line schema change + block ID attribute
- `defaultExtensions` fork wired through all four call paths
- Stock keymaps only: paragraphs, headings, lists working with default Tiptap behavior
- Template overlay suppressed on v2 docs (until the unwrap util lands in M2; it is now enabled and unwraps at insert time)
- Demo app toggle: a "new v2 doc" action keyed on docId (demo has multi-doc infra already; `demo/src/App.tsx` has zero dBlock references)
- Exit: a v2 doc can be created, edited, closed, and reopened in the demo, and the four fork paths all produce the right extension set

M1 is deliberately where surprises are supposed to surface (keymap priority reshuffle, schema group details), while the blast radius is a demo toggle.

### M2: Parity

Work items from the package audit (see inventory below). Only one is large on this track: heading collapse. The gutter toolbar / floating handle chrome comes from Bhavesh's track and must be built schema-agnostic.

Late in M2: the template unwrap util. One exported function, roughly 20 lines: walk template JSON, replace every `dBlock` with its child, recursing into columns. Shared by the package overlay and ddocs.new's create flow. Never hand-rewrite the template JSONs (144 dBlock nodes in ddocs.new, 69 in the package); the transform is the only safe path. Built as `unwrapDBlocksInJSON` in `package/utils/block-schema.ts`.

Exit criterion: **every template renders and edits correctly in a v2 doc.** Templates contain tables, callouts, media, and columns, so they double as the parity smoke test.

> Count correction: the package ships **6** templates (meeting-notes, todo-list,
> brainstorm, breathe, pretend-to-work, resume). The "9" in earlier drafts was
> the ddocs.new count. All 6 were verified unwrapping into v2 with block counts
> identical to v1.

### M3: ddocs.new integration + flip

- `preferredSchemaVersion` prop passed at the main `<DdocEditor>` mount (`components/ddoc-editor/ddoc-editor.tsx`), gated by a new `NEXT_PUBLIC_*` flag in `utils/feature-flags.ts`
- App-side fixes (see ddocs.new inventory below)
- Internal testing period with the flag on for the team
- Flip: flag on for everyone. Every new doc is v2, templates included. The create flow needs no v1 fork at all

## Package work inventory (from the 2026-08-04 audit)

44 files reference dBlock. Buckets:

- **Works as-is (9)**: comment-only refs, dead code, the runtime state container. No work
- **v1-only, absent from v2 set (7)**: the `d-block/` folder itself (`dblock.ts`, node view, gutter components). Kept for v1 mode, simply not registered in v2. Note the chrome work has since deleted `dblock-view-registry.ts` and gutted the gutter toolbar, so this bucket is smaller than the audit found
- **Trivial content producers (5)**: stop emitting `type: 'dBlock'` in v2 paths: `sanitize-content.ts`, `resizable-media.ts` Enter-on-media, `multi-column/utils.ts` `buildDBlock`, `multi-column/columns.ts`, plus the package template JSONs (handled by the unwrap util)
- **Point edits (11)**: retarget "find enclosing dBlock" to "top-level block": bubble-menu node-selector (medium, list conversion wraps/unwraps dBlock), code-block Mod-Enter escape, media captions, editor-utils list detection, AI autocomplete gating, markdown paste pageBreak conversion, content-item actions, TOC heading expansion, callout clipboard flatten, plus the headless assembly fork
- **Re-homes (12)**: heading collapse (large, decorations over top-level ranges, `collapsed` attr on the heading node), gutter toolbar + template overlay (large, but mostly Bhavesh's chrome track), media conversion plugin (medium), trailing node (medium, position math assumes the wrapper), the two schema files (trivial), dBlock-specific CSS in `editor.css` / `index.css` / `split-view.css` (small; the `.node-dBlock` rules still look dead — search for them rather than trusting the old line number, the file has moved a lot)

**What the audit could not see.** Three v2 breaks were found by running the
editor, not by searching it: `getHeadingLinkSlug` (copy-link returned nothing),
the template overlay's second guard (a `[data-type="d-block"]` DOM query), and
`extract-title-from-content.tsx` (every v2 doc untitled). None of those files
mention `dBlock` — they assume the wrapper's *shape*, which no grep finds.
Treat the bucket counts above as a floor, and prefer the parity sweep for
evidence.

## ddocs.new work inventory (from the 2026-08-04 audit)

The app treats content as opaque bytes everywhere that matters: all Yjs handling is byte-level, no `getXmlFragment` anywhere, comments/publish/IPFS/search/AI/key-rotation all pass content through. Four structural exceptions:

1. **Title auto-extraction, must fix**: `utils/ddoc-title-manager.ts:120-180` assumes one wrapper level when finding the H1 title. On v2 docs it fails silently and every doc stays "Untitled". Roughly 5 lines to handle both shapes. Sneaky because nothing throws. The package had its own copy of the same bug, fixed in `package/utils/extract-title-from-content.tsx` — reuse that shape as the fix
2. **Version-history diff**: `utils/diff/node-diff-renderer.ts:272` has an explicit dBlock branch. Add a flat branch; keep the v1 branch (v1 docs live forever). Cross-schema diffs cannot occur because docs never change schema, so that case is deferred until migration exists
3. **App-side templates**: `utils/template-utils.ts` (7k lines, 144 dBlock nodes) feeds the create-page flow. Handled by the shared unwrap util at creation time; the JSON stays untouched
4. **Corrupt-content guard**: compares against a dBlock literal but only runs for legacy JSON content, never Yjs blobs. Inert; no change

Operational notes:

- The app pins the package exactly (`"@fileverse-dev/ddoc": "4.3.6"` as audited; the combined branch is now `4.4.0`) and forces single `yjs` / `y-indexeddb` / `y-protocols` instances via `overrides`. v2 package releases must keep these in lockstep or cross-boundary `instanceof` checks break
- One e2e selector (`tests/utils/selectors.ts:13`, `.node-view-content p.select-text`) couples to the v1 node-view DOM and needs a v2 variant
- `IDdoc.version` is the crypto/contract version, unrelated to editor schema. No Dexie migration needed; the marker lives in the doc

## Ordering constraints

These are the only hard sequencing rules. Everything else can shuffle.

1. **Safety check live in a shipped release before any v2 doc exists, with soak time.** The check only protects clients that have it. Stale browser tabs run old bundles; an old bundle opening a v2 doc would write dBlock structure into it and corrupt it for everyone, with no Yjs undo. Since the flip makes all new docs v2 at once, day-one stale-tab exposure is high, and the soak time is what covers it. **This is the one rule still outstanding** — the guard is built and merged with everything else, but the ddocs.new flag must not be flipped until a release carrying it has been out for a while
2. **Chrome (Bhavesh's track) must be schema-agnostic.** The floating drag/plus handle and container padding anchor to top-level blocks, not to `[data-dblock-*]`. Built that way once, v2 inherits it and the large "toolbar re-home" item mostly disappears. *Held up in practice:* `resolveTopLevelBlock` accepts any depth-0 block. The parts that still assumed the wrapper (heading render meta, first-line offset, plus-button insert) were point fixes, not a rebuild
3. **Behavior tests before v2 is judged working.** Tests should be written against editor behavior, not dBlock internals, so the identical suite runs against both extension sets. *As built:* this became `scripts/parity-sweep.cjs`, which drives both schemas through the same actions in a real browser. Unit tests cover the schema-aware utilities; the keymap suite from Bhavesh's track has not been written, since the keymap shrink did not happen
4. **Template unwrap after parity covers what templates contain.** Templates exercise tables, callouts, media, and columns; running them earlier just reports known-missing features

## Risks and open items

- ~~M1 unknowns~~ — resolved. Keymap order did change with `priority: 1000` gone, which is the intent in v2; the group handling was a non-issue
- ~~Heading collapse is the single largest v2 work item~~ — done. Generalised in place around a resolver, so every v1 caller kept its signature
- Effort labels in the inventories are informed estimates from the audits, not scoped commitments
- Out of scope, deliberately: migration of v1 docs, cross-schema diffs, retiring the v1 code path
- Still open and **not** part of this design: the ~200ms tab-switch pause (see `TEC2515_REMAINING.md`), and the v1 keymap shrink, which was never done — `dblock.ts` is still ~1090 lines

## Related tickets

TEC-2515 (umbrella), TEC-2221 / TEC-2232 (list bugs, fixed by Bhavesh's keymap track), TEC-2539 / TEC-2617 (cursor jumps, fixed by the point-fix track), TEC-2644 (todo UI, rides the chrome work).
