# Paragraph spacing

Status: agreed design, implementation in progress
Branch: `TEC-2701`

Two new node attributes, `spaceBefore` and `spaceAfter`, rendering as inline
`margin-top` / `margin-bottom` in **pt**. Net-new — the existing `lineHeight`
attribute keeps its own value and storage. Registered as global attributes on
`paragraph`, `heading`, and `listItem`, modelled on
`package/extensions/line-height.ts`.

## Data model

| Decision | Value |
| --- | --- |
| Attributes | `spaceBefore`, `spaceAfter` (two, not one) |
| Unit | `pt` |
| Default | `null` — no inline style emitted, existing CSS governs |
| `0` vs unset | **Distinct.** `0` renders `margin-*: 0` and overrides the CSS default; unset renders nothing |
| Range | 0–100, integer steps |
| Storage | in the Y doc, synced to collaborators, same footing as `lineHeight` |
| Schema versions | **both v1 and v2** |
| Adjacent blocks | CSS margin collapsing accepted — larger value wins, not the sum |

`null` (rather than a concrete default) is deliberate. `lineHeight` uses
`defaultLineHeight: '138%'`, which is why every block in every ddoc carries an
inline `line-height`. An inline `margin-top` on every block would beat every
media query and every `:first-child` reset in `editor.css`, breaking responsive
spacing and the top-of-document flush rule in documents nobody has touched.

`0` and unset must stay distinct: `0pt` is how a user says "remove the gap this
editor gives me by default", and collapsing it to unset makes that
inexpressible.

## Application

Strictly **selection-scoped**, like `textAlign`. Collapsed cursor = the current
block only. Whole-document = `Cmd+A`; there is no dedicated affordance.

On lists the attribute exists on `listItem`, but the command **skips paragraphs
nested inside a `listItem`** so a list item gets one gap, not two. Read-back
needs the same parent-awareness. That logic is currently triplicated across
`use-editor-states.tsx:49-57`, `use-editor-commands.ts:115-123`, and
`editor-utils.tsx:288-296` — centralise it rather than copying the bug a fourth
time.

### The list item owns the gap, and has to be made to

Skipping the nested paragraph on write is only half of it. **Wrapping** a block
into a list — `toggleBulletList`, the `- ` input rule, a slash command, a paste
— keeps the paragraph's attributes and gives the new `listItem` none. The
margin then renders on the inner `<p>`, where nothing can reach it: the command
skips it, and so do `readSpacingSelection` and `readEffectiveSpacing`. The
dialog never shows the value, the toggles never see it, and setting spacing on
the item stacks a **second** gap on top of the first. Reproduced identically on
both schemas.

The `paragraphSpacingListOwnership` plugin moves it, and the exact rule matters:

- `spaceBefore` is taken only from the item's **first child**, `spaceAfter` only
  from its **last child**, and only when that child is a paragraph. "Last
  paragraph" is not the same as "last child" — an item ending in a nested list
  would otherwise have that paragraph's bottom gap pushed below the whole
  sublist.
- An attribute the item already carries **wins**; that is the one the dialog and
  the toggles read back.
- **Interior spacing is left alone.** The gap between two paragraphs inside one
  item is neither of the item's edges and a `listItem` cannot express it, so
  lifting the edges and clearing everything else would silently delete authored
  values. Those interior values are not reachable from the UI, but they are not
  produced by it either — they arrive by paste or import, and destroying them
  is worse than leaving them.

Ranges come from the step maps, like the heading-boundary plugin, so this stays
off the hot path. It is also **local-edit only** (`isChangeOrigin`), matching
`blockId`'s plugin: a peer running this same extension normalised its own edit
before sending it, so repeating the work here would race that peer and put a
write triggered by someone else's edit on our undo stack.

That guard means it does **not** heal a document as it loads over
collaboration — and the primary open path *is* collaborative
(`use-tab-editor.tsx` applies a Yjs update; `setContent` is only the fallback
for content that is not Yjs-encoded). This is deliberate rather than a gap:
every way the bad shape is produced — wrapping a block into a list, pasting,
importing — is a local transaction, so it is normalised at the moment it is
created and never reaches the shared document.

**Known, not fixed — one family, not one case.** Spacing is dropped whenever the
node that owned it stops existing: unwrapping a spaced item back to a paragraph
(`toggleBulletList` off), and converting a spaced bullet to a task item, which
is the same thing because `taskItem` is not one of the spacing types. Recovering
it would mean correlating against `oldState` inside the same appendTransaction.
Defensible as-is; if it is ever "fixed", fix the family, not one member.

**Task lists have the opposite ownership model** for the same reason: with
`taskItem` outside `types` and outside the parent skip, a task item's gap lives
on its inner `<p>` while a bullet's lives on the `<li>`. Self-consistent, but do
not assume the two behave alike.

### Enter carry-over

Paragraph → paragraph inherits both attributes.
**Heading → paragraph does not carry `spaceBefore`.** Without that carve-out,
every heading with a large gap above it produces body text with the same gap
above it, on every Enter, forever.

**As built**, and it needs a path per schema after all:

- **v2** needs no carry-over code. ProseMirror's split copies node attrs, so
  paragraph → paragraph carries both for free.
- **v1** does. Its dBlock `Enter` handler builds the new block's attrs by hand,
  so `spaceBefore`/`spaceAfter` are carried explicitly alongside `lineHeight`.
- The heading carve-out exists twice for the same reason. v2 uses an
  `appendTransaction` in `paragraph-spacing.ts` that clears `spaceBefore` on a
  freshly split, still-empty paragraph whose previous sibling is a heading;
  attribute-only edits leave node sizes unchanged, so a deliberately-set
  `spaceBefore` under a heading is never caught. That plugin cannot see the v1
  case, because v1's new block sits in its own dBlock row and has no heading
  sibling — so `dblock.ts` drops `spaceBefore` itself when leaving a heading.
- Both schemas drop to a **paragraph** when Enter is pressed at the end of a
  heading.

> An earlier version of this document claimed v1 continued with another heading
> and needed no carry-over work. Both came from a vacuous test that read **the
> block at the cursor** — and in v1 the cursor stays in the *original* block
> after Enter, so the assertion kept reading the block that already had the
> spacing. `paragraph-spacing-carryover.test.ts` now reads the *created* block
> by index.
>
> A previous revision of this note blamed the editor being **detached**. That
> was wrong and has been measured: detached and mounted editors split on Enter
> identically, in both schemas. The tests mount only because that matches how
> the editor really runs.

## UI

Inside the existing line-height dropdown, below the presets, a menu item
**"Custom spacing"** opening a **modal dialog** with three fields:

- Space before (pt)
- Space after (pt)
- Line spacing (multiplier, e.g. `1.15`)

Apply / Cancel. **One undo step per Apply**, not per keystroke — live-apply on a
freeform field would fire a transaction and a Yjs broadcast on every character.

Fields prefill from the selection, and show **blank with a placeholder when the
selection has mixed values**. Never prefill the first block's value: the user
would hit Apply without touching the field and silently stamp block one's
spacing onto the rest.

Placement mirrors the existing line-height control: `group: 'More'`,
`notVisible: 1270`, present in the overflow popover and the bubble menu, absent
from `mobile-toolbar.tsx`.

**As built:** three entry points open it — the toolbar dropdown, the bubble
menu, and the second-level nav (Format ▸ Line height ▸ Custom spacing),
which is data-driven and has nowhere to hold dialog state. They share
`stores/custom-spacing-store.ts` (module-level, like `search-replace-store`)
and `ddoc-editor.tsx` mounts the single `CustomSpacingDialogHost`, so the demo
menu needs no new export and the dialog is never duplicated. The registry entry
is `format.customSpacing`.

### Add / Remove space before|after paragraph

Above "Custom spacing", mirroring Google Docs. The label flips on what the
block **actually renders with**, stylesheet included, so a fresh paragraph
offers "Remove space before paragraph" first — its gap comes from editor.css,
not from an attribute. A mixed selection counts as having a gap, since removing
is the action that leaves every block in the same state.

Both halves write an explicit value, and the asymmetry is load-bearing:

| Action | Writes | Why not null |
| --- | --- | --- |
| Remove | `0` | null hands the block back to the stylesheet — the very gap being removed |
| Add | `SPACING_ADD_PT` (12pt) | "Add" is only offered when the stylesheet gives nothing, so null would leave it at zero and the item would do nothing |

Consequence: once either item is used the block is pinned and no longer tracks
the responsive stylesheet. Clearing a field in the dialog is the way back.

Logic lives once in `components/editor-toolbar/spacing-toggles.ts`;
`applySpacingToggle` is the single writer and `spacingToggleLabel` the single
wording, so the toolbar dropdown, the bubble menu and the second-level nav
cannot drift apart on either.

**Second-level nav (originally deferred, now built).** The nav is data —
`menu-tree` nodes name an action id and the label is a function of the
projected state bag — so the "which half" reading has to come from
`use-editor-commands.ts` as `format.spaceBefore` / `format.spaceAfter` with
`current: 'add' | 'remove'`. It must live in the `useEditorState` **selector**,
not in the `useMemo` body: writing a margin moves nothing else in that snapshot,
so a memo-only reading would leave the label stuck on the half already taken.

That is what made this expensive, since `readEffectiveSpacing` calls
`getComputedStyle` — a forced style recalc — per selected block. Three things
make it affordable, each pinned by a test:

- **The selector is wrapped in `useCallback`** (`use-editor-commands.ts`). This
  is load-bearing, not tidiness: `useEditorState` memoises on selector identity,
  so an inline arrow is a fresh selector every render and the snapshot is
  recomputed **per render** rather than per transaction. This hook renders
  alongside the consumer's menu bar, which has no memo boundary (nav doc §9), so
  the unmemoised version paid a style recalc on every unrelated re-render.
- The DOM is consulted only for an edge with **no attribute** to answer with —
  `nodeDOM` alone is a map lookup and costs nothing.
- The walk stops measuring once **both edges are already `'mixed'`**, since no
  later block can change that, which bounds a drag-select across a long
  document.

The common case — a collapsed cursor — is one block, so typing costs at most one
style read per transaction.

### There is no single default spacing

The dialog prefills what the block actually renders with, read via
`getComputedStyle` on `editor.view.nodeDOM(pos)`, because no constant would be
right: the gap comes from `.ProseMirror > *` (1.5em), `> p` (1.5rem), nested
`p` (0.5rem), the heading pin (1.5rem) and the `:last-child` reset — so it
varies by element type, nesting depth and position.

### Block spacing is margin-bottom only

Every block used to carry a top *and* a bottom margin. Adjacent margins
collapse to the larger, so an authored `spaceAfter` smaller than the next
block's default top margin did nothing visible. A block now owns only the gap
below it, which makes `spaceAfter` authoritative.

`spaceBefore` still collapses against the previous block's bottom margin and
only wins when larger. That is Word's behaviour too, and matches the collapsing
decision recorded above — it is not fixed by this change.

Two details that are load-bearing:

- The generic rule is `.ProseMirror > *`, not `> * + *`. A bottom gap belongs
  on every block including the first; `* + *` existed only to keep a *top*
  margin off the first block.
- The heading pin is no longer gated on `[data-schema-version='2']`. v1 hid
  prose-lg's 48px heading margins by collapsing them through the dBlock wrapper
  rows; with nothing collapsing, an unpinned heading would expose them and
  roughly double the gap after every v1 heading.

**v1 needs its own rule.** v1 wraps every block twice — `dBlock row > div >
block` — so `.ProseMirror > *` lands the gap on the outer wrapper while the
spacing attribute renders on the block itself. A parent's bottom margin
collapses with its last child's and the larger wins, so the wrapper's 1.5em
floored any authored value below it. Both wrappers therefore carry no margin
(neither has padding or a border, so the block's margin collapses out through
them) and the gap sits on `> [data-type='d-block'] > * > *`, the element the
attribute is on. Nested content — list-item and blockquote paragraphs — is
deeper than that and keeps the smaller nested default.

The selector is structural rather than gated on `data-schema-version`, since
dBlocks only exist in v1 and this then holds wherever the editor DOM renders
without that attribute. `styles/v1-block-rhythm.test.ts` restates the rules
flattened (jsdom cannot parse CSS nesting) and asserts them against a real v1
editor, because the failure mode here is a selector one level too shallow —
which CSS text assertions cannot see.

`handle-print.ts` mirrors this, so PDF and screen space identically. Scope is
the editing canvas — `.presentation-mode` and `.ai-preview-editor` are separate
renderers with their own rhythm and are untouched.

That means **Apply pins spacing on every selected block**, since the prefilled
value gets written back. Clearing a field still writes null and returns that
block to the stylesheet, which is the only escape hatch.

`getComputedStyle` returns resolved pixels in a browser but the *specified*
value in jsdom (no layout), so anything that is not px is treated as unknown
rather than parsed into a wrong number — and the tests specify px.

> **Verified.** `uiValueToPercentage` is `round(uiValue * 120)` and the preset
> table matches it exactly (1 -> 120%, 1.15 -> 138%, 1.5 -> 180%, 2 -> 240%), so
> the multiplier field is consistent with the presets. Note that "1.15" in the
> UI means CSS `line-height: 138%`, not 115%.

## Line-height changes (same PR, separate commit)

`line-height.ts:56-124` becomes selection-scoped — the collapsed-cursor
`state.doc.descendants` whole-document path is removed, and
`Alt+Shift+Up/Down` (`editor-utils.tsx:283-323`) follows.

This is required because "Custom spacing" now lives inside the line-height
dropdown. Without it the same menu behaves two ways: presets restyle the whole
document on a collapsed cursor, "Custom spacing" restyles one block.

> **User-visible regression.** Anyone who currently puts their cursor anywhere
> and picks a preset to restyle their whole document now needs `Cmd+A`. Needs a
> changelog line.

`defaultLineHeight: '138%'` **stays as-is**. Changing it to `null` would reflow
every existing document (138% -> the CSS 150%) and belongs in its own ticket.

## Export

| Path | Carries spacing? | Notes |
| --- | --- | --- |
| Editor / collab | yes | it's in the Y doc |
| HTML export | yes | `style` reached `ALLOWED_ATTR` only via `MERMAID_SVG_ATTRS`; now listed explicitly so narrowing that list cannot silently break it |
| ODT export | no | see below |
| Plain `.md` / plain text | no | see below |
| List items in `.md` | **no** | see the LI note below |
| PDF / print | yes | `handle-print.ts` passes raw `getHTML()` through unsanitised |
| Markdown with CSS (.md) | yes | new turndown rule |
| Split View round-trip | yes | new turndown rule |
| Plain `.md` | **no** | accepted — no CommonMark syntax for margins |
| Plain text | **no** | meaningless |
| **ODT** | **no** | accepted limitation, see below |
| DOCX | n/a | no DOCX export exists, import only |

### The turndown rule

**One generalised block-style rule** (`blockStyle`) replaces `alignedBlock`,
emitting `text-align`, `margin-top`, `margin-bottom`, and `line-height`
together, extended from H1–H3/P to also cover **H4–H6**. Two separate rules
would let turndown's ordering pick one and silently drop the other's styles on
a block that is both aligned and spaced.

> **LI could not be included.** The custom `listItem` rule (`filter: 'li'`) is
> registered *after* `blockStyle`, and turndown checks later-registered rules
> first, so `<li>` never reaches the style rule — adding `'LI'` to the tag list
> is verifiably dead code. Carrying list-item spacing would mean emitting the
> whole `<ul>`/`<ol>` as raw HTML instead of a markdown list, which is a bigger
> trade than this rule should make unilaterally. **Consequence: list-item
> spacing does not survive `.md` export or the Split View round-trip**, though
> it is correct in the editor, HTML export, and PDF. Pinned by a test so it
> stays a deliberate limitation. Needs a decision if list spacing must round-trip.

**Critical gate: emit a property only when it deviates from the default** —
`line-height` only when it differs from `138%`, margins only when set. The rule
emits `el.innerHTML` verbatim (CommonMark does not re-parse markdown inside
block-level HTML), so an ungated rule would route every block in the document
through it and degrade the whole "Markdown with CSS" export — and the Split View
pane — into raw HTML. `alignedBlock` already sets this precedent by skipping
`left`/`start` at `:86`.

Also add the missing **"Markdown with CSS (.md)"** option to
`use-export-headless-editor-content.tsx` (currently only in
`editor-utils.tsx:889-917`), so the headless lane doesn't produce different
output for the same document.

### Why ODT is out

`odf-kit@0.9.3`'s HTML->ODF bridge reads exactly one block property.
`parseParagraphOptions` (`dist/odt/html-parser.js:527-534`) maps `text-align` and
nothing else; the `h1`–`h6` case (`:147-157`) passes no options argument at all;
`ListBuilder.addItem` has no options parameter, so list-item spacing is
structurally impossible.

The output side already exists — `ParagraphOptions`
(`dist/odt/types.d.ts:167-209`) has `spaceBefore`, `spaceAfter`, and
`lineHeight`, and the emitter writes `fo:margin-top` / `fo:margin-bottom` /
`fo:line-height` (`dist/odt/content.js:929-942`). Only the HTML->options bridge
is missing. Fixing it means a `patch-package` fork or an upstream PR; deferred.

**Surfacing:** silent. Changelog and README only, no UI note.

## Bug fixes riding along

1. `html-export/index.tsx:63` registers a `DOMPurify.addHook` that is never
   removed. DOMPurify is a module singleton, so it leaks into the markdown
   import sanitize (`mardown-paste-handler/index.ts:1529`) and deletes any
   element with no text and no children — including a spacing-only paragraph.
   Add `removeHook` after the sanitize call.
2. `handle-print.ts:395-401` (and `:404-405`, `CONTENT_STYLES:74,79-83`) use the
   `margin` shorthand, so an inline `margin-top` alone leaves the print
   stylesheet's `margin-bottom: 12px` in force. Convert to longhands. Eyeball the
   print output afterward — those values were tuned by hand.
3. **The first paragraph of a multi-paragraph paste lost its block attributes**
   (TEC-2701 D1, reported by two testers against a Google Docs paste). The
   clipboard was never the problem — all three paragraphs parse with the right
   values. ProseMirror's slice arrives with `openStart > 0`, which merges the
   first pasted block's *inline* content into the block at the cursor; that
   block keeps its own attributes, so line height, spacing and alignment were
   all dropped for it while every later paragraph kept them. Predates this
   feature — line height alone reproduces it — but spacing rides the same
   mechanism.

   (`openStart` is 1 for a flat multi-block paste and 2 on v1, where
   prosemirror-view's own `normalizeSiblings` wraps the bare paragraphs into
   `dBlock` at doc level. Neither number is universal: a single-block paste is
   1 on v1 too, and pasting into a table cell gives 1 with bare paragraphs.)

   Fixed in `transformPasted`: when the target paragraph is empty — or is fully
   selected, and so about to be — there is nothing to merge with, so the slice
   start is marked closed (`openStart = 0`) and the pasted block simply becomes
   that block. Pasting into a block that has text still merges, which is
   correct mid-sentence. `gdocs-paste.test.ts` pins both sides on both schemas.

   Three scoping decisions, each deliberate and each pinned by a test:

   - **Drops are excluded.** `transformPasted` is ProseMirror's *drop* hook as
     well, and there the insertion point is the mouse — an external drop
     resolves its context from `$mouse`, not the caret. Without the guard, a
     drop while the caret sat in an empty paragraph split whatever paragraph
     the pointer landed in. jsdom cannot complete a real drop (no
     `elementFromPoint`), so the tests cover the guard's two reachable halves
     and the rest rests on prosemirror-view's source.
   - **Paragraphs only, not every textblock.** An empty *heading* is a block
     the user deliberately created; letting the pasted paragraph become it
     silently discarded the level.
   - **Full-selection replace is included.** Selecting a whole paragraph and
     pasting over it leaves the same empty target and lost the same
     attributes.

   **[LIMIT]** If the clipboard's `text/plain` looks like markdown, `handlePaste`
   takes the markdown branch and the HTML — attributes and all — is discarded
   before ProseMirror sees it. There the loss is worse than the bug above:
   **every** paragraph comes back at the default, not just the first. `isMarkdown`
   is a loose heuristic (any `*…*`, any backtick run, any `[…](…)`, a leading
   `-`/`>`/`*`), so ordinary prose trips it. Pre-existing routing, unchanged
   here, and worth its own ticket rather than a silent footnote.

   Testing a paste in jsdom needs a `ClipboardEvent` double, and its `getData`
   must return `''` for types it is not serving: a fake that answers everything
   feeds the plain text to `@tiptap/extension-code-block`'s `vscode-editor-data`
   probe, which `JSON.parse`s it and throws. Give it a realistic `text/plain`
   too — `handlePaste` inspects that first, so an empty one silently exercises
   a different route than production.

## DOCX import

Word documents carry spacing that ddoc can now model, so it is read on import.

**Mammoth cannot supply it.** Its README states it converts "using the semantic
information in the document, and ignoring other details" — it never parses
`w:spacing` at all, and its paragraph model carries only styleId, styleName,
numbering, alignment and indent. So mammoth keeps doing structure, and
`extensions/docx/docx-spacing.ts` reads the presentational values straight from
`word/document.xml` in the same `arrayBuffer`, via the `jszip` that mammoth
already pulls in (now a direct dependency, so the import is not relying on
hoisting; it is already inside the bundle either way).

| Word | ddoc | Conversion |
| --- | --- | --- |
| `w:before` / `w:after` (twips) | `spaceBefore` / `spaceAfter` (pt) | twips / 20 |
| `w:line` with `w:lineRule="auto"` (240ths of a line) | `lineHeight` (% on a 120 base) | line / 2 |

Layers are merged **per attribute**, lowest first, because Word does the same:
`docDefaults` -> the `basedOn` style chain -> the paragraph's own style ->
direct `w:pPr/w:spacing`. A style supplying only `w:before` therefore survives
direct formatting that supplies only `w:after`.

Alignment between the two passes is positional, so it is **verified, not
trusted**: block counts must match and each block's text must match its `w:p`,
or the HTML is returned untouched. Spacing on the wrong paragraphs is silent
and hard to trace; no spacing is not.

`ignoreEmptyParagraphs: false` is required for that alignment to hold — mammoth
drops empty paragraphs by default, which desynchronised a 38-paragraph test
document by 3. It also means blank lines an author typed now survive import,
which is a behaviour change to every DOCX import, not just spaced ones.

**Known gaps:** `w:contextualSpacing` ("don't add space between paragraphs of
the same style") has no equivalent in the model and is ignored. `w:lineRule`
of `exact` or `atLeast` is absolute and has no multiplier equivalent, so it is
dropped rather than guessed from an assumed font size. Text boxes are
relocated by mammoth and footnotes are appended, so a document using them will
fail the alignment check and import without spacing.

## Out of scope

- ODT support (odf-kit patch)
- Plain `.md` and plain text
- Changing `defaultLineHeight` to `null`
- The consecutive-empty-paragraph collapsing at
  `mardown-paste-handler/index.ts:1569-1589`
- A document-level spacing default with per-block override
- Mobile toolbar; promoting the control to the always-visible toolbar row
- Property-level CSS filtering in the sanitizer
- Presets for paragraph spacing (dialog only, for now)

## Known risks

- **Older collaborators strip the attribute.** A user on a published ddoc
  version without this extension edits a shared doc, and unknown attributes are
  dropped on round-trip. Schema version does not gate this — adding an attribute
  doesn't bump `SUPPORTED_SCHEMA_VERSION`. Same exposure `fontSize` and
  `lineHeight` already have. Accepted; worth a release-coordination note.
- `use-ddoc-export.ts:185-229` — the all-tabs HTML export bypasses DOMPurify
  entirely, so single-tab and all-tabs exports run different pipelines. Not
  fixed here.

## Test plan

- **Extension unit tests** (net-new; `line-height.ts` has none today): set/unset
  on each of the three types; `0` vs `null` distinctness; collapsed cursor
  touches one block only; selection touches exactly the selected blocks;
  nested-paragraph-in-`listItem` skip.
- **Carry-over**: paragraph -> paragraph inherits; heading -> paragraph drops
  `spaceBefore`. Both v1 and v2, via `utils/make-editor.ts`.
- **Turndown round-trip**, following the `columns-export` / `page-break-export`
  pattern: spacing survives; default line-height is *not* emitted; a plain
  paragraph stays plain markdown; align + spacing on one block emit together.
- **Split View**: apply -> spacing and line-height both survive.
- **`default-extension.test.ts`**: extension present under both schema versions.
- **Line-height regression**: collapsed cursor no longer restyles the document.
- **CSS**: assert print longhands, following `styles/placeholder-css.test.ts`.

## Commit sequence

1. Extension + attributes + commands + tests
2. Registration in `default-extension.ts`, both schema forks
3. Enter carry-over, v1 and v2
4. Line-height -> selection-scoped *(separately revertable)*
5. Custom spacing dialog + dropdown menu item
6. Generalised turndown rule + headless md-css option
7. DOMPurify `removeHook` + print longhands
