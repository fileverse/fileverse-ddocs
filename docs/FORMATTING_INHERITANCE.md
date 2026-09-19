# Formatting inheritance and persistence (TEC-3030, stage 1)

Status: **final, 2026-09-19** — accepted for implementation after nine
review rounds in `FORMATTING_INHERITANCE_REVIEW.md` (findings 1–5,
R2-1–R2-5, R3-1–R3-5, R4-1–R4-3, R5-1–R5-2, R6-1–R6-4, R7-1, R8-1–R8-2,
R9-1 and both verification corrections are folded in; their acceptance
tests are in section 6 and are the implementation's test list). Round
five replaced the after-the-fact "was this block created?" classifier with
declared inheritance: every path that creates a block sets the caret style
itself, explicitly, empty or not. Covers the
"Inherited" and "persistence doesn't work on text explicitly changed by the
user" rows of TEC-3030 for font family, font size, text colour, highlight,
bold/italic/underline/strikethrough, spacing and alignment. Both schemas.
Lists and zoom are later stages of the same ticket.

## 1. What is broken today

Measured with a real-keydown probe against both schemas (the numbers in the
ticket match v2; v1 has its own, different gaps).

| Format a run, Enter at its end, type | v1 (dBlock) | v2 (flat) |
|---|---|---|
| font family / size | carried | lost |
| colour | carried, lost on a second Enter | lost |
| highlight, B/I/U/S | lost | lost |
| line height, spacing | carried | carried |
| alignment | lost | carried |

Click away from an empty formatted line and back: only font family/size
survive, in both schemas. Everything else is gone.

Root causes:

1. **v2 marks are wiped right after the split.** Tiptap's `splitBlock` keeps
   the marks as `storedMarks`, but `blockIdAssign$` then appends a
   `setNodeMarkup` step for the new block's id, and ProseMirror nulls
   `storedMarks` on any transaction that adds a step. Every appended
   doc-changing transaction has this effect (`typographyInheritance`,
   `paragraphSpacingHeadingBoundary` too).
2. **The font "mirror" goes stale.** `fontFamily`/`fontSize` are copied onto
   paragraph node attrs, but only while the paragraph is empty. Set 24px on an
   empty line, type, select the text and change it to 32px: the attr still says
   24px, the v2 split copies it, and the next line comes out 24px. This is the
   ticket's "explicitly changed by the user" case.
3. **v1's hand-rolled Enter handler is incomplete.** `dblock.ts` carries only
   the `textStyle` mark read from `$head.marks()` (never `storedMarks`, so a
   second Enter on an empty line loses colour), never carries highlight or
   B/I/U/S, and does not carry `textAlign`.
4. **Nothing remembers an empty line's formatting** except the two font attrs.
   ProseMirror has no place to hang a mark on an empty paragraph.
5. **Spacing, v1 only, blockquote exit** (the reported repro: template, select
   all, spacing 0, Enter twice at the end of a quote). The branch inserts the
   new block *with* the spacing, then `.focus(from + 2)` moves the caret to a
   wrong position (depth 1, inside the dBlock, before the paragraph — the
   `insertContentAt` call replaced the whole empty line, so the arithmetic is
   off), `.setMark` returns false there, the chain dispatches but `run()`
   returns false, and `prosemirror-keymap` falls through to Tiptap's core
   Enter, whose `createParagraphNear` inserts a second paragraph with default
   attrs. The caret lands in that one; the correctly spaced block is the stray
   empty line left behind.
6. **Spacing, both schemas, list exit.** `setParagraphSpacing` stores spacing
   on the `listItem` and skips the inner paragraph. Enter-Enter out of a bullet
   or ordered list builds the new paragraph from the inner paragraph, so the
   spacing is dropped. Task lists happen to work because their paragraph also
   carries the attrs.

Not a bug: heading → paragraph drops `spaceBefore` on purpose (TEC-2701
carve-out, `docs/PARAGRAPH_SPACING.md`).

## 2. Target behaviour: the Google Docs model

Docs stores a text style on every paragraph's invisible trailing newline (the
paragraph mark). Enter gives the new paragraph's mark the **caret style** —
the style of the character left of the caret, or the pending style if the user
formatted with nothing selected. An empty paragraph *is* its mark, so it
remembers its style across clicks, reloads and collaborators. Formatting an
empty line writes the mark.

We build the same thing:

- **Caret style** = what typing a character would produce right now:
  `state.storedMarks ?? selection.$from.marks()`, with the legacy paragraph
  font filled in where the marks say nothing (old docs).
- **Enter** copies the caret style onto the new block. The path that creates
  the block declares it (Tiptap's split commands, made legacy-aware; v1's
  hand-built block; the callout insert), less the marks Tiptap's
  `splittableMarks` says never cross a split (`link`). Nothing infers
  creation after the fact.
- **An empty block keeps its caret style** in a node attr. Entering the block
  restores it as `storedMarks`. Formatting the empty line rewrites it.
- **Explicit formatting always wins.** The attr is refreshed from the caret at
  every Enter, so the stale-mirror case cannot recur.

## 3. Design

### 3.1 The `caretMarks` attribute

A global attribute on `paragraph` and `heading`:

- `caretMarks: string | null`, default `null`. A JSON array of
  `Mark.toJSON()` (`[{ type, attrs? }]`). A string keeps Yjs/y-prosemirror
  attribute equality trivial.
- `null` means *never stamped*; `'[]'` means *explicitly cleared*. The two are
  different (see Rule B).
- `keepOnSplit: false`. An end-of-block split — the kind that creates the
  empty line the caret lands in — starts the new block at `null`, and the
  split's own declaration then stamps it (3.2). A block that is moved
  (`liftEmptyBlock`), pasted or loaded keeps the attr it arrived with. A
  middle split copies every attr onto both halves whatever the flag says
  (Tiptap passes no `types` to `tr.split` there). For the right half, which
  has text, that is harmless. For the empty left half that an Enter at
  offset 0 leaves behind it is not: the copied stamp is whatever the
  original line was stamped with when it was last empty, not the caret
  style now (the text can have been reformatted since, the pending style
  can differ, or there may be no stamp at all), and no rule ever writes to
  a block the caret is not in. So the split path itself stamps that left
  half with the style it captured (3.2, review R7-1).
- `renderHTML` and `parseHTML`: none. The attr never reaches HTML, so paste
  and the HTML/Markdown/ODT/docx exporters ignore it, and — the important
  part — it can never become a stale paragraph-level CSS default for text
  typed later (the legacy attrs have exactly that defect, review finding 3).
- The empty-line presentation is a **node decoration**, not markup: empty
  text blocks whose stamp carries a `textStyle` font get a
  `Decoration.node` with `font-family` / `font-size` inline styles, so an
  empty 24px line has a 24px-tall caret. A decoration is part of the outer
  markup ProseMirror compares, so the block re-renders the moment it gains
  or loses text — a `renderHTML` that checked emptiness would not, because
  ProseMirror reuses a `<p>` whose attrs are unchanged. The decoration set is
  maintained incrementally from the changed ranges of each transaction (full
  scan only on init and whole-document replacement), which keeps it off the
  per-keystroke path TEC-3008 trimmed.

### 3.2 The `CaretMarks` extension

One extension, `extensions/caret-marks.ts`, registered in
`defaultExtensions` for both schemas (and so in `getHeadlessExtensions`).
One ProseMirror plugin with a small state (the dispatch context below), an
`appendTransaction` running rules A1, A3, B and C, and the decoration plugin
from 3.1. Every rule is idempotent so ProseMirror's append loop terminates.

**Dispatch context.** ProseMirror hands an `appendTransaction` hook only the
transactions it has not seen yet, so by the time a repair has been appended
the root transaction — with its origin, its stored marks and its steps — is
no longer in the slice a rule receives (review R2-3, R3-1, R3-2). The
plugin's own `state.apply(tr, value, oldState, newState)` sees every
transaction, root and appended, in order, so provenance lives there. At a
**root** transaction (no `appendedTransaction` meta) the context is rebuilt
from scratch; at an appended one it is updated:

- `local`: the root has no `y-sync` meta (`isChangeOrigin`) and no
  `addToHistory: false` (maintenance: ToC id repair, the emptied-fragment
  reconcile). Fixed at the root; a later slice cannot lose it. **Every
  doc-writing rule requires `local`** (review R4-1). There is no
  "replaced the whole document" heuristic: Tiptap's `insertContentAt`
  replaces an empty paragraph it inserts block content into, so a callout
  inserted into a document's only line is a whole-document replacement too
  (review R5-2). Loads are safe without it — see "Why loads never stamp"
  below.
- `docChanged`: the root changed the doc.
- `oldCaret`: from the pre-root state — whether the caret block was empty,
  its opening position tracked forward step by step (see "Survival"), and
  `deletedMarks`: walk the root's steps in order; for step `i`, map the
  block's content range forward through `tr.mapping.slice(0, i)`, and if
  step `i`'s old range deletes inside it, take `marksAcross` over that
  range in `tr.docs[i]`, the doc just before the step. Never compare a later
  step's offsets against pre-root coordinates or resolve them in the
  pre-root doc (review R4-3). An empty set is a real value; `null` when
  nothing was deleted there.
- `pending: { marks, explicit } | null`: set to `tr.storedMarks` when the
  transaction has `storedMarksSet` (`null` from a `setStoredMarks(null)` or
  `removeStoredMark` is honoured as an intentional change), with
  `explicit = true` unless the transaction carries this plugin's own meta —
  B and C tag every transaction they append, so a *restored* style is never
  mistaken for something the user did (review R4-1); cleared when a
  transaction has `selectionSet` without `storedMarksSet` **and no steps**
  (an explicit selection change; a selection merely mapped through a step
  is not `selectionSet`, and a step's own selection bookkeeping —
  `insertText`, `replaceSelectionWith` call `setSelection` internally — is
  not navigation, so an appended repair that also re-places the caret keeps
  the pending style for Rule C); left alone by a bare step (which nulls the
  state's marks, not the intent). Reset at the root like everything else, so a split whose
  declaration was `[]` is explicit and stays so, while a `setContent` or a
  remote root starts with `pending = null` and nothing stale can be
  restored (review R3-1).
  `storedMarksSet` is authoritative because ProseMirror clears it whenever a
  later `setSelection` or step in the same transaction discards the marks.
  One exception to `explicit`: a step-free transaction that re-sets the marks
  the state already holds (Tiptap's bare `focus()` ends in
  `setStoredMarks(tr.storedMarks)` when the selection is unchanged) is a
  re-affirmation, not a declaration, and must not make A1 stamp.

**Survival of the old caret block.** The only positional question left is
whether the block the caret was in before the root is still there, in
place, for Rule A3. It is tracked per step, in each step's own
coordinates: for step `i`, the block's opening position `p` (already mapped
through steps before `i`) survives as `map(p, 1)` unless
`mapResult(p, 1).deleted` — the association-aware flag: its opening token
was removed — with one exception: a `ReplaceAroundStep` with `from === p`,
`gapFrom === from + 1` and `gapTo === to - 1` is a wrapper replacement
(`setNodeMarkup`: the node's content is the gap, only its tokens are
re-issued), and the block survives at `p`. `assoc = 1` keeps the tracked
block *after* content inserted at its own opening position. It has to be
`deleted`, not `deletedAfter`: ProseMirror's `StepMap` reports
`deletedAfter` for a zero-width insertion at `p` too (`pos == start`, no
old size), so that flag would pronounce the block dead when a paragraph is
merely inserted in front of it (review R6-3); `deleted` is set only when
the token on the associated side was actually removed. Once the token is deleted the block is gone for the
rest of the dispatch; appended transactions keep mapping the position the
same way. This decides only "is the caret's block the old one"; it makes no
claim about any other block. The earlier attempt to also classify blocks as
*created* by mapping positions backwards failed at insertion boundaries in
both directions and under attribute repairs (review R4-2, R5-1), and is
gone: creation is declared, not inferred.

**Why loads never stamp.** A load, an import, a paste or a `setContent`
sets no stored marks, so A1 has nothing explicit; it deletes the old caret
block's opening token or contains no deletion inside it, so A3 is off; and
there is no rule that stamps a block merely for being new. A pending style
from *before* such a root is reset with the context. So a document's own
stamps — `'[]'` included — are what its blocks carry after it is loaded.

**Split commands.** Tiptap's `splitBlock` and `splitListItem` end with
`ensureMarks(marks filtered to splittableMarks)`, `marks` being
`storedMarks || $from.marks()`. That is nearly the declaration this design
relies on, and it falls short twice: it has no legacy fill, and
`ensureMarks` only *sets* stored marks when they differ from the marks at
the new caret — on a new empty paragraph `ensureMarks([])` is a no-op, so
"I turned bold off, then pressed Enter" leaves no declaration at all and
Rule B would hand the new line its neighbour's bold (review R6-2). So
`CaretMarks` overrides both commands (commands merge later-wins across
extensions, and `@tiptap/core` exports the originals as
`commands.splitBlock` / `commands.splitListItem`):

1. **Before** delegating, capture three things: `style = caretStyle(state,
   oldBlock) filtered to splittableMarks`, `oldBlock` being the block about
   to be split; `p = state.selection.$from.before()`, its opening position;
   and `sourceWasEmpty = oldBlock.content.size === 0`. Tiptap's command `state` is a chainable facade whose fields
   are refreshed from the working transaction whenever its `tr` getter is
   read — and the original `splitBlock` reads it — so a style read *after*
   delegation sees the new empty paragraph and would clear the bold the
   original just preserved (review R6-1). The callout insert already
   captures from the pre-insert state for the same reason.
2. Delegate to the original with the caller's options. Stop if it failed
   or `dispatch` is unset (or `keepMarks` was passed as `false`).
3. **Left result.** Everything a split inserts lies at or after the caret,
   which lies after `p`, and Tiptap's heading-at-start conversion re-marks
   the left half in place, so `p` still addresses the left result:
   `tr.doc.nodeAt(p)`. If that node is an **empty** text block **and
   `sourceWasEmpty` is false** — Enter at offset 0 of a non-empty line,
   where the caret moves on with the text and an empty line is left above
   it; this split is what emptied it — write the captured style onto it
   directly, in the same transaction: `setNodeMarkup(p, …)` with
   `caretMarks` serialised from `style` and the legacy `fontFamily` /
   `fontSize` nulled. A1 and A3 act only on the caret's block and cannot
   reach it, and the attr the middle split copied onto it is the original
   line's stamp from whenever it was last empty, not the caret style
   (review R7-1). The target is the split's own block, never found by
   searching backwards, so an unrelated blank line above can never be
   stamped; and it holds across list-item wrappers, where `splitListItem`
   puts `</li><li>` between the two paragraphs and no text block "ends at"
   the new caret block's opening (review R8-2). The `sourceWasEmpty` guard
   is what keeps Enter *from* an already-empty line off this path: that
   line's stamp is the user's explicit formatting of it — a link, say — and
   the split-filtered style headed for the new line must not be written
   back over it (review R9-1).
4. **Last**, `tr.setStoredMarks(style)` — `setStoredMarks`, not
   `ensureMarks`, so `storedMarksSet` is true and the declaration survives
   even when `style` is `[]`. It must be the final operation: a step added
   after it (the left-result stamp is one) nulls the transaction's stored
   marks and clears the flag, the root then reaches the plugin with no
   declaration at all, and Rule C cannot recover a value that was never
   there (review R8-1) — so the caret's pending bold would be lost in front
   of the text it now precedes.

A paragraph whose 32px lives only on its legacy attr now hands 32px to the
next line as marks (review finding 2). Because the declaration is explicit,
**every empty block a split creates is stamped, `'[]'` included** — the
destination by A1, an empty line left behind by the split itself (step 3):
a line created plain stays plain when its neighbour is later made bold and
the user returns to it, exactly as a Docs paragraph mark would. Rule B's
previous-block fallback is therefore only ever reached by blocks no
declaring path made — old documents, the trailing node, suggest mode.

The v1 Enter handler makes the same `setStoredMarks` call (3.4); so does
the callout insert (3.3). Any future path that creates an empty block the
caret lands in makes it too — that is the contract, in place of guessing.

Middle splits are outside this: when the caret is not at the end of the
block, Tiptap passes no `types` to `tr.split`, ProseMirror copies the
original attrs onto both halves, and `keepOnSplit` never enters into it
(review R6-4). The right half is non-empty, so nothing stamps it, and a
legacy font attr on the original paragraph ends up on both halves — which
is what happens today. The alternative, converting the right half's
unmarked text to marks inside the split so the attr can be cleared, would
rewrite existing text as a side effect of Enter; not worth it for a frozen
attribute. The limitation is recorded in 3.3 and 7 and pinned by a test.

**Caret style.** One helper, `caretStyle(state, legacyBlock)`, used
everywhere a style is read: `state.storedMarks ?? state.selection.$from.marks()`,
then, when those marks set no `fontFamily` / `fontSize`, filled from
`legacyBlock`'s legacy `fontFamily` / `fontSize` attrs as a `textStyle`
mark. Which block supplies the fill is fixed per caller. Explicit formatting
wins because the marks come first; an explicit *reset* wins because
`unsetFontFamily` / `unsetFontSize` null the matching legacy attr on an
empty caret block in the same transaction (they already do), and A1 reads
that block as it is *after* the command (review R2-1). No `splittableMarks`
filtering in this helper; the split commands and the v1 handler apply it
where a split happens (review finding 5, R2-4).

Rules A1 and A3 are tried in that order. Both require the caret to sit in
an empty text block and `local`; A3 also requires `docChanged`. A stamp is a
`setNodeMarkup` writing `caretMarks` and nulling the block's legacy
`fontFamily` / `fontSize` (the font now lives in the stamp; a block never
carries both), followed by `setStoredMarks`. Every rule skips when the
serialised style already equals the block's attr.

**Rule A1 — explicit stamp.** `pending.explicit` — the marks were set by a
transaction in this dispatch that is not one of ours. The style is
`pending.marks` (read from the transaction that set them, not from
`newState`, because a later appended step may already have nulled the
state's copy — root cause 1), unfiltered, with the legacy fill from the
caret's block *in `newState`*. It may overwrite any existing stamp,
including with `'[]'`. This is the user formatting or clearing an empty
line (`toggleBold`, `setColor`, `setFontSize`, `unsetFontFamily`, inline
code, …); it is every Enter into an empty line (the split commands above,
the v1 handler — they declare even an empty style) and every insert that
declares one (the callout); and it is
the user's Backspace on a line's last character whenever the deleted text's
marks differ from the marks at the emptied caret, because ProseMirror's
DOM-change reader calls `ensureMarks(marksAcross(deleted))`.

**Rule A3 — emptied in place.** No `pending` at all — explicit or restored:
after A1 stamps, its own tagged `setStoredMarks` makes `pending` non-null
but not explicit, and A3 must not overwrite that fresh stamp on the next
append round — the old caret block
**survived** and is the caret's block, `oldCaret` was not empty, and
`oldCaret.deletedMarks` is not `null` (the root deleted content inside it,
wherever in the root's step sequence that deletion sat — review R4-3). The
style is `oldCaret.deletedMarks` — the deleted text's own marks, an empty
set included, never the pending style of the moment (review R3-5) — with
the legacy fill from the caret's block in `newState`, unfiltered, and it
overwrites the stamp. This is the case `ensureMarks` cannot signal: a line
stamped bold whose last, plain character is deleted must come back plain
(review R2-2), whatever colour or font was pending at the time. Deleting a
block in front of an existing empty line lands the caret in a block that is
not the old one, so nothing is written there (review R4-2, R5-1).

**Rule B — restore on entry.** The caret is in an empty text block and
`newState.storedMarks` is null (a click, an arrow key, a wipe by another
plugin's appended step), and Rule C did not apply:

- attr is a string → `setStoredMarks(parse(attr))`, unfiltered, tagged
  with our meta; `'[]'` restores nothing and stays cleared;
- attr is `null` → `caretStyle` over the block's own legacy attrs (old docs,
  no migration, no doc write); if that is empty too, the marks at the end of
  the previous text block, if any. This is the lazy form of "created after
  that paragraph": it covers the trailing node, blank lines in old docs, and
  blocks whose stamp was filtered out in suggest mode — never a block a
  declaring path created, since those are stamped even when the declared
  style is empty. Once the user formats the line, A1 stamps it and the
  heuristic no longer applies.

**Rule C — keep pending marks through appended steps.** `pending` is
non-null (explicit or restored), the selection is a cursor and
`newState.storedMarks` is null (an appended step — `blockIdAssign$`,
`paragraphSpacingHeadingBoundary`, our own stamp — nulled it): re-set
`pending.marks`, tagged with our meta. Order-independent, holds across a
second appended repair, and confined to the dispatch that set the marks.
This is what makes Tiptap's `keepMarks` actually hold in v2, for empty and
non-empty destinations alike — Enter between bold `A` and plain `B` keeps
bold pending in front of `B` (review finding 4). It is a stored-marks-only
transaction: no step.

Rules B and C are why no other plugin needs to know about stored marks:
whatever an appended step wipes, the append loop calls us again and we put
it back, and a restore is tagged so it can never be read back as the user's
own formatting. Rules A1 and A3 are the only doc writes and both require
`local`, so undo, redo, remote edits, loads and maintenance never trigger a
local write, however many repairs other plugins append after a restore
(see 3.6).

**Suggest mode.** `filterTransaction` drops doc changes that are not its
own, so a stamp is dropped there like any other edit. Rules B and C are
mark-only and still run, so formatting carries within the session.

### 3.3 Legacy font attrs: frozen

`fontFamily` / `fontSize` on `paragraph` stay in the schema and keep
rendering. Existing documents contain them — in v2 today, text typed after an
Enter has *no* mark and gets its font purely from the paragraph attr — so
removing them would change how old docs render. They become read-only:

- `keepOnSplit: false` on both, so an **end-of-block** split (the only kind
  that creates an empty new line) never copies them: the legacy-aware split
  commands (3.2) carry the font as marks instead. A middle split copies the
  attr onto both halves regardless of the flag — Tiptap passes no `types`
  to `tr.split` there — so the legacy CSS defect (7) can follow the right
  half of a split legacy paragraph. Unchanged from today; documented, not
  fixed (review R6-4).
- Writers removed:
  - `setFontFamily` / `setFontSize` (and increase/decrease) no longer
    `setNodeMarkup` the paragraph; the empty-line case is now Rule A1 (the
    command sets `storedMarks`, which is `storedMarksSet`). The `unset*`
    commands keep the one write they already make — nulling the legacy attr
    on an empty caret block — because A1 reads that block after the command
    and a reset must not be refilled (review R2-1).
  - `TypographyPersistence` deleted (both plugins are subsumed).
  - `trailing-node.ts` (v1): stop copying/syncing font attrs onto the trailing
    node; it is a never-stamped block and gets Rule B's previous-block
    fallback. `lineHeight` copying stays.
  - `insert-commands.ts` callout: drop the font attrs and the trailing
    `setMark`; in their place the insert chain ends with
    `setStoredMarks(caretStyle(state, caretBlock) filtered to
    splittableMarks)`, computed from the pre-insert state, so the caret's
    style is declared on the callout's empty paragraph and A1 stamps it —
    including when the callout replaces a document's only line (review
    R5-2) and when the style is empty (review R6-2).
  - `dblock.ts`: drop every `fontFamily`/`fontSize` attr and every
    `.setMark('textStyle', …)` tail (see 3.4).
- Readers kept: `get-current-font-family.tsx` node-attr fallback, Rule B's
  fallback, `getExistingTextStyleAttrs` in the font commands (cursor-only
  merge of existing attrs; harmless).

### 3.4 v1 Enter handler (`extensions/d-block/dblock.ts`)

- Every `.setMark('textStyle', attrs)` tail and every `fontFamily`/`fontSize`
  attr in a built block goes. In their place, each branch that moves the
  caret into a new block captures `caretStyle(state, currentBlock)` filtered
  to `splittableMarks` *before* it builds anything, and ends its chain
  (after its `focus`, so the marks are not discarded by the selection
  change) with `tr.setStoredMarks(thatStyle)` — the same declaration the
  overridden split commands make, `[]` included, with the legacy fill taken
  from the block being left because a hand-built block copies no attrs. On
  an empty destination Rule A1 stamps it; on a non-empty one (Enter
  mid-text) the right half keeps its own marks and Rule C keeps the pending
  marks in front of it. And, as the overridden split commands do (3.2,
  step 3), when the branch moves the block's whole text into the new block
  (Enter at offset 0) and leaves the original line empty behind the caret,
  it writes the captured style onto that original line in the same
  transaction — `caretMarks` set, legacy attrs nulled — because no rule
  reaches a block the caret has left (review R7-1). The original line is
  addressed by the opening position the handler already holds
  (`$head.before()`), which its `insertContentAt` after the caret does not
  move, never by adjacency across dBlock wrappers (review R8-2), and only
  when the original line was non-empty before Enter (review R9-1). Chain
  order is fixed: build, stamp the original if emptied, `focus`, and
  `setStoredMarks` last — any step after the declaration would erase it
  (review R8-1).
- Node attrs are still built by hand, because v1 builds the node: one helper
  returns `{ lineHeight, spaceBefore, spaceAfter, textAlign }` from the block
  being left, with the existing "no `spaceBefore` when leaving a heading"
  rule. `textAlign` is new (v1 currently loses it). The list-exit branch
  reads `spaceBefore` / `spaceAfter` from whichever node owns them under the
  existing schema: the `listItem` for bullets and numbering (`setParagraphSpacing`
  writes the item and skips its paragraph), the paragraph itself under a
  `taskItem` (which has no spacing attrs) — review R2-5, R3-4. It is the one
  place in v1 that knows a list exit is happening. Ownership is not changed.
- Blockquote-exit branch: `insertContentAt` already leaves the caret inside
  the new paragraph, so the `.focus(from + 2)` goes. That was the wrong
  position that made `.setMark` fail.
- **The handler never returns `false` after dispatching.** A chain whose last
  command fails still dispatches, and `run()`'s `false` makes
  `prosemirror-keymap` run Tiptap's core Enter on the already-changed doc
  (root cause 5). Every dispatching branch returns `true` explicitly.

### 3.5 List-exit spacing (both schemas)

v1's dBlock list-exit branch builds the paragraph by hand and copies the
owner's spacing itself (3.4). v2 exits a list through Tiptap's
`liftEmptyBlock` / `liftListItem`, which *move* the paragraph node: `tr.lift`
carries it through the `ReplaceAroundStep` gap, so at the root the node
object is the same before and after. That identity does not survive the
append loop: `ExtensionManager` reverses the extension list before its
priority sort, so BlockId — registered after ParagraphSpacing — appends
first, and the lifted paragraph, now top-level, gets its block id through a
`setNodeMarkup` that replaces the object (review R3-3). So the rule is
split in two, in `paragraph-spacing.ts`:

- **Capture at the root**, in the plugin's `state.apply`: the root is local
  (no `y-sync` meta, no `addToHistory: false`), the caret was inside a
  `listItem` / `taskItem` before it,
  the caret's block in `newState` *is the same object* as before (true for a
  lift at the root), it is inside no item now, and its `spaceBefore` /
  `spaceAfter` are both `null` → remember the block's position and the
  owner's spacing values. Each appended transaction maps that position
  through its `mapping`.
- **Apply in `appendTransaction`**: read the node at the remembered
  position afresh (whatever BlockId or a caret stamp made of it), and if its
  spacing is still both `null`, `setNodeMarkup` the values in; then clear
  the capture. Position-based, so it holds in the production plugin order,
  with a missing block id, and with a caret stamp on the same block.

A task item's paragraph owns its spacing (3.4), so a lifted task paragraph
already carries it and the "both `null`" test makes the rule a no-op there.
Deleting a selected list — locally or by a collaborator — lands the caret in
a *different*, pre-existing block, so the capture never matches, and no
local write follows a remote change (review R2-5). A click from an item
into a paragraph changes no doc and never qualifies either.

### 3.6 Undo, redo and collaboration

History here is Yjs's `UndoManager` (`undoRedo: false` in
`default-extension.ts`; `undo-selection.ts` explains the consequences), not
prosemirror-history, so the guarantees rest on the y-prosemirror binding, and
on what it actually does:

- The binding's view `update` runs after **every** dispatch, doc change or
  not, and calls `_prosemirrorChanged` → `updateYFragment`, which diffs the
  ProseMirror doc against the Yjs fragment inside one `doc.transact` and
  writes only the differences. So one dispatch — the root transaction plus
  everything the append loop added, stamp included — is at most one Yjs
  transaction, and Enter and its stamp are one undo item, undone and redone
  together. Formatting or clearing an empty line is likewise one item.
- Undo and redo re-enter ProseMirror as `y-sync` transactions. Neither A
  rule fires on those: `local` is false for the whole dispatch, however
  many repairs are appended, and a Rule B restore inside that dispatch is
  tagged and cannot stand in for explicit formatting. So no stamp follows
  an undo. That matters: as
  `undo-selection.ts` documents, a locally tracked write after an undo is
  captured by the UndoManager and wipes the redo stack.
- Rules B and C never dispatch on their own; they only append to a dispatch
  that is already happening. On such a dispatch the diff is whatever the
  root transaction changed — nothing extra for a stored-marks-only append.
  The one case where a diff appears without a doc change is the emptied
  fragment after an undo, which `undo-selection.ts` already reconciles under
  `addToHistory: false` in a microtask; B and C add no dispatch that could
  race it. This is a claim about dispatches, not an unconditional "mark-only
  transactions never reach Yjs", and the collaboration-backed tests in
  section 6 are what establish it.
- A collaborator's stamp arrives as a node attr through the ordinary sync
  path and renders through the same decoration.

## 4. Expected behaviour after

| Scenario | Result (both schemas) |
|---|---|
| Format a run (any mark), Enter at end, type | new text has the marks |
| Enter twice, type | still has the marks |
| Enter, click elsewhere, click back into the empty line, type | still has the marks |
| Set marks on an empty line (nothing selected), click away, back, type | has the marks |
| Clear marks on an empty line, click away, back, type | stays cleared |
| X on empty line, type, select text, change to Y, Enter, type | Y |
| Backspace the last character of a line, type | the deleted character's marks, stamped or not |
| Toggle bold on an empty line of an old doc whose 32px is a node attr, type | bold 32px |
| Choose Default size on that same empty line, type | bold, default size (family, if any, kept) |
| Choose Default family on an empty legacy line with both attrs, type | default family, legacy size kept |
| Line stamped bold, type, clear bold on the last char, Backspace it, type | plain; click away and back: still plain |
| Pending link on an empty line, Enter, type | new text unlinked; the empty line itself can still take a link |
| Enter between bold `A` and plain `B` with CaretMarks registered before *and* after `blockIdAssign$`, and with a second appended repair | `x` bold in front of plain `B` |
| Delete a selected list that sits before an existing paragraph (local or remote) | that paragraph's spacing untouched; no local history item for the remote case |
| Pending bold, then `setContent` of a doc whose empty first line is stamped `'[]'`, type | plain — the loaded stamp wins, nothing restored from before |
| Click or arrow from bold text into an existing unstamped blank line | no doc write; B restores per its fallbacks |
| Unrelated maintenance elsewhere while the caret rests on a blank line | no doc write to that line |
| v2: Enter-Enter out of a bullet whose paragraph has no block id, with formatting pending | paragraph gets the item's spacing, its id, and the caret style; caret stays in it |
| v1: Enter-Enter out of a checklist with custom spacing, and with explicit 0/0 | the new paragraph keeps both values |
| Bold-stamped line with a plain last char; set pending bold/colour/font, Backspace the char, type | plain (deleted text's marks); leave and re-enter: still plain |
| Remote/load/maintenance root lands the caret on an empty legacy 32px line, another plugin appends a repair after B | typing gets 32px; no doc write |
| Delete a bold paragraph (or a list) sitting before an existing unstamped blank line | that line is not stamped; typing follows B's fallbacks |
| One root: insert text in an earlier paragraph, then Backspace the plain last char of a bold-stamped line | plain; leave and re-enter: still plain |
| Insert a paragraph directly before or after a formatted one, or between two, and land in either | no stamp on a surviving block; the inserted one carries whatever its creator declared |
| Fresh doc, format its only empty line, insert a callout via the slash menu, type (and: leave, re-enter, type) | the callout's paragraph is stamped with that style; typed text has it |
| Enter at the end of an old-doc paragraph whose 32px is only a node attr, in a list item too | 32px as marks; the new block carries no legacy attr |
| Split a legacy-font paragraph (or list paragraph) in the middle | both halves keep the attr and look unchanged; resetting the right half's text to Default still shows the legacy font (documented limitation) |
| At the end of bold text, turn bold off (nothing selected), Enter, type — or leave and re-enter first | plain, stamp `'[]'`; still plain after the preceding paragraph is made bold and the user returns |
| Enter at offset 0 of plain `abc` that carries a stale bold stamp; return to the empty line above, type | plain; the line is stamped `'[]'`; `abc` unchanged |
| Enter at offset 0 of bold `abc` with no stamp; return to the empty line above, type | bold; stamped bold |
| Enter at offset 0 of plain `abc` stamped `'[]'` with bold pending; return to the empty line above, type | bold; stamped bold |
| Apply a link to an empty line, Enter; type on the new line; return to the original line and type | new line unlinked (`'[]'`); original line keeps its link stamp and typing there is linked |
| One root: insert a block at the old caret block's opening, then delete its last plain character | the block survives; stamp `'[]'`; plain typing and re-entry |
| Old doc: paragraph whose 32px is only a node attr, unmarked text; Enter, type | 32px, as a real mark |
| Bold `A` + plain `B`, caret between, Enter, type | new paragraph `xB` with `x` bold, `B` plain |
| Set bold with the caret mid-word (nothing selected), Enter, type | bold |
| Toggle inline code on an empty line, type | code |
| Set 32px on an empty line, type, select all of it, choose Default | text renders at the default size |
| Enter at end of a heading | paragraph; explicit marks carry; `spaceBefore` dropped |
| Enter in a list item | new item, marks carry (already true) |
| Enter-Enter out of bullet/ordered/task list | paragraph with the item's spacing |
| Enter-Enter out of a blockquote (v1) | one paragraph, spacing kept, no stray line |
| Alignment, line height, spacing across Enter | carried (v1 gains alignment) |
| Open an old doc, click an empty line that has legacy font attrs, type | text gets the font as a real mark |
| Open a doc, or `setContent` with a pending style | nothing written; loaded stamps (including `'[]'`) preserved |
| Undo Enter | block and stamp go together; redo survives |
| Suggest mode | no attr writes; marks still carry within the session |

Which marks cross a split is left exactly as Tiptap defines it
(`splittableMarks`: everything except `link`); inline code is TBD on the
ticket and is not changed here. Comment anchors are decorations, not marks,
so they are unaffected.

## 5. Not in this stage

- Toolbar/bubble-menu availability rows of the ticket (font family in nav,
  colour in nav), tooltips, dropdown overlap.
- List state issues and zoom.
- The heading `spaceBefore` carve-out, kept as is.
- Migrating legacy font attrs to `caretMarks`. Nothing needs it.
- The ddocs.new integration surface: no exported name or prop changes.

## 6. Testing

Unit (vitest, real keydown path — `commands.keyboardShortcut('Enter')`
replays only steps and drops selection and stored marks, so it cannot test
any of this; use `view.someProp('handleKeyDown', f => f(view, keydownEvent))`
and read the *created* block by index, as `paragraph-spacing-carryover.test.ts`
does):

- `extensions/caret-marks.test.ts`, `describe.each([1, 2])` over the table in
  section 4, grouped:
  - **Load and replacement.** `setContent` of a stamped empty paragraph into
    a plain editor leaves the stamp untouched; `setContent` while a style is
    pending writes nothing, against saved stamps of `'[]'` and of a
    different style — assert the doc JSON is the input *and* the marks the
    next typed character gets; through the headless path too. `y-sync`-meta
    and `addToHistory: false` transactions never stamp. Suggest mode never
    writes the attr.
  - **Legacy fonts.** Fallback on entering an empty legacy line. Carried
    across Enter for family, size and both, with an explicit override and an
    explicit reset. Reset family and size independently on empty legacy
    lines: pending marks, stamp and typed text use the default for the reset
    property and keep the other.
  - **Splits and pending marks.** Bold/plain boundary and a pending mid-word
    style: first typed character carries it, right-hand text unchanged. Same
    with the extension registered before and after `blockIdAssign$`, and
    with a second appended repair. Link-only pending marks then Enter: typed
    text unlinked, a link still applicable on the empty line. Inline code
    stays active on an empty line.
  - **Deletion.** Backspace the last, plain character of a bold-stamped line:
    typing and re-entry stay plain; the same with pending bold, colour and
    font set just before the deletion; alongside the non-empty-mark deletion
    cases. A single root that first inserts or deletes in an earlier
    paragraph and then deletes the caret block's last character: the right
    range is detected and the empty mark set survives typing and re-entry.
    A single root that inserts a block directly at the old caret block's
    opening and then deletes its last plain character: survival, a final
    `'[]'` stamp, plain typing and re-entry — with actual block deletion,
    attribute repair and lift as controls. jsdom has no DOM-change path, so emulate ProseMirror with
    `tr.delete(...).ensureMarks(deletedMarks)` — including the empty-mark
    case, where `ensureMarks` is a no-op and A3 must carry it — and cover the
    native path in manual QA.
  - **Navigation and survival.** Click and arrow into existing unstamped
    blank lines from differently formatted places, and unrelated maintenance
    elsewhere while the caret rests on one: inspect the appended
    transactions and assert no doc write. Delete a formatted paragraph, and
    a list, sitting before an existing unstamped blank line: no stamp on the
    survivor. Insert a paragraph directly before and after a formatted one,
    and between two, selecting each destination, with and without appended
    repairs: no stamp on any survivor; an inserted block's stamp is exactly
    what its creating path declared. Delete the original caret paragraph and
    repair the survivor's attrs: no stamp. A new line's style stays stable
    after a neighbour's formatting changes and the user returns to it.
    `'[]'` stays cleared. Previous-block fallback for a never-stamped block.
  - **Declared inheritance.** The real overrides, driven through Tiptap's
    command manager: bold-at-end, bold/plain mid-text, pending mid-word
    formatting and legacy fonts — first typed character and the empty
    destination's stamp, with the appended-repair cases retained. Clear the
    pending marks at the end of formatted text and press Enter: type
    immediately, and leave/re-enter before typing in a separate case; both
    stay plain with a persisted `'[]'`, also after the preceding paragraph's
    formatting is changed before returning. Legacy-aware `splitBlock` and
    `splitListItem` in both schemas: Enter at the end of a paragraph, and of
    a list item, whose font lives only on the legacy attr yields marks on
    the next block and no copied attr; a middle split of such text, in a
    paragraph and in a list paragraph, keeps the attr on both halves with
    visible formatting unchanged (the retained limitation, pinned). Enter
    at offset 0 in both schemas, for a stale non-null stamp, an unstamped
    formatted paragraph, and pending formatting that differs from the
    stamp: return to the empty line above and type — persisted style,
    typed marks, right-hand text unchanged — then change the neighbour's
    formatting and return again; with appended repairs; for bullet, ordered
    and task-list items (through their own Enter paths), the v1 wrapped
    block, and a heading (whose left half becomes a paragraph) as well,
    with a neighbouring unrelated empty block above as a non-target control.
    For each: assert the left stamp **and** the first character typed at
    the right-hand caret keeps the pending style (pending bold before plain
    text, and pending plain before bold text as the inverse), and check
    `storedMarksSet` on the completed root transaction, not only the final
    editor state. Enter *from* an empty line explicitly stamped with a link:
    the original keeps its link stamp and typed marks, the new line is
    unlinked — both stored stamps asserted (review R9-1). Callout
    insert into a fresh document's only line with a style pending, and with
    a second paragraph present: stamp and typed marks in both; leave and
    re-enter before typing in a separate case; v2 and the v1 insertion path.
  - **Restore provenance.** Under remote, load/replacement and maintenance
    roots, append an attribute repair *after* B (both plugin orders, and
    with several repairs): typing gets the restored style and CaretMarks
    adds no document write.
  - **Rendering.** The stale-font case on the **mounted DOM** (`view.dom`
    paragraph `style` and the plugin's decoration set as the block gains and
    loses text — `getHTML()` serialises the schema and cannot see a
    decoration), with the serialised output asserted separately.
- Undo/redo, against the real Yjs UndoManager in jsdom: Enter + stamp undone
  and redone together; format-then-clear an empty line round-trips through
  undo/redo; redo survives an undo that empties the document; a remote
  update while the caret is on an empty line adds no local history item.
- `paragraph-spacing-carryover.test.ts`: blockquote exit (v1: exactly one
  block created, spacing kept); list exit for bullet, ordered and task lists
  in both schemas, in the **production plugin order** (`getHeadlessExtensions`,
  not a hand-picked subset); v2 with a paragraph lacking a block id and with
  a pending style that triggers a caret stamp (inherited spacing and final
  caret position); v1 checklist exit with custom spacing and with explicit
  zeros; list deletion before an existing paragraph, local and
  `y-sync`-tagged (paragraph unchanged, no history item).
- Existing `text-style-selection.test.ts` and `docx` tests must stay green
  (font commands over a range are unchanged).
- `styles/css-ownership.test.ts` untouched (no CSS change).

Manual QA in the demo (`?v2=1` for v2, plain new doc for v1), a lean
checklist: the section 4 table row by row, plus the reported repro (Pretend to
work template, select all, custom spacing 0, Enter twice at the end of the
quote), and a collab pair check that a stamp written by one client renders
the same empty-line font on the other.

## 7. Risks and notes

- A stamp is a doc write on every Enter into an empty line (`'[]'` for a
  plain one — a few bytes per paragraph in the Yjs doc, the price of a
  paragraph mark that exists whether or not it is styled), on
  Backspace-to-empty, and on formatting an empty line. It rides in the same
  dispatch and Yjs transaction as the edit; `onChange` sees one update.
  Load, remote, undo and maintenance paths write nothing: `local` in the
  dispatch context, and the fact that no rule stamps a block for merely
  being new ("Why loads never stamp", 3.2).
- The dispatch context is plugin state rebuilt at every root transaction:
  a tracked position, a couple of flags and a mark array. It exists only
  because ProseMirror's append loop hides the root from later hook calls;
  if that ever changes, it can go.
- Inheritance into a new block is a contract on creating paths, not a
  detector: a future command that inserts an empty block and wants the
  caret style must call `setStoredMarks(caretStyle(...))` itself — as its
  last operation, since any later step erases it — and if it leaves an
  empty block *behind* the caret it must stamp that block directly, before
  that declaration, at a position it already holds, since no rule reaches
  a block the caret is not in. The tests in section 6 pin every path that
  exists today.
- Overriding `splitBlock` / `splitListItem` shadows core commands; any
  other extension doing the same would win or lose by registration order.
  None does today (grep before adding one). A caller passing
  `keepMarks: false` gets the original behaviour and no declaration; none
  exists in the repo.
- `caretMarks` is one more attribute in the Yjs doc. It has no HTML form, so
  no importer or exporter sees it; the docx/markdown paths read marks.
- Legacy paragraphs keep their old defect: unmarked text under a legacy font
  attr cannot be reset to Default one word at a time, and a middle split
  carries the attr onto both halves (3.2, 3.3). Out of scope; the attr is
  frozen, not fixed.
- Position arithmetic in v1 (`focus(from + n)`) stays fragile. The one
  wrong site is removed; the others are verified by the carry-over tests,
  which read the created block rather than the block at the caret.
- `docs/FONTS.md` describes a doc-load `fontFamily` scan for on-demand font
  loading; it is not implemented today, so there is nothing to extend.
- A split from a `NodeSelection` whose parent is not a text block (a selected
  block node) makes no declaration; an empty block it creates falls to Rule
  B's fallbacks.
