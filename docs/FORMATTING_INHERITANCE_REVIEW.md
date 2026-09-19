# Formatting inheritance spec review

## Ninth review — eight-times-revised spec, 2026-09-19

**Verdict: the eighth-pass fixes hold; make one remaining guard explicit.**
Reviewed the latest
[FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md), including capture of
the original block position and declaration after the left stamp. Line
references below refer to this revision. Earlier reviews remain historical.

### Status of eighth-pass findings

| Previous finding | Ninth-pass assessment |
| --- | --- |
| R8-1: the left stamp clears the declaration | Addressed in the command model. The completed root retains `storedMarksSet: true`, and the first typed character preserves pending bold before plain text and pending plain before bold text. |
| R8-2: the locator misses list-item wrappers | Addressed for the non-empty source split cases. Using the captured original opening locates and stamps the left paragraph in bullet, ordered and task lists. |

Both directions were exercised through the actual Enter key handler for
ordinary paragraphs, headings and all three list types: ten successful
cases, asserting the left stamp, completed-root declaration and the next
typed character's marks. These were minimal editor probes, not the complete
production editor or v1 handler.

### R9-1. [P2] Refresh the left stamp only when this split emptied the source block

**Spec:** Captured state and left-result condition, lines 227–253.

The prose describes Enter at the start of a non-empty source, but the
specified condition only tests whether `tr.doc.nodeAt(p)` is empty after
splitting. That also matches Enter from an already-empty paragraph. In
that case its existing stamp already represents explicit user formatting,
and writing the split-filtered style back onto it can remove formatting
from the original line.

**Probe:** Start with an empty paragraph explicitly stamped with a link,
with that link active as pending formatting. Press Enter. The new line
correctly receives an empty mark set because links do not cross splits.
However, step 3 also rewrites the original empty line's link stamp to
`'[]'`. Returning to the original line will now restore plain marks through
B, losing the link the user explicitly applied there. Filtering inheritance
for the destination should not clear the existing source line's stamp.

This was reproduced through the real Enter handler using the current
capture/delegate/stamp/declaration sequence. A control that additionally
requires the source block to have been non-empty preserves the original
link stamp while leaving the new line unlinked.

**Change needed:** Capture the source block's pre-split emptiness along with
its position/style. Require it to have been non-empty and the left result
to be empty before refreshing the left stamp (or equivalently verify that
this split emptied that source). Keep the final destination declaration
and its split filtering unchanged. State the guard explicitly in the steps
and mirror it in the v1 path.

**Acceptance tests:** Apply a link to an empty line, Enter, then return to
the original line and type: it retains the link, while the new line is
unlinked. Assert both stored stamps as well as typed marks. Retain the
offset-zero non-empty-source cases and ordinary Enter-twice formatting
checks.

### Evidence and limits for the ninth review

Used minimal jsdom/Tiptap overrides delegating to the installed core split
commands. The ten paragraph/heading/list probes above validated both
eighth-pass corrections. A separate Enter-key probe compared the specified
empty-result-only condition with a pre-split non-empty-source guard. The
former cleared the original link stamp; the latter preserved it; both
left the new caret unlinked. Nested empty-list command shapes were also
inspected; no separate actionable finding is recorded from that inspection.

No production CaretMarks implementation, full application suite, v1 browser
QA or collaboration suite was run. Only this review file was updated; the
spec and application source were left unchanged.

---

## Eighth review — seven-times-revised spec, 2026-09-19 (historical)

**Verdict: two details in the new left-half stamping rule need correction.**
Reviewed the revision of
[FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md) that adds direct
stamping to the split command. Line references below refer to this revision.
Earlier reviews remain as historical records.

### Status of seventh-pass finding

R7-1 is partly addressed. Through the real Enter key handler in a minimal
Tiptap editor, the three ordinary-paragraph examples now write the intended
stamp onto the empty left paragraph. A heading-at-start control also writes
the intended stamp onto the resulting left paragraph. The right-hand text
remains unchanged. However, the added write discards pending typing marks,
and the specified locator does not find a list item's left paragraph.

### R8-1. [P1] The left-half stamp clears the split declaration in the same transaction

**Spec:** Split-command steps 3 and 4, lines 236–250.

Step 3 calls `tr.setStoredMarks(style)`, then step 4 calls
`tr.setNodeMarkup(...)`. Adding that document step clears both
`tr.storedMarks` and `storedMarksSet`. This happens inside the root
transaction, before the plugin sees it, so the dispatch context never
captures the declaration. Rule C cannot recover marks that were discarded
before `state.apply` ran.

**Probe:** Put the caret at the start of plain `abc`, enable bold without a
selection, and split with the specified sequence. The empty left paragraph
correctly receives a bold stamp, but the resulting root has
`storedMarksSet: false`. Typing `x` at the new right-hand caret produces
plain `xabc`, losing the user's pending bold. That destination is non-empty,
so A1 and B cannot help either. Repeating the same probe with
`setStoredMarks(style)` after the left-half write produces bold `x` before
the unchanged plain `abc`.

The real-keydown probes also confirmed that all three R7-1 paragraph cases
and the heading control end with the declaration cleared under the current
step order, even when the visible text's marks happen to mask the loss.

**Change needed:** Make `setStoredMarks(style)` the final marks/selection
operation after every structural or attribute write in the split command.
Perform the left-half stamp before that final declaration, in the same
transaction. Apply the same ordering requirement to the v1 branch; do not
rely on append-loop restoration to recover an earlier value within a root.

**Acceptance tests:** At offset zero with pending formatting different from
the right-hand text, assert both the left paragraph's stamp and immediate
typing at the right-hand caret. Include plain pending style before bold
text as the inverse case, plus headings, both schemas and appended repairs.
Check `storedMarksSet` on the completed root as well as the final editor
state.

### R8-2. [P2] The left-half locator cannot cross list-item wrappers

**Spec:** Step 4's locator, lines 249–250; list-item offset-zero acceptance
case in section 6.

The text block left by `splitListItem` does not end at
`tr.selection.$from.before()`. The two paragraphs belong to separate list
items, whose closing and opening tokens sit between them. A test requiring
the previous text block's end to equal the new paragraph's opening finds
nothing, so the old stamp remains on the empty left paragraph.

**Probe:** At offset zero of the first item's plain `abc`, stamped `'[]'`,
set pending bold and run the overridden `splitListItem`. The installed
command produces an empty left paragraph spanning positions 2–4 and a
right paragraph opening at 6. No text block ends at 6. The specified
locator returns no target and the left paragraph keeps `'[]'` instead of
bold. This reproduced for bullet, ordered and task lists. Under Rule B,
returning to that empty item would restore plain formatting, so R7-1 still
applies there.

**Change needed:** Locate the actual left result of this split using its
structure or a position tracked within the transaction. Account for the
intervening list-item wrappers; do not require paragraph-token adjacency.
Keep the target tied to the split so a search cannot accidentally stamp an
unrelated preceding blank paragraph. The v1 path should likewise use its
known original block rather than assume adjacent paragraph boundaries
across dBlock wrappers.

**Acceptance tests:** Run the offset-zero cases through bullet, ordered and
task-list Enter paths. Assert the left paragraph's stamp and typed style
after returning to it, alongside unchanged right-hand text and preserved
pending marks there. Include the v1 wrapped-block path and a neighboring
unrelated empty block as a non-target control.

### Evidence and limits for the eighth review

Used minimal jsdom/Tiptap overrides delegating to the installed core
`splitBlock` and `splitListItem`, with the spec's capture/declaration/stamp
order. The actual `handleKeyDown` path confirmed the ordinary-paragraph
and heading left stamps. Direct command probes verified loss of the next
typed character's bold, a declaration-last control, and the locator's
failure for all three list types.

These probes modeled the proposed command changes; they did not implement
the production CaretMarks plugin. The append rules cannot rescue R8-1
because the completed root contains no stored-mark declaration and its
destination is non-empty. No full application suite or collaboration QA was
run. Only this review file was updated; the spec and application source
were left unchanged.

---

## Seventh review — six-times-revised spec, 2026-09-19 (historical)

**Verdict: one remaining split case needs an explicit rule.** The four
sixth-pass findings are addressed by the revised contract or an explicitly
documented limitation. This pass reviews the latest
[FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md); line references below
refer to that revision. Earlier reviews remain as historical records.

**Follow-up recheck, 2026-09-19:** Re-read the spec after the next update
request. The on-disk file still identifies itself as revised six times,
retains the copied-stamp assertion at lines 104–112, and limits A1/A3 to
the caret's block. R7-1 therefore remains open; no additional finding is
added for this recheck. Reviewed file SHA-256:
`5769b8eb173f1b279dfdcb82bf7d6aca4f95a10d33f7027ce88fe5c36736c14b`.

### Status of sixth-pass findings

| Previous finding | Seventh-pass assessment |
| --- | --- |
| R6-1: reading caret style after delegation loses marks | Addressed in the model. Pre-split capture preserved bold at the end of bold text and at the bold/plain boundary, including two appended attribute repairs. |
| R6-2: an empty declaration is lost | Addressed for the empty destination. `setStoredMarks([])` produced a persisted `'[]'` stamp and plain pending marks, including after leaving and re-entering. |
| R6-3: insertion at the opening falsely kills survival | Addressed in the model. The association-aware `deleted` test retained the original block across insertion at its opening; deleting its last plain character then produced `'[]'`. |
| R6-4: middle splits copy legacy font attrs | Resolved as an explicitly retained limitation, rather than a behavior change. The probe still finds 32px on both halves, matching the narrowed guarantee and new acceptance row. |

These results validate the specified mechanisms in isolated probes, not a
completed production CaretMarks implementation.

### R7-1. [P2] Enter at offset zero leaves an empty line with a stale or missing stamp

**Spec:** Copied-stamp justification, lines 104–112; split declaration and
universal empty-block claim, lines 222–246; A1/A3 and restoration,
lines 277–315.

The claim that the original paragraph's stamp is already the caret style
at offset zero is false. The design intentionally leaves that stamp alone
while the paragraph has text: the text can have been reformatted since the
stamp was written, or the user can have changed the pending style. An
existing paragraph can also have formatted text and no stamp at all.

Splitting at offset zero leaves an empty left paragraph and moves the caret
into the non-empty right paragraph. The declaration updates pending marks
at that right-hand caret. A1 cannot stamp the empty left paragraph because
it only acts on the caret's block, and A3 has the same destination constraint.
Returning to the left paragraph therefore restores its old stamp through B,
or falls back to unrelated preceding text if the stamp is null.

**Probes:** In the revised command/plugin model, split the document's first
paragraph at offset zero, then move the caret back to the empty first line:

| Original paragraph | Caret style before Enter | Empty left paragraph's stamp | Style restored on return |
| --- | --- | --- | --- |
| Plain `abc`, old bold stamp | plain | bold | bold |
| Bold `abc`, no stamp | bold | null | plain |
| Plain `abc`, `'[]'` stamp, pending bold | bold | `'[]'` | plain |

The first state arises naturally by formatting an empty line bold, typing,
and then clearing bold from the text. It does not require a legacy font
attribute or malformed content. This is distinct from the accepted
middle-split legacy-font limitation: the issue affects the new `caretMarks`
mechanism with ordinary bold/plain formatting.

**Change needed:** Define and persist the intended style of an empty result
left behind by a split, as well as the destination the caret enters. Do not
assume the copied old stamp represents that style. Keep this responsibility
within the declared split path, using its captured style and known result
positions, so loads and unrelated edits remain outside the write path. An
explicit plain result must persist `'[]'` rather than fall back to a neighbor.

**Acceptance tests:** Cover Enter at offset zero for a stale non-null stamp,
an unstamped formatted paragraph, and pending formatting that differs from
the stamp. Return to the empty left line and type; verify its persisted
style, the typed marks, and unchanged right-hand text. Include subsequent
neighbor formatting changes, both schemas and appended repairs. Keep the
existing end-of-block and non-empty middle-split controls.

### Evidence and limits for the seventh review

Ran a revised A1/A3/B/C model with the installed Tiptap command manager,
core split commands and ProseMirror transactions/mappings. Rechecked the
sixth-pass capture, explicit-empty-declaration and survival cases, including
two appended repairs for split preservation. Confirmed the documented
middle-split legacy-attribute behavior and reproduced all three offset-zero
cases above.

These were isolated jsdom/command-model checks. No production implementation,
full application suite or collaborative browser QA was run. Only this review
file was updated; the spec and application source were left unchanged.

---

## Sixth review — five-times-revised spec, 2026-09-18 (historical)

**Verdict: revise the split contract and survival rule before implementation.**
This pass reviews the declared-inheritance revision of
[FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md). Four actionable
findings follow. Line references in this section refer to the current
revision; earlier reviews are retained below as historical records.

### Status of fifth-pass findings

| Previous finding | Sixth-pass assessment |
| --- | --- |
| R5-1: creation classification confuses insertion boundaries | Removing inferred creation and A2 removes that mechanism. In the revised A1/B/C model, inserting beside an existing blank paragraph and selecting the survivor produces no stamp. The separate A3 survival predicate has an insertion-boundary error; see R6-3. |
| R5-2: sole-line callout insertion is mistaken for a load | The whole-document exclusion is removed. The declared-inheritance model stamps a bold callout paragraph both when it replaces the sole empty line and when another paragraph follows. Empty style declarations still need R6-2. |

### R6-1. [P1] Capture the caret style before delegating to `splitBlock`

**Spec:** Split-command override, lines 197–211, especially lines 203–204.

The specified sequence delegates to the original command and then evaluates
`caretStyle(state, oldBlock)`. Tiptap's command `state` is a chainable facade,
not an immutable snapshot. Reading its `tr` getter refreshes its selection,
document and stored-mark fields from the working transaction. Core
`splitBlock` does exactly that in its internal `ensureMarks(state, ...)`
after splitting.

Consequently, the wrapper's subsequent style read can see the new paragraph
with no marks, even though the original command just preserved bold in the
transaction. Calling `ensureMarks([])` then actively clears that bold.
Saving only `oldBlock` does not preserve the old selection or pending marks.

**Probe:** A minimal Tiptap override following the specified order leaves
`storedMarks: []` both after splitting at the end of bold `A` and between
bold `A` and plain `B`. Capturing the style before delegation instead leaves
`storedMarks: [bold]` in both cases. These probes used the installed original
command and Tiptap command manager. With A1, the erroneous explicit empty
mark set would also be persisted on an empty destination.

**Change needed:** Compute and retain the complete inherited mark set,
including legacy fill and split filtering, before calling the original
command. Apply the captured value after a successful split. Make this
ordering explicit for both overrides, as it already is for the callout's
pre-insert state.

**Acceptance tests:** Exercise the actual override through Tiptap's command
manager for bold-at-end, bold/plain mid-text, pending mid-word formatting,
and legacy fonts. Assert the first typed character and the empty destination
stamp, with the existing appended-repair cases retained.

### R6-2. [P1] `ensureMarks([])` cannot declare an intentionally plain new line

**Spec:** Split declarations and pristine no-op, lines 197–211; Rule B,
lines 265–270; equivalent declarations in sections 3.3 and 3.4.

An empty mark set is a real inherited style, but `ensureMarks([])` on a new
empty paragraph does nothing: the paragraph already has no marks. It leaves
`storedMarksSet` false and the transaction's stored marks null. A1 therefore
has no declaration to stamp. Rule B then restores the previous paragraph's
marks, contradicting the user's chosen plain style.

**Probe:** Start with bold `abc`, put the caret at its end, turn bold off
without changing the existing text, then split. Even with R6-1 corrected by
capturing the pre-split style, the root has `storedMarksSet: false`. In the
A1/B/C model, B restores `[bold]` from `abc`; the new line's stamp remains
null. Typing resumes in bold. A3 cannot help because this is a split into a
new block, not a deletion that empties the original block.

This also means a creator's declared empty style is indistinguishable from
a legacy, never-stamped line when the user returns later. The spec explicitly
routes both through B's fallback, so an adjacent paragraph can change the
new line's intended style.

**Change needed:** Preserve the declaration independently of mark equality,
including an empty array. An explicit stored-mark write or dedicated
declaration metadata can carry it; `ensureMarks` alone cannot. Define any
pristine-document skip separately so B cannot replace an intentionally plain
style with a neighbor's formatting. Apply the contract consistently to
splits, v1's hand-built blocks and callout insertion.

**Acceptance tests:** At the end of formatted text, clear the pending marks
and press Enter: type immediately, and leave/re-enter before typing in a
separate case. Both must stay plain with a persisted clear stamp. Also change
the preceding paragraph's formatting before returning to the new empty line.

### R6-3. [P2] A pure insertion at the opening position falsely kills block survival

**Spec:** Per-step survival tracking, lines 172–183; Rule A3,
lines 246–257.

For an insertion map `[p,0,n]`, the installed ProseMirror implementation
returns `deletedAfter: true` at `p`, even though the associated old token
survives at `p + n`. The association-aware `deleted` flag is false. The
specified `deletedAfter` test therefore declares the old block gone before
`map(p, 1)` can retain it. Merely passing `assoc = 1` does not fix that test.

**Probe:** Start with a bold-stamped paragraph containing one plain `x`.
In one root, insert an empty paragraph at position 0, immediately before
the caret block, then delete `x` from the shifted original paragraph and
call `ensureMarks([])`. The first map is `[0,0,2]`; its result at 0 is
`pos: 2`, `deletedAfter: true`, `deleted: false`. The specified tracker
marks the block dead. The original paragraph is still the empty destination,
but A3 is disabled, the root sets no stored marks, and the stale bold stamp
is left for B to restore.

**Change needed:** Use a deletion test that distinguishes removal of the
associated old opening token from a zero-width insertion at its boundary,
such as the association-aware `deleted` result, while retaining and checking
the attribute-replacement exception. Map surviving positions forward.

**Acceptance tests:** Insert a block directly at the old caret block's
opening, then delete its last plain character in the same transaction.
Assert survival, a final `'[]'` stamp and plain typing/re-entry. Retain the
actual-block-deletion, attribute-repair and lift cases as controls.

### R6-4. [P2] `keepOnSplit: false` does not prevent legacy attrs on middle splits

**Spec:** Split delegation, lines 197–208; legacy no-copy guarantee,
lines 303–305.

The installed `splitBlock` passes filtered paragraph attrs to `tr.split`
at the end of a block. For an ordinary middle split, it passes no replacement
type/attrs, so ProseMirror copies the original attrs. `splitListItem` likewise
omits replacement attrs for the inner paragraph in its middle-split path.
Setting `keepOnSplit: false` on the attributes does not affect those paths.

**Probe:** With `fontSize: '32px'` on a legacy paragraph and
`keepOnSplit: false` in the extension, splitting `AB` between the letters
leaves both resulting paragraphs with the 32px attr. The same occurs inside
a list item. The end-of-paragraph control gives the new paragraph a null
attr, as expected. The new right half is non-empty, so neither A1 nor A3
clears its copied legacy attr; pending marks from the wrapper do not change
that attr or mark the existing right-hand text.

Thus the claim that legacy paragraph CSS cannot propagate to new lines is
not established, and the old default-font reset defect can follow the copied
attr into a new paragraph.

**Change needed:** Specify middle-split handling rather than relying on the
flag. If the right half must lose the legacy attrs, preserve the visible font
of its existing unmarked text through marks before clearing them. If keeping
attrs on that existing text is intentional, narrow the no-copy guarantee
and document/test the retained limitation explicitly.

**Acceptance tests:** Split legacy-font text in the middle of a normal
paragraph and a list paragraph. Inspect both attrs and existing text marks,
verify unchanged visible formatting, and specify the result of resetting
the right-hand text to Default. Keep the end-split no-copy checks.

### Evidence and limits for the sixth review

Ran minimal jsdom/Tiptap probes using the installed command manager and core
split commands, including before/after style-capture controls and paragraph/
list attribute-copy checks. A separate A1/B/C model exercised declared
inheritance, the plain-style failure and the two fifth-pass examples. The
A3 survival failure was checked directly against real transaction steps and
their mappings. The A1/B/C model intentionally does not implement A3; its
split/callout/survivor scenarios do not qualify for A3.

These are specification and isolated-behavior checks. No production
CaretMarks implementation, full application suite or collaborative browser
QA was run. Only this review file was updated; the spec and application
source were left unchanged.

---

## Fifth review — four-times-revised spec, 2026-09-18 (historical)

**Verdict: two corrections still needed before implementation.** Reviewed the
latest [FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md), concentrating on
the revised provenance, block classification and deletion-range rules. Line
references in this section refer to that revision. Earlier reviews remain
below as historical records.

### Status of fourth-pass findings

| Previous finding | Fifth-pass assessment |
| --- | --- |
| R4-1: restoration can authorize A1 | Addressed in the rule model. Remote, load and maintenance roots each restored 32px marks across two appended repairs without a CaretMarks document write. |
| R4-2: a surviving block is treated as newly created | The original deletion example now passes. The new three-way classifier still fails at insertion boundaries; see R5-1. |
| R4-3: deleted marks use the wrong coordinate space | Addressed in the rule model. Inserting a prefix into an earlier paragraph, then deleting the last plain character of a bold-stamped paragraph in the same root, now produces `'[]'` and plain pending marks. |

These are results from isolated models of the specified rules, not passing
tests of a production CaretMarks extension, which has not been implemented.

### R5-1. [P1] The creation predicate inspects the wrong token and confuses boundary identity

**Spec:** Same/created/other classification, lines 167–180; Rule A2,
lines 224–239.

A node's opening token is **after** its opening position.
`MapResult.deletedBefore` describes the token before that position; it is
not evidence that this node was created. The installed ProseMirror mapping
implementation distinguishes these sides explicitly. A split happens to put
the new opening inside an inserted range, where both flags are true, hiding
the problem in split-only checks.

**Probes:** Start with a bold `abc` paragraph followed by an existing empty
paragraph. The first paragraph occupies positions 0–5. Insert a new empty
paragraph at position 5, producing the step map `[5,0,2]`:

| Destination | Inverse result | Spec classification | Correct classification |
| --- | --- | --- | --- |
| New paragraph, opening at 5 | position 5, `deletedBefore: false`, `deletedAfter: true` | other | created |
| Existing paragraph, now opening at 7 | position 5, `deletedBefore: true`, `deletedAfter: false` | created | other |

In the complete rule model, selecting the new paragraph leaves its stamp
null and relies on B's neighboring-text heuristic; selecting the survivor
instead causes A2 to stamp that existing paragraph bold. This breaks both
the persistence contract for newly inserted blocks and the no-stamping
contract for surviving blocks.

There is a second boundary ambiguity in the same classifier: insert a new
paragraph immediately **before** the original caret paragraph, then select
the new paragraph. Its opening maps onto the old caret block's opening, so
the first test calls it **same**, although it is a different, newly inserted
node. Changing only `deletedBefore` cannot fix that case.

**Change needed:** Establish node creation/survival from the structural steps,
including which opening token was inserted, rather than treating backward
position equality as sufficient identity. Preserve that evidence through
attribute repairs. Simply swapping to `deletedAfter` is also insufficient:
deleting the original caret paragraph and then running `setNodeMarkup` on
the surviving paragraph sets `deletedAfter` even though no paragraph was
created. The probe confirmed that case too.

**Acceptance tests:** Directly insert before and after a formatted paragraph;
insert between two existing paragraphs and select each possible destination;
delete the original paragraph and repair the survivor's attrs. Assert both
classification and final stamp, with and without appended repairs. Retain
the split and lift cases. A new line's style must remain stable after the
neighbor's formatting changes and the user returns to the empty line.

### R5-2. [P2] A normal callout insertion can be classified as a document load

**Spec:** Root `local` predicate, lines 134–140; A2 callout coverage,
lines 224–239; removal of the callout's existing font writes, lines 309–311.

Replacing the whole document's content is not sufficient evidence of a
load/import. Tiptap's `insertContentAt` deliberately replaces an empty
paragraph when inserting block content. If that paragraph is the document's
only block, an ordinary callout insertion replaces the entire content range.

**Probe:** In a minimal flat Tiptap editor, set bold on the sole empty
paragraph, then execute the callout-shaped `insertContent` that remains after
the spec removes its font attrs and trailing `setMark`. The installed command
produces map `[0,2,4]`: its old range 0–2 is the entire pre-step document.
It has `storedMarksSet: false` and no stored marks. The spec therefore sets
`local: false`, blocking every A rule. The new callout paragraph has no stamp
or legacy font attrs and no preceding text block for B to consult; C has no
pending value. The pending style is lost instead of inherited and persisted.

Running the same command with another paragraph after the empty one produces
the same replacement map, but the document size is 8, so `local` is true.
The inheritance decision thus depends on whether unrelated content exists
elsewhere in the document.

**Change needed:** Distinguish known loads/imports from ordinary user edits
using explicit transaction provenance or equivalent command-level evidence.
Keep the no-write guard for actual loads, remote updates and maintenance,
while allowing an insertion that replaces the sole empty block to inherit.

**Acceptance tests:** Format a fresh document's only empty paragraph, insert a
callout through the public insertion path, type, and leave/re-enter before
typing in a separate case. Assert both the inherited stamp and typed marks.
Repeat with a second paragraph present and retain the existing `setContent`
no-write tests. Cover v2 explicitly and the equivalent v1 insertion path.

### Evidence and limits for the fifth review

Executed an isolated A1–A3/B/C model using the installed ProseMirror state,
mapping and transaction implementations. Rechecked all three fourth-pass
examples and exercised the insertion-boundary failures. Separate direct
mapping probes checked insertion at the original block's opening and an
attribute repair on a surviving destination. A minimal jsdom/Tiptap editor
using the installed `insertContent` command and a callout-shaped container
confirmed the whole-document replacement case.

The callout probe establishes the command's transaction shape; the formatting
consequence follows from the specified rules. This was not a production
CaretMarks implementation, full application integration test, browser QA or
collaboration suite. Only this review file was updated; the spec and
application source were left unchanged.

---

## Fourth review — three-times-revised spec, 2026-09-18 (historical)

**Verdict: three changes still needed before implementation.** This pass
covers the dispatch-context design in
[FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md), including reverse
position mapping and root-time list-exit capture. Line references below are
for that revision. Earlier reviews remain below as historical records.

### Status of third-pass findings

| Previous finding | Fourth-pass assessment |
| --- | --- |
| R3-1: cache survives unrelated root operations | The root reset fixes the modeled link-only Enter and replacement-with-`'[]'` examples. Restored marks still need separate provenance; see R4-1. |
| R3-2: navigation writes a stamp | The document-change requirement fixes the modeled selection-only navigation case. Destination classification is still incomplete; see R4-2. |
| R3-3: list exit loses identity after repair | Root capture plus position mapping preserved 12pt/8pt spacing in both plugin orders in the model, including an ID/stamp attribute repair. |
| R3-4: checklist spacing read from taskItem | The revised v1 branch now explicitly reads the paragraph for task items, matching current ownership. |
| R3-5: deleted style confused with pending style | Capturing deleted marks fixes the modeled single-step plain-character deletion with pending bold. Multiple-step roots need the coordinate correction in R4-3. |

These results concern isolated rule models and the specified design, not a
completed production CaretMarks implementation.

### R4-1. [P1] Restoration can be mistaken for an explicit edit by A1

**Spec:** Dispatch context, lines 145–155; Rule A1, lines 188–202; no-write
guarantee, lines 253–257 and 370–375.

The context records `storedMarksSet` from every transaction, including the
plugin's own B/C restoration transactions. A1 then treats that cached value
as an explicit formatting action, without requiring an eligible local root
or checking which rule produced the marks.

Consequently, the claim that remote/load/maintenance roots cannot reach A1
because the binding never sets marks is insufficient: B sets them itself.
If another plugin appends a repair after B, the next CaretMarks call can
stamp the restored style even though `local` is false.

**Probe:** A remote-tagged root loaded an empty legacy 32px paragraph. With
an attribute-repair plugin after CaretMarks, the append sequence was:

1. B restores 32px pending marks without changing the document.
2. The other plugin repairs an attribute and clears stored marks.
3. A1 writes a new 32px `caretMarks` stamp and clears the legacy font attr,
   despite the dispatch context still having `local: false`.

The repair in this probe was simulated; the result demonstrates the missing
provenance distinction, not a full collaborative-editor reproduction.

**Change needed:** Separate evidence of explicit user formatting from marks
cached for restoration/preservation. Tag or otherwise identify B/C-generated
transactions so they cannot authorize A1, and enforce the appropriate root
eligibility on every document-writing path.

**Acceptance tests:** Put an appended attribute repair after B under remote,
load/replacement, and maintenance roots. Verify CaretMarks adds no document
write while still restoring the correct typing style. Retain both plugin
orders and multi-repair cases.

### R4-2. [P1] A different surviving block is not necessarily a new block

**Spec:** Same/new-block classification, lines 157–167; Rule A2,
lines 204–218.

Mapping the destination's opening position backward and comparing it with
the old caret block distinguishes that old block from other destinations.
It does not distinguish a newly created block from another pre-existing
block. The classification paragraph itself says that an existing block
reached after deletion maps elsewhere, but A2 interprets that same result
as evidence of creation.

**Probe:** Delete a bold paragraph immediately before an existing unstamped
blank paragraph. The remaining paragraph maps back to its original opening
position, which differs from the deleted caret block's opening position.
A2 therefore classifies it as new and stamps it bold. No paragraph was
created by this edit.

**Change needed:** Distinguish three cases: the surviving original caret
block, another surviving block, and a block actually created by the edit.
Require creation evidence for A2, using the root's steps and node survival
rather than inequality with one old position. Keep A3's same-block deletion
handling separate.

**Acceptance tests:** Delete a formatted block before an existing unstamped
blank paragraph, and delete a list before such a paragraph. Verify no
inheritance stamp is written onto the surviving paragraph. Include a genuine
insert/split at nearby boundaries so creation detection still works.

### R4-3. [P2] Deleted-mark capture mixes pre-step and pre-root coordinates

**Spec:** Dispatch context, lines 139–143.

Each step's old range is expressed in the document immediately before that
step. The spec compares those ranges against the pre-root caret content
range and resolves them against the pre-root document. After an earlier
step inserts or removes content, those coordinates no longer agree.

**Probe:** In one root transaction, insert a prefix into an earlier paragraph,
then delete the last plain character of a later bold-stamped paragraph.
The deletion's step coordinates have moved past the recorded old caret
range, so `deletedMarks` remains null. A3 is skipped and B restores the stale
bold stamp, even though the deleted character was plain.

**Change needed:** Inspect each deletion against its own pre-step document
(`tr.docs[stepIndex]`) and map the old caret range through preceding steps
before testing overlap. Map any retained positions into a defined common
coordinate space. Do not resolve raw later-step offsets in the pre-root doc.

**Acceptance tests:** Chain an earlier insertion or deletion with a
last-character deletion in the caret block. Verify the correct deleted range
is detected and the empty mark set survives typing and re-entry.

### Evidence and limits for the fourth review

Executed an isolated model of the revised dispatch context and A1–A3/B/C
using the installed ProseMirror state, mapping and transaction implementations.
Re-ran the prior stale-cache, replacement, navigation and conflicting-pending-
style deletion examples, then exercised the three failures above. A separate
root-capture model carried list spacing across repairs in both plugin orders
using the real `liftEmptyBlock` command.

No production implementation or full browser/collaboration suite was run.
Only this review file was updated; the spec and application source were left
unchanged.

---

## Third review — twice-revised spec, 2026-09-18 (historical)

**Verdict: revise before implementation.** This pass covers the revision with
Rules A1–A3/B/C, persistent plugin state for Rule C, and node-identity-based
list-exit detection. References below use this revision's line numbers in
[FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md). Earlier reviews and
their original line references are retained below as historical records.

### Status of second-pass findings

| Previous finding | Third-pass assessment |
| --- | --- |
| R2-1: legacy reset refilled from old block | The specified A1 fill now reads the post-command block, addressing that mechanism. |
| R2-2: deleting a plain character revives a stamp | A3 covers the simple case, but its use of pre-edit pending marks leaves the case in R3-5. |
| R2-3: pending marks lost across append-loop calls | Plugin state addresses visibility across calls, but its lifetime is too broad; see R3-1. |
| R2-4: split-excluded links restored | A2 now filters correctly, but C independently restores the cached link; see R3-1. |
| R2-5: deleting a list restyles an existing paragraph | The new predicate excludes that deletion case, but normal exit now depends on identity surviving earlier repairs; see R3-3. |
| Verification corrections | The revised Yjs rationale and mounted-DOM decoration checks address both corrections in the text. |

These are assessments of the specified design, not claims that the production
implementation or its acceptance tests pass.

### R3-1. [P1] Rule C carries cached intent across unrelated root transactions

**Spec:** Section 3.2, lines 201–218.

The new plugin state retains `pending` until a transaction explicitly sets
marks or selection. A fresh root transaction that clears stored marks through
steps alone retains the old cache. That includes `setContent` and a split
whose filtered mark set is empty: `ensureMarks([])` can still be a no-op.

**Observed in the revised-rule model:**

- Apply a pending link to an empty line, then Enter. The split has neither
  `storedMarksSet` nor `selectionSet`; A2 filters the link out and skips the
  pristine stamp, but C restores the old link. Subsequent typing is linked.
- Set pending bold, then replace the document with an empty paragraph whose
  saved stamp is `'[]'`. C restores bold ahead of B, despite the loaded block
  explicitly declaring plain formatting.

**Change needed:** Distinguish pending intent within the current dispatch
from a cache left by an earlier root operation. Invalidate or replace it on
content replacement and intentional split filtering, including an empty
result, while retaining it through genuine appended repairs. Account for
remote/undo roots explicitly as well.

**Acceptance tests:** Preserve the two plugin-order and multiple-repair tests;
also exercise link-only pending marks followed by Enter, and content replacement
with both `'[]'` and differently styled saved stamps. Verify actual typing
marks, not only that the loaded document JSON is unchanged.

### R3-2. [P1] A2 can stamp a paragraph on cursor movement alone

**Spec:** Section 3.2, lines 139–175, especially A2 at lines 164–175.

As written, A2 requires no `storedMarksSet`, an empty destination with a null
stamp, and a batch without remote/replacement transactions. It no longer
requires a document change or establishes that the destination was created
by the edit. An existing unstamped blank line satisfies all of these checks
when the user clicks into it.

**Probe:** Moving the cursor from bold text to an existing blank paragraph
produced an appended document write that stamped the blank paragraph bold.
This persists the previous cursor location's formatting on navigation,
instead of leaving restoration to B. A null stamp is not evidence of a newly
created block.

**Change needed:** Restore a document-change requirement and identify the
block created or emptied by the local editing operation. Navigation and
unrelated document maintenance must not qualify. Retain operation provenance
across append-loop slices so load/remote exclusions cannot disappear merely
because the root transaction has already been seen.

**Acceptance tests:** Click and arrow into existing unstamped blank lines from
differently formatted locations; inspect appended transactions and confirm
no stamp/document write. Repeat with unrelated maintenance elsewhere in the
document while the caret is on such a line.

### R3-3. [P1] Block-ID assignment breaks the v2 list-exit identity check

**Spec:** Section 3.5, lines 293–302.

The paragraph object survives the root `liftEmptyBlock` operation, as the
spec states. It does not necessarily survive until ParagraphSpacing's append
hook runs. A paragraph moving from a list to the top level needs a block ID;
BlockId assigns it with `setNodeMarkup`, replacing the paragraph object.

The repository registers BlockId after ParagraphSpacing, and Tiptap reverses
equal-priority extension order when collecting plugins. BlockId therefore
runs first in the existing configuration. The proposed same-object check
fails on the normal list-exit path.

**Probe:** A real ProseMirror `liftEmptyBlock` preserved the paragraph object
immediately after the lift. With ID repair before the proposed spacing rule,
the new paragraph retained null spacing. Reversing those plugins carried the
expected 12pt/8pt values.

**Change needed:** Capture the local lift and its target before subsequent
attribute repairs, then map the target through the remaining steps, or carry
spacing in the exit operation itself. Do not require object identity to
survive all other append hooks; a caret stamp can also replace the object.

**Acceptance tests:** Exercise real v2 list exit with the production plugin
order, a missing paragraph block ID, and formatting that triggers a caret
stamp. Verify both inherited spacing and the final caret location. Retain
the negative local/remote list-deletion tests.

### R3-4. [P2] The v1 checklist exit reads spacing from the wrong node

**Spec:** Section 3.4, lines 279–282.

The new v1 branch reads spacing from either `listItem` or `taskItem` and
assumes the inner paragraph owns none. That assumption is only true for
`listItem` in this repository. ParagraphSpacing registers attributes on
paragraph, heading and listItem, and skips a paragraph only when its parent
is a listItem. A taskItem has no spacing attributes; its paragraph owns them.

**Probe using the actual ParagraphSpacing extension:** Applying 12pt/8pt to
a checklist produced `taskItem.attrs = { checked: false }` and paragraph
attributes containing the two spacing values. The proposed item-only exit
lookup returned null for both values.

**Change needed:** Read the current spacing owner for each list type: the
listItem for bullets/numbering, and the paragraph for checklists under the
existing schema. Do not change task-item spacing ownership incidentally.

**Acceptance tests:** In v1, Enter-Enter out of a checklist with custom
spacing and with explicit zero spacing. Verify the created paragraph keeps
both values, alongside the bullet/ordered-list cases.

### R3-5. [P2] A3 reads pending formatting instead of the deleted text's marks

**Spec:** Section 3.2, lines 177–183.

`caretStyle(oldState, ...)` prioritizes `oldState.storedMarks`. Those are the
style chosen for future typing, which can differ from the character being
deleted. It therefore cannot stand in for the deleted text's marks.

**Probe:** On a bold-stamped line containing a plain `x`, set pending bold
without changing `x`, then delete it. The actual
`marksAcross(deletedRange)` is `[]`; `delete(...).ensureMarks([])` leaves
native ProseMirror's typing marks plain. A3's specified helper instead
returns the old pending bold. The simple deletion case from R2-2 is covered,
but this variant still restores bold.

**Change needed:** Resolve the style from the deleted range in the relevant
pre-step document, preserving an explicit empty mark set. Define legacy-font
fallback separately; do not substitute unrelated pending typing marks for
the deleted text's style.

**Acceptance test:** Repeat plain-last-character deletion with conflicting
pending bold, color and font choices. Check the resulting stamp, immediate
typing, and typing after leaving and re-entering the empty line.

### Evidence and limits for the third review

Read the twice-revised spec, actual spacing ownership and extension ordering,
and the installed ProseMirror transaction and append-loop implementations.
Executed isolated models of A1–A3/B/C with the specified plugin-state rules;
used the real `liftEmptyBlock`, `ensureMarks`, and `marksAcross` operations;
and ran the repository's ParagraphSpacing extension in a minimal Tiptap
editor to verify checklist ownership.

No CaretMarks production implementation or full browser/collaboration suite
was run. This review updates only this review file; the spec and application
source remain unchanged.

---

## Second review — revised spec, 2026-09-18 (historical)

**Verdict: revise before implementation.** This review covers the same-day
revision of [FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md), including
Rules A1/A2/B/C and the new collaboration section. References below use that
revision's line numbers. The original review is retained below as historical
context.

The revision addresses the original stale-CSS design by using decorations
only on empty blocks, preserves the existing inline-code split policy, adds
guards for ordinary content replacement, and correctly identifies Yjs as the
history implementation. Effective legacy-font lookup and Rule C also address
the right problems, but their specified behavior still has gaps.

### R2-1. [P1] Resetting an empty legacy line refills the font being cleared

**Spec:** Section 3.2, lines 123–145; section 3.3, lines 220–223.

The reset commands retain their `setNodeMarkup` call to clear the legacy font
attribute. That operation creates a different paragraph object. Rule A1 uses
that identity change to choose the *previous* block for legacy-font lookup,
so it reads the attribute from before the reset and restores the value the
command just cleared.

**Probe:** An empty paragraph with legacy `fontSize: '32px'`, followed by the
specified reset transaction, ended with a 32px stamp and 32px pending marks.
It did not return to the default size.

**Change needed:** Distinguish a structural move/split from an attribute edit
of the same block. For an explicit reset, use the post-command attributes or
an explicit reset signal; node identity cannot choose the fallback source.

**Acceptance test:** Reset family and size independently on empty legacy
paragraphs. Verify pending marks, stamp, and typed text use the default for
the reset property while preserving the other property.

### R2-2. [P1] Backspace can revive an old stamp after deleting plain text

**Spec:** Section 3.2, lines 148–165; section 6, lines 358–360.

The design assumes the DOM-change reader always sets `storedMarksSet` when
deleting the last character. It calls `ensureMarks`, which only sets that flag
when the requested marks differ from the current effective marks.

For a paragraph previously stamped bold but now containing a plain final
character, deleting that character and calling `ensureMarks([])` leaves
`storedMarksSet` false. A1 does not run, A2 refuses to overwrite the existing
stamp, and B restores bold. The user's plain formatting is lost.

**Probe:** `delete(...).ensureMarks([])` produced `storedMarksSet: false`; the
model then restored the old bold stamp. This also affects the proposed jsdom
test technique unless it includes the empty-mark case.

**Change needed:** Recognize an actual content-to-empty deletion and preserve
the deleted character's style, including an empty mark set. Do not use
`storedMarksSet` alone as evidence that the DOM deletion path ran.

**Acceptance test:** Stamp bold or a custom font, type, clear the character's
formatting, then Backspace the last character. Subsequent typing and re-entry
must remain plain/default. Retain the nonempty-mark deletion cases too.

### R2-3. [P2] Rule C still depends on plugin execution order

**Spec:** Section 3.2, lines 187–201.

ProseMirror passes an append hook only transactions it has not already seen.
If CaretMarks sees the root split before block-ID repair, the initial call
has the pending marks and needs no restoration. On its next call, only the
repair transaction is supplied; the root transaction with `storedMarksSet`
is no longer in the batch. Rule C therefore has nothing to restore.

**Probe:** Splitting bold `A` from plain `B` retained pending bold when the
caret plugin ran after the repair. With the caret plugin before the repair,
the same proposed rule left pending marks null.

**Change needed:** Retain the relevant pending marks across append-loop calls,
with explicit invalidation on selection changes and intentional mark changes,
or define and enforce a sufficient plugin-order contract. The current claim
that any later appended repair is handled is not established.

**Acceptance test:** Run the split/repair scenario in both plugin orders and
with a second appended repair. Verify the next typed character retains the
pending style without overwriting a later deliberate selection/style change.

### R2-4. [P2] A2 can restore a link that the split deliberately excluded

**Spec:** Section 3.2, lines 134–136 and 153–165; section 4, lines 324–326.

Moving split filtering into Tiptap does not cover A2's fallback. When a split
filters pending marks down to an empty array, `ensureMarks([])` can be a no-op
on the new empty paragraph. No transaction then has `storedMarksSet`, and A2
copies the unfiltered pre-split style back into the paragraph.

**Probe:** Enter with a pending link, followed by the split's empty filtered
mark set, left `storedMarksSet` false. A2 stamped and restored the link.

**Change needed:** Record or resolve the post-filter split style explicitly,
including an empty result. Apply split filtering to the structural inheritance
path without filtering ordinary formatting/restoration on the current line.

**Acceptance test:** Apply a pending link, press Enter, and type. The new text
must be unlinked, while applying a link on the current empty line must remain
possible.

### R2-5. [P1] The list-exit rule can restyle existing content after deletion

**Spec:** Section 3.5, lines 263–270.

The predicate detects any document change that moves the caret from a list
item to a paragraph outside a list. It does not establish that the operation
was a local list-exit gesture, and it has no remote-origin exclusion.

Deleting the selected list can move the caret into an already-existing plain
paragraph. The rule then copies the deleted item's spacing onto that
paragraph. The same can happen when a collaborator deletes the list, causing
a new local document write in response to the remote change.

**Probe:** A remote-tagged deletion of a selected list with 12pt/8pt spacing
caused an appended local transaction that assigned those values to the
existing following paragraph.

**Change needed:** Exclude remote/undo/load operations and identify the
paragraph produced or lifted by an actual local list-exit operation. Cursor
ancestry before and after a change is insufficient.

**Acceptance test:** Keep the intended bullet/ordered/task exit cases, and add
local deletion and remote deletion of a list before an existing paragraph.
The existing paragraph must remain unchanged, with no extra local history
entry for the remote case.

### Verification corrections

- **Section 3.6, lines 289–292:** The installed y-tiptap binding's view update
  does not simply skip all dispatches without document changes. It can call
  `_prosemirrorChanged` on such updates; actual Yjs changes depend on whether
  reconciliation finds a difference. The existing `UndoSelection` code
  documents the empty-fragment exception. Keep the collaboration-backed tests
  and correct this rationale rather than treating mark-only transactions as
  an unconditional no-write guarantee.
- **Section 6, line 357:** `editor.getHTML()` serializes the document schema;
  it does not include view decorations. With the revised presentation model,
  that assertion cannot catch a stale font decoration left on a nonempty
  paragraph. Inspect the mounted editor DOM and decoration state as the block
  gains/loses text, and retain serialization checks separately.

### Evidence and limits for the second review

Read the revised spec and relevant installed ProseMirror/Tiptap/y-tiptap
sources. Executed isolated ProseMirror models of the revised rules, including
both append-plugin orders and the actual `ensureMarks` behavior. The five
examples above are observed failures of those models, not results from a
completed CaretMarks implementation or a full browser/collaboration suite.
The proposed acceptance tests remain to be implemented. Application source
and the spec were not modified during this review.

---

## First review — original draft (historical)

Reviewed: 2026-09-18.

Ticket: [TEC-3030 — Editor Improvements v2](https://linear.app/fileverse/issue/TEC-3030/editor-improvements-v2).

Spec: [FORMATTING_INHERITANCE.md](FORMATTING_INHERITANCE.md), design dated
2026-09-18.

## Objective and scope

TEC-3030 calls for consistent editor behavior across the navigation menu,
editor toolbar, and bubble menu. Formatting inheritance and persistence are
central: new text should retain the user's chosen style, including after an
explicit formatting change. The ticket also covers lists, zoom, missing
controls, import/export checks, clipboard behavior, and toolbar UX.

The ticket's comments explicitly prioritize **“Inheritance > List > Zoom.”**
The spec therefore matches the intended first stage. Deferring list-state
issues, zoom, and toolbar availability is consistent with that ordering;
completing this spec would not complete the entire ticket.

The proposed shared extension and persistent empty-paragraph style are a
reasonable direction, but the following five findings should be resolved
before implementation.

## Findings

### 1. [P1] Loading content can overwrite saved formatting

**Spec:** Section 3.2, Rule A, especially the pristine-case exception
(lines 138–140 in the reviewed version).

Rule A treats a different paragraph node object after a document change as
eligible for stamping. That includes content replacement through `setContent`.
The pristine-case exception protects only an empty style with a `null`
attribute, so it does not protect an already-stamped paragraph or a replacement
made while the previous editor state has pending formatting.

An isolated model of the proposed rules produced both failures:

- Loading an empty paragraph with a saved 32px `caretMarks` value into a plain
  editor replaced that value with `'[]'`.
- Setting a pending 32px style, then replacing the document with an empty plain
  paragraph, stamped 32px into the replacement.

This contradicts the guarantee that opening or setting content writes no
stamps and preserves authored formatting. The remote-origin guard does not
protect local `setContent` transactions.

**Recommended change:** Explicitly distinguish content loading/replacement
from user editing. Preserve incoming attributes and avoid importing the old
selection's style into replacement content. Node identity and the pristine
exception are insufficient on their own.

**Required tests:** Load stamped empty paragraphs, replace content while a
style is pending, and load unstamped content. Verify the incoming document is
unchanged by the inheritance extension, including through the headless path.

### 2. [P1] Legacy paragraph fonts stop carrying across Enter

**Spec:** Section 3.3, frozen legacy attributes (lines 173–180), and Rule A's
style resolution in section 3.2.

The spec correctly notes that existing nonempty paragraphs may obtain their
font entirely from paragraph attributes, with no corresponding text marks.
However, Rule A reads only `storedMarks` or the marks at the old selection,
while the proposed split stops copying those legacy attributes.

For a paragraph with `fontSize: '32px'` and unmarked text, Enter at the end
therefore creates a paragraph with neither the font attribute nor a font mark.
The previous-block fallback also reads marks, so it does not recover the font.
The isolated probe produced an empty next-mark set and a null font attribute.

**Recommended change:** Resolve the effective caret font from legacy paragraph
attributes when the text marks do not supply it. Explicit user formatting,
including a deliberate reset, must still take precedence. This can be a read
fallback without migrating existing documents.

**Required tests:** Enter at the end of nonempty legacy paragraphs whose font
family, size, or both exist only on the paragraph. Verify newly typed text
receives the effective font as marks, and verify explicit overrides and resets.

### 3. [P1] Paragraph font CSS recreates stale formatting

**Spec:** Section 3.1, `caretMarks` rendering (lines 94–97).

The proposed attribute renders font CSS on the paragraph even after it has
text. Rule A only refreshes empty paragraphs. Consequently, formatting stored
when the paragraph was empty remains a CSS default for its later content.

For example: stamp an empty paragraph with 32px, type `abc`, select the text,
and remove its font marks. The probe still serialized:

```html
<p style="font-size: 32px;">abc</p>
```

The assertion that text marks override paragraph CSS only holds while those
marks specify an override. Removing a font mark makes the text inherit the
stale paragraph style. The same issue applies to choosing the Default font,
whose existing command calls `unsetFontFamily`.

**Recommended change:** Restrict the new caret-font presentation to empty
paragraphs, or define an explicit reset model that prevents stale paragraph
CSS from styling unmarked text. Preserve the rendering of legacy paragraphs
that still depend on their existing attributes.

**Required tests:** Set a font on an empty line, type, then reset all or part
of the text to the default font. Verify both the marks and rendered output;
checking the document's marks alone will miss this failure.

### 4. [P2] Mid-paragraph Enter does not preserve the pending caret style

**Spec:** Section 3.2's empty-block guards and section 3.4's statement that
mid-text splits need no additional handling (lines 200–204).

Keeping the right-hand text's marks is distinct from keeping the formatting
that the next typed character should receive.

Consider bold `A` followed by plain `B`, with the caret between them. The
pre-split caret marks include bold. After Enter, the right-hand paragraph
contains `B`; block-ID repair clears the pending marks, and the empty-block
guards prevent either proposed rule from restoring them. Typing `x` then
produces plain `xB`.

This was reproduced with Tiptap's real keydown path and an appended repair
that replaces duplicated block IDs, matching the relevant v2 behavior.

**Recommended change:** Preserve pending typing marks across structural edits
and appended repairs even when the destination paragraph is nonempty. Keep
the existing right-hand text's formatting unchanged.

**Required tests:** Split at mixed-format boundaries and with an explicitly
selected pending style in the middle of a paragraph. Verify the first newly
typed character and the unchanged right-hand text. Cover both schemas where
their Enter paths support the corresponding operation.

### 5. [P2] Split filtering cancels explicit formatting on empty lines

**Spec:** Section 3.2, Rule A's unconditional `splittableMarks` filtering
(line 136), together with the inline-code policy in section 4.

Rule A handles both explicit formatting on an empty line and inheritance
after Enter, but applies the split filter to both. With the proposed
`code.keepOnSplit: false`, toggling inline code on an empty paragraph triggers
Rule A, filters out the code mark, and writes an empty stored-mark set.

The probe confirmed that inline code became inactive immediately, before
Enter or typing. This is an unintended change to an existing formatting
action; inline code is marked TBD in the ticket.

**Recommended change:** Separate same-paragraph formatting and restoration
from inheritance across a split. A mark that should not cross Enter can still
be valid formatting for the current empty paragraph.

**Required tests:** Enable inline code on an empty line and type; it must
remain code. Separately test the intended behavior across Enter. Review the
same distinction for other marks excluded from `splittableMarks`, such as
links.

## Additional correction: undo and redo

Section 3.2 (lines 145–147) bases its undo guarantee on
`prosemirror-history`. This repository disables StarterKit's undo/redo and
uses Collaboration's Yjs UndoManager instead. See
[`default-extension.ts`](../package/extensions/default-extension.ts) and
[`undo-selection.ts`](../package/extensions/undo-selection.ts).

The stated user-facing guarantee may be achievable, but the cited mechanism
does not establish it for this editor. Rewrite the rationale around the
actual collaboration path and verify:

- Enter plus its stamp is undone and redone together.
- Formatting or clearing an empty line restores the expected attribute and
  typing style through undo/redo.
- Redo survives an undo that empties the document.
- Remote changes and mark restoration do not create unintended local history
  entries or erase redo.

## Review evidence and limits

The review used the ticket description and comments, the repository spec and
implementation paths, and the installed Tiptap/ProseMirror sources. Isolated
executable probes exercised a model of the proposed rules and the relevant
split/repair behavior.

These findings concern the design as written. The proposed `CaretMarks`
extension has not been implemented or tested in the full editor, and the
probes do not establish end-to-end behavior for both schemas or collaboration.
The required tests above are implementation acceptance criteria, not passing
tests reported by this review. The original spec and application source were
left unchanged.
