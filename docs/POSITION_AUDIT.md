# Position-Mapping Audit

Audited: 2026-08-05, on `feat/flat-schema-v2`. Scope: every call site using
position arithmetic (`focus(pos + n)`, `insertContentAt(pos + n)`), excluding
the sites already owned by the chrome + fixes track (dblock.ts keymaps,
action-button, dblock-media-plugin, upload-images).

## The rule

A ProseMirror position is only valid against the document state it was
computed from. The safe patterns are:

1. Compute and consume in the same transaction: arithmetic against the
   post-mutation `tr.doc` inside one chain is fine and often intentional.
2. Recompute after any await or dispatch, or map through `tr.mapping`.

The failure pattern is reading a position at chain-BUILD time (plain argument
expressions evaluate before `.run()`), or capturing one before an async gap,
and consuming it after the doc changed.

## Verdicts

| Site | Verdict |
|---|---|
| `utils/insert-commands.ts` columns2/columns3 | **STALE, fixed.** `.focus(editor.state.selection.head - 1)` evaluated pre-insert at chain-build time. Removed; `setColumns` now owns the caret. |
| `extensions/multi-column/columns.ts` setColumns | **Fixed (new owner).** Caret placed in the first column cell inside the same transaction, offsets derived from the structure just built (schema-aware: +3 with dBlock, +2 flat), `TextSelection.near` for the final descent. Verified live in both schemas incl. keepContent. |
| `extensions/resizable-media/media-caption.ts` Enter (focus after insert) | Correct. Single chain; arithmetic targets the paragraph inserted earlier in the same transaction; offset is schema-aware. |
| `extensions/resizable-media/media-caption.ts` focus into next block | Correct. Fresh-state read, no mutation before use. v1-only branch. |
| `extensions/resizable-media/resizable-media-menu-util.ts` caption add/migrate | Correct. Single chain; `pos` is fresh at invocation; post-insert arithmetic targets the caption just created, inside the media node (schema-neutral). |
| `extensions/resizable-media/resizable-media-node-view.tsx` migrateLegacyCaption | Correct. Same single-chain caption pattern; `getPos()` fresh at call. |
| `extensions/default-extension.ts` createInputRule | **N/A: dead code.** Zero consumers in the repo. Candidate for deletion when v1 code retires. |

Sites excluded as already-owned work: `d-block/dblock.ts` keymap offsets
(keymap shrink deletes them), `action-button/action-button-node-view.tsx` (4
sites, point fix), `d-block/dblock-media-plugin.ts` (point fix),
`utils/upload-images.tsx` IPFS branch (point fix).

## Outcome

After the owned fixes land, no call site in the package consumes a position
computed against a stale document state. New code should follow pattern 1 or
2 above; anything reading `editor.state` inside chain arguments is a review
flag.
