# DOCX Run Formatting & Matching Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make run-level formatting (colour, font size, font family) survive real Google Docs `.docx` exports, by hardening the OOXML→HTML block matcher so it degrades per-block instead of abandoning the document.

**Architecture:** `docx-import.tsx` runs mammoth for structure, then `docx-spacing.ts` reads `word/document.xml` + `word/styles.xml` and zips presentation attributes onto mammoth's HTML positionally. That zip is guarded by two all-or-nothing gates that currently fail on any document with footnotes, nested lists, `w:br`, or `w:noBreakHyphen`. This plan replaces the global bail with per-block degradation, narrows which OOXML inheritance layers get baked into inline spans, and makes absent paragraph spacing resolve to an explicit zero.

**Tech Stack:** TypeScript, mammoth 1.11.0, JSZip, TipTap/ProseMirror, Vitest (jsdom environment).

**Spec:** `docs/superpowers/specs/2026-09-01-docx-run-formatting-design.md`

## Global Constraints

- **Commit once per task, on branch `TEC-2840`.** Conventional message, imperative mood, under three lines. **Never any AI attribution** — no `Co-Authored-By`, no "Generated with", no 🤖. (Controller ruling: the user's standing preference is to own commit boundaries themselves, but subagent-driven execution needs commits for review diffs and compaction recovery. They collapse the series with one `git reset --soft` at the end.)
- **Never amend or force-push.** The user shares this tree.
- **Minimal changes.** Apply only what each task specifies. Do not restructure neighbouring code as a bonus.
- **Comment discipline.** Comments only where the decision is non-obvious; 2–3 lines maximum. Never narrate what the code already says.
- **All work happens in `package/extensions/docx/docx-spacing.ts`** unless a task names another file.
- **Run tests from the repo root** with `npx vitest run <path>`. The full docx suite is `npx vitest run package/extensions/docx/`.
- **Baseline:** `package/extensions/docx/` holds four healthy test files totalling **49** passing tests — `docx-spacing.test.ts` (39), `docx-blank-lines.test.ts` (6), `docx-import-parity.test.ts` (2), `docx-style-map.test.ts` (2). Per-task counts below are for `docx-spacing.test.ts` alone unless a step names the directory. No task may reduce any count.
- **`docx-verify.test.ts` does not exist during Tasks 1-9.** It was deleted at baseline (it read a `/tmp/verify/` path that no longer exists and failed every run). Task 10 recreates it.
- **Exact conversion constants:** `TWIPS_PER_PT = 20`; font size px = `Math.round((w:sz / 2) * 96 / 72)`; `SPACING_MIN_PT = 0`, `SPACING_MAX_PT = 100` (from `package/utils/typography.ts`).

---

### Task 1: Align `runText` with mammoth's text output

`runText` (line 289) feeds two things: `paragraphText`, which is compared against mammoth's DOM text in the alignment gate, and the character offsets `applyRunStylesToBlock` uses to place spans. Both break when the two sides disagree about how many characters a non-text element contributes.

Verified mammoth 1.11.0 behaviour:

| OOXML | mammoth HTML | text contributed | `runText` today |
|---|---|---|---|
| `<w:br/>` | `<br />` | none | `'\n'` ❌ |
| `<w:tab/>` | literal `\t` | 1 char | `' '` ✅ (collapses identically under `normalize`) |
| `<w:noBreakHyphen/>` | `\u2011` | 1 char | `'-'` ❌ (different string) |

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:289-307` (`runText`)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `runText` semantics relied on by every later task. Signature unchanged: `(run: Element) => string`.

- [ ] **Step 1: Write the failing tests**

Add to `docx-spacing.test.ts`, inside the existing `describe('readDocxSpacing', ...)` block:

```ts
it('matches mammoth by contributing no text for a line break', () => {
  const xml = doc(
    `<w:p><w:r><w:t>foo</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>bar</w:t></w:r></w:p>`,
  );
  // mammoth renders <p>foo<br />bar</p>, whose textContent is "foobar".
  expect(readDocxSpacing(xml, NO_STYLES)[0].text).toBe('foobar');
});

it('matches mammoth by using a non-breaking hyphen for w:noBreakHyphen', () => {
  const xml = doc(
    `<w:p><w:r><w:t>a</w:t><w:noBreakHyphen/><w:t>b</w:t></w:r></w:p>`,
  );
  expect(readDocxSpacing(xml, NO_STYLES)[0].text).toBe('a\u2011b');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "matches mammoth"`
Expected: FAIL — first receives `"foo bar"` (a `\n` normalised in the assertion diff), second receives `"a-b"`.

- [ ] **Step 3: Implement**

Replace the body of `runText` (line 289):

```ts
// Character-for-character parity with mammoth's HTML matters twice over: the
// alignment gate compares this against the DOM's text, and applyRunStylesToBlock
// places spans by offset into it. w:tab stays a space — mammoth emits a literal
// tab, and `normalize` collapses both to the same thing.
const runText = (run: Element): string => {
  let text = '';
  for (const child of Array.from(run.childNodes)) {
    if (child.nodeType === 1 /* ELEMENT_NODE */) {
      const el = child as Element;
      const tagName = el.localName || el.nodeName.replace(/^w:/, '');
      if (tagName === 't') {
        text += el.textContent ?? '';
      } else if (tagName === 'tab') {
        text += ' ';
      } else if (tagName === 'noBreakHyphen') {
        text += '\u2011';
      }
    }
  }
  return text;
};
```

Note what was removed: the `br`/`cr` branch entirely. Mammoth's `<br />` contributes no text, so neither may this.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 39 existing + 2 new = 41 tests.

---

### Task 2: Compare a block's own text, excluding nested blocks

`BLOCK_SELECTOR` matches both `li`s of a nested list, so the outer one's `textContent` includes the inner one's text and never equals its single source `w:p`. The same shape breaks mammoth's footnote `<li><p>…</p></li>`. Comparing only the text a block owns directly fixes both.

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:383` (add helper after `normalize`)
- Modify: `package/extensions/docx/docx-spacing.ts:467-487` (`applyDocxSpacingToHtml`, the `aligned` check)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: `runText` semantics from Task 1.
- Produces: `const blockOwnText = (block: Element): string` — a module-private helper. Task 3 extends its skip list; Task 4 calls it.

- [ ] **Step 1: Write the failing test**

Add a new `describe` block to `docx-spacing.test.ts`:

```ts
describe('applyDocxSpacingToHtml block matching', () => {
  const bare = (text: string): DocxParagraphSpacing => ({
    spaceBefore: null,
    spaceAfter: null,
    lineHeight: null,
    textAlign: 'center',
    hasImage: false,
    text,
    runs: [],
  });

  it('matches a nested list by each item\'s own text', () => {
    const html = '<ul><li>lvl0<ul><li>lvl1</li></ul></li></ul>';
    const result = applyDocxSpacingToHtml(html, [bare('lvl0'), bare('lvl1')]);
    // Both items styled: the outer li must not be judged by "lvl0lvl1".
    expect(result.match(/text-align: center/g)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "own text"`
Expected: FAIL — receives `null` from `.match()`, because the gate bails and returns the HTML untouched.

- [ ] **Step 3: Implement**

Add after `normalize` (line 383):

```ts
/** Text this block owns directly. A nested block — a sub-list's item, a
 *  footnote's paragraph — owns its own text and is skipped, which is what keeps
 *  the comparison one-to-one with a single w:p. */
const blockOwnText = (block: Element): string => {
  let text = '';
  for (const node of Array.from(block.childNodes)) {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      text += node.nodeValue ?? '';
    } else if (node.nodeType === 1 /* ELEMENT_NODE */) {
      const el = node as Element;
      if (el.matches(BLOCK_SELECTOR)) continue;
      text += blockOwnText(el);
    }
  }
  return text;
};
```

Then in `applyDocxSpacingToHtml`, change the `aligned` check to use it:

```ts
  const aligned = blocks.every(
    (block, index) =>
      normalize(blockOwnText(block)) === normalize(spacings[index].text),
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 42 tests.

---

### Task 3: Exclude footnote and endnote artifacts

Mammoth appends `<ol><li id="footnote-0"><p>…<a href="#footnote-ref-0">↑</a></p></li></ol>` and injects `<sup><a href="#footnote-0" id="footnote-ref-0">[1]</a></sup>` at each reference. The footnote paragraphs live in `word/footnotes.xml`, which is not read, so they have no counterpart to zip against; the markers add text the OOXML side does not have.

The reference selector keys on the **anchor**, not on `sup` — File B contains a genuine `<sup>2</sup>` that must survive.

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:381` (add selectors near `BLOCK_SELECTOR`)
- Modify: `package/extensions/docx/docx-spacing.ts` (`blockOwnText` from Task 2)
- Modify: `package/extensions/docx/docx-spacing.ts` (`applyDocxSpacingToHtml`, the `blocks` query)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: `blockOwnText` from Task 2.
- Produces: `FOOTNOTE_BLOCK_SELECTOR` and `FOOTNOTE_REF_SELECTOR` constants.

- [ ] **Step 1: Write the failing test**

Add to the `describe('applyDocxSpacingToHtml block matching', ...)` block from Task 2:

```ts
it('ignores mammoth footnote blocks and reference markers', () => {
  const html =
    '<p>Text with a note<sup><a href="#footnote-0" id="footnote-ref-0">[1]</a></sup>.</p>' +
    '<ol><li id="footnote-0"><p>The note body. <a href="#footnote-ref-0">↑</a></p></li></ol>';
  // One w:p in document.xml: the footnote's paragraph lives in footnotes.xml.
  const result = applyDocxSpacingToHtml(html, [bare('Text with a note.')]);
  expect(result).toContain('text-align: center');
  // The footnote body must be left alone, not styled as a second block.
  expect(result.match(/text-align: center/g)).toHaveLength(1);
});

it('keeps superscript that is not a footnote reference', () => {
  const html = '<p>E = mc<sup>2</sup></p>';
  const result = applyDocxSpacingToHtml(html, [bare('E = mc2')]);
  expect(result).toContain('text-align: center');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "footnote"`
Expected: FAIL on the first — 3 blocks (`p`, `li`, nested `p`) against 1 spacing, so the count gate bails. The superscript test passes already; it is a guard against over-stripping in Step 3.

- [ ] **Step 3: Implement**

Add beside `BLOCK_SELECTOR` (line 381):

```ts
/** Mammoth's footnote/endnote list. Its paragraphs come from footnotes.xml,
 *  which is not read, so they have no w:p to zip against — and the li plus its
 *  nested p would otherwise be counted twice. */
const FOOTNOTE_BLOCK_SELECTOR = 'li[id^="footnote-"], li[id^="endnote-"]';

/** The injected [1] marker. Keyed on the anchor, not on sup — a document's own
 *  superscript must survive. */
const FOOTNOTE_REF_SELECTOR = 'a[href^="#footnote-"], a[href^="#endnote-"]';
```

In `blockOwnText`, add the marker skip alongside the nested-block skip:

```ts
      if (el.matches(BLOCK_SELECTOR)) continue;
      if (el.matches(FOOTNOTE_REF_SELECTOR)) continue;
```

In `applyDocxSpacingToHtml`, filter the block list:

```ts
  const blocks = Array.from(doc.body.querySelectorAll(BLOCK_SELECTOR)).filter(
    (block) =>
      !block.matches(FOOTNOTE_BLOCK_SELECTOR) &&
      !block.closest(FOOTNOTE_BLOCK_SELECTOR),
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 44 tests.

---

### Task 4: Degrade per block instead of abandoning the document

The two gates are all-or-nothing: one unexpected block costs the whole document its spacing, alignment, and formatting. With Tasks 1–3 in place both fixtures match completely (13/13 and 67/67 blocks, verified), so the remaining job is to make the *unverified* case cheap.

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:467-515` (`applyDocxSpacingToHtml`)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: `blockOwnText`, `FOOTNOTE_BLOCK_SELECTOR`, `FOOTNOTE_REF_SELECTOR` from Tasks 2–3.
- Produces: `applyDocxSpacingToHtml` no longer returns early on a count or text mismatch. Signature unchanged.

- [ ] **Step 1: Write the failing test**

Add to the `describe('applyDocxSpacingToHtml block matching', ...)` block:

```ts
it('skips only the paragraph that does not match', () => {
  const html = '<p>one</p><p>UNEXPECTED</p><p>three</p>';
  const result = applyDocxSpacingToHtml(html, [
    bare('one'),
    bare('two'),
    bare('three'),
  ]);
  // The first and third still line up positionally and must survive.
  expect(result.match(/text-align: center/g)).toHaveLength(2);
  expect(result).toContain('<p>UNEXPECTED</p>');
});

it('still applies to the blocks it can when counts differ', () => {
  const html = '<p>one</p><p>two</p><p>extra</p>';
  const result = applyDocxSpacingToHtml(html, [bare('one'), bare('two')]);
  expect(result.match(/text-align: center/g)).toHaveLength(2);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "skips only"`
Expected: FAIL — `.match()` returns `null`; the first test trips the text gate and the second the count gate, and both currently return the HTML untouched.

- [ ] **Step 3: Implement**

Replace the gates and the `forEach` header in `applyDocxSpacingToHtml`:

```ts
  // Positional, so every block is verified rather than trusted — mammoth
  // relocates text boxes and appends footnotes. A block that does not match is
  // skipped alone: spacing on the wrong paragraph is silent and hard to trace,
  // but losing the whole document's formatting to one odd block is worse.
  let skipped = 0;

  blocks.forEach((block, index) => {
    const spacing = spacings[index];
    if (!spacing) {
      skipped += 1;
      return;
    }
    if (normalize(blockOwnText(block)) !== normalize(spacing.text)) {
      skipped += 1;
      return;
    }

    const { spaceBefore, spaceAfter, lineHeight, textAlign, hasImage, runs } =
      spacing;
```

Keep the existing body of the `forEach` from `const element = block as HTMLElement;` onward unchanged.

After the `forEach`, before the return:

```ts
  if (skipped > 0) {
    console.warn(
      `Skipped ${skipped} of ${blocks.length} blocks while applying .docx formatting`,
    );
  }

  return doc.body.innerHTML;
```

Delete the now-unused `const aligned = …` / `if (!aligned) return html;` and the `if (blocks.length !== spacings.length) return html;` lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: FAIL on exactly two existing tests, which assert the contract this task replaces.

- [ ] **Step 5: Update the two tests that asserted the global bail**

`drops spacing entirely when the block count diverges` and `drops spacing entirely when the text diverges` both `expect(out).toBe(html)`. Replace both, and the three-line comment above the first of them:

```ts
  // Degrade per block rather than document-wide: mammoth relocates text boxes
  // and appends footnotes, so the two sequences can legitimately diverge. A
  // block that cannot be verified is skipped alone.
  it('keeps spacing on matched blocks when the block count diverges', () => {
    const html = '<p>one</p><p>two</p>';

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'one', spaceBefore: 12 }),
    ]);

    expect(out).toContain('margin-top: 12pt');
    expect(out).toContain('<p>two</p>');
  });

  it('skips only the block whose text diverges', () => {
    const html = '<p>one</p><p>two</p>';

    const out = applyDocxSpacingToHtml(html, [
      spacing({ text: 'one', spaceBefore: 12 }),
      spacing({ text: 'ELSEWHERE', spaceBefore: 12 }),
    ]);

    expect(out).toContain('margin-top: 12pt');
    expect(out).toContain('<p>two</p>');
  });
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 46 tests.

---

### Task 5: Bake in only direct and character-style formatting

`resolveRunProperties` currently layers paragraph-style run properties under character styles and direct formatting, and `readStyles` parses a `docDefaults.run` that nothing reads. Per spec §3.1, both layers come out: they are the source application's factory look, not the author's choices, and stamping them overrides ddoc's own heading CSS with no toolbar control to explain it.

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:169-183` (`StyleTable` type)
- Modify: `package/extensions/docx/docx-spacing.ts:185-228` (`readStyles`)
- Modify: `package/extensions/docx/docx-spacing.ts:230-247` (`resolveStyleSpacing`)
- Modify: `package/extensions/docx/docx-spacing.ts:249-287` (`resolveRunProperties`)
- Modify: `package/extensions/docx/docx-spacing.ts` (`getParagraphRuns` call site)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `resolveRunProperties(rPr, characterStyleId, styles)` — **the `paragraphStyleId` parameter is removed**. `StyleTable.docDefaults` becomes `RawSpacing` directly rather than `{ spacing, run }`. `StyleTable.byId` entries lose nothing; the `run` field is still needed for character styles.

- [ ] **Step 1: Write the failing test**

Add to `docx-spacing.test.ts`, in the existing `describe('readDocxSpacing run formatting', ...)` block:

```ts
it('does not bake in paragraph-style run properties', () => {
  const xml = doc(
    `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Title</w:t></w:r></w:p>`,
  );
  const sty = styles(
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:sz w:val="40"/><w:color w:val="2e74b5"/></w:rPr></w:style>`,
  );

  // Heading identity belongs to the block type and editor.css, not to an
  // inline span the toolbar cannot explain.
  expect(readDocxSpacing(xml, sty)[0].runs[0]).toEqual({
    text: 'Title',
    color: null,
    fontSize: null,
    fontFamily: null,
  });
});

it('does not bake in document default run properties', () => {
  const xml = doc(`<w:p><w:r><w:t>Body</w:t></w:r></w:p>`);
  const sty = styles(
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>`,
  );

  expect(readDocxSpacing(xml, sty)[0].runs[0]).toEqual({
    text: 'Body',
    color: null,
    fontSize: null,
    fontFamily: null,
  });
});
```

- [ ] **Step 2: Run the tests to verify the first fails**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "does not bake in"`
Expected: the paragraph-style test FAILS, receiving `fontSize: '20pt'` and `color: '#2e74b5'`. The docDefaults test passes already — `docDefaults.run` is parsed but never read; it is a guard against wiring it up by accident.

- [ ] **Step 3: Implement**

Change the `StyleTable` type (line 169) so `docDefaults` carries spacing only:

```ts
type StyleTable = {
  docDefaults: RawSpacing;
  byId: Map<
    string,
    { spacing: RawSpacing; run: RawRunProperties; basedOn: string | null }
  >;
};
```

In `readStyles`, delete the `defaultRPr` lookup and the `type` field (nothing reads it), and return:

```ts
  return { docDefaults: readSpacingElement(defaultPPr), byId };
```

In `resolveStyleSpacing`, change the final merge to use `docDefaults` directly:

```ts
  return mergeSpacing(styles.docDefaults, ...chain);
```

Replace `resolveRunProperties` (line 249) entirely:

```ts
/** Only the layers a person applied to a selection: a named character style,
 *  then direct formatting. Paragraph styles and docDefaults are the source
 *  app's factory look — ddoc owns that. */
const resolveRunProperties = (
  rPr: Element | null | undefined,
  characterStyleId: string | null,
  styles: StyleTable,
): RawRunProperties => {
  const chain: RawRunProperties[] = [];
  const seen = new Set<string>();
  let current = characterStyleId;

  while (current && !seen.has(current)) {
    seen.add(current); // a malformed basedOn cycle must not hang the import
    const style = styles.byId.get(current);
    if (!style) break;
    chain.unshift(style.run);
    current = style.basedOn;
  }

  return mergeRunProperties(...chain, readRunPropertiesElement(rPr));
};
```

In `getParagraphRuns`, drop the now-unused argument at the call site:

```ts
      const resolved = resolveRunProperties(rPr, rStyleId, styles);
```

`getParagraphRuns` still receives `paragraphStyleId` from `readDocxSpacing`; remove that parameter from its signature and from the call in `readDocxSpacing` too, since nothing inside uses it any more.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 48 tests.

The existing test `inherits run formatting from character styles and basedOn chain` must still pass — character styles are the layer this task keeps.

---

### Task 6: Emit font size in px

`w:sz` is in half-points. `FontSize` stores whatever string it parses, so `pt` renders correctly but breaks the toolbar: the stepper at `package/extensions/font-size/font-size.ts:128-134` does `parseInt(attrs.fontSize || '16')` and writes back `` `${nextSize}px` ``, so imported `16pt` nudged one step becomes `17px` — a jump from ~21px down to 17px.

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:110-140` (`readRunPropertiesElement`)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `DocxRunFormatting.fontSize` is now a px string (e.g. `'21px'`).

- [ ] **Step 1: Write the failing test**

Add to `describe('readDocxSpacing run formatting', ...)`:

```ts
it('converts half-points to px so the size stepper stays coherent', () => {
  const xml = doc(
    `<w:p><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>Sized</w:t></w:r></w:p>`,
  );
  // 32 half-points = 16pt = 21.33px.
  expect(readDocxSpacing(xml, NO_STYLES)[0].runs[0].fontSize).toBe('21px');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "half-points to px"`
Expected: FAIL, receives `'16pt'`.

- [ ] **Step 3: Implement**

In `readRunPropertiesElement`, replace the `w:sz` branch:

```ts
  const szEl = rPr.getElementsByTagName('w:sz')[0];
  const szVal = szEl?.getAttribute('w:val');
  let fontSize: string | undefined;
  if (szVal) {
    const halfPoints = Number.parseFloat(szVal);
    if (!Number.isNaN(halfPoints) && halfPoints > 0) {
      // px, not pt: the size stepper parseInts the stored value and writes back
      // px, so a pt value shrinks the text the first time it is nudged.
      fontSize = `${Math.round((halfPoints / 2) * (96 / 72))}px`;
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: FAIL on two existing tests that assert the pt output.

- [ ] **Step 5: Update the two tests that asserted pt**

In `extracts direct color, font-size, and font-family from w:rPr`, change `fontSize: '16pt'` to `fontSize: '21px'` (`w:sz="32"` → 16pt → 21px).

In `inherits run formatting from character styles and basedOn chain`, change `fontSize: '14pt'` to `fontSize: '19px'` (`w:sz="28"` → 14pt → 18.67px → 19px).

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 49 tests.

---

### Task 7: Drop black and white shades at emit time

File B carries `#000000` ×8 and `#ffffff` ×3 as direct run formatting. Both dark-mode normalisation passes run only at document load and neither fires for an import into an already-open editor, so these would ship as invisible text. `isBlackOrWhiteShade` is the codebase's existing definition of an unsafe colour; reuse it rather than inventing a second one.

Dropping happens at emit time so `readDocxSpacing` keeps telling the truth about the document.

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts:1` (import)
- Modify: `package/extensions/docx/docx-spacing.ts:388-465` (`applyRunStylesToBlock`)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: `isBlackOrWhiteShade` from `package/utils/color-utils.ts`, signature `(color: string) => boolean`. Matches an exact lowercased hex list: black `#000000 #434343 #666666 #999999`, white `#ffffff #f3f3f3 #efefef #d9d9d9 #cccccc #b7b7b7`.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to the `describe('applyDocxSpacingToHtml block matching', ...)` block created in Task 2:

```ts
it('drops black and white shades that would be invisible in one theme', () => {
  const html = '<p>black red white</p>';
  const spacings: DocxParagraphSpacing[] = [
    {
      spaceBefore: null,
      spaceAfter: null,
      lineHeight: null,
      textAlign: null,
      hasImage: false,
      text: 'black red white',
      runs: [
        { text: 'black ', color: '#000000', fontSize: null, fontFamily: null },
        { text: 'red ', color: '#cc0000', fontSize: null, fontFamily: null },
        { text: 'white', color: '#ffffff', fontSize: null, fontFamily: null },
      ],
    },
  ];

  const result = applyDocxSpacingToHtml(html, spacings);
  expect(result).toContain('rgb(204, 0, 0)');
  expect(result).not.toContain('rgb(0, 0, 0)');
  expect(result).not.toContain('rgb(255, 255, 255)');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "invisible in one theme"`
Expected: FAIL — the output contains `rgb(0, 0, 0)`.

- [ ] **Step 3: Implement**

Add the import at the top of `docx-spacing.ts`:

```ts
import { isBlackOrWhiteShade } from '../../utils/color-utils';
```

In `applyRunStylesToBlock`, add a resolver above the `styledRuns` filter and use it everywhere a colour is read:

```ts
  // Imported colour is literal hex, and the editor's dark-mode passes run only
  // at document load — an import into an open editor never reaches them. Black
  // on a dark background is invisible, so drop the shades that flip.
  const safeColor = (color: string | null) =>
    color && !isBlackOrWhiteShade(color) ? color : null;

  const styledRuns = runs.filter(
    (r) => safeColor(r.color) !== null || r.fontSize !== null || r.fontFamily !== null,
  );
  if (styledRuns.length === 0) return;
```

In the interval-collection loop, gate on the safe colour:

```ts
  for (const run of runs) {
    const start = offset;
    const end = offset + run.text.length;
    if (safeColor(run.color) || run.fontSize || run.fontFamily) {
      intervals.push({ start, end, run });
    }
    offset = end;
  }
```

And where the span is built:

```ts
      const span = block.ownerDocument.createElement('span');
      const color = safeColor(interval.run.color);
      if (color) span.style.color = color;
      if (interval.run.fontSize) span.style.fontSize = interval.run.fontSize;
      if (interval.run.fontFamily)
        span.style.fontFamily = interval.run.fontFamily;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 50 tests.

---

### Task 8: Resolve absent paragraph spacing to zero

In OOXML, nothing in the resolution chain setting `w:before`/`w:after` means the gap **is zero** — Word renders it flush. Treating that as "unspecified" lets ddoc's default 1.5rem land on top of the blank lines the author used as spacing, which is TEC-2900. File A: 6 of 13 paragraphs resolve to null; File B: 58 of 67.

Line-height deliberately does **not** get the same treatment (spec §3.7).

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts` (`applyDocxSpacingToHtml`, inside the `forEach`)
- Test: `package/extensions/docx/docx-spacing.test.ts`

**Interfaces:**
- Consumes: the per-block loop from Task 4.
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Write the failing test**

Add to the block-matching describe:

```ts
it('stamps an explicit zero when the docx specifies no paragraph spacing', () => {
  const html = '<p>flush</p>';
  const result = applyDocxSpacingToHtml(html, [
    {
      spaceBefore: null,
      spaceAfter: null,
      lineHeight: null,
      textAlign: null,
      hasImage: false,
      text: 'flush',
      runs: [],
    },
  ]);
  // Absent in OOXML means zero; null would let editor.css's 1.5rem apply on
  // top of the blank lines the author used as spacing (TEC-2900).
  expect(result).toContain('margin-top: 0pt');
  expect(result).toContain('margin-bottom: 0pt');
  // Line-height is house typography, not authorial rhythm — left to CSS.
  expect(result).not.toContain('line-height');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts -t "explicit zero"`
Expected: FAIL — the output is `<p>flush</p>` with no margin at all.

- [ ] **Step 3: Implement**

In `applyDocxSpacingToHtml`, replace the two conditional margin assignments:

```ts
    // Absent spacing in OOXML means zero, not "unspecified" — Word renders it
    // flush. Leaving it null lets editor.css's default gap stack on top of the
    // blank lines the author used as spacing (TEC-2900). Line-height keeps the
    // opposite rule on purpose: it is house typography, not authorial rhythm.
    element.style.marginTop = `${spaceBefore ?? 0}pt`;
    element.style.marginBottom = `${spaceAfter ?? 0}pt`;
    if (lineHeight !== null) element.style.lineHeight = lineHeight;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: FAIL on exactly two existing tests, whose premise this task reverses.

- [ ] **Step 5: Update the two tests that assumed absent means no margin**

`leaves untouched paragraphs without a style attribute` asserts `expect(out).not.toContain('style=')`. Its premise is now wrong — an unspecified paragraph is explicitly flush. Replace it:

```ts
  it('stamps zero margins on a paragraph the docx left unspecified', () => {
    const html = '<p>one</p>';

    const out = applyDocxSpacingToHtml(html, [spacing({ text: 'one' })]);

    // Absent in OOXML means zero, not "let CSS decide" — see TEC-2900.
    expect(out).toContain('margin-top: 0pt');
    expect(out).toContain('margin-bottom: 0pt');
  });
```

`covers headings and list items, not just paragraphs` asserts `expect(out).toContain('<li style="margin-bottom: 4pt')`. The list item now also carries an explicit `margin-top: 0pt`, which is serialised first, so the prefix no longer matches. Loosen that one assertion only — the `<h1 ...>` assertion above it still passes unchanged:

```ts
    expect(out).toContain('<li style="margin-top: 0pt; margin-bottom: 4pt');
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/docx/docx-spacing.test.ts`
Expected: PASS, 51 tests.

---

### Task 9: Restore the deleted explanatory comments

The Phase 2 work removed eight comments unrelated to run formatting. They document non-obvious decisions, and the alignment one in particular must record that verification was deliberate rather than accidental.

**Files:**
- Modify: `package/extensions/docx/docx-spacing.ts` (five sites)

**Interfaces:**
- Consumes: all prior tasks (comments must describe the code as it now stands).
- Produces: nothing.

- [ ] **Step 1: Restore each comment**

In `toLineHeight` (line 61), above the first statement:

```ts
  // 'exact' and 'atLeast' are absolute measurements with no multiplier
  // equivalent, and ddoc's lineHeight is a percentage — so they are dropped
  // rather than guessed at from an assumed font size.
```

Above `mergeSpacing`:

```ts
/** Later layers win, but attribute by attribute — a style supplying only
 * w:before must survive direct formatting that supplies only w:after. */
```

In `resolveStyleSpacing`, on the `seen.add(current)` line:

```ts
    seen.add(current); // a malformed basedOn cycle must not hang the import
```

In `readDocxSpacingFromArchive`, above the `stylesXml` fallback:

```ts
    // styles.xml is optional — a document can carry direct formatting only.
```

And in its `catch`:

```ts
    // Reported, not swallowed silently: a failure here is invisible in the
    // imported document (formatting simply does not appear) and is otherwise
    // very hard to tell apart from a document that had none.
    console.warn('Could not read formatting from .docx', error);
```

Above `readDocxSpacing`:

```ts
/**
 * One entry per w:p, in document order — the same order mammoth emits its
 * blocks in, which is what makes them zippable.
 */
```

- [ ] **Step 2: Verify nothing else changed**

Run: `git diff package/extensions/docx/docx-spacing.ts`
Expected: this task's diff is comments only — no logic lines added, removed, or reordered.

- [ ] **Step 3: Run the full suite**

Run: `npx vitest run package/extensions/docx/`
Expected: PASS, 61 tests across four files (docx-spacing.test.ts unchanged at 51).

---

### Task 10: Add fixtures and assert against real exports

41 synthetic tests passed while the feature did nothing on a real file. At least one test must run the real pipeline end to end.

`docx-verify.test.ts` is currently untracked and reads a `/tmp/verify/` path that no longer exists. It is replaced, not repaired.

**Files:**
- Create: `package/extensions/docx/__fixtures__/gdocs-manual-formatting.docx` (move from repo root, `gdocs manual formatting testing(3).docx`)
- Create: `package/extensions/docx/__fixtures__/gdocs-footnotes-lists.docx` (move from repo root, `gdocs formatting-test(2).docx`)
- Replace: `package/extensions/docx/docx-verify.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: the regression net for this feature.

- [ ] **Step 1: Move the fixtures into the repo**

```bash
mkdir -p package/extensions/docx/__fixtures__
git mv "gdocs manual formatting testing(3).docx" package/extensions/docx/__fixtures__/gdocs-manual-formatting.docx 2>/dev/null \
  || mv "gdocs manual formatting testing(3).docx" package/extensions/docx/__fixtures__/gdocs-manual-formatting.docx
mv "gdocs formatting-test(2).docx" package/extensions/docx/__fixtures__/gdocs-footnotes-lists.docx
```

(The files are currently untracked, so `git mv` will fall through to `mv`. Stage them with `git add` — do not commit.)

- [ ] **Step 2: Write the test**

Replace `package/extensions/docx/docx-verify.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { readDocxSpacing, applyDocxSpacingToHtml } from './docx-spacing';
import { DOCX_STYLE_MAP } from './docx-import';

const FIXTURES = path.join(__dirname, '__fixtures__');

/** The real import pipeline, minus the editor insertion. */
const importDocx = async (file: string) => {
  const buffer = fs.readFileSync(path.join(FIXTURES, file));
  const zip = await JSZip.loadAsync(buffer);
  const spacings = readDocxSpacing(
    await zip.file('word/document.xml')!.async('string'),
    (await zip.file('word/styles.xml')?.async('string')) ??
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
  );
  const { value: html } = await mammoth.convertToHtml(
    { buffer } as never,
    { styleMap: DOCX_STYLE_MAP, ignoreEmptyParagraphs: false },
  );
  return { html, spacings, result: applyDocxSpacingToHtml(html, spacings) };
};

const count = (haystack: string, needle: RegExp) =>
  (haystack.match(needle) || []).length;

describe('docx import against real Google Docs exports', () => {
  it('restores run formatting in a plainly formatted export', async () => {
    const { result } = await importDocx('gdocs-manual-formatting.docx');
    expect(count(result, /font-family:/g)).toBe(16);
    expect(count(result, /font-size:/g)).toBe(5);
  });

  it('restores run formatting despite footnotes and nested lists', async () => {
    // This file bailed both gates before the matcher was hardened: 71 blocks
    // against 67 w:p (footnote li + nested p), and nested list items whose
    // textContent swallowed their children.
    const { result } = await importDocx('gdocs-footnotes-lists.docx');
    expect(count(result, /font-family:/g)).toBeGreaterThan(0);
    expect(count(result, /font-size:/g)).toBeGreaterThan(0);
  });

  it('emits no black or white text that would vanish in one theme', async () => {
    const { result } = await importDocx('gdocs-footnotes-lists.docx');
    expect(result).not.toContain('color: rgb(0, 0, 0)');
    expect(result).not.toContain('color: rgb(255, 255, 255)');
  });

  it('stamps explicit spacing on every matched block', async () => {
    const { result, spacings } = await importDocx('gdocs-footnotes-lists.docx');
    // No paragraph may fall through to editor.css's default gap (TEC-2900).
    expect(count(result, /margin-bottom:/g)).toBe(spacings.length);
  });

  it('emits font sizes in px so the size stepper stays coherent', async () => {
    const { result } = await importDocx('gdocs-manual-formatting.docx');
    expect(result).not.toMatch(/font-size: [\d.]+pt/);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `npx vitest run package/extensions/docx/docx-verify.test.ts`
Expected: PASS, 5 tests.

If `restores run formatting in a plainly formatted export` reports a count other than 16/5, do not adjust the number to match — that file's direct formatting is 16 `w:rFonts`, 5 `w:sz`, 4 `w:color`, measured from the OOXML. A different count means a task regressed.

- [ ] **Step 4: Run the whole docx suite**

Run: `npx vitest run package/extensions/docx/`
Expected: PASS, 66 tests across five files.

- [ ] **Step 5: Run the full test suite for regressions**

Run: `npx vitest run`
Expected: no new failures against the pre-change baseline.

---

## Follow-ups (not in this plan)

- **TEC-2900, second half:** the same double-spacing symptom via gdocs copy/paste, which never touches this code path.
- **Mid-session colour normalisation:** `use-tab-editor.tsx:1344` and `:1943` run only at document load. Task 7 makes docx import safe by not emitting dangerous colours, but every other mid-session insertion path has the same hole. Worth its own ticket.
- **`w:asciiTheme`:** Word-authored documents put fonts in `theme1.xml`; they would import with no font. Note on TEC-2840.
- **Two-pointer resync:** only if Task 4's skip counter fires on a real file.
- **Document-level default font:** only if QA rejects spec §3.1's accepted risk (File B's body imports in ddoc's default font rather than Calibri).

## Manual QA checklist

Deliver in chat after Task 10, covering both fixtures in **both themes**:

1. Import each file in light mode — fonts, sizes, and colours appear on manually formatted text.
2. Import each file in **dark mode** — no invisible text anywhere. jsdom cannot catch this.
3. Headings render at ddoc's sizes (H1 32px), not the source document's, and the H1 button restyles them.
4. Blank-line spacing matches the source — no doubled gaps (TEC-2900).
5. Nested list items in `gdocs-footnotes-lists.docx` keep their formatting; check the flush spacing on the three items that resolve to zero.
6. Select imported text, nudge the font size one step — it moves by one step, not down to 17px.
