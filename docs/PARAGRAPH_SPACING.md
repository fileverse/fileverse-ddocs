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

That is what made this expensive, since the selector runs per transaction and
`readEffectiveSpacing` calls `getComputedStyle` (a forced style recalc) per
selected block. Two changes make it affordable, both pinned by tests in
`utils/typography.test.ts`:

- the DOM is consulted only for an edge with **no attribute** to answer with —
  `nodeDOM` alone is a map lookup and costs nothing;
- the walk stops measuring once **both edges are already `'mixed'`**, since no
  later block can change that, which bounds a drag-select across a long
  document.

The common case — a collapsed cursor — was always one block, so typing costs at
most one style read per transaction.

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
