# Design Specification: DOCX Run Formatting & Matching Robustness (TEC-2840 Phase 2)

**Date:** 2026-09-01
**Status:** Approved
**Ticket:** [TEC-2840](https://linear.app/fileverse/issue/TEC-2840/docx-and-doc-import-parity-with-gdocs)
**Amends:** `docs/superpowers/specs/2026-08-31-docx-import-parity-design.md` (Phase 2 section)
**Related:** [TEC-2900](https://linear.app/fileverse/issue/TEC-2900/double-spacing-issue-when-importing-docx-files) (partially addressed)

---

## 1. Problem

Phase 2 run formatting (colour, font size, font family) was implemented but is
**0% effective on real Google Docs exports**. `applyDocxSpacingToHtml` guards the
positional zip with two all-or-nothing gates; when either fails the HTML is
returned byte-identical and every presentation attribute is lost document-wide.

Measured against two real exports:

| | blocks | `w:p` | gates | font-family / font-size / colour spans |
|---|---|---|---|---|
| A — `gdocs manual formatting testing(3).docx` | 13 | 13 | pass | 16 / 5 / 4 |
| B — `gdocs formatting-test(2).docx` | 71 | 67 | **fail** | 0 / 0 / 0 |

41 unit tests pass while the feature does nothing on File B. All are synthetic;
none exercise a real export.

### 1.1 Confirmed causes of the bail

1. **Footnotes.** Mammoth appends `<ol><li id="footnote-0"><p>…</p></li></ol>`.
   Both the `li` and its nested `p` match `BLOCK_SELECTOR`, so each footnote adds
   two blocks. Their paragraphs live in `word/footnotes.xml`, which
   `readDocxSpacing` never reads. File B: 71 blocks vs 67 `w:p`.
2. **Nested lists.** `BLOCK_SELECTOR` matches both `li`s of
   `<ul><li>lvl0<ul><li>lvl1</li></ul></li></ul>`; the outer `li`'s `textContent`
   is `"lvl0lvl1"` against an OOXML paragraph of `"lvl0"`. File B has 4
   `ilvl>0` paragraphs. Pre-existing, independent of footnotes.
3. **Footnote reference markers.** Mammoth injects
   `<sup><a href="#footnote-0" id="footnote-ref-0">[1]</a></sup>` into the
   referencing paragraph. `runText` reading `document.xml` does not.
4. **`w:br` — a regression introduced by the Phase 2 work.** The previous
   `paragraphText` joined `w:t` nodes; the new one routes through `runText`,
   which emits `'\n'` for `w:br`. Mammoth emits `<br />`, contributing no text.
   Any document containing a Shift+Enter now loses everything. Latent on files
   A and B (both have zero `w:br`).
5. **`w:noBreakHyphen`.** `runText` emits ASCII `-`; mammoth emits U+2011.
   Same length, different string — pre-existing bail.

### 1.2 Additional defects found

6. **Dark-mode invisibility, introduced by this feature.** File B carries
   `#000000` ×8 and `#ffffff` ×3 as *direct* run formatting. Both normalisation
   passes (`use-tab-editor.tsx:1344`, keyed on `initialContent`; and
   `useDarkModeStyleCleanup` at `:1943`, additionally latched by a `cleanupDone`
   ref) run only at document load. A docx import dispatches into an already-open
   editor and triggers neither. Before this feature no colours were imported, so
   nothing was invisible — shipping as-is introduces the bug.
7. **`docDefaults.run` is dead code.** `readStyles` parses `w:rPrDefault/w:rPr`
   into `docDefaults.run`; `resolveRunProperties` never reads it.
8. **`pt` conflicts with the toolbar.** `FontSize` stores the value verbatim, but
   the stepper does `parseInt(attrs.fontSize || '16')` and writes back
   `` `${nextSize}px` `` (`font-size/font-size.ts:128-134`). Imported `16pt`
   nudged one step becomes `17px` — a jump from ~21px down to 17px.
9. **TEC-2900 double spacing.** `toPt` returns `null` when nothing in the
   resolution chain sets `w:before`/`w:after`, and nothing is stamped, so ddoc's
   default 1.5rem applies on top of the author's blank-line spacing. In OOXML,
   absent spacing means **zero**, not "unspecified". File A: 6 of 13 paragraphs
   resolve to null; File B: 58 of 67.

---

## 2. Guiding principle

> **Honour what the author chose; drop what the tool defaulted.**
>
> Corollary: bake in only formatting the user can see and undo in ddoc's own UI.

Defects 7 and 9 are this principle pointing in opposite directions — over-applying
the source application's defaults to runs, and under-applying genuinely-resolved
zeros to spacing.

---

## 3. Decisions

### 3.1 Formatting layers (D-1)

OOXML resolves a run's appearance through four layers, later winning:

| layer | source | File A (35 text runs) | File B (83 text runs) |
|---|---|---|---|
| L1 docDefaults | `w:rPrDefault/w:rPr` | all 35 (Arial 11pt) | all 83 (Calibri 11pt) |
| L2 paragraph style | style's `w:rPr` | 1 run (H1 @ 20pt) | 18 runs (Calibri, `#2e74b5`, sized) |
| L3 character style | via `w:rStyle` | **0 runs** | **0 runs** |
| L4 direct | run's own `w:rPr` | 16 font / 5 size / 4 colour | 12 font / 12 size / 18 colour |

**Decision: bake in L3 + L4 only.**

L1 and L2 are the source application's factory look — Arial 11pt is Google Docs
stock, Calibri 11pt and `#2e74b5` are Word stock. Nobody chose them. L3 and L4
are things a person deliberately applied to a selection, and they map onto ddoc's
font dropdown, size stepper, and colour picker, so the user can see, change, and
clear them. L2 has no such control: heading identity comes from the block type
and `editor.css:903-911` owns it (`h1 { font-size: 32px }`). Baking L2 in makes an
imported H1 render at 27px inside an `<h1>` that ddoc styles at 32px, with no
toolbar control that explains the difference.

Corroborating: TEC-2840 already lists **Headings ✅ Works**. Everything on its ❌
list (Underline, Text Colour, Highlight, Font Style, Font Size, Alignment) is
applied to a selection — L3 and L4 exactly.

`Normal` carries no `w:rPr` in either file, so L2 affects headings only, not body
text.

**Accepted risk:** File B's body is Calibri purely via L1, so it imports in ddoc's
default font. If QA rejects this, the fix is a document-level default font, **not**
L1 spans on all 83 runs. ddoc has no document-level font concept today
(`fontFamily` exists only as a `textStyle` mark), so that would be new work.

### 3.2 Matching architecture (D-2)

**Decision: harden the positional zip in place.**

The rejected alternative was to synthesise a character style per distinct
(colour, size, family) triple into `styles.xml`, stamp `w:rStyle` on each run,
re-zip, and let mammoth emit the spans via `r[style-name='…'] => span.ddoc-run-N`.
Structurally correct and gets footnotes free, but forces a full JSZip
re-generate on every import — unacceptable on the 10MB+ files that already
display a "this may take a while" loader — and cannot reuse an existing
`w:rStyle` without `basedOn` gymnastics.

Three normalisations, then per-block degradation:

1. **Own text.** Compare a block's own text, excluding text inside nested
   block-level descendants. Fixes nested lists *and* the footnote `li > p`
   double-count in one change.
2. **Exclude footnote artifacts.** Drop `li[id^="footnote-"]`,
   `li[id^="endnote-"]`, and any block inside them from the block list.
3. **Skip reference markers.** Exclude `a[href^="#footnote-"]` /
   `a[href^="#endnote-"]` text when computing own text. A document's genuine
   `<sup>2</sup>` must survive, so the selector keys on the anchor, not on `sup`.

Then: replace the two global bails with a per-block text check that skips one
block instead of abandoning the document, plus a dev-only warn counting skips.

**Validated:** simulating this against both files yields 13/13 and 67/67 blocks
matched, **zero mismatches**.

**Resync (added 2026-09-02).** Per-block degradation bounds the damage only when
a mismatch is *content-local*. For a **count skew** — a block inserted or dropped
relative to the OOXML — positional pairing shifts every later block and the
document still loses everything downstream. Measured: one stray block at the
*start* cost all 3 of 3 blocks their formatting, while the same stray at the end
cost none. Both original real-world causes were count skews.

Blocks are therefore paired by text with a `RESYNC_LOOKAHEAD` of 3 rather than by
index. The window is deliberately small so a coincidental text match cannot pull
the pairing far out of order. The earlier deferral ("only if the skip counter
fires on a real file") was unsound: that counter is a `console.warn` in a
browser, so the trigger would never have been observed.

**Text boxes.** `w:txbxContent` paragraphs are excluded, and a paragraph's runs
are collected by pruning nested `w:p`/`w:txbxContent` subtrees rather than by a
descendant-blind search. This mirrors `ownTextNodes` on the DOM side; the
symmetry of those two halves is what the whole design rests on.

### 3.3 Footnote bodies (D-3)

**Decision: exclude, do not parse `footnotes.xml`.** Footnote text imports
unstyled. Footnotes are already visually distinct chrome; parsing them roughly
doubles the paragraph-mapping surface for the least-visible content.

### 3.4 Font size unit (D-4)

**Decision: emit px.** `w:sz` is half-points: `px = round(w:sz / 2 × 96 / 72)`, so
`w:sz="32"` → `21px`. Keeps imported text behaving identically to typed text in
the size stepper and dropdown. Sub-pixel fidelity loss against a visible glitch
the first time anyone touches the control.

### 3.5 Colour safety (D-5)

**Decision: drop black/white shades at emit time**, reusing
`isBlackOrWhiteShade` from `package/utils/color-utils.ts`. Everything else passes
through as literal hex.

This mirrors what the existing load-time cleanup already does — `setColor('')`
across the board, then re-apply only where `!isBlackOrWhiteShade(color)` — but at
emit time, where no theme access is needed (`applyDocxSpacingToHtml` is a pure
string transform with no React context). Fidelity cost is near zero: dropped
black means ddoc's default body colour, which *is* black in light mode and
legible in dark.

Rejected: threading theme through `readDocxSpacingFromArchive` (plumbing for no
gain); re-arming the load-time passes after import (re-runs a whole-document pass
mid-session and would stomp colours the user set by hand earlier).

`isBlackOrWhiteShade` is asymmetric: it matches **hex** against an exact list —
black `#000000 #434343 #666666 #999999`, white `#ffffff #f3f3f3 #efefef #d9d9d9
#cccccc #b7b7b7` — but **range-checks `rgb()`** (`r < 30 || r > 240 || 60..180`,
equal channels only). Neither form alone is complete: the list misses `#555555`,
and the range misses `#efefef`, `#d9d9d9`, `#cccccc`, `#b7b7b7`.

Testing **both** forms is still not a cover: their union leaves the bands 30-59
and 181-240 open, and never inspects a near-grey with unequal channels. A branch
review on 2026-09-02 showed `#333333`, `#262626` (Word's "Black, Text 1, Lighter
15%"), `#eeeeee` and `#bfbfbf` ("White, Background 1, Darker 25%") all importing
verbatim — each one click away in Word's picker.

`isThemeUnsafe` therefore tests **chroma**, not a shade list: any colour whose
channel spread is `<= NEAR_GREY_CHROMA` (16) is dropped. A grey is never a colour
the author chose in a way ddoc must honour, and a computed test removes the whole
class rather than two more entries.
QA on 2026-09-02 confirmed the narrower check was a real gap: File B's `#555555`
was importing as hard dark grey. Chromatic choices are untouched — File B now
emits only `#cc0000`, `#188038`, `#1a73e8`, `#0563c1`.

Deliberately no theme dependency anywhere in the import path: dropped colour
falls through to ddoc's theme-responsive CSS, which is the thing that actually
knows the theme.

**Out of scope, flagged:** the load-time-only normalisation passes remain
load-time-only. Any *other* mid-session insertion path has the same hole. Worth
its own ticket.

### 3.6 Paragraph spacing: absent means zero (D-6)

**Decision: a resolved-null `spaceBefore`/`spaceAfter` stamps `0pt`.**

Applies to `paragraph`, `heading`, `listItem` — matching
`ParagraphSpacing.options.types`. OOXML draws no distinction between them.

The machinery already supports this. `ParagraphSpacing`'s own doc comment: *"`0`
is a distinct, explicit value: it renders `margin-*: 0` and overrides that CSS."*
`parsePt("0pt")` returns `0`; `renderPt` guards on `typeof value === 'number'`, so
zero renders. `editor.css:124-135` deliberately puts the 1.5rem gap on the block
itself rather than the dBlock wrapper — *"the gap therefore belongs to the same
element the attribute does"* — and an inline style outranks that (0,2,0) selector.
`null` is the only value that falls through to the default.

**Why this rides with the matching fix rather than waiting for TEC-2900:**
hardening the matcher un-gates File B for the first time. Today the gate bails, no
paragraph gets an inline margin, and all 67 fall through to a uniform 1.5rem.
After hardening, 9 of 67 would get explicit margins and 58 would not —
*inconsistent* spacing within one document, which reads worse than
uniformly-wrong. The zeroing is what makes the un-gating an improvement rather
than a regression.

TEC-2900's other half — the same symptom via gdocs **copy/paste**, which never
touches this code path — remains separate.

### 3.7 Line-height stays asymmetric (D-7)

**Decision: absent `w:line` continues to mean "let CSS decide". Comment the
reason.**

The symmetry argument says absent `w:line` also means single spacing. Rejected:
paragraph gaps are authorial rhythm a reader can see and count, and the author
put blank lines in deliberately, so restoring zero restores what they saw.
Line-height is house typography; forcing 100% would make every import cramped to
match a rendering decision the author never made. Without the reason written
down, the next reader will "fix" the inconsistency.

### 3.7b Image alignment vocabulary (D-9, 2026-09-02)

`dataAlign`'s canonical vocabulary is `start | center | end`
(`resizable-media-menu-util.ts`). The import emitted `right`, so a right-aligned
imported image rendered correctly but left **no** alignment button active — the
same defect class as the font picker showing "Default". It now emits `end`.

**Widened 2026-09-03 (review response).** The fold happens in the `dataAlign`
attribute's `parseHTML`, which is the only choke point: TipTap's attribute-level
parsing outranks every rule's `getAttrs`, and its *implicit* reader picks up
`renderHTML`'s lowercased `dataalign` — so scoping the fold to the newly added
bare-`img` rule is not possible. That means the pre-existing `figure` and `div`
paste paths are folded too, and five assertions in `media-figure.test.ts` /
`svg-import.test.ts` moved from `right`/`left` to `end`/`start`. Rendered output
is unchanged either way — the node view and the print CSS both already pair the
two vocabularies — so this is a stored-token change, not a visual one.

No migration: nodes already in Yjs keep `left`/`right`, render and print
correctly, and converge on any HTML round trip. The one residual symptom is that
those legacy nodes still light no toolbar button, which a tolerant `isActive`
would fix for them and for `iframe.ts`'s `dataAlign: 'left'` default at the same
time. The node view's `left`/`right` tolerance therefore now serves stored
documents rather than pasted HTML.

### 3.8 Deferred

- **`w:asciiTheme`** — Word-authored documents put fonts in `theme1.xml` rather
  than `w:ascii` and would import with no font. Zero occurrences in either
  fixture; both ship an unused `theme1.xml`. Note on the ticket.
- **Two-pointer resync** — only if the skip counter fires on a real file.
- **Document-level default font** — only if QA rejects §3.1's accepted risk.
- **Mid-session colour normalisation** — see §3.5.

### 3.9 Comments (D-8)

The Phase 2 work deleted eight explanatory comments unrelated to run formatting:
the `lineRule: exact/atLeast` rationale, the `basedOn` cycle guard, `styles.xml`
being optional, the `console.warn` rationale, and the block explaining why
alignment is verified rather than trusted. **Restore them.** These document
non-obvious decisions, and the gate rationale in particular must record that the
bail was deliberate.

---

## 4. Verification

Synthetic regression tests for each confirmed cause, plus real-file assertions —
41 green synthetic tests coexisted with a 0%-effective feature, so at least one
test must run the real pipeline over a real export.

Both `.docx` files move to `package/extensions/docx/__fixtures__/` under stable
names. `docx-verify.test.ts` (currently untracked, reading a `/tmp/verify/` path
that no longer exists) is rewritten against them.

Manual QA is a lean checklist in chat, covering both themes. jsdom cannot catch
the CSS cascade here — `block-rhythm.test.ts` already documents this and asserts
against the CSS source instead.

### 4.1 Residual unknowns

- `0pt` survives jsdom's CSSOM (verified); worth an eyeball in Chrome.
- Three of File B's list items go flush under §3.6 — the most visible edge.
