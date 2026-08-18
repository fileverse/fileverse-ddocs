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

**As built** (differs from the plan above, which assumed two hand-written
carry-over paths):

- Inheritance itself needed no code. ProseMirror's split copies node attrs, so
  paragraph → paragraph already carries both in v1 and v2.
- The carve-out is one `appendTransaction` plugin in `paragraph-spacing.ts`,
  written against node types rather than schema version. It clears `spaceBefore`
  on a freshly split, still-empty paragraph whose previous sibling is a heading.
  Attribute-only edits leave node sizes unchanged, so a deliberately-set
  `spaceBefore` on a paragraph under a heading is never caught.
- The two schemas behave differently at a heading boundary and both are pinned
  by tests: **v1's dBlock Enter continues with another heading** (so there is no
  type change and the rhythm is kept), while **v2 drops to a paragraph** (so the
  carve-out fires). Only v2 needed fixing.

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
menu, and the demo's second-level nav (Format ▸ Line height ▸ Custom spacing),
which is data-driven and has nowhere to hold dialog state. They share
`stores/custom-spacing-store.ts` (module-level, like `search-replace-store`)
and `ddoc-editor.tsx` mounts the single `CustomSpacingDialogHost`, so the demo
menu needs no new export and the dialog is never duplicated. The registry entry
is `format.customSpacing`.

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
