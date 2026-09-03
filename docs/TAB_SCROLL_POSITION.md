# ADR: Tab position restore (TEC-2710)

**Status:** Accepted · 2026-08-24
**Ticket:** [TEC-2710](https://linear.app/fileverse/issue/TEC-2710/switching-doc-tabs-resets-scroll-position)

## Context

All doc tabs share a single scroll container. On every `activeTabId` switch,
`ddoc-editor.tsx` deliberately sets `scrollTop = 0` (ghost-layout fix, #532) —
otherwise the outgoing tab's scroll offset would bleed into the incoming tab.
The outgoing editor is also force-blurred and made non-editable, destroying its
selection. Net effect: switching tabs always lands the user at the top.

## Decision

Replace "reset to 0" with "reset to the user's last position in that tab",
tracking **cursor placement, not scroll position** (the Google Docs model):

- No continuous scroll listener → no main-thread cost, no race conditions,
  burst-scrolls ignored.
- Cursor positions are stored as **Yjs relative positions** (reusing the
  comment-anchor encode/decode machinery), so concurrent collab edits made
  while a tab is hidden cannot invalidate them.

### Fallback ladder (on restore)

1. User-placed cursor exists → restore selection, scroll caret **centered** in
   the viewport.
2. No cursor ever placed in that tab this session → restore a `scrollTop`
   captured **once at tab-hide** (covers read-only/scroll-only users; still no
   scroll listener).
3. Nothing stored → top (today's behavior, first visit in a session).
4. Relative position resolves to deleted content → clamp to nearest valid
   position.

A cursor counts as "user-placed" only after the first pointerdown/keydown in
that tab's editor — autofocus/default selections don't poison the fallback.

### Lifetime & keying

Module-level in-memory `Map` keyed by `(ddocId, tabId)`. Survives tab
close/reopen and editor LRU eviction within the app session; **gone on
reload** (deliberate — matches Google Docs, keeps every collaborator's
position local). Nothing is written to the Y.Doc, localStorage, or IndexedDB.

### Behavior

- Selection + scroll restored always; auto-focus **desktop only**, never touch
  devices (no keyboard pop).
- Editors rebuilt after >4-tab LRU eviction restore too — deferred until
  content settles (`isContentLoading`).
- Surfaces: edit + suggest mode fully; view-only/preview via the scroll
  fallback. Excluded: version-history preview, presentation mode.
- Explicit navigation wins: cross-tab heading links and comment-focus jumps
  override restore; restore fires only on plain tab-bar switches.
- Package-internal — no new props or ref methods.
- Tab activations that are not user tab-bar switches (create tab, delete-active
  fallback, undo-delete, remote tab-state sync) do not refresh the outgoing
  tab's scroll fallback; restore still runs for the incoming tab. Acceptable
  under the cursor-first model.

### Mechanics

Cursor captured continuously on `selectionUpdate` (immune to force-blur
ordering and LRU teardown); scroll fallback captured at switch time, before
React commits the incoming panel — once it commits, the shared container's
`scrollTop` is already clamped by the new content height. Restore happens in
the pre-paint layout effect that previously zeroed `scrollTop` (no flash).
Scroller resolved via `getEditorScrollContainer`; in Split View (where the
right pane owns scrolling) scroll writes are a no-op against the attributed
container — same degradation as the old reset, no regression.

## Consequences

- Cursor semantics, not viewport semantics: typing at ¶5 then scrolling to ¶50
  without clicking returns you to ¶5. Accepted trade-off (ladder step 2 only
  applies when no cursor was ever placed).
- Positions are per-session; a reload starts fresh by design.
