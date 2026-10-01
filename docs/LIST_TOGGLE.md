# Lists (TEC-3130, stage 2 of TEC-3030)

Status: **implemented** in `package/extensions/list-toggle/`, tests in
`list-toggle/*.test.ts` (§5). Includes TEC-3110, list markers that follow the
item's font (§3.9). Builds on stage 1's caret-mark model
(`FORMATTING_INHERITANCE.md`); zoom is stage 3.

## 1. Background

Two engines used to toggle lists and disagreed with each other and between
schemas: stock Tiptap `toggle*List` (nav, slash menu, Mod-Shift-7/8/9) and
hand-rolled converters (`checkActiveListsAndDBlocks`, `convertToList`,
`convertListToParagraphs`) behind the toolbar and bubble menu. Stock no-ops in
v1 (a `dBlock` holds exactly one block, so lifts and wraps that need siblings
fail); its cross-item retype (`clearNodes` + `wrapInList`) resets paragraph
attrs and flings nested items to the top level. The converters rebuilt whole
ranges, deleting anything they did not collect (an hr, a second list), and
any `replaceWith` over anchored text marks those comments deleted. Backspace
at an item's start disagreed too: v1 split the list and kept the bullet, v2
joined the item into the previous one.

## 2. Behaviour

The same document shape in both schemas (up to v1's dBlock wrapping), from
every trigger, for a selection whose blocks contain no list or exactly one
list:

| Selection | Result |
|---|---|
| paragraphs or headings, press T | one list of T, one item per block; a heading becomes a paragraph keeping the attrs paragraph also has |
| items of a T list, press T (toggle off) | only the covered items leave; the list splits around them; each body child of a lifted item becomes its own block, in order (paragraphs, sub-lists with their type and attrs, other blocks); edge spacing lands on the first/last paragraph (§3.5). In a nested list the items move to the outer list when the outer item has the same item node, else they unwrap into the outer item's body |
| press a type with the same item node (bullet ↔ numbered) | the whole list is retyped |
| press a type with the other item node (↔ checklist) | only the covered items are retyped, the list splits around them, their bodies untouched; edge spacing moves between item and paragraph (§3.5); a nested list stays nested |
| inside a blockquote, callout, table cell or one column | the same, at that depth |
| after a wrap or a retype | the result joins a same-type list right before or after it |

Also: Backspace at an item's start takes it out of the list (§3.8), markers
follow the item's font (§3.9), and Enter out of a nested list keeps the item's
spacing (§3.10).

**Refused**, document unchanged ("mixed elements", to be designed
separately): a range holding a list and something else, or two lists; a wrap
range holding anything but paragraphs and headings (hr, image, table, code
block, blockquote, a whole columns block); a NodeSelection or AllSelection
over a whole list. Also parked: the double-tick active indicator (`isActive`
counts ancestors) and "Text" on a heading inside a list item (toggles the item
off, leaves the heading).

**Known lossy cases.** An item's `spaceAfter` is dropped when its last body
child is not a paragraph (a trailing sub-list) and the item is lifted or
becomes a `taskItem`. Toggling off the items that end a nested list which is
the outer item's last child moves the last paragraph's `spaceAfter` onto the
outer item through the ownership plugin, dropping it if the outer item already
has one.

**Known gap (TEC-3181, comment layer, pre-existing).** Comment anchors are Yjs
`RelativePosition`s, and y-prosemirror re-creates a `Y.XmlElement` whenever
its node name changes, so anchors inside a retyped, wrapped or lifted subtree
collapse and the comment is dropped — as with stock `toggleHeading` and
`toggleBlockquote`. The engine keeps the ProseMirror-mapped range exact, which
the fix needs; "anchors kept" below means that layer. The Yjs-layer cases are
`it.fails` in `list-toggle-anchors.test.ts` and `-backspace.test.ts`.

## 3. Design

### 3.1 One override, structural steps only

`ListToggle` (`list-toggle.ts`), registered after the list extensions in
`default-extension.ts`, overrides `toggleList` (Tiptap merges `addCommands`
later-wins), so every trigger converges on it: the three `toggle*List`
commands, the shortcuts, the slash menu, the toolbar and the bubble menu
(§4). It also owns the Backspace and Enter shortcuts (§3.8, §3.10) and the
marker-font plugin (§3.9).

The schema enters in one place: where a container's children are v1 `dBlock`s
(the doc, a v1 `column`), rows are read through them, splits and joins cut two
levels instead of one, and a block lifted out of a list gets a new dBlock
(§3.4).

Every change is a structural step (`split`, `join`, `wrap`, `lift`,
`setNodeMarkup`, `setBlockType` and two hand-built `ReplaceAroundStep`s), so
positions map through the transaction: the selection needs no re-placing and
no step's old range covers anchored text. `replaceWith` is never used.

A refusal sets `preventDispatch` and returns `false`, so nothing changes,
including earlier steps in the same chain (the slash menu's `deleteRange`).
The engine runs the same code with and without `dispatch`, so `editor.can()`
matches execution. Its only stock delegate is `liftListItem` for a nested
toggle off (§3.4), whose `can()` answer also matches for those cases.

### 3.2 Classify, then act

`shared` is the innermost list containing both `$from` and `$to`.

1. No `shared`: the row is the block range's children, looked through
   dBlocks. All paragraphs or headings → wrap (§3.3); otherwise refuse.
2. `shared` exists: the covered items are its children between `$from`'s and
   `$to`'s indexes (reaching into a sub-list covers the whole item). Already
   the target type → toggle off (§3.4); same item node → retype the list;
   otherwise retype the covered items (§3.5). All act on `shared`, never on the
   list nearest `$from`.

### 3.3 Wrap

Last block to first: a heading becomes a paragraph (`setBlockType` with an
attrs callback keeping `textAlign`, `lineHeight`, spacing, `caretMarks`), then
`tr.wrap` puts the block in its own `list(item)`. The single-item lists are
then joined into the first, then §3.6. Last to first because two adjacent flat
wraps make their shared boundary ambiguous under mapping.

### 3.4 Toggle off

**Nested list** (`shared`'s parent is an item): stock `liftListItem`. With an
outer item of the same item node it runs `liftToOuterList`, which moves the
items whole, attrs intact. With the other item node it runs `liftOutOfList`,
which unwraps the items into the outer item's body, so the engine first moves
each item's edge spacing onto its paragraphs (§3.5).

**Otherwise**, for each covered item, last to first:

1. Move the item's edge spacing onto its first/last paragraph (§3.5).
2. Lift every body child after the first, last to first and as a whole node,
   to just after the item (`liftOut`: ProseMirror's `lift` step, whose slice
   also wraps the gap in a new dBlock when the list sits in one — a dBlock
   cannot sit inside an item). A sub-list keeps its type and attrs (`start`,
   `checked`), and the items after it stay a separate list.
3. `isolateItem`: split before and after the item.
4. `tr.lift` the paragraph to the list's parent, replacing the single-item
   list.

### 3.5 Retype and edge spacing

**Same item node:** `setNodeMarkup(shared.pos, listType)`, then §3.6.
**Other item node:** for each covered item, last to first, isolate it and swap
both wrappers in one `ReplaceAroundStep` whose gap is the item's body, so the
body is untouched (`setNodeMarkup` cannot: `taskList(listItem)` is invalid
mid-way). Then rejoin, then §3.6.

**Edge spacing** (toggle off and both retypes), mirroring the ownership
plugin's `takeEdge`: an item's `spaceBefore` belongs to its first child and
its `spaceAfter` to its last, only when that child is a paragraph. Item →
paragraphs: the item's value wins on the edge paragraph; a value whose edge
child is not a paragraph is dropped. Paragraphs → item: the edge paragraph's
value moves onto the item. Interior gaps (a paragraph followed by a sub-list)
are never touched. Zero is a value. `checked` starts `false`; `lineHeight` and
`textAlign` never move.

### 3.6 Adjacency

After a wrap or a retype, the resulting list joins a same-type list directly
after it, then directly before it (through the dBlock boundary in v1). The
list is found from the selection's ancestors, never from a mapped position.
A toggle off never joins.

### 3.7 Invariants

- A `false` never changes the document.
- No `ReplaceStep` covers anchored text: ProseMirror-mapped comment ranges
  stay exact (the Yjs layer is §2's gap).
- The same shape in both schemas up to dBlock wrapping; one block per dBlock.
- Paragraph attrs survive every path; nodes are never rebuilt from JSON.
- `doc.check()` passes; one transaction, so one undo step.

### 3.8 Backspace at the start of an item

At offset 0 of an item's first textblock, Backspace takes the item out of the
list in place with `toggleList(list.type, item.type)` (§3.4): a top-level item
becomes a paragraph and the list splits around it, a nested item outdents, an
empty item becomes an empty paragraph. Anything else falls through (a range,
a caret inside the text, a paragraph after a list). `ListToggle` is
registered after StarterKit, so its keymap runs before `ListKeymap`'s. v1's
dBlock Backspace list branch is gone; its page-break case stays.

### 3.9 Markers follow the item's font (TEC-3110)

Markers are the browser's `::marker` (bullets, top-level numbers) and
`li > ol > li::before` counters (nested `a.` and `i.`, `styles/index.css`).
Both inherit the `<li>`'s font, while the item's font lives on its text. A
`listItem`'s marker now takes the font size and family of its first paragraph
when that paragraph agrees on them.

The rule (`resolveMarkerFont` in `list-toggle/marker-font.ts`), per property:

- **Voting runs:** the paragraph's text nodes, except whitespace-only ones;
  inline atoms (`hardBreak`, `inlineMath`) do not vote. An empty paragraph
  votes with its stage-1 `caretMarks` stamp, so Enter after a 12px item gives
  a 12px bullet before anything is typed.
- **A run's value:** its `textStyle` attr, else the paragraph's legacy
  `fontSize`/`fontFamily` attr. `''` counts as unset.
- **Only values the marker can reproduce vote:** absolute sizes (`px`, `pt`,
  `pc`, `in`, `cm`, `mm`, `q`, `rem`, `xx-small`…`xxx-large`) always; `%`,
  `em`, `larger` and `smaller` only when declared on the paragraph or on a run
  in a paragraph without a legacy size, since the marker resolves them against
  the `<li>`. Anything else (`ex`, `calc()`, `var()`, CSS-wide keywords), and
  a family that is a CSS-wide keyword or uses `var()`, keeps the default.
  A value containing `;`, `{` or `}` is ignored: it would break out of the
  inline style.
- **Canonical form**, used to compare and to write: sizes lower-cased with the
  shortest number (`12.0px` → `12px`; units are not converted, so `12px` next
  to `9pt` is mixed); family names unquoted, whitespace-collapsed,
  lower-cased and re-quoted (`"comic sans ms"`), a generic family unquoted only
  when written unquoted.
- **Uniform:** when every voting run carries the same canonical value the
  marker takes it; otherwise the marker keeps the default, as Google Docs and
  Word restyle a bullet only when the whole line is restyled. Size and family
  only; `taskItem`s have no marker.

**Editor and preview.** `markerFontPlugin`, registered by `ListToggle`,
decorates each item whose rule yields a value with `--ddoc-marker-font-size` /
`--ddoc-marker-font-family`; `styles/index.css` resets both on every
`.ProseMirror li` (custom properties inherit) and feeds them into `li::marker`
and `li > ol > li::before`. Display only: nothing is stored. A decoration and
not `renderHTML`, because ProseMirror reuses an `<li>` whose attrs do not
change. Upkeep: `changedBlockRanges(tr)` collects each step's map ranges plus
the positions of mark and attr steps (their maps are empty), widens them to
top-level blocks and merges them, so a block is rescanned once per
transaction; the fresh decorations are diffed against the mapped ones, so
unchanged markers are not re-added (removing all of a long list's node
decorations is quadratic in ProseMirror).

**Print and PDF.** `handleContentPrint` runs `applyMarkerFonts(root)` on the
parsed HTML before KaTeX: the same rule over each non-task `li`'s first `<p>`,
reading inline styles and skipping text inside `data-type` elements
(serialized atoms). The print stylesheet carries the same reset and feeds
`li::marker` and `li > ol > li::before`, since a consumer's global CSS can
draw nested counters. HTML carries no `caretMarks`, so an empty item prints
with the default marker.

**Out of scope:** HTML, Markdown, ODT and docx export, and presentation mode
(TEC-3186); markers staying anchored at the indent as the font grows
(TEC-3200). Safari's `::marker` may ignore `font-family`; the size still
applies.

### 3.10 Enter out of a nested list keeps the item's spacing

Enter on an empty last line of the last item of a nested list (inside an item
of the same type) takes that line out one level and keeps the item's attrs,
spacing included; items typed after it inherit them. Stock `splitListItem`
built the new outer item with `createAndFill(null, …)`, which dropped the
item-owned spacing in v2.

`ListToggle`'s Enter handler: when the item holds only that line,
`liftListItem` moves the item node out; when it holds other content, stock
`splitListItem` splits the line off (the content stays nested) and
`setNodeMarkup` gives the new item the attrs a normal Enter carries
(`getSplittedAttributes`), in one transaction. v1's dBlock Enter lifts only an
item that is just that line and otherwise falls through to the same handler.
`taskItem`s stay with stock: their spacing is on the paragraph.

## 4. Call sites

Twelve UI sites call the engine; the hand-rolled converters are deleted.
`editor-utils.tsx`: the toolbar's List, Ordered List and To-do List tools, the
mobile To-do tool, the "Text" entries of the desktop heading dropdown and the
mobile text-formatting modal, and the modal's Bullet and Ordered entries.
`editor-bubble-menu/node-selector.tsx`: Text, To-do, Bullet and Numbered. The
"Text" entries use `listAtSelection(state)` and `toggleList(listType,
itemType)` inside a list (a toggle off), `toggleNode('paragraph',
'paragraph')` outside.

## 5. Tests

`package/extensions/list-toggle/`, every behaviour in both schemas
(`describe.each([1, 2])`), asserting `doc.check()` and a dBlock-free outline
(`flatShape`):

- `list-toggle-wrap` — helpers (`sharedList`, `listAtSelection`), refusals and
  chain atomicity, wraps with headings, containers, adjacency, `can()`.
- `-off` — toggle off at top level and nested (same and other item node),
  multi-paragraph items, edge spacing, containers.
- `-retype` — both retypes, attrs, spacing collisions and round trips,
  `can()`, adjacency.
- `-anchors` — ProseMirror-layer comment anchors and `caretMarks` through
  every path, undo, Mod-Shift-8 via a real keydown; the Yjs layer as
  `it.fails` (TEC-3181).
- `-backspace`, `-enter` — §3.8 and §3.10 via real keydowns.
- `-marker` — §3.9 in the document, the editor DOM and print, from one case
  table; live upkeep; `changedBlockRanges`; the inline-atom guard.
- `marker-font.test.ts` — the pure rule and canonical form.

`utils/handle-print-css.test.ts` and `styles/css-ownership.test.ts` cover the
CSS. Undo tests call `undoManager(editor).stopCapturing()` first. Shortcuts go
through a real `KeyboardEvent`: Tiptap's `keyboardShortcut()` replays steps
through a mapping and mangles multi-step transactions.

## 6. Gotchas

- Tiptap's `run()` and `editor.commands.x()` dispatch even when a command
  returned `false`, unless the transaction carries `preventDispatch`.
- `editor.can()` uses a fresh transaction; `props.can()` inside a command
  reuses the shared one. Stock `toggleList`'s same-item retype runs only with
  `dispatch`.
- `liftListItem` uses `liftToOuterList` only when the outer item's type equals
  `itemType`, else `liftOutOfList`.
- `analyzeCommentAnchorTransactionChanges` marks a comment deleted when a
  changed range's old span covers it; `ReplaceAroundStep` gaps are not
  changed ranges.
- A split copies an ordered list's `start` to both halves (stock too).
- `blockRange()` at the position before a paragraph's opening token selects
  its parent: resolve inside the paragraph.
- Lifting a sub-list's items into the outer list loses the sub-list node and
  merges them with the following items, and `taskItem`s cannot enter a
  `bulletList`: lift the sub-list whole.
- `dBlock` is `group: 'dBlock'` and cannot sit inside a list item; a v1
  `column` holds `dBlock+`.
- Mark and attr steps have empty step maps. A remote Yjs update and a Yjs undo
  arrive as one whole-document `ReplaceStep`.
- Parsed HTML stores unset `textStyle` attrs as `''`; the legacy paragraph
  parser strips family quotes, the mark keeps them.
- Tiptap builds plugins from the reversed extension list, so a later-registered
  extension's keymap runs first.

## 7. Tiptap upgrade

Verified on `@tiptap/*` 3.11.0 (`core`, `pm` and `extension-collaboration`
pinned exactly). The engine leans on these behaviours; after a bump, run
`npx vitest run package/extensions/list-toggle` first.

| Relies on | Where | Fails first |
| --- | --- | --- |
| `addCommands` merges later-wins, so ours replaces stock `toggleList` | §3.1 | `list-toggle-off` (lifted items keep spacing), `list-toggle-wrap` (refusals) |
| `run()` and `commands.x()` dispatch a `false` command unless it sets `preventDispatch` | §3.1 | `list-toggle-wrap` refusals ("document unchanged") |
| Reversed plugin order: v1 dBlock's keymap, then ours, then StarterKit's `ListKeymap` | §3.8, §3.10 | `list-toggle-backspace`, `list-toggle-enter` (real `keydown`) |
| `getSplittedAttributes` exported from `@tiptap/core` | §3.10 | `list-toggle-enter` (PR597-1) |
| Stock `splitListItem` exits a nested list with default item attrs; `liftListItem` uses `liftToOuterList` only for a matching outer item | §3.10, §6 | `list-toggle-enter` |
| Any step clears `storedMarks`, so the Enter split restores the typing style after `setNodeMarkup` | §3.10 | `list-toggle-enter` (PR597-2) |
| `Decoration.node` style lands on the `<li>` | §3.9 | `list-toggle-marker` editor-DOM suite |
| `@tiptap/y-tiptap`: a remote update or Yjs undo is one whole-document `ReplaceStep`; a node type change re-creates the subtree (TEC-3181). Anchors resolve through `y-prosemirror`, a separate dependency | §2, §3.9 | `list-toggle-marker` (collaborator, undo), `list-toggle-anchors` |

A newer Tiptap that fixes stock `toggleList`'s spacing or comment loss does not
make the override removable: it also unifies v1/v2 and the refusals (§2).
