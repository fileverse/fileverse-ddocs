# List toggling (TEC-3130 — stage 2 of TEC-3030)

Status: **implemented** in `package/extensions/list-toggle/` (2026-09-24);
the acceptance tests of §5 live in `list-toggle/*.test.ts`
(`list-toggle-wrap`, `-off`, `-retype`, `-anchors`); full suite 99 files,
1131 passed, 2 skipped. Design revised four times after four review rounds;
tags "(review N)", "(R2-N)", "(R3-N)" and "(R4-N)" name the finding that
shaped a rule — the review log itself is a process artefact and is not kept
in the repo. Covers the "List" rows of TEC-3030, split out as sub-issue TEC-3130: the
second-level nav and the toolbar toggle lists through two different engines
that disagree with each other and between schemas. Stage 1
(`FORMATTING_INHERITANCE.md`) is the caret-mark model this builds on; zoom is
stage 3.

## 1. What is broken today

Two engines toggle lists:

- **Stock Tiptap** `toggleBulletList` / `toggleOrderedList` /
  `toggleTaskList` (all three are `commands.toggleList(...)`): the
  second-level nav (`useEditorCommands` → `insertCommands`), the slash menu
  and the Mod-Shift-7/8/9 shortcuts.
- **Hand-rolled** `checkActiveListsAndDBlocks` + `convertToList` /
  `convertListToParagraphs` (`components/editor-bubble-menu/node-selector.tsx`,
  `components/editor-utils.tsx`): the toolbar (desktop and mobile) and the
  bubble-menu node selector, eleven copy-pasted call sites, no tests —
  toolbar (3), the mobile to-do tool (1), the heading dropdown's "Text"
  entry (1), the mobile text-formatting modal's `listStyles` (2) and the
  bubble menu (4).

Measured with a jsdom probe over 21 scenarios in both schemas:

| Scenario | stock v1 | stock v2 | toolbar v1 | toolbar v2 |
|---|---|---|---|---|
| caret in a paragraph | ok | ok | ok | ok |
| three paragraphs selected | no-op | ok | ok | ok |
| heading + paragraph selected | heading demoted, no list | ok | ok | ok |
| paragraph + heading + paragraph | no-op | heading absorbed into item 1 | ok | ok |
| caret in an item, same type (toggle off) | no-op | lifts that item | whole list → paragraphs | whole list → paragraphs |
| caret in an item, bullet → numbered | ok (whole list) | ok (whole list) | ok | **no-op** |
| two items selected, bullet → checklist | no-op | retypes those two, **attrs reset** | whole list | **no-op** |
| nested item → checklist | attrs reset, stays nested | **attrs reset, lifted to top level, outer list split** | whole list | no-op |
| two items selected, same type | **items merged** | lifts those two, **spacing kept on the first only** | whole list | whole list |
| range from a nested item into an outer item, toggle off | **outer item merged**, `false` | lifts both | whole list | whole list |
| range from a nested item into an outer item, bullet → numbered | nested list only | nested list only | ok | **no-op** |
| paragraph + hr + paragraph | no-op | hr absorbed into item 1 | **hr deleted** | **hr deleted** |
| bullet list + numbered list selected | no-op | merged | **first list deleted** | no-op |

Causes:

- `dBlock` content is `(block|columns)`: exactly one child. Lifting a middle
  item needs `list p list` as siblings and wrapping three blocks needs a list
  around three dBlocks; ProseMirror refuses both, and a Tiptap chain
  dispatches the steps that did succeed (`clearNodes`, the item merge).
- Stock's cross-item retype is `clearNodes` + `wrapInList`: `clearNodes`
  rebuilds paragraphs with default attrs (alignment, line height,
  `caretMarks` and the item's spacing are lost) and lifts the content out of
  every enclosing list, so a nested item ends up at the top level. Stock's
  retype and lift find the list at `$from` only, so a range that starts
  deeper than it ends acts on the wrong list. Stock's lift relies on the
  stage-1 list-exit plugin for spacing, which captures `$from`'s paragraph
  only.
- The hand-rolled path rebuilds the range from the paragraphs and headings it
  collected and replaces the whole range, so anything else in range is
  dropped; it keeps only the last list it saw; its v2 retype branch keys on a
  position that is never set once the traversal stops at a list; and it
  re-applies the pre-change `{from, to}` after restructuring, so the
  selection drifts ("TextSelection endpoint not pointing into a node with
  inline content").
- Any `ReplaceStep` whose old range covers a comment anchor marks that
  comment deleted (`analyzeCommentAnchorTransactionChanges`), whatever the new
  content holds. Rebuilding a list with `replaceWith` therefore strips every
  comment in it (R2-1); only structural steps keep them.

## 2. Scope

In: one engine, the same document shape from every trigger in both schemas,
for a selection whose blocks (at the depth where the change happens) contain
**no list or exactly one list**:

| Selection | Result (both schemas) |
|---|---|
| caret or range over paragraphs/headings, target type T | one list of T; each block becomes one item; headings become paragraphs keeping the attrs paragraph also has |
| caret or range whose covered items are in a list of type T, press T (toggle off) | only the covered items leave the list; the list splits around them; each body child of a lifted item becomes its own block at the list's level, in order — its paragraphs, a sub-list of any type with its attrs, any other block; the item's edge spacing lands on its first/last paragraph (§3.5). In a nested list whose outer item has the same item node: the covered items move to the outer list (stock). In a nested list of the *other* item node (bullets inside a checklist item, a checklist inside a bullet item): the covered items unwrap into the outer item's body as paragraphs, in order, each keeping its edge spacing (stock's shape, R4-1) |
| … press a type with the **same item node** (bullet ↔ numbered) | the whole list containing the selection is retyped |
| … press a type with a **different item node** (bullet/numbered ↔ checklist) | only the covered items are retyped, the list splits around them; the item's body is untouched (paragraph attrs, sub-lists, other blocks); edge spacing moves between the item and its first/last paragraph (§3.5); a nested list stays nested |
| selections inside a blockquote, callout, table cell or one column | the same, at that depth (R3-4) |
| after a wrap or a retype | the result joins a same-type list immediately before or after it (adjacency, both schemas) |
| comments and suggestions anchored inside the affected items | keep their anchors and highlights through every path and through undo; a known gap drops them after redo of a structural change (below) |

Parked ("mixed elements", to be designed separately): a range whose blocks
include a list **and** something else, or two lists; the double-tick active
indicator (`isActive` counts ancestors, so a numbered sub-list inside a
bullet list lights both); any block that is not a paragraph, heading or list
in a wrap range (hr, image, table, code block, blockquote, a whole columns
block). Also out: the clipboard "paste a list item" row and the "to-do list
→ checklist" label rename. A NodeSelection or AllSelection covering a whole
list also refuses: the trailing node makes it a mixed range for Cmd-A; a wrap
attempted under a v1 dBlock NodeSelection skips the adjacency join (§3.6).
"Text" on a heading that is a list item's body child toggles the item off
and leaves the heading in place (pre-existing behaviour; a UX question for
the mixed-elements follow-up).

Known lossy case, by design (R3-3): an item's own `spaceAfter` when its last
body child is not a paragraph (the item ends with a sub-list) has no home once
the item is lifted or becomes a `taskItem`, and is dropped.

Second known lossy case (§3.4): toggling off items that end a nested list
which is the outer `listItem`'s last child moves the last lifted paragraph's
`spaceAfter` onto the outer item via the ownership plugin, dropping it if the
outer item already carries one.

**Known gap (pre-existing, not fixed here):** anchors survive every engine
path and undo, but redo of a structural change drops anchors inside the
redone range (comment-decoration plugin's Yjs-origin rebuild) — stock
`toggleBlockquote()` shows the same loss; kept as a documented `it.skip` in
`list-toggle-anchors.test.ts`; needs its own ticket.

## 3. Design

### 3.1 One override, one engine, structural steps only

`package/extensions/list-toggle/`, whose override lives in its
`list-toggle.ts`, registered after the list extensions in
`default-extension.ts` (both schema branches), overrides `toggleList` the way
`caret-marks.ts` overrides `splitBlock`: Tiptap merges `addCommands` with
later-wins, the original is `commands.toggleList` from `@tiptap/core`. Every
trigger converges here by construction — the three `toggle*List` commands,
the shortcuts, the slash menu and, after §4, the toolbar and bubble menu.

The engine is the same code in both schemas and at every depth. The schema
enters in one place, "through the dBlock": wherever a container's children
are v1 `dBlock`s — the doc and a `column` (`content: 'dBlock+'`, R3-4) — the
row is read through them, splits and joins cut **two** levels (list and
dBlock) instead of one, and a block lifted out of a list gets a new dBlock
around it (§3.4). Nothing else knows about dBlocks.

Every change is a structural ProseMirror step — `tr.split`, `tr.join`,
`tr.wrap`, `tr.lift`, `tr.setNodeMarkup`, `tr.setBlockType`, and two
hand-built `ReplaceAroundStep`s (the item-node swap, §3.5, and the
dBlock-wrapping lift, §3.4) — so text positions map through the transaction:
the selection needs no re-placing, and comment and suggestion anchors
survive because no step's old range ever covers anchored text (R2-1).
`replaceWith` is not used anywhere. Every test asserts `doc.check()` on the
result (R3-1).

Stock is delegated to for exactly one operation, `liftListItem` for a toggle
off inside a nested list (§3.4). Without `dispatch` that command returns
`true` as soon as a list range exists — an eligibility shortcut, no
transform runs (R4 correction). That answer matches execution for the nested
cases that are delegated, because a lift that stays inside the outer item
never fails; the lift that does fail (a top-level item under a dBlock) is
never delegated. Stock's same-item retype, whose *result* differs with and
without `dispatch`, is not delegated to (§3.5, R2-4). The engine runs the
same logic whether or not `dispatch` is set:
`editor.can()` hands commands a throwaway transaction, so a capability check
builds exactly what execution would and its answer matches. Inside a chain,
`props.can()` reuses the shared transaction; the engine never calls it.

### 3.2 Classify, then act

Let `shared` be the innermost list that contains **both** `$from` and `$to`
(`$from.before(d) === $to.before(d)` walking down from the shallower depth),
null if none (review 1). Let `range = $from.blockRange($to)`.

1. `shared` is null → the **row** is `range.parent`'s children inside the
   range; when those children are dBlocks (the v1 doc or a v1 column, R3-4),
   each is looked through to its single block. Every row block is a
   paragraph or heading → **wrap** (§3.3); otherwise **refuse**.
2. `shared` exists. The **covered items** are its children from `$from`'s
   index to `$to`'s index at its depth; a range reaching into an item's
   sub-list covers the whole item. Then: the list is already the target type
   → **toggle off** (§3.4); the target has the same item node → **retype the
   list** (§3.5); otherwise → **retype the covered items** (§3.5). All three
   act on `shared` itself, never on the list nearest to `$from` (R2-3).

There is no delegation for "single containers": paragraphs inside a
blockquote, callout or table cell take rule 1 at that depth and are wrapped
in place; a list inside one takes rule 2. Probe-verified: `bq(p aa p bb)` →
`bq(ul(li aa li bb))`; toggle off in `bq(ul(li aa li bb))` → `bq(p aa
ul(li bb))`, both schemas.

Rule 1's refusal covers the parked bucket, identically in both schemas. This
replaces stock's nesting of the existing list under the first new item in v2
and the toolbar's silent no-op.

**Atomicity (review 1).** A refusal, a `findWrapping` that returns null and a
delegate that returned `false` all set `preventDispatch` on the transaction
and return `false`. Both `editor.commands.x()` and a chain's `run()` skip
`view.dispatch` when that meta is set, so the document never changes on a
`false` — including any earlier steps in the same chain (the slash menu's
`deleteRange` stays undone). Probe-verified in both schemas, via `commands`
and via a chain.

### 3.3 Wrap

For each row block **from last to first** (a wrap only touches positions at
or after its block's start, so earlier blocks' original positions stay
valid; mapping is ambiguous in v2, where both neighbours insert tokens at the
same boundary): a heading becomes a paragraph with `tr.setBlockType`'s attrs
callback keeping the attrs paragraph also defines (`textAlign`,
`lineHeight`, spacing, `caretMarks`); then `tr.wrap(blockRange,
findWrapping(blockRange, listType))`. Every block is now its own
`list(item)`. Then `tr.join(start + nodeSize, joinDepth)` at the first
block's unit start (its dBlock in the v1 doc row), once per remaining block:
each join folds the next list into the first. Finally §3.6.

Doing this ourselves rather than delegating is what makes a heading in the
middle of a range its own item: stock's `clearNodes` only runs when the
*first* block cannot be wrapped (§1).

Probe-verified: `D(p aa) D(h2 bb) D(p cc)` → `D(ul(li aa li bb li cc))`;
`p aa, h2 bb(center)` → `ul(li aa li bb(center))`; selection kept; three
comment anchors kept.

### 3.4 Toggle off

**Nested list** (`shared`'s parent is a list item): delegate to stock
`liftListItem(itemType)`, which has two branches keyed on the *outer item's*
node type (R4-1):

- Outer item of the **same** item node (bullets in a bullet item, a checklist
  in a checklist item): `liftToOuterList` — the covered items move to the
  outer list as items, the items after them re-nest under the last one. The
  item nodes move whole, so their attrs and spacing are untouched.
- Outer item of the **other** item node (bullets in a checklist item, a
  checklist in a bullet item): `liftOutOfList` — the covered items are
  unwrapped into the outer item's body: their paragraphs (and sub-lists)
  become body children of the outer item, in order, and the rest of the
  nested list stays after them. The item wrappers disappear, so before
  delegating the engine moves each covered item's edge spacing onto its
  first/last paragraph (§3.5 policy). Inside a `taskItem` the paragraph is
  the spacing owner anyway; inside a `listItem` the lifted paragraphs are
  usually interior children, whose gaps the ownership plugin leaves alone —
  except when the lifted list is the outer item's last child, where the last
  paragraph becomes the outer item's own last child and the ownership plugin
  moves its `spaceAfter` onto it, dropping it if the item already has one
  (second known lossy case, §2).

Both are structural steps and work in both schemas because the change stays
inside the outer item. Probe-verified: `tl(ti(p aa ul(li{2,7} bb li cc li
dd)))`, toggle off bb → `tl(ti(p aa p{2,7} bb ul(li cc li dd)))`, anchor on
bb kept; bb..cc with 2/7 and 0/3 → both paragraphs keep their gaps; `ul(li(p
aa tl(ti✓(p{5,6} bb) ti cc)))` → `ul(li(p aa p{5,6} bb tl(ti cc)))`;
`can()` and execution agree.

**Otherwise**, for each covered item **from last to first** (edits land at or
after the item's start, so earlier items keep their positions):

1. Move the item's edge spacing onto its first/last paragraph (§3.5 policy).
2. Lift every body child after the first, **last to first, as a whole
   node**, to the list's parent, right after the item: `liftOut(range,
   target, wrapper)`. This is ProseMirror's `lift` step
   (`ReplaceAroundStep` with copies of the split ancestors before and after
   the gap) with one addition: when the list's parent is a dBlock, the
   target is the dBlock's parent and the slice wraps the gap in a new dBlock
   — a dBlock is `group: 'dBlock'`, so it cannot be wrapped inside the item
   first and lifted afterwards. The lifted node keeps its type and attrs (an
   ordered sub-list keeps `start`, a checklist keeps `checked`), and the
   items after it are re-wrapped in their own copy of the list, so the
   boundary between the promoted sub-list and the untouched next sibling is
   preserved (R3-1). Works for a second paragraph or any other block as much
   as for a sub-list (R3-2). The item is now `item(p)`.
3. Isolate it with `isolateItem`: `tr.split` at its end when it still has a
   next sibling and at its start when it has a previous one (`splitDepth`: 2
   under a dBlock, else 1).
4. `tr.lift(paragraphRange, shared.depth − 1)`: the paragraph replaces that
   single-item list in the list's parent (the dBlock in v1). The range is
   resolved *inside* the paragraph — `blockRange()` at the item's content
   start would select the item.

Probe-verified against stock v2's shape in both schemas, `doc.check()`
valid: `ul(li aa li(bb ⤷ xx yy) li cc)`, caret in bb → `ul(li aa) p bb ul(li
xx li yy) ul(li cc)` (dBlock-wrapped in v1); with an `ol start=5` or a
checked `taskList` as the sub-list, that node comes out unchanged; the whole
list covered → `p aa p bb ul(li xx li yy) p cc`; a range from `xx` into `cc`
→ `ul(li aa) p bb ul(li xx li yy) p cc`; `li{2,7}(p bb p b2)` → `p{2} bb
p{7} b2`; `li(p bb ul(xx) p b2)` → `p bb ul(xx) p b2`; `spaceAfter` 11/22/0
→ 11/22/0; inside a column and a blockquote likewise; comment anchors on aa,
bb, cc and xx all kept. The stage-1 list-exit plugin is no longer on this
path; it still serves Shift-Tab and Backspace exits.

### 3.5 Retype

**Same item node** (bullet ↔ numbered): `tr.setNodeMarkup(shared.pos,
listType)` — the items are valid children of both list types — then §3.6.
Acting on `shared` fixes the range that starts in a nested item and ends in
an outer one: the outer list is retyped, as rule 2 says (R2-3). Probe-
verified in both schemas, anchors kept.

**Different item node** (↔ checklist), at any depth (R2-2): for each covered
item from last to first, isolate it with `isolateItem` as in §3.4 step 3
(splits only — the body is not lifted), then swap both wrappers in **one**
`ReplaceAroundStep`: from the list's start to its end,
gap = the item's content, slice = `listType(itemType(attrs))`, insert = 2,
structure = true. The item's body — paragraphs with their attrs, sub-lists —
is the gap and is not touched; a `setNodeMarkup` sequence cannot do this
because `taskList(listItem)` and `bulletList(taskItem)` are each invalid.
Then `tr.join` the single-item lists back into one, then §3.6.

**Edge spacing policy** (R2-5, R3-3), applied by the engine on toggle off
and on both retype directions, mirroring the ownership plugin's `takeEdge`
rule exactly: an item's `spaceBefore` belongs to its **first** child and its
`spaceAfter` to its **last** child, each only when that child is a
paragraph. Item → paragraphs (toggle off, into a `taskItem`): the item's
value is written onto that edge paragraph and **wins** over the paragraph's
own value there, as the plugin's collision rule says ("an attribute the item
already carries wins"); a value whose edge child is not a paragraph is
dropped (the known lossy case, §2). Paragraphs → item (into a `listItem`):
the edge paragraph's value moves onto the new item and is nulled on the
paragraph. A paragraph's gap that is *not* at an item edge — its `spaceAfter`
when a sub-list follows it — is internal spacing and is never touched, so
`li{after 7}(p{after 3} bb ul(xx))` → checklist keeps 3 on the paragraph
(7 has no home and is dropped) and → bullet gives `li(p{after 3} bb ul(xx))`
again. Zero is a value: `li{after 0}(p{after 5})` → `p{after 0}`.
`checked` starts `false`; `lineHeight` and `textAlign` are never moved.

Probe-verified in both schemas: `ul(li{spaceAfter 11}(p center 200%) li li)`,
range over the first two → `tl(ti(p center 200% spaceAfter 11) ti) ul(li)`,
anchors kept; a nested `xx(center 200%)` → checklist → `li(bb
tl(ti(xx center 200%)) ul(li yy))`, still nested, attrs kept; `li{3,7}(p bb
ul(xx yy))` → checklist → bullet → `li{3}(p bb ul(xx yy))` (7 dropped, as
defined); `li{2,7}(p{1,3} aa)` → checklist → `ti(p{2,7} aa)`; `ti(p{1,3}
aa)` → bullet → `li{1,3}(p aa)`; `li(p bb ul(xx) p b2)` → checklist keeps
the whole body; `checked` items → bullet → `ul(li) tl(ti)`.

### 3.6 Adjacency (review 5)

After a wrap or a retype, the list at the known depth around
`tr.selection.$from` (the created list for a wrap, `shared` for a retype) is
joined with a same-type list immediately after it and then immediately
before it — through the dBlock boundary in v1 (depth 2). The list is
located from the selection's ancestors at that depth, never from a mapped
position (a mapped position lands inside the new list after a wrap). Stock
does this in v2 for wrap and same-item retype; v1 never did, so `ul(a) p(b)
ul(c)` with bullet pressed in `b` becomes one list in both schemas, as does
`ol(a) ul(b) ol(c)` retyped to numbered. A toggle off never joins (stock
parity: `p bb ul(li xx) ul(li cc)` stays two lists).

### 3.7 Invariants

- The document never changes when the override returns `false`
  (`preventDispatch`).
- Every step is structural; no `ReplaceStep` ever covers anchored text.
  Comments and suggestions inside the affected items keep their anchors
  (through undo; redo is the known gap of §2).
- The output shape is identical in both schemas up to dBlock wrapping; one
  block per dBlock holds after every path.
- Paragraph attrs (`caretMarks`, `lineHeight`, `textAlign`, indent) survive
  every path; spacing follows the edge policy of §3.5; nodes are never
  rebuilt from JSON. Lifted body children keep their node type and attrs.
- The result passes `doc.check()` in both schemas.
- One transaction per toggle, so one undo step (Yjs UndoManager).
- Remote transactions never reach the override (it is a command).

## 4. Call sites

Twelve sites, across two files, now call the engine — eleven replacing the
hand-rolled functions, plus the desktop heading dropdown's (`TextHeading`)
"Text" entry, which never used them: it was a plain `toggleNode` no-op on
list items, not a conversion.

- `editor-utils.tsx` (8): the toolbar's three list tools (List, Ordered
  List, To-do List) and the mobile toolbar's To-do list tool call
  `editor.chain().focus().toggleBulletList().run()` etc. directly — the
  trailing `.setTextSelection({ from, to }).focus()` is gone, since the
  selection maps through the transaction. The desktop heading dropdown's
  (`TextHeading`) and the mobile text-formatting modal's
  (`TextFormatingPopup`) "Text" entries, plus the modal's two `listStyles`
  entries (Bullet List, Ordered List), round out the eight.
- `editor-bubble-menu/node-selector.tsx` (4): the Text, To-do List, Bullet
  List and Numbered List entries.
- The "Text" entries (bubble `NodeSelector`, the desktop heading dropdown
  `TextHeading` and the mobile modal `TextFormatingPopup`) convert a list
  to paragraphs: all three use the shared `listAtSelection(state)` helper
  (`extensions/list-toggle`) to find the list at the selection and call
  `toggleList(list.listType, list.itemType)` — the same type pressed again,
  so the engine takes the toggle-off branch (§3.4) and the covered items
  become paragraphs; in a nested list that lifts one level, as stock does.
  Outside a list they keep `toggleNode('paragraph', 'paragraph')`.
- `checkActiveListsAndDBlocks`, `convertToList`, `convertListToParagraphs`,
  `processListContent`, the `ListConversionProps` type and the
  `hasMultipleLists` early returns are deleted. `insertCommands` and
  `useEditorCommands` needed no change.

## 5. Tests

`package/extensions/list-toggle/list-toggle-{wrap,off,retype,anchors}.test.ts`,
built with `list-toggle/test-helpers.ts` (wraps `caret-marks/test-helpers.ts`'s
`makeEditor(version, html, { extensions })`, `pressKey`, `selectText`) plus
`CommentDecorationExtension` with `createCommentAnchorFromEditor` /
`triggerDecorationRebuild` as in `comment-decoration-plugin.test.ts`. One v1
and one v2 case per row, asserting `doc.check()`, document shape (an outline
string with the attrs that matter), the selection's text or caret offset
and, where anchors are placed, the decorated text per comment id. Undo tests
call `undoManager.stopCapturing()` after setup: the Yjs UndoManager groups
edits within its capture window into one step.

1. caret in a paragraph → bullet / numbered / checklist
2. range over paragraph + heading(center) + paragraph → one list, three
   items, heading attrs kept, selection text kept; same to checklist
3. toggle off: caret in the middle item with a same-type sub-list and an
   untouched next sibling → `ul(aa) p bb ul(xx yy) ul(cc)` (R3-1); the same
   with an `ol start=5` sub-list and with a checked `taskList` sub-list, node
   and attrs unchanged; range over the first two items; the whole list; the
   only item; the last item; range from a nested item into an outer item
   (review 1)
4. toggle off three items with `spaceAfter` 11/22/0 → 11/22/0 (review 4);
   `li{2,7}(p bb p b2)` → `p{2} bb p{7} b2` and `li(p bb ul(xx) p b2)` →
   `p bb ul(xx) p b2` (R3-2)
5. caret in a nested item, own type, same outer item node → lifted to the
   outer list with its attrs; range inside a nested list → the same; bullets
   inside a checklist item and a checklist inside a bullet item, one and two
   covered items with explicit spacing (including 0) → unwrapped into the
   outer item's body, gaps on the paragraphs (R4-1); `can()` agrees (R2-4)
6. retype bullet → numbered with a caret → whole list; from a nested item
   into an outer item → the outer list (R2-3); `can()` at the first item
   agrees with execution (R2-4)
7. retype bullet → checklist over two of three items with `textAlign`,
   `lineHeight`, `caretMarks` and item `spaceAfter` set → attrs on the
   paragraphs, spacing moved onto them; checklist → bullet with a caret →
   that item only, spacing moved onto the `listItem` (review 2)
8. retype an item with a sub-list to checklist → sub-list kept (review 3);
   a nested item to checklist and back → stays nested, attrs kept (R2-2);
   spacing (R2-5, R3-3): `li{after 7}(p{after 3} bb ul(xx))` → checklist →
   `ti(p{after 3} bb ul(xx))` → bullet → `li(p{after 3} …)`;
   `li{2,7}(p{1,3} aa)` → checklist → `p{2,7}` (item wins); `li{after
   0}(p{after 5} aa)` toggled off → `p{after 0}`; `ti(p{1,3} aa)` → bullet →
   `li{1,3}(p aa)`; `li(p bb ul(xx) p b2)` → checklist keeps the body
9. adjacency: wrap with a same-type list before, after, both; retype
   bullet → numbered between two numbered lists → one list; retype to
   checklist between numbered lists → no join; toggle off never joins
   (review 5)
10. anchors (R2-1): a comment on each item and one suggestion anchor; toggle
    off the middle item, toggle off the whole list with a sub-list, retype
    to checklist, retype to numbered, wrap three commented paragraphs →
    every decoration still covers its text; undo keeps them. Redo is a
    documented `it.skip` (the known gap, §2)
11. parked: paragraph + list range, two lists, hr in range, a range across a
    whole columns block → `false`, document unchanged, both schemas; the
    same through a chain that starts with `deleteRange` (the delete does not
    land)
12. containers: wrap two paragraphs inside a blockquote, inside a table cell
    and inside one column (R3-4, built with `setColumns(2)` + Enter, since
    the v1 column holds dBlocks); toggle off inside a blockquote and inside a
    column; toggle off an item with a sub-list inside a blockquote
13. `can().toggleBulletList()`: `true` on a multi-block range, `false` on a
    parked range, document unchanged (review 6)
14. Mod-Shift-8 keydown reaches the override (`ctrlKey` in jsdom)
15. undo after a wrap, a toggle off and a retype restores the previous
    document in one step

Existing suites to keep green: `use-editor-commands.test.tsx`,
`paragraph-spacing-carryover.test.ts`, `caret-marks/*.test.ts`,
`comment-decoration-plugin.test.ts`.

## 6. Measured facts the design rests on

- `toggleBulletList`/`toggleOrderedList`/`toggleTaskList` are
  `commands.toggleList(this.name, itemTypeName, ...)` in
  `@tiptap/extension-list`; an override of `toggleList` catches all three
  and the shortcuts.
- Tiptap's chain `run()` and `editor.commands.x()` dispatch the shared
  transaction even when a command returned `false`, unless the transaction
  carries `preventDispatch`.
- `editor.can()` builds its props on a fresh `state.tr`; `props.can()` inside
  a command reuses the shared one. Stock `toggleList`'s same-item retype
  branch runs only with `dispatch`, so its `can()` is `false` while the real
  call succeeds. `liftListItem` returns `true` without `dispatch` whenever a
  list range exists (no transform runs); with `dispatch` it takes
  `liftToOuterList` when the containing item's type equals `itemType` and
  `liftOutOfList` otherwise — the latter unwraps the items into the
  containing item and discards their item nodes (R4-1).
- `analyzeCommentAnchorTransactionChanges` marks an anchor deleted when a
  changed range's old span covers it; `ReplaceAroundStep`s (split, join,
  wrap, lift, setNodeMarkup) leave their gap out of the changed ranges.
- `tr.join(pos, 2)` between `D(ul(li))` neighbours yields `D(ul(li li))`;
  `tr.split(pos, 2)` at an item boundary yields two dBlocks; the flat
  equivalents use depth 1. A split inserts `2 × depth` tokens before the
  item.
- A split copies an ordered list's `start` to both halves: `ol{start=3}(aa bb
  cc)`, retype `bb` → `ol{3}(aa) tl(bb) ol{3}(cc)`, same as stock.
- After wrapping two adjacent flat blocks, their boundary position is
  ambiguous under `tr.mapping` (both wraps insert there); the dBlock token
  disambiguates it in v1 only.
- `tr.lift(range, target)` with an explicit target depth removes every
  wrapper between and re-wraps the content after the range in copies of the
  split ancestors; lifting a paragraph to the list's parent replaces the
  single-item list. `blockRange()` at the position *before* a paragraph's
  open token selects the paragraph's parent. Lifting a sub-list's *items*
  into the outer list drops the sub-list node (its type and `start`) and
  merges them with the following siblings; a `taskList`'s items cannot enter
  a `bulletList` at all (R3-1). Lift the sub-list node whole instead.
- `dBlock` is `group: 'dBlock'`: it cannot be a child of a list item, so a
  body child cannot be wrapped in a dBlock in place and then lifted; the
  dBlock is added inside the lift step's slice (§3.4). `column` content is
  `dBlock+` in v1 (R3-4).
- The ownership plugin's collision rule: when both the item and its edge
  paragraph carry a value, the item's is kept and the paragraph's is nulled.
- One `ReplaceAroundStep(from, to, gapFrom, gapTo, Slice(list(item())), 2,
  true)` swaps a single-item list's two wrappers; `tr.setNodeMarkup` cannot
  (`taskList(listItem)` is invalid at that step).
- `tr.setBlockType(from, to, type, attrs)` accepts a per-node attrs callback
  (prosemirror-transform 1.10.5).
- The stage-1 ownership plugin moves a paragraph's edge spacing onto its
  `listItem` only when that paragraph is the item's first/last child; the
  list-exit plugin captures only the paragraph at `$from`.
- The Yjs UndoManager groups edits within its capture window (500 ms) into
  one undo step; tests call `stopCapturing()` after setup.
- Tiptap's `keyboardShortcut()` command replays the captured steps through a
  mapping and mangles the engine's multi-step transactions (v1: three
  unjoined lists; v2: a `RangeError`). The real keymap path — a
  `KeyboardEvent` through `handleKeyDown` — works and is what the shortcut
  test (§5 test 14) uses.
