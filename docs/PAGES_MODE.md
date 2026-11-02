# Pages mode

Status: M0 (print test) done (§7.5). M1 (on-screen pages) in design (§12). Product and tech specs live on Linear TEC-3006 ("Pages mode: product spec", "Pages mode: tech spec"); this file records what the package builds and every place it departs from or fills in the tech spec. Later milestones extend it.

## 1. Intent

Pages mode shows a document as paper sheets while you write, and the printout or PDF must break on the same lines as the screen ("screen equals paper", product rule 1). Pages are a display layer: nothing is written to the Y.Doc.

M0 answers one question before the engine is built: **if the package computes page breaks from the rendered editor, does the browser's print land each page on the same line?** Gate: zero mismatched breaks in Chrome and Safari over the fixture matrix (§7). Firefox is recorded, best effort. If the gate fails for a reason we cannot fix (§7.4), PDF export moves to the raster path before M1 starts.

M0 is built as production code, not a spike (decision). The modules it needs (`page-grid`, `collect-leaves`, `line-split`, `place`, the print schema, the `pageSetup` print CSS) ship as they are; M1 adds scheduling, spacers and sheets on top.

Evidence that the gate is not a formality: Edentext abandoned browser print for PDF (`src/lib/export/pdf.ts`: "the browser's print-time re-render drifts text (vector ≠ hinted metrics)") and rasterises instead.

## 2. Goals, non-goals, anti-goals

**Goals (M0)**

- `DocumentStyling.pageSetup` prop; in Pages mode the live editor lays out at paper width with 1 inch margins, so its blocks wrap exactly as they will on paper.
- `getPrintBreaks(view)`: break positions computed from the live DOM by the real placement rules (tech spec "What a pass does" steps 1 to 3, plus "Splitting a paragraph").
- `printCurrentTab()` on the imperative handle, running the shared print pipeline (tech spec "Print, PDF and page count") with the breaks applied and the editor's own styling.
- A demo harness and a Chrome checker that prove or disprove the gate on 10 fixtures, both schemas, A4 and Letter.

**Non-goals (M0)** — later milestones, per the tech spec's delivery plan:

- Spacers, sheets, page numbers on screen, the scheduler, settle/oscillation guards, the page store, `onStatsChange` page count (M1).
- Collapsed-heading override, image `max-height`, page-break node view, Ctrl+Enter, routing the other print paths through the pipeline (M2). This includes the Cmd/Ctrl+P handler in `hooks/use-tab-editor.tsx` (`handleContentPrint(editor.getHTML())`), which the tech spec's caller list misses; M2 must route it too.
- Anything in ddocs.new (M3).

**Anti-goals** — a failure even if the gate passes:

- Any Yjs write, any change to Pageless rendering, or any change to Pageless print output. A doc without `pageSetup` (or with `mode: 'pageless'`) must render and print byte-for-byte as before.
- A new runtime dependency. Dev dependencies for the checker are fine (§6.3).
- Measuring the gate in a way that cannot fail (e.g. comparing print against print, or a checker that passes when a page is missing).

## 3. Constraints

- AGENTS.md layout contract: the 1024px cut-off reads the **editor's width** (`useEditorMediaQuery('(min-width: 1024px)', editorWidthStore)`), not the window (decision; the tech spec says viewport). No `vh`/`vw`/`fixed` in editor chrome.
- Zoom is `transform: scale()` on `[data-ddoc-zoom-layer]` (docs/ZOOM.md §8). Measure with `offsetTop`/`offsetHeight` (unscaled); divide client rects and `posAtCoords` input by `getZoomScale(view.dom)`.
- Both schemas: v1 wraps top-level blocks in `dBlock`, v2 is flat. Every module and every fixture runs on both.
- Ported Edentext code (AGPL-3.0) carries a header naming the source file and licence. Source: https://github.com/stffnb/edentext at `b5ee86a` (2026-10-23); clone it read-only for reference, never install it. Its `docs/architecture/pagination.md` explains the rules `pageBreaks.ts` implements.
- Edentext's measured trap (`:has()` under the editor makes Chromium restyle on each inserted child) is measured in M1, not M0 (decision): `.editor-main-lane:has(...)` in `styles/index.css` is the candidate.

## 4. What M0 builds

### 4.1 Prop and on-screen geometry

- `package/types.ts`: `PageSetup = { mode: 'pages' | 'pageless'; paper: 'a4' | 'letter' }`; `DocumentStyling.pageSetup?: PageSetup`. Export `PageSetup` from `index.ts`.
- `extensions/pagination/page-grid.ts`: CSS px at 96/in. A4 794 × 1123, Letter 816 × 1056; landscape (`documentStyling.orientation`) swaps them. `PAGE_MARGIN = 96` on all sides (one constant), `PAGE_GAP = 16`. `PageGrid` answers `pageAt(y)`, `contentTopOf(page)`, `contentBottomOf(page)` from those numbers only. Text width: A4 602, Letter 624, landscape 931 / 864.
- **Pages active** = `pageSetup?.mode === 'pages'` and editor width ≥ 1024 and not Split View and not version history. Presentation mode is untouched. `PreviewDdocEditor` stays Pageless (it does not read `pageSetup`).
- When active, `ddoc-editor.tsx` sets `baseWidth` to the paper width (it is already the only width input, docs/ZOOM.md §8) and puts `data-page-mode="pages"` on the editor root. `styles/editor.css` sets `--padding-t/r/b/l` to 96px under that attribute (replacing 72/80/20vh). No sheets: in M0 the editor is one long column at paper width.
- M0 does not register an extension in the live editor. `getPrintBreaks` is a plain function over the view. (M1 adds the `Pagination` extension.)

### 4.2 Measuring and placing

Ported from Edentext `src/lib/editor/extensions/pageBreaks.ts`, cut to the tech spec's v1 scope.

- `collect-leaves.ts`: walks the tab editor's DOM per the tech spec's block-type table. dBlock is walked into; lists and blockquotes are walked into (every `li` at every depth; an `li`'s own text block is a leaf, its nested list is walked); tables yield one leaf per `tr`; callouts are atomic if they fit a page, else walked; columns, media, iframe, tweet, actionButton, aiWriter, hr and Mermaid code blocks are atomic; other code blocks and paragraphs/headings are text leaves; `pageBreak` is a forced break. Each leaf carries its document position (`view.posAtDOM`, memoised per pass), `naturalTop` and `height` relative to `view.dom`, unscaled.
- `line-split.ts`: line boxes from `Range.getClientRects()` over the leaf's text nodes, grouped by vertical overlap, divided by the zoom scale; one `Range` reused per pass. The carried line's start position comes from a binary search over `view.posAtCoords` along the line plus the left-edge check (Chrome misreports inside hyphenated words).
- `place.ts`: a **pure** function, leaves + `PageGrid` in, `{ breaks, pageStarts, pageCount }` out. Rules (tech spec step 3): fits → nothing; atomic leaf that does not fit → break before it; a leaf already first on its page is never pushed; heading pushed with the next block when fewer than 2 of its lines (or none of an atomic block) fit; text leaf crossing the bottom splits between lines keeping ≥ 2 lines each side (else push the whole leaf); forced break → next leaf starts a page; a table continuing onto a new page reserves its header row's height at the top when the table has a header row.
- **Margins at a break (to verify in fixture 07).** Breaks are CSS forced breaks in print, where the margin before the break is truncated and the margin after it is kept. So the fit test uses a leaf's border-box bottom, and a leaf starting a page sits at `contentTop + its margin-top`. If print disagrees, the fixture says so and the rule changes here.
- Break types: `{ kind: 'before', pos }` (before a block, a list item or a table row) and `{ kind: 'inText', pos }` (start of a carried line). Table rows need no special type: a row is a node, so "before row" is "before" at the row's position.
- `getPrintBreaks(view)` in `print.ts` runs collect → place synchronously and returns the breaks plus, per page, the first ~40 characters of text (used by the harness).

### 4.3 Print copy

`print-break-node.ts` and `print.ts`. The tech spec's mechanism, with two fixes found by jsdom probes on both schemas:

1. Build the print schema from the live one: `nodes.append({ printPageBreak })` (inline, group `inline`, atom; `toDOM` → `<span data-print-break>`). Probed: `Node.fromJSON(printSchema, doc.toJSON())` serialises byte-identical to `editor.getHTML()`.
2. **Fix 1 — code blocks.** `codeBlock` content is `text*`, so an inline break inside it is invalid. The print schema updates `codeBlock`'s content to `(text | printPageBreak)*`. Probed: valid, and it serialises as a span inside `<pre><code>`.
3. **Fix 2 — breaks before blocks.** An inline node cannot sit between blocks (before an image, a list item, a table row). `kind: 'before'` breaks are applied at serialisation: a `DOMSerializer` built from the print schema's `nodes` map, each `toDOM` wrapped to add `data-print-break-before` when the node is in a `Set` of target nodes (matched by identity in the copied doc). Probed: marks `UL` and `PRE` correctly in both schemas, public API only.
4. `inText` breaks are inserted as `printPageBreak` nodes, last position first.
5. Header rows move into a `<thead>` after serialisation so print repeats them. Chrome ignores `break-before` on a row in a repeated `thead` (and a page-start mark there would repeat on every page), so a break or page start on a header row moves to the table's wrapper.
6. **Table rows (WebKit).** WebKit ignores `break-before` on a table row, and on a `tbody` too. The print copy splits a table at each row break: the piece after the break is a copy of the block's wrapper chain with the header and `colgroup` cloned in, and it carries the break. The pieces are pinned to the live column widths (`table-layout: fixed`, read from a row without merged cells), because automatic layout would size each piece's columns anew. Margins only go around the whole table: a piece followed by another drops its bottom margin (truncated at a forced break anyway), and a continued piece drops its top margin (kept after a forced break). A break on a table's first row moves to the table's block.
7. **Print mirrors node-view DOM** where `editor.css` rules depend on it (found by the parity check): v1 `dBlock` content goes in `div[data-node-view-content]`, and a `dBlock` holding a table gets `.is-table`; tables go in `div.tableWrapper`; an empty textblock gets the trailing `<br>` ProseMirror draws (else it prints 0px tall).

Pipeline for `printCurrentTab()` (tech spec order): compute breaks → `searchForSecureImageNodeAndEmbedImageContent` on a copy (assert the copy has the same `content.size`, else fail loudly in dev and print without breaks) → print copy with breaks → `getHTML`-equivalent serialisation → `renderMermaidBlocks` → `handleContentPrint(html, { pageSetup, orientation })`. In Pageless the same handle method prints as today (no breaks, today's styles). When `pageSetup.mode === 'pages'` but Pages is not active (editor under 1024px, Split View, version history), it prints with the Pages CSS (paper size, margins, editor styling) and **no computed breaks**, so the browser breaks pages itself (tech spec "Below 1024 px").

### 4.4 Print styling: the editor's CSS, not the print sheet

Found while checking the spec: print restyles content with its own sheet (`CONTENT_STYLES`, `MAIN_DOCUMENT_PRINT_BASELINE` in `utils/handle-print.ts`: Arial fallback, `p` 16px/1.5 with 12px spacing, `pre` 12px monospace with 16px padding, its own list/table spacing), while the screen uses `styles/editor.css` (system-ui, JetBrains Mono 0.8rem, other heading and spacing values). Lines cannot wrap the same under two stylesheets. This is separate from the tech spec's "print measures text slightly differently" risk, which is glyph-metric drift and is what the slack absorbs.

Decision: **in Pages mode the printout is styled by the editor's own CSS** and looks like the editor, not like today's printout. Pageless print keeps today's sheet.

`handleContentPrint(content, options?)`, with `options.pageSetup`:

- `@page { size: A4|letter portrait|landscape; margin: 1in 0 calc(1in - SLACK) 0 }`, `SLACK` = 20px (the tech spec's one-line bottom slack). Horizontal margins stay as print-root padding (1in each side), keeping today's workaround for mobile WebKit, which honours horizontal `@page` margins unreliably; iPads at 1024px+ get Pages.
- The print root carries the editor's content classes (`ProseMirror main-doc-editor`, `data-page-mode="pages"`); its content box is the text width.
- Text-affecting styles that live outside `.ProseMirror` (e.g. `documentStyling.fontFamily`, applied on the canvas wrapper) are copied onto the print root from the live editor's computed style: `font-family`, `font-size`, `line-height`, `letter-spacing`, `word-spacing`.
- Colours stay as print forces them today: light scheme, default text `#0D0D0D` on white, whatever the screen theme or `canvasBackground`; explicit text-colour marks print as authored. (Printing the page colour is a later decision.) `CONTENT_STYLES` and `MAIN_DOCUMENT_PRINT_BASELINE` are not emitted. Print-only rules that stay: hide everything but the host, reset `html/body` height, `print-color-adjust: exact`, `[data-print-break]` → `display: block; break-before: page`, `[data-print-break-before]` → `break-before: page`, `thead` → `display: table-header-group`.
- `@bottom-right { content: counter(page) }` for page numbers; M0 records which browsers render it.

- **Flat, no sections.** Pageless print splits content into `.print-page` sections at page breaks; in Pages that breaks every `.ProseMirror > block` spacing rule (24px gaps became 8px), so Pages prints flat. A page break serialises as a `<br>`, which Chrome will not make a block, so the block *after* it gets `break-before: page` (sibling rule; `:has()` for the v1 `dBlock` wrapper).

Hazards found and closed by the parity check (§6.2):

- **Breakpoint rules.** `editor.css` gates content rules on `@container ddoc-editor (min-width: …)` with an `@media` fallback for elements outside a `.ddoc-editor-cq` root. The print host is outside the root, so in print the fallback tests the *paper* width while the screen tested the *editor* width (≥ 1024 whenever Pages is active). Found: the v1 table block's 90% width cap at 1024px; Pages print CSS restates it. Any new content rule at 1024/1280 needs the same.
- **React node views.** Their content sits in a `pre-wrap` div, while ProseMirror's own `break-spaces` wraps a word earlier (a line-end space counts). Table cells print `pre-wrap`; `.tableWrapper` prints `overflow: visible` (a scroll container cannot break across pages).
- **Code blocks.** On screen a block over 20 lines is a 500px scroll box; paper cannot scroll, so Pages mode lifts the cap on screen (`[data-code-body]` hook, like collapsed headings showing expanded). Pages print CSS mirrors the node view's box: 1px border, body 32px under the overlaid header, 20px lines at the inherited size, `white-space: pre` unless word wrap is on. Not mirrored: the line-number gutter's width, which only matters for word-wrapped code with line numbers.
- **Mermaid** prints in the state it shows (decision): the node view exposes `data-mermaid-view="preview|source"`, and Pages print renders only the blocks showing the diagram; blocks showing source print as code. Pageless print still renders every diagram.
- **Page-break `<br>`** is hidden in print (`display: none`); left visible, its line box could spill onto a blank page.
- **Theme.** The print root matches `.ProseMirror` theme-coloured rules, so the print host carries the light `:root` `--color-*` tokens whatever theme class sits above it.
- **Flex and grid lists (WebKit).** WebKit cannot break a page inside a flex or grid item: an ordered list (a flex column on screen) and a task item (a grid) spilled a page each. Both print as blocks. A task item becomes a self-contained block with the checkbox floated to the inline start: the same geometry, since its list is a plain block either way. An ordered list's items would collapse their margins in block flow, while the flex column adds them, so print folds each gap onto the lower item as the sum of the live computed margins. Not mirrored: a margin on an item's first or last child would collapse through the item in print; list spacing lives on the item (`PARAGRAPH_SPACING.md`), so this needs an interior value the UI cannot set.
- **Display-only decorations.** List-marker font (`applyMarkerFonts` already mirrors it in print), comment highlights, search, carets: none may change layout on screen in Pages mode, or print will differ.

## 5. Fixtures

HTML strings in `demo/src/fixtures/pages/` (they load into both schemas through `setContent`). Each is long enough to break at least 4 times at A4 and Letter.

| # | Content | What it stresses |
| -- | -- | -- |
| 01 | Long prose, mixed paragraph lengths | Line splits, 2-line rule |
| 02 | Many headings H1 to H3, short sections | Keep-with-next, headings at page bottom |
| 03 | Nested bullet, ordered, task lists | Item leaves, nesting, numbering across a break |
| 04 | Long tables, with and without header rows | Row breaks, `thead` repeat, header reserve |
| 05 | Images of several sizes (data URLs, none taller than a page) | Atomic push, image sizing in print |
| 06 | Code blocks, one longer than a page; one Mermaid | Line split inside `pre`, atomic Mermaid |
| 07 | Mixed fonts, sizes, line heights, paragraph spacing | Metric drift, margins at a break |
| 08 | Manual page breaks, callouts, blockquotes, hr | Forced breaks, walked containers |
| 09 | Columns blocks, action buttons | Atomic boxes |
| 10 | A realistic proposal mixing all of the above | Integration |

Fixtures 01 and 04 also run landscape.

## 6. Harness and checks

### 6.1 Demo

A "Pages" section in the demo's styling panel: mode, paper, fixture picker, a predicted-breaks list (page → first 40 characters), and a Print button calling `printCurrentTab()`. `window.__ddocPages` (demo only) exposes `{ breaks, pageStarts, pageCount }` for the checker.

**Self-describing PDFs.** With a demo-only `debugMarkers` print option, every predicted page start gets an absolutely positioned (layout-neutral) tiny text marker `§P<n>§`, page 1 included. Its block is made `position: relative`: Gecko places an absolute box against its containing block's unbroken layout, so a marker anchored on the print root lands a page early. It sits 4px below its block's top: WebKit paints a glyph that crosses a page edge on both pages. An extra in-flow anchor element is not an option: in a columns block it becomes a flex item. A PDF then states its own prediction: the checker needs no side file, and a PDF printed by hand in Safari or Firefox is checked the same way.

### 6.2 Height parity (screen vs print DOM, no PDF)

Before printing, the harness mounts the real print host (`mountContentPrintHost`, forced visible off-screen, so the Pages print CSS outside `@media print` applies) and compares every top-level block's height and the gap above it with the live editor. Any difference is a stylesheet or node-view mismatch (§4.4), found in seconds, per block. A fixture is not sent to PDF until it passes here.

### 6.3 Chrome checker

`scripts/pages-print-check.cjs`, built like `scripts/chrome-parity-probe.cjs` (a headless Chrome over CDP against the demo, default `--base http://localhost:5174/` so it never collides with main's server on 5173). One profile and one doc per schema (the schema is stamped when a doc is created; the demo waits for the v2 stamp before loading a fixture). For each fixture × schema × paper (× landscape where listed): load, read `window.__ddocPages`, run the height parity check, `Page.printToPDF` with `preferCSSPageSize`, extract text with `pdfjs-dist`, and report per page: marker present, marker sequence intact, page count equal, first line of any mismatched page. Also compares fixture 01's breaks at zoom 1.5, Fit and 0.75 with zoom 1. `pdfjs-dist` is installed with `npm i --no-save pdfjs-dist@4.10.38`, not saved: npm 11 rewrites hundreds of unrelated lockfile flags (CI runs npm 10).

`Page.printToPDF` is the engine behind Playwright's `page.pdf()`; the CDP pattern avoids a Playwright dependency (my call; swap to Playwright if preferred). The live-Chrome manual check is printing from the demo's Print button.

### 6.4 Safari and Firefox (manual)

Print → Save as PDF from the demo, `debugMarkers` on, into a folder; `node scripts/pages-print-check.cjs --pdf-dir <dir>` checks them. Matrix: Safari all fixtures at A4 and Letter on v2, A4 on v1; Firefox all fixtures at A4 on v2. iPad Safari (simulator, editor ≥ 1024px): fixtures 01, 04, 10 at A4 on v2, recorded, not part of the gate.

## 7. Gate and outcomes

1. **Pass:** zero mismatches in Chrome (full matrix) and Safari (its matrix). Firefox results recorded.
2. Every mismatch is classified: **(a)** style or DOM mismatch (height parity would have caught it, or a node view differs) → fix, rerun; **(b)** glyph-metric drift larger than the slack → try a larger slack once, with its cost (lost lines per page) written down; **(c)** an engine limitation (e.g. `break-before` ignored inside `pre`) → record it and its workaround.
3. Record per browser: `@page` margin-box page numbers, `thead` repeat, breaks inside `pre`.
4. **Fail:** (b) or (c) left in Chrome or Safari after fixes → report to the team with the per-fixture table; the switch to the raster path is a team decision, not made in M0.

### 7.5 Results

**Chrome** (headless, `Page.printToPDF`, 48 cases: 10 fixtures × v1/v2 × A4/Letter, plus landscape for 01 and 04). Baseline 10/48; after the fixes in §4.3–4.4 and the final review's fixes, 40/48, and **every case's page breaks match**. The 8 remaining failures are the image parity difference below, which moves no break.

| Fixture | Page breaks (markers) | Parity | Notes |
| -- | -- | -- | -- |
| 01 prose, 02 headings, 03 lists, 07 fonts, 08 breaks/containers, 09 columns | Match, every case | Match | |
| 04 tables | Match, every case | Match | Header row repeats on each page |
| 05 images | Match, every case | Image ~45–55px taller on screen | Media node view's in-flow editing chrome; break-neutral (print is shorter, so only whitespace at a page bottom) |
| 10 proposal | Match, every case | Image, as 05 | |
| 06 code | Match, every case | Match | Mermaid prints in the state it shows |

- No glyph-metric drift (class b) seen: no break moved for any reason other than the structural mismatches above. The 20px slack was never needed as more than headroom.
- Zoom 1.5, Fit and 0.75 give the same breaks as 100%.
- Per-browser facts, Chrome: `@page @bottom-right` page numbers render; `thead` repeats; `break-before` inside `pre` honoured; `break-before` on a repeated `thead` row ignored (worked around, §4.3).

After the Safari fixes below, the Chrome matrix was rerun: 40/48, the same 8 image parity cases, every break matching.

**Firefox** (manual round, all fixtures, A4, v2). Every page broke where predicted; the markers did not. An absolutely positioned marker anchored on the print root was placed against the root's unbroken layout, one page early (fixed, §6.1). Reproduced and rechecked in headless Firefox over WebDriver BiDi (`browsingContext.print`), whose PDFs matched the manual ones marker for marker: **10/10** after the fix.

**Safari** (manual round, all fixtures, A4, v2). Two artefacts and two engine limits (class c):

- Every forced break also printed its marker on the previous page: WebKit paints a glyph that crosses a page edge on both pages. Not a layout fault (fixed, §6.1).
- **Lists** (03, and 10's lists): no break inside a flex or grid item. Fixed by printing lists as blocks (§4.4).
- **Table rows** (04, 10): `break-before` on a row is ignored. Fixed by splitting tables at row breaks (§4.3).

Reproduced with a WKWebView print harness (`NSPrintOperation`, the engine Safari prints with), whose PDFs matched the manual ones page for page. After the fixes: **10/10 on v2 A4, v2 Letter and v1 A4**, with the height parity check also passing in WebKit (05 and 10 apart: the image chrome). A manual Safari reprint confirms the harness.

- Per-browser facts. Safari and Firefox: no `@page` margin-box page numbers; `thead` repeats; `break-before` inside `pre` honoured. Safari: `break-before` ignored on table rows and row groups, and inside flex and grid items.
- The demo's v1 fixture loader sometimes appends to the doc instead of replacing it, so some v1 cases print several fixtures at once (both the prediction and the print come from the same doc, so the check stays valid).

**Verdict: M0 is done** (decision, 2026-11-02). Chrome passes; Safari passes in the WebKit harness across its matrix. Print and PDF are due for a rework of their own, so the remaining print checks are not run: a manual Safari reprint after the fixes, iPad Safari (§6.4), and the v1 fixture loader that sometimes appends instead of replacing.

## 8. Tests

- Unit (vitest): `PageGrid`; `place` on synthetic leaves (fits, push, split, 2-line rule both sides, first on page, keep-with-next chain stops after one heading, forced break, header reserve); print schema (both schemas: byte-identical without breaks, inline breaks in paragraph/heading/list item/code block, `before` marking by identity, last-first insertion, `thead` move); `handleContentPrint` emits the Pages CSS only with `pageSetup` and today's CSS without it; `data-page-mode` and `baseWidth` follow the gating rules.
- `collect-leaves` and `line-split` need real layout and are covered by the checker.
- Pageless unchanged: existing print and layout tests stay green untouched.

## 9. Delivery

M0 lives on branch `pages-mode` and does **not** merge to `main`: every push to `main` publishes to npm, and M0's public surface (`pageSetup`, `PageSetup`, `printCurrentTab()`) would let a consumer turn on a half-built mode. It merges once the feature is shippable. ddocs.new trials use a prerelease tag (AGENTS.md "Release"). Commits per task.

## 10. Open for M1

- **Layout-changing widgets.** Pending suggestions render the proposed text as `Decoration.widget`s (`comment-decoration-plugin.ts`), and AI autocomplete renders ghost text; the print copy has neither, so while one is on screen the screen's pages and the printout differ. Decided (2026-11-02): hidden in Pages mode, §12.7.

- **Image editing chrome.** The media node view keeps ~45px of toolbar row, padding and margins in flow on screen. Break-neutral, but the sheet's fill differs from paper. Belongs with M2's image work (`max-height` to the text height).
- **`:has()` cost.** `.editor-main-lane:has(...)` (`styles/index.css`) sits above the editor: Edentext measured this pattern at ~150ms of Chromium restyle per inserted spacer. Measured in M1, §12.9.

## 11. Left to the builder

Internal types and names beyond those above, module boundaries inside `extensions/pagination/`, the demo panel's look, the checker's report format, and fixture wording.

## 12. M1: on-screen pages

### 12.1 Intent and scope

M1 turns the M0 column into sheets of paper while you write: the live editor runs passes that insert spacers, so every leaf sits on a drawn sheet, with page numbers, and the footer gets the exact page count. Print reads the same layout, so the screen and the printout come from one placement.

**In M1**: the `Pagination` extension in every tab editor (§12.2), collapsed headings shown expanded (§12.7), passes with spacers (§12.3, §12.4), the scheduler with its settle and oscillation guards (§12.5), the sheets layer and page numbers (§12.6), hiding layout-changing widgets (§12.7), the page store and `onStatsChange` page count (§12.8), the `:has()` measurement (§12.9), print from the live layout (§12.10), failure handling and instrumentation (§12.11), and the checks that gate M1 (§12.12).

**M2** (decision): table-row spacers with the header row cloned in, image `max-height`, clipping of other atoms taller than a page, the page-break node view, Ctrl+Enter, the image editing chrome (§10), and routing the other print paths through the pipeline (§2).

**Tables in M1** (my call): collected as one atomic leaf, not one leaf per row, on screen and therefore in print too (§12.10). A table that fits a page moves to the next page whole; a table taller than a page follows the tall-leaf rule (§12.3) and is the one known place where screen and paper differ until M2. M0's row-break print code stays, unused by the live path until M2 turns rows back on.

**Anti-goals** (from §2, unchanged): no Yjs write, no change to Pageless rendering or print, no new runtime dependency. Pageless pays nothing: the extension is registered but inert.

### 12.2 The extension

`extensions/pagination/index.ts`: `Pagination`, registered in every tab editor in `buildExtensionsForTab` (`hooks/use-tab-editor.tsx`), both schemas. It adds no nodes or marks. It is not part of `getHeadlessExtensions` (headless editors have no layout).

- **Storage**: `{ pageSetup, orientation, active }`. `active` is true only when Pages is active for the editor (`isPagesActive`, §4.1) **and** the editor is the active tab. Hidden cached tab editors are inert; their last spacers stay until they become active, when a pass runs.
- **Command**: `setPagination({ pageSetup, orientation, active })`. `ddoc-editor.tsx` calls it on the active tab editor whenever any input changes, and with `active: false` on an editor that stops being the active tab.
- **Inert** (`active` false): no measuring, no observers, no listeners, empty decoration set. Turning Pages off clears the spacers with one step-less transaction, so switching to Pageless is instant.
- **Plugin**: state is the spacer `DecorationSet`, mapped through every document-changing transaction and replaced only by the plugin's own meta. Its `view()` owns the scheduler (§12.5) and the observers.

### 12.3 A pass

`collect → place → emit`, synchronous, in one frame.

1. **Collect.** `collectLeaves` (§4.2), with tables atomic (§12.1). Every leaf's `top`, `bottom` and lines are **natural**: where they would be with no spacers. The walk skips spacer elements and takes their effect out of every measurement below them, including spacers inside a leaf (a split paragraph's lines after its spacer). A pass must never measure its own output, or two layouts feed each other.
   - **Margins around a spacer.** A spacer between two blocks stops their margins collapsing: with no spacer the gap is `max(mb, mt)`, with one it is `mb + S + mt`. Taking out `S` alone leaves the swallowed margin in the measurement. Edentext adds it back (`cumulativeDropped`) and gives some spacers a negative `margin-top`. The builder picks the mechanism; the requirement is that the natural positions do not depend on where the spacers are, which the settle check (§12.5) and I4 (§12.12) catch.
2. **Place.** `place(leaves, grid)` (§4.2), unchanged except for the tall-leaf rule. Its output also carries, per break, the **spacer height**: the shift it adds.
   - **Tall leaf** (an atomic leaf taller than the text height, now including tables): it starts first on its page and nothing splits it; on screen it runs over the sheet's bottom margin, the gap and the next sheets. **The leaves after it follow paper** (my call): M0's `spill` already places the next leaf where print puts it (print fragments the box at text height plus slack per page), and on screen a spacer before that next leaf moves it there. That spacer opens no page in print, so the placement carries a spacer list separate from `breaks`. The spacer is never negative: a page holds more of the box on screen (whole page plus gap) than on paper. So one placement serves both, page counts stay equal, and only the tall leaf's own drawing differs from paper (§12.1).
3. **Emit.** Compare the placement with the spacers **actually in the view** (not the last computed placement: a node replaced by a paste or a language change drops its widgets, Edentext hit this). Equal: no dispatch. Otherwise build a `DecorationSet` and dispatch one transaction with no steps, carrying the plugin meta only. Never set `addToHistory: false`: `@tiptap/y-tiptap`'s sync plugin would call `undoManager.stopCapturing()` on it and split the user's undo steps (tech spec "What a pass does" step 4).

### 12.4 Spacers

- `Decoration.widget(pos, toDOM, { side: -1, key })`; `key` encodes the kind and the height, so an unchanged spacer keeps its DOM node across passes (Edentext: 1.5 s → 144 ms per keystroke at the top of a 124-page doc).
- Element: `div.ddoc-page-spacer`, `contenteditable="false"`, `role="separator"`, `aria-label="Page N"` (N = the page it opens), `pointer-events: none`, `height` in whole pixels (fractional heights shake by 1px at some zooms), no margin, border or padding of its own.
- **Where a `before` spacer goes.** Before the **outermost** node that starts with the leaf (walk up while the leaf's node is its parent's first child, stopping below the doc): before the `dBlock` in v1, before the list for a first list item. The leaf then lands at `contentTop + marginTop`, where `marginTop` is M0's `leadingOffset` of that chain, the same position print gives it after a forced break.
- **Where an `inText` spacer goes.** At the carried line's start position. A block `div` inside the textblock ends the line there and pushes the rest to the next page. Inside `pre` it is a block inside the `code` element.
- **Split boxes cross the gap** (decision, accepted for M1): a code block, callout, blockquote or list split by a spacer draws its border or background through the bottom margin, the desk gap and the next sheet's top margin. M2 cuts boxes at the sheet edge.
- **Hazards for the builder to check** (each has a fixture): an ordered list is a flex column, so a spacer between its items is a flex item and any `gap` counts on both sides of it; a spacer inside a code block shifts the line-number gutter against the text; a v1 spacer inside a `dBlock` sits in its node-view content beside the drag-handle chrome.

### 12.5 Scheduler

`extensions/pagination/scheduler.ts`, one per plugin view, running only while `active`.

| Trigger | Response |
| -- | -- |
| Local edit | Spacers mapped (`DecorationSet.map`). Full pass after 300 ms with no edits |
| Remote edit (transaction meta from `y-sync` with `isChangeOrigin`) | Same 300 ms wait. Not "run now": remote transactions also carry `addToHistory: false`, which Edentext reads as "not an edit" |
| Caret's block now ends past its page's text bottom (held Enter, a long paste) | Pass on the next animation frame |
| `setPagination` with a change, mount, becoming the active tab, zoom change | Pass on the next animation frame |
| `document.fonts` `loadingdone`; a `ResizeObserver` hit on the content (late images, embeds) | Pass on the next animation frame |
| `view.composing` | No dispatch; reschedule for `compositionend` |

- **Skip rule**, checked when the 300 ms timer fires: every edit since the last pass stayed inside one textblock, that textblock holds no `inText` spacer, and the content's bottom edge did not move. Then nothing below can have moved: no pass.
- **ResizeObserver** watches the content's children, not `view.dom`, so the pass's own `min-height` change does not retrigger it; a pass that changes nothing does not dispatch, which ends any loop.
- **Settle.** After a dispatch, if the placement differs from the previous pass, run one more on the next frame, at most 4 in a row. If the placement from two passes ago returns, keep the current one and stop (oscillation). The count resets on the next edit or trigger. Both guards are pure functions over placements and unit-tested.
- **Flush**: `flush()` runs a pending pass synchronously; print calls it (§12.10).

### 12.6 Sheets and page numbers

`components/page-sheets.tsx`, rendered inside `[data-ddoc-zoom-layer]` behind the editor content (`pointer-events: none`, `aria-hidden`), so it scales with zoom like the text. It reads the active tab's page store (§12.8) and draws nothing when Pages is not active.

- **Geometry**: sheet `i` at `top = origin + i × (pageHeight + PAGE_GAP)`, `width = paper width`, where `origin` is the active editor's `view.dom` top within the zoom layer (the `PageGrid` frame). The `.ProseMirror` element gets `min-height = pageCount × (pageHeight + gap) − gap`, so the last sheet is always fully drawn.
- **Windowing**: only sheets within two screens of the visible part of the scroll container (`getEditorScrollContainer`, rAF-throttled scroll listener; the Split View swap of the scroller does not apply, Pages is off there).
- **Colours**: the sheet takes the canvas fill (`documentStyling.canvasBackground`, else today's canvas token); the space between sheets is the desk (`documentStyling.background`, else the editor background), so in Pages mode `#editor-wrapper` and `.ProseMirror` stop painting the canvas fill. Sheet edge: 1px existing border token, no shadow. Dark mode uses the same tokens' dark values.
- **Page numbers**: one per sheet, plain digits from 1, each tab restarting at 1, vertically centred in the bottom margin and right-aligned to the text edge; 11px, secondary text token, the document font, not selectable, `aria-hidden` (the spacer's `aria-label` announces pages).
- Focus mode draws sheets as normal; presentation mode is untouched.
- Anything the zoom layer renders above `view.dom` (tags) sits on the desk above the first sheet, with no canvas fill behind it (my call).

### 12.7 Collapsed headings and layout-changing widgets in Pages mode

**Collapsed headings** (pulled forward from M2: hidden blocks measure as zero-size boxes and would corrupt every placement after them, and print serialises them anyway). While Pages is active, `buildHiddenDecorationSet` (`d-block/dblock-collapse.ts`) returns an empty set in both schemas and the collapse chevrons are hidden. The `isCollapsed` attribute is untouched; leaving Pages restores the collapsed view. The plugin rebuilds its decorations when Pages turns on or off, through its own meta.

**Widgets.** Decided (2026-11-02): hidden, so the screen's pages match print.

- **Pending suggestions.** The proposed-text widgets from `createSuggestionWidgetRenderer` (`comment-decoration-plugin.ts`) are `display: none` under `[data-page-mode='pages']`; the struck-through original range and the suggestion card in the rail stay. Any other suggestion decoration that changes layout (check the `suggestion-source-caret-hidden` node class) is hidden the same way.
- **Your own draft stays visible** (decision, 2026-11-02): text typed in suggest mode lives only in that widget (`anchor.isDraft`), so hiding it would hide the suggester's typing. The draft widget (and its `suggestion-source-caret-hidden` block) is exempt; while it is open the pass measures it as content, so that user's page breaks are off by the draft until it is submitted, after which it is hidden like any other. Print never includes it.
- **AI autocomplete** (`ai-autocomplete.ts`): while Pages is active it does not fetch a suggestion at all (my call), so Tab can never accept text the user cannot see. Hiding the ghost text with CSS alone would leave that trap.

### 12.8 Page store and page count

- `extensions/pagination/page-store.ts`: per tab editor, `{ pageCount, pageStarts }`, published after each pass that changes them, read with `useSyncExternalStore` by `PageSheets`.
- `use-tab-editor.tsx`: while Pages is active for the active tab, `createPageCounter` does not run (no hidden iframe) and `statsPublisher.publish({ pages })` takes the store's count, published on every change. Leaving Pages resumes today's counter.

### 12.9 `:has()` cost

Measure the restyle cost of a spacer insert with Chrome's performance trace in the demo, on the 50,000 word fixture, with the `.editor-main-lane:has(...)` rules (`styles/index.css`) present and with them removed. If they cost more than a few ms per pass, replace the `:has()` with a class that React sets on `.editor-main-lane` from the floating-comment state it already holds. The numbers go in §12.13.

### 12.10 Print from the live layout

`printCurrentTab()` in Pages mode: `flush()` the active editor's scheduler, then take the breaks from the plugin's current placement instead of running `getPrintBreaks` again. The rest of the pipeline (§4.3) is unchanged. Because collect measures natural positions, a fresh run would give the same answer; reading the plugin's placement guarantees it and costs nothing. Print falls back to `getPrintBreaks` when the plugin has no placement (it failed, §12.11, or never ran). With tables atomic, print breaks before a table, never between its rows, in M1.

### 12.11 Failures and instrumentation

- **No writes**: every pagination transaction is checked before dispatch; in dev a transaction with steps throws. Unit test plus the I1 check (§12.12).
- **A pass throws**: caught, decorations cleared, that editor goes inert until reload (it renders as M0's single column at paper width), `console.error` in dev. The package has no Sentry; error reporting is the app's (M3).
- **Marks**: `performance.mark`/`measure` around collect, place and emit, named `ddoc:pagination:*`.
- **Debug**: the demo's `window.__ddocPages` gains the last pass's leaves, placement, pass count and timings.

### 12.12 Gate

M1 is done when all of these hold. The layout checks extend `scripts/pages-print-check.cjs` (CDP against the demo on 5174, my call over the tech spec's Playwright, as in M0).

1. **I4, every leaf on a sheet**: on screen with spacers, every leaf's rect lies inside one sheet's text area, or it is first on its page and taller than a page. Fixtures 01–03 and 05–10, both schemas, A4 and Letter, plus 01 landscape, zoom 1.5, Fit and 0.75, and 02 with its headings collapsed (it must lay out and print as expanded).
2. **I3, screen equals paper**: on the same matrix, each printed page starts where its sheet starts (M0's PDF markers), and the PDF page count equals the store's `pageCount`.
3. **I1, no writes**: the Yjs state vector is identical before and after 50 passes driven by resizes, zooms and tab switches.
4. **I2, undo**: the same typing script undoes in the same steps in Pages and Pageless.
5. **Settles**: after loading each fixture, passes stop within the cap and do not dispatch again without a trigger.
6. **Performance** on a generated 50,000 word fixture (`demo/src/fixtures/pages/gen.ts`), Chrome, measured by a new `scripts/pages-perf-check.cjs` over CDP: keystroke latency in Pages within 10% of Pageless; extra cost per keystroke under 1 ms; one pass (collect and place) under 50 ms; emit and re-render under 16 ms. The fixture from ddocs.new #1122 was never committed, so M1 generates its own.
7. Unit tests green: settle and oscillation guards, spacer keys, the skip rule, the tall-leaf rule in `place`, no-steps assertion, `page-store`, the page count in `use-tab-editor`, AI autocomplete not fetching in Pages.

Safari and Firefox are spot-checked by hand on fixtures 01 and 10 (on-screen sheets only; their print is M0's).

### 12.13 Results

To be filled in during M1.
