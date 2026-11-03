# Pages mode

Status: M0 (print test) done (§7.5). M1 (on-screen pages) built; Chrome gate results in §12.13, manual browser QA pending. M2 (feature fit) built (§13); Chrome gate results in §13.12, manual checks pending. Product and tech specs live on Linear TEC-3006 ("Pages mode: product spec", "Pages mode: tech spec"); this file records what the package builds and every place it departs from or fills in the tech spec. Later milestones extend it.

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

**Tables in M1** (my call): collected as one atomic leaf, not one leaf per row, on screen and therefore in print too (§12.10). A table that fits a page moves to the next page whole; a table taller than a page follows the tall-leaf rule (§12.3) and is the one known place where screen and paper differ until M2: its drawing runs over the sheet edges, and its printed page count can differ by one (§12.3, §12.13). M0's row-break print code stays, unused by the live path until M2 turns rows back on. (Superseded in M2: rows are leaves, §13.6.)

**Anti-goals** (from §2, unchanged): no Yjs write, no change to Pageless rendering or print, no new runtime dependency. Pageless pays nothing: the extension is registered but inert.

### 12.2 The extension

`extensions/pagination/index.ts`: `Pagination`, registered in every tab editor in `buildExtensionsForTab` (`hooks/use-tab-editor.tsx`), both schemas. It adds no nodes or marks. It is not part of `getHeadlessExtensions` (headless editors have no layout).

- **Storage**: `{ pageSetup, orientation, zoom, enabled, running, failed, store, flush, lastPass, isIdle }`. `enabled` is true when Pages is active for the editor (`isPagesActive`, §4.1): spacers are kept and the §12.7 behaviours are on. `running` is true when the editor is also the active tab: the scheduler and observers are live. Hidden cached tab editors are enabled but not running; their last spacers stay until they run again, when a pass runs.
- `flush()` runs pending passes, settle follow-ups included, until idle (at most the settle cap + 1), then returns the store's placement, or null after a failure. `isIdle()` is true when no pass is pending. `lastPass` is `{ count, timings, dispatched, dispatches }`, updated by every pass, the skip-rule fast path included (timings 0); the checker reads it.
- **Command**: `setPagination({ pageSetup, orientation, zoom, enabled, running })`. `ddoc-editor.tsx` calls it on the active tab editor whenever any input changes, and with `running: false` on an editor that stops being the active tab. Any changed field while running (zoom included) runs a pass on the next frame.
- **Inert** (`enabled` false): no measuring, no observers, no listeners, empty decoration set. Turning Pages off clears the spacers with one step-less transaction carrying `PAGINATION_META` `{ enabled: false }` (turning it on carries `{ enabled: true }`), so switching to Pageless is instant.
- **Plugin**: state is the spacer `DecorationSet`, mapped through every document-changing transaction and replaced only by the plugin's own meta. A `y-sync` transaction (remote edit, undo) replaces the whole doc in one step, which would drop every spacer; the plugin maps those through a step map built from the old and new docs' diff (`findDiffStart`/`findDiffEnd`) instead. Its `view()` owns the scheduler (§12.5) and the observers.

### 12.3 A pass

`collect → place → emit`, synchronous, in one frame.

1. **Collect.** `collectLeaves` (§4.2), with tables atomic (§12.1; rows are leaves since M2, §13.6). Every leaf's `top`, `bottom` and lines are **natural**: where they would be with no spacers. The walk skips spacer elements and takes their effect out of every measurement below them, including spacers inside a leaf (a split paragraph's lines after its spacer). A pass must never measure its own output, or two layouts feed each other.
   - **Margins around a spacer.** A spacer between two blocks stops their margins collapsing: with no spacer the gap is `max(mb, mt)`, with one it is `mb + S + mt`. Taking out `S` alone leaves the swallowed margin in the measurement. Edentext adds it back (`cumulativeDropped`) and gives some spacers a negative `margin-top`. The builder picks the mechanism; the requirement is that the natural positions do not depend on where the spacers are, which the settle check (§12.5) and I4 (§12.12) catch. Built: a spacer's `spacerCollapse` and the displacement it causes both come from one function over the effective (chain-collapsed) margins, with no collapse inside a flex or grid parent (its row gap counts instead).
   - **Node-view chrome is not measured.** Lines come from the node's `contentDOM` only; a code block's line-number gutter used to merge into its lines and, once a spacer moved the code, read back as phantom lines.
   - **Passes measure final layout.** In Pages, paragraphs transition only colour, background, border and opacity: their `transition-all` animated the margin a new paragraph gives its neighbour, so a pass on the next frame measured it half-grown.
   - **Whole tables carry their rows** (superseded in M2, §13.6: the whole-table leaf is gone). A table leaf also carries its rows' natural boxes and its header row's height, for `place`'s print model below.
2. **Place.** `place(leaves, grid)` (§4.2), unchanged except for the tall-leaf rule. Its output also carries, per break, the **spacer height**: the shift it adds. Heights are whole pixels; each spacer's rounding remainder carries into the next, so the screen stays within 0.5px of the placement (rounding each on its own drifted 2px by page 13).
   - **Tall leaf** (an atomic leaf taller than the text height, now including tables): it starts first on its page and nothing splits it. A tall leaf that is not first is pushed to the next page with a printing break, unless only the heading(s) that open its page sit above it (decision): pushing it again would leave them alone on a page, and print puts no break between them; on screen it runs over the sheet's bottom margin, the gap and the next sheets. **The leaves after it follow paper** (my call): `spill` places the next leaf where print puts it, and on screen a spacer before that next leaf moves it there. A generic atomic box fragments at the page capacity (text height plus the 20px slack). A table does not (M1; superseded in M2 by row leaves, §13.6): Chrome breaks it between rows, so `packRows` (decision) moves a row that does not fit the rest of the page to the next one whole, under the repeated header, and fragments only a row taller than a page's room. The header counts as repeated only when it is at most a quarter of the capacity (my reading of Chromium; not checked). That spacer opens no page in print, so the placement carries a spacer list separate from `breaks`. The spacer is never negative: a page holds more of the box on screen (whole page plus gap) than on paper. So one placement serves both, and page counts stay equal for generic atomic boxes (not for a tall columns block, whose columns Chrome breaks between lines: §13.12). A tall table can still print one page off: Chrome also splits a row between its cells' lines when that row would fit a fresh page (fixture 10 v2 A4: store 16, PDF 15). Matching it needs each cell's line boundaries, which is M2's row work (§12.13). (Superseded in M2, §13.6: `packRows` is gone and 10 v2 A4 matches, §13.12.)
3. **Emit.** Compare the placement with the spacers **actually in the view** (not the last computed placement: a node replaced by a paste or a language change drops its widgets, Edentext hit this). Equal: no dispatch. Otherwise build a `DecorationSet` and dispatch one transaction with no steps, carrying the plugin meta only. Never set `addToHistory: false`: `@tiptap/y-tiptap`'s sync plugin would call `undoManager.stopCapturing()` on it and split the user's undo steps (tech spec "What a pass does" step 4).

### 12.4 Spacers

- `Decoration.widget(pos, toDOM, { side: -1, key })`; `key` encodes the kind and the height, so an unchanged spacer keeps its DOM node across passes (Edentext: 1.5 s → 144 ms per keystroke at the top of a 124-page doc).
- Element: `div.ddoc-page-spacer`, `contenteditable="false"`, `role="separator"`, `aria-label="Page N"` (N = the page it opens), `pointer-events: none`, `height` in whole pixels (fractional heights shake by 1px at some zooms), no margin, border or padding of its own. A spacer that rounds to 0px is not emitted: an empty div lets margins collapse through it, so it would not displace what the placement assumed.
- **Where a `before` spacer goes.** Before the **outermost** node that starts with the leaf (walk up while the leaf's node is its parent's first child, stopping below the doc): before the `dBlock` in v1, before the list for a first list item. The leaf then lands at `contentTop + marginTop`, where `marginTop` is M0's `leadingOffset` of that chain, the same position print gives it after a forced break.
- **Where an `inText` spacer goes.** At the carried line's start position. A block `div` inside the textblock ends the line there and pushes the rest to the next page. Inside `pre` it is a block inside the `code` element.
- **Split boxes cross the gap** (decision, accepted for M1): a code block, callout, blockquote or list split by a spacer draws its border or background through the bottom margin, the desk gap and the next sheet's top margin. M2 cuts boxes at the sheet edge.
- **Hazards for the builder to check** (each has a fixture): an ordered list is a flex column, so a spacer between its items is a flex item and any `gap` counts on both sides of it; a spacer inside a code block shifts the line-number gutter against the text; a v1 spacer inside a `dBlock` sits in its node-view content beside the drag-handle chrome.
- **Code-block gutter** (built): the gutter adds the inText spacer's height before the row that spacer opens (`gutter-spacers.ts`), as an element with `ddoc-page-spacer-gutter`, which the parity check hides like a spacer. It follows the node view's row model, so with word wrap on it lands before the next gutter row, not the exact visual line (the gutter was already off there in Pageless).

### 12.5 Scheduler

`extensions/pagination/scheduler.ts`, one per plugin view, running only while `running` (§12.2).

| Trigger | Response |
| -- | -- |
| Local edit | Spacers mapped (`DecorationSet.map`). Full pass after 300 ms with no edits |
| Remote edit (transaction meta from `y-sync` with `isChangeOrigin`) | Same 300 ms wait. Not "run now": remote transactions also carry `addToHistory: false`, which Edentext reads as "not an edit" |
| Caret's block now ends past its page's text bottom, above its page's text top, or on a page the last pass did not have (held Enter, a long paste) | Pass on the next animation frame |
| `setPagination` with a change, mount, becoming the active tab, zoom change | Pass on the next animation frame |
| `document.fonts` `loadingdone`; a `ResizeObserver` hit on the content (late images, embeds) | Pass on the next animation frame |
| `view.composing` | No dispatch; reschedule for `compositionend` |

- **Skip rule**, checked when the 300 ms timer fires: every edit since the last pass stayed inside one textblock, that textblock holds no `inText` spacer, and the content's bottom edge did not move. Then nothing below can have moved: no pass.
- **ResizeObserver** watches the content's children, not `view.dom`, so the pass's own `min-height` change does not retrigger it; a pass that changes nothing does not dispatch, which ends any loop. A hit resets the settle guard, like an edit.
- **Settle.** After a dispatch, if the placement differs from the previous pass, run one more on the next frame, at most 4 in a row; only dispatching passes feed the guard, and a pass that matches ends the run. If the placement from two passes ago returns, keep the current one (no dispatch) and stop (oscillation). The count resets on the next edit or trigger. Both guards are pure functions over placements and unit-tested.
- **Flush**: `flush()` runs pending passes synchronously until idle (§12.2); print calls it (§12.10).

### 12.6 Sheets and page numbers

`components/page-sheets.tsx`, rendered inside `[data-ddoc-zoom-layer]` behind the editor content (`pointer-events: none`, `aria-hidden`), so it scales with zoom like the text. It reads the active tab's page store (§12.8) and draws nothing when Pages is not active or before the first pass has a count.

- **Geometry**: sheet `i` at `top = origin + i × (pageHeight + PAGE_GAP)`, `width = paper width`, where `origin` is the active editor's `view.dom` top within the zoom layer (the `PageGrid` frame). The `.ProseMirror` element gets `min-height = pageCount × (pageHeight + gap) − gap`, so the last sheet is always fully drawn.
- **Windowing**: only sheets within two screens of the visible part of the scroll container (`getEditorScrollContainer`, rAF-throttled scroll listener; the Split View swap of the scroller does not apply, Pages is off there).
- **Colours**: the sheet takes the canvas fill (`documentStyling.canvasBackground`, else today's canvas token); the space between sheets is the desk (`documentStyling.background`, else the editor background), so in Pages mode `#editor-wrapper` and `.ProseMirror` stop painting the canvas fill. Sheet edge: 1px existing border token, no shadow. Dark mode uses the same tokens' dark values. In focus mode the sheet takes the token fill: a custom `canvasBackground` is dropped there, as the canvas drops it today.
- **Page numbers**: one per sheet, plain digits from 1, each tab restarting at 1, beside the sheet (12px right of its edge, level with its bottom), not inside it. Like other chrome in the zoom layer they keep their 100% size (counter-scaled). Fit reserves `PAGE_NUMBER_GUTTER` (24px) more on the right in Pages mode so they never scroll the canvas sideways; at a fixed zoom wider than the canvas they hang past it, as the comment column does. 11px, secondary text token, the document font, not selectable, `aria-hidden` (the spacer's `aria-label` announces pages).
- Focus mode draws sheets as normal; presentation mode is untouched.
- Anything the zoom layer renders above `view.dom` (tags) sits on the desk above the first sheet, with no canvas fill behind it (my call).

### 12.7 Collapsed headings and layout-changing widgets in Pages mode

**Collapsed headings** (pulled forward from M2: hidden blocks measure as zero-size boxes and would corrupt every placement after them, and print serialises them anyway). While Pages is active, `buildHiddenDecorationSet` (`d-block/dblock-collapse.ts`) returns an empty set in both schemas and the collapse chevrons are hidden. The `isCollapsed` attribute is untouched; leaving Pages restores the collapsed view. The plugin rebuilds its decorations when Pages turns on or off, through its own meta.

**Widgets.** Decided (2026-11-02): hidden, so the screen's pages match print.

- **Pending suggestions.** The proposed-text widgets from `createSuggestionWidgetRenderer` (`comment-decoration-plugin.ts`) are `display: none` under `[data-page-mode='pages']`; the struck-through original range and the suggestion card in the rail stay. Any other suggestion decoration that changes layout (check the `suggestion-source-caret-hidden` node class) is hidden the same way.
- **Your own draft stays visible** (decision, 2026-11-02): text typed in suggest mode lives only in that widget (`anchor.isDraft`), so hiding it would hide the suggester's typing. The draft widget (and its `suggestion-source-caret-hidden` block) is exempt; while it is open the pass measures it as content, so that user's page breaks are off by the draft until it is submitted, after which it is hidden like any other. Print never includes it.
- **AI autocomplete** (`ai-autocomplete.ts`): while Pages is active it does not fetch a suggestion at all (my call), so Tab can never accept text the user cannot see. Hiding the ghost text with CSS alone would leave that trap.

### 12.8 Page store and page count

- `extensions/pagination/page-store.ts`: per tab editor, `{ enabled, pageCount, pageStarts, placement }`, published after each pass that changes them, read with `useSyncExternalStore` by `PageSheets`.
- `use-tab-editor.tsx`: while Pages is active for the active tab, `createPageCounter` does not run (no hidden iframe) and `statsPublisher.publish({ pages })` takes the store's count, published on every change. While the store has no count (before the first pass, or after a failure) today's counter still runs (decision). Leaving Pages resumes today's counter.

### 12.9 `:has()` cost

Measure the restyle cost of a spacer insert with Chrome's performance trace in the demo, on the 50,000 word fixture, with the `.editor-main-lane:has(...)` rules (`styles/index.css`) present and with them removed. If they cost more than a few ms per pass, replace the `:has()` with a class that React sets on `.editor-main-lane` from the floating-comment state it already holds. The numbers go in §12.13.

### 12.10 Print from the live layout

`printCurrentTab()` in Pages mode: `flush()` the active editor's scheduler, then take the breaks from the plugin's current placement instead of running `getPrintBreaks` again. The rest of the pipeline (§4.3) is unchanged. Because collect measures natural positions, a fresh run would give the same answer; reading the plugin's placement guarantees it and costs nothing. Print falls back to `getPrintBreaks` when the plugin has no placement (it failed, §12.11, or never ran). With tables atomic, print breaks before a table, never between its rows, in M1 (superseded in M2, §13.6).

### 12.11 Failures and instrumentation

- **No writes**: every pagination transaction is checked before dispatch; one with steps is not applied and logs `console.error`, in every build (the package has no dev flag). Unit test plus the I1 check (§12.12).
- **A pass throws**: caught, decorations cleared, that editor goes inert until reload (it renders as M0's single column at paper width), `console.error` in every build. The package has no Sentry; error reporting is the app's (M3).
- **Marks**: `performance.mark`/`measure` around collect, place and emit, named `ddoc:pagination:*`.
- **Debug**: the demo's `window.__ddocPages` gains the last pass's leaves, placement, pass count, dispatch count and timings (`storage.lastPass`), plus `sheetCheck()`, `stateVector()`, `watchWrites()`/`writes()` and `tabContent()` for the checker.

### 12.12 Gate

M1 is done when all of these hold. The layout checks extend `scripts/pages-print-check.cjs` (CDP against the demo on 5174, my call over the tech spec's Playwright, as in M0).

1. **I4, every leaf on a sheet**: on screen with spacers, every leaf's rect lies inside one sheet's text area, or it is taller than a page and first on its page or directly under the heading(s) that open it. Fixtures 01–03 and 05–10, both schemas, A4 and Letter, plus 01 landscape, zoom 1.5, Fit and 0.75, and 02 with its headings collapsed (it must lay out and print as expanded).
2. **I3, screen equals paper**: on the same matrix, each printed page starts where its sheet starts (M0's PDF markers; a page a tall box continues onto has none), and the PDF page count equals the store's `pageCount`. Accepted gap: a tall table's page count (§12.3).
3. **I1, no writes**: the content of every tab (each `Y.XmlFragment`) is identical before and after 50 passes driven by resizes, zooms and tab switches, and no transaction touches anything outside the host's `tabs_state`. Not the raw state vector: the demo's tab manager writes `activeTabId` on each switch, which is host state, not pagination.
4. **I2, undo**: the same typing script undoes in the same steps in Pages and Pageless.
5. **Settles**: after loading each fixture, passes stop within the cap and do not dispatch again without a trigger.
6. **Performance** on a generated 50,000 word fixture (fixture 11, `large()` in `demo/src/fixtures/pages/index.ts`; left out of the print check unless named with `--only`), Chrome, measured by a new `scripts/pages-perf-check.cjs` over CDP: keystroke latency in Pages within 10% of Pageless; extra cost per keystroke under 1 ms; one pass (collect and place) under 50 ms; emit and re-render under 16 ms. The fixture from ddocs.new #1122 was never committed, so M1 generates its own.
7. Unit tests green: settle and oscillation guards, spacer keys, the skip rule, the tall-leaf rule in `place`, no-steps assertion, `page-store`, the page count in `use-tab-editor`, AI autocomplete not fetching in Pages.

Safari and Firefox are spot-checked by hand on fixtures 01 and 10 (on-screen sheets only; their print is M0's).

### 12.13 Results

Run on 2026-11-02 at the M1 head, demo on 5174, headless Chrome over CDP (`scripts/pages-print-check.cjs`, `scripts/pages-perf-check.cjs`). Unit tests: `npm test` 188 files, 2363 passed, 3 skipped; `npx tsc` clean; `npx eslint --no-fix` on every file M1 touched: no new problems (the 9 prettier errors in `dblock-collapse.ts` and 6 hook warnings in `use-tab-editor.tsx` predate M1).

**Chrome matrix** (§12.12 items 1, 2 and 5; 44 cases: fixtures 01, 02, 02c, 03, 05–10 × v1/v2 × A4/Letter, plus 01 landscape). **36/44 pass**; the 8 failures are the two accepted gaps below. Pages are store/PDF.

| Fixture | Sheets (I4) | Markers (I3) | Pages (I3) | Parity | Settle |
| -- | -- | -- | -- | -- | -- |
| 01 prose (+ landscape) | ok | ok | equal, every case | ok | ok, 2–4 passes |
| 02 headings, 02c collapsed | ok | ok | equal (13, 14) | ok | ok |
| 03 lists, 06 code, 07 fonts, 08 breaks/containers, 09 columns | ok | ok | equal, every case | ok | ok |
| 05 images | ok | ok | equal (9, 11) | image ~50px taller on screen (§10) | ok |
| 10 proposal | ok | ok, except v2 A4 | equal, except v2 A4: 16/15 | image, as 05 | ok |

- Settle: every case stops within 2–4 passes and does not dispatch again in the next 2 s.
- Zoom 1.5, Fit and 0.75 (fixture 01, A4, both schemas): the same spacers as at 1, sheets ok, no dispatch.
- 02c: the 15 collapsed headings lay out and print as expanded.
- Fixed on the way (during M1): spacer rounding drift (§12.3), the code-block gutter (§12.3, §12.4), paragraph margin transitions (§12.3), and a tall leaf placed mid-page (§12.3).

**Invariants** (`--invariants`, both schemas): all pass.

| Check | v2 | v1 |
| -- | -- | -- |
| I1, no writes | 50 passes, 0 dispatched; 2 tabs' content equal; no write outside `tabs_state` | same |
| I2, undo | 6 undo steps in Pages and in Pageless, across a pass that dispatched | same |
| Enter at the end (held, 60×) | 15 → 18 pages, caret always on a sheet, sheets ok | same |

**Performance** (§12.12 item 6; fixture 11, ~50,000 words, A4, 180 pages in v2 and 182 in v1). Numbers from the M1 performance run. The gate rerun agrees within noise: collect + place 22.0 / 20.3 ms, emit median 12.6 / 13.4 ms (max 18.7 / 20.4), emit on the first pass after typing 16.5 / 17.3 ms (v2 / v1).

| Budget | v2 | v1 | Result |
| -- | -- | -- | -- |
| Keystroke median, Pages ÷ Pageless (≤ 1.10) | 0.995 | 1.004 | pass |
| Extra per keystroke, typing (< 1 ms) | −0.06 ms | 0.05 ms | pass |
| Per keystroke with the passes after it counted | ≈ 0.6 ms | ≈ 0.9 ms | pass |
| Collect + place, median (max) (< 50 ms) | 22.1 (23.9) ms | 21.8 (25.3) ms | pass |
| Collect + place, first pass after typing | 37.3 ms | 43.5 ms | pass |
| Emit, median (max) (< 16 ms) | 12.0 (18.9) ms | 15.4 (21.0) ms | median passes |
| Emit, first pass after typing | 15.8 ms | 18.2 ms | v1 misses (v2 too in the rerun) |

- Emit is close to the line. About 9 ms of it is a forced layout inside `dispatch`: the pass's own reads after it dispatches (`contentBottom`, `observeChildren`) and the host's `useEditorState` selector (`hooks/use-editor-commands.ts`, `readEffectiveSpacing`), which reads computed margins on every transaction. That layout would otherwise run in the next frame, so it mostly moves cost.
- Before the M1 performance fixes one pass took ~4,450 ms on this fixture (the hyphen hit test per line, and a spacer scan per leaf). The fixes changed no placement: same-DOM comparison of old and new `collectLeaves`/`place` on 10 fixtures × 2 schemas, identical.
- **`:has()` (§12.9)**: a pass's style recalc is 0.02 ms median with the 6 `.editor-main-lane:has(...)` rules and without them. Edentext's ~150 ms per inserted spacer does not happen with this selector in current Chrome, so the rules stay (decision).

**Accepted gaps** (decision):

- **05 and 10, image parity**: the media node view's editing chrome (§10). Break-neutral: sheets, markers and page counts pass. M2. (Closed in M2, §13.5, §13.12.)
- **10 v2 A4, tall-table page count**: store 16, PDF 15. Chrome splits a 492px row between its cells' lines; `packRows` moves the row whole (§12.3). Pages after the table are one page off in that print. The other three fixture 10 cases match. M2 (row leaves with cell line boundaries). (Superseded in M2, §13.6: rows are leaves, 15/15, §13.12.)

**Pending, manual** (the user runs these; not yet done):

- Safari and Firefox: fixtures 01 and 10, on-screen sheets only, A4 v2: every leaf on a sheet, page numbers drawn, no content in the gaps.
- Live Chrome, in the demo:
  - dark mode: sheet, desk and page numbers take the dark tokens;
  - focus mode: sheets drawn with the token fill;
  - two tabs: switch back and forth; each tab keeps its own pages and numbers restart at 1; note any flash of the old layout on return (hidden tabs keep their spacers, §12.2);
  - collapsed headings (02c): shown expanded in Pages, chevrons hidden;
  - turning Pages off with collapsed headings: spacers gone and the collapsed view back in the same frame, no stale `aria-label="Page N"`;
  - suggest-mode draft: your own draft visible while typing, others' proposals hidden, the draft hidden once submitted;
  - typing at the end of the last page (Enter held, then text): a new sheet appears, the caret never sits below the last sheet.

**Known limits, for M2**:

- The first exact page count can be dropped if the active-editor ref is not yet this editor when the store publishes; the footer would keep the previous count. Practically unreachable: the ref is set before the editor switch, and on first mount the store has no count yet.
- Typing inside a table or columns block taller than a page triggers a full (non-dispatching) pass per keystroke. M2: skip textblocks inside tall atomic blocks.
- The 300 ms debounce has no maximum wait, so continuous remote edits keep delaying passes. M2: add a ~1 s max wait.
- A justified paragraph's line just before an in-text spacer may render ragged on screen though the line breaks are unchanged.
- `packRows` is checked in Chrome only. The quarter-page header-repeat rule is unverified, and a header can be counted twice when row 0 moves. (Superseded in M2, §13.6: `packRows` is gone; the quarter rule is now ours on both sides.)
- Settled spacer heights can differ by ±1px between runs (pairs carried, page positions unchanged): a pair on a .5px rounding boundary settles on either fixed point.
- `Line.startPos`, `Leaf.marginTop` and `Leaf.spacerCollapse` are measured on first read: read them before the next DOM write.
- Code gutter with word wrap: the gutter spacer lands before the next gutter row, not the visual line (§12.4).
- Not pagination, seen in every run: `TypeError ... naturalWidth` in the image node view's `onload` when navigating mid-load; the demo's v1 fixture loader sometimes appends to the doc (§7.5).

## 13. M2: feature fit

### 13.1 Intent and scope

M1 put pages on screen. M2 closes the places where the screen and the printout still differ, or where Pages mode looks unfinished, and makes every way of printing go through the Pages pipeline. Found in the demo (2026-11-03): File ▸ Print and Cmd/Ctrl+P print with Pageless's 0.83 inch side margins, because they still call `handleContentPrint(editor.getHTML())`; only the styling panel's Print button runs `printCurrentTab()` (measured: its PDFs have 1.00 inch side margins on A4, Letter and landscape, as do M0's Safari and Firefox PDFs). And Cmd+Enter opens the link popup instead of inserting a page break.

**In M2**, in this order (my call: the order of the plan, user-visible fixes first):

1. Every print path through the Pages pipeline (§13.2).
2. Page-break and link shortcuts (§13.3).
3. Carry-overs from M1: split `index.ts`, the debounce's max wait, quiet passes inside tall blocks, a host failure callback, wiring and listener tests (§13.4).
4. Images, the media editing chrome and atoms taller than a page (§13.5).
5. Table rows as leaves (§13.6).
6. Split boxes cut at the sheet edge (§13.7).
7. The page-break block in Pages mode (§13.8).

**Not in M2**: anything in ddocs.new (M3: wiring `printCurrentTab()` to its File ▸ Print, the page setup UI, `onPagesError` to Sentry); headless export (`useExportHeadlessEditorContent`, §13.2); Pageless print gaining image embedding or Mermaid on the paths that skip them (the tech spec suggests it; it changes Pageless output, an anti-goal); the M1 manual QA checklist (§12.13), which the user still runs.

**Anti-goals** (§2, unchanged): no Yjs write, no change to Pageless rendering or Pageless print output, no new runtime dependency.

**Departures from the Linear specs** (decision, user, 2026-11-03): the product and tech specs keep ⌘+Enter on the link popup and give Mac users no page-break shortcut. M2 makes ⌘+Enter a page break and moves the link popup to ⌘/Ctrl+K (§13.3). The Linear product spec should be updated to match.

### 13.2 Every print path through the pipeline

One function prints the active tab: what `printCurrentTab()` runs today (`buildPrintHtml` with `resolvePrintPlacement`, then `handleContentPrint(html, options)`, `ddoc-editor.tsx`). Every path below calls it when the doc's `pageSetup.mode` is `'pages'`, so in Pages mode the print dialog always shows the 1 inch sheet and the screen's breaks, whichever way the user printed. It keeps §4.3's rule: Pages wanted but not active (editor under 1024px, Split View, version history) prints with the Pages CSS and no computed breaks.

| Path | Today | Pages mode | Pageless |
| -- | -- | -- | -- |
| `printCurrentTab()` (handle) and the demo styling panel's Print button (calls `buildPrintHtml` directly) | the pipeline | unchanged | unchanged |
| Cmd/Ctrl+P in the editor (`use-tab-editor.tsx`, the print shortcut effect) | `handleContentPrint(editor.getHTML())` | the pipeline | unchanged |
| Toolbar Print (`printHandler`, `components/editor-utils.tsx`) | image embedding, Mermaid, `handleContentPrint` | the pipeline | unchanged |
| Export ▸ PDF, current tab (`exportOptions` PDF item, same file) | as toolbar Print, plus the loader | the pipeline, same loader | unchanged |
| Export ▸ PDF, all tabs (`exportAllTabsAsPdf`, `hooks/use-ddoc-export.ts`) | each tab's `getHTML()` | the active tab with its live breaks; every other tab with the Pages CSS and the browser's breaks (tech spec "All-tabs export"); each tab, and each tab-title page, starts a new page | unchanged |
| Demo File ▸ Print (`demo-app-actions.ts`) | `handleContentPrint(liveEditor.getHTML())` | `editorRef.printCurrentTab()` in both modes, as the tech spec plans for ddocs.new | prints as `printCurrentTab()` does in Pageless (demo only) |
| Presentation mode print (`handlePrint(slides)`) | slides | unchanged | unchanged |
| Headless export (`useExportHeadlessEditorContent`) | `handleContentPrint(tempEditor.getHTML())` | unchanged in M2: it has no layout and no `pageSetup`; M3 decides whether ddocs.new passes one (then it prints like "Pages, not active") | unchanged |

- **Pageless unchanged** means byte-identical HTML and options to today's call on each path. A unit test per path checks both modes.
- The Cmd/Ctrl+P effect lives in `use-tab-editor.tsx`, which does not hold the print inputs (`printInputsRef` in `ddoc-editor.tsx`: image fetchers, `pageSetup`, `isPagesActive`). How the shortcut reaches the pipeline is the builder's call (a callback passed down, or the shortcut moved up); the requirement is one code path, not a copy.
- All-tabs in Pages mode: Pages print is flat (§4.4), so the tab boundaries need the same forced break the Pages CSS gives a page break; the builder checks the joined HTML breaks at every tab and title page in Chrome. The `tab-title-page` styles live only in Pageless's print sheet (`CONTENT_STYLES`, not emitted in Pages), so the Pages print CSS restates them.

### 13.3 Page-break and link shortcuts

Decision (user, 2026-11-03):

| Keys | Today | M2 |
| -- | -- | -- |
| ⌘+Enter (Mac) | link popup (`components/editor-utils.tsx`, `handleKeyDown`) | page break |
| Ctrl+Enter (Windows, Linux) | Tiptap default: hard break (exit code block inside one) | page break |
| ⌘/Ctrl+K | nothing on desktop; link popup in the mobile toolbar (`mobile-toolbar.tsx`) | link popup, toggling as on mobile |
| Alt/Option+Enter | link popup | unchanged (my call: only ⌘+Enter was asked to move) |
| Shift+Enter | hard break | unchanged |

- **Where the break goes** (my call). `pageBreak` is allowed only at the top level (`(dBlock|columns|pageBreak)+` in v1, `(block|columns|pageBreak)+` in v2), so `setPageBreak()`'s `insertContentAt` at a nested caret makes ProseMirror close (split) the surrounding list or table, or fail; and every node-type change kills comment anchors inside (AGENTS.md, Lists).
  - Caret in a top-level paragraph or heading: at the caret, as `setPageBreak()` does today (the paragraph splits; an empty paragraph is replaced).
  - Caret inside any container (list item, table cell, columns, blockquote, callout): the break goes after the enclosing top-level block and the caret moves to the start of the block after it; nothing is split.
  - A selected block (an image, rule, embed or v1 dBlock): the same as a container: the break goes after its top-level block and the caret moves to the block after it (a new empty paragraph if there is none); the block stays. With everything selected or a gap cursor at the top level, the key does nothing and is swallowed, so Tiptap's `Mod-Enter` cannot replace the selection with a hard break.
  - The menu item and slash command keep today's behaviour (§2 anti-goal on Pageless); the shortcut gets its own command with these rules.
  - `setPageBreak` does position arithmetic (`pos - 2` for an empty paragraph), which differs between v1 and v2 (`docs/POSITION_AUDIT.md`): every rule gets a v1 and a v2 test.
- **Inside a code block** ⌘/Ctrl+Enter exits it, as Tiptap's `Mod-Enter` does today: the handler returns `false` there so the keymap runs. `editorProps.handleKeyDown` runs before keymaps, which is why the shortcut lives in that handler (tech spec).
- **Modifiers are exact**: ⌘ without Ctrl, Alt or Shift on Mac; Ctrl without ⌘, Alt or Shift elsewhere. Ctrl+Enter on a Mac keeps today's behaviour.
- **Both modes** (decision, user, 2026-11-03): the shortcut inserts a page break in Pageless too, like Google Docs; a page break already exists and prints in Pageless. The product spec says Pages mode only.
- Any tooltip, shortcut list or help text that names ⌘+Enter for links is updated.
- Node views with their own Ctrl/⌘+Enter (`ai-writer-node-view.tsx`, comment cards) handle it in their own inputs, outside the editor's `handleKeyDown`; the builder checks they still submit.
- The desktop link handler lives in `useEditorToolbar`, installed by whichever toolbar instance registers last; the mobile toolbar binds ⌘/Ctrl+K on `document`. The two must not both toggle on one keypress. ddocs.new's e2e tests already expect Mod+K to open the link dialog; its shortcut popup lists ⌥+Enter, which stays.

### 13.4 Carry-overs from M1 (§12.13 Known limits)

- **Split `extensions/pagination/index.ts`** (~510 lines). No behaviour change; the existing tests pass with at most import changes. Module boundaries are the builder's call (for example the `PaginationView` controller, the plugin's state and mapping, the extension).
- **Max wait on the debounce**: the 300 ms wait runs a pass at the latest 1 s after the first edit of a burst, local or remote, so continuous edits cannot hold passes back. The perf check (§12.12 item 6) is rerun with a typing script longer than 1 s; if the budget breaks, the max wait applies to remote edits only.
- **Quiet passes inside tall blocks**: a keystroke in a textblock inside an atomic leaf taller than a page triggers no pass unless that block's height changed. Today `caretOverflows` fires every keystroke there because the textblock always ends past its page's bottom. With table rows as leaves (§13.6) and images capped (§13.5) this is mostly sliced columns blocks (§13.5).
- **Host failure callback**: a new optional `DdocEditor` prop, `onPagesError?: (error: unknown) => void` (name is my call), called once when a tab editor's pagination fails (§12.11), after the `console.error`. The package sends nothing anywhere; ddocs.new wires it to Sentry in M3 (tech spec: counts only, never content). Exported in the props type.
- **Wiring and listener tests**: `ddoc-editor.tsx` calls `setPagination` on the active tab editor whenever an input changes, and with `running: false` on the editor it leaves; observers and listeners (`ResizeObserver`, `document.fonts`, scroll, composition) attach on start and detach on stop and destroy.
- Stays a known limit: the first exact page count dropped when the active-editor ref lags (practically unreachable, §12.13).

### 13.5 Images, media chrome and atoms taller than a page

**Media editing chrome** (§10). In edit mode the media node view (`resizable-media-node-view.tsx`) puts a grey padded frame (`p-2 pt-1 color-bg-secondary`) and a toolbar row (`flex gap-1 p-1 mb-1`) in flow, ~45–55px that print does not have (fixtures 05 and 10 fail parity on it). In Pages mode the frame's padding and background go and the toolbar overlays the media's top-right corner, shown on hover and while the node is selected (my call on the look; Pageless keeps today's frame). Requirement: in Pages mode the media block's on-screen height equals its print height, so 05 and 10 pass the parity check.

**Media scales to fit** (product rule 4): everything the media node view draws (`img`, secure image, native `video`, its `iframe`; my call: they share a stored width and aspect ratio, and a clip would cut a video's controls). In Pages mode such media is never taller than the page's text height, keeping its aspect ratio; a wide image narrows with it. The whole media block, caption included, fits one page's text height. Same rule in print (the Pages print CSS restates it). The stored width attribute is untouched; resizing still writes it. The caption allowance covers a one-line caption: a longer caption makes the block taller than its cap, and it then follows the tall-leaf rule (§12.3). Screen and print use the same allowance, so they stay equal (known limit). CSS `max-height` alone cannot keep the aspect ratio of an `img[width]` or an `iframe`, so in Pages the node view publishes `--ddoc-media-ratio` on its box from a ref and an effect (`useMediaRatio`, `media-ratio.ts`; decision), and Pageless DOM is untouched.

**Other atoms taller than a page** (tweets, Mermaid in preview, action buttons, AI writer, embeds outside the media node view, columns), decided (user, 2026-11-03):

- **Not editable** (tweets, Mermaid preview, action button, AI writer, other embeds): clipped at the page's text height (`max-height` and `overflow: hidden`, screen and print), per product rule 4. They never become tall leaves.
- **Columns** (editable): not clipped, because a clip would hide text the user typed and can still put the caret in. A columns block taller than a page splits at the sheet edge inside its columns, as a tall table row splits inside its cells (§13.6; decision, user, 2026-11-03, replacing M1's run-over). The block is a one-row grid (`[data-type='columns']`, `editor.css`), so each column is a lane: `collectLeaves` gives its atomic leaf the same lazy `cells` as a single row (lines of every textblock in each column, boxes of its non-text blocks), and `place`'s `splitRow` puts an inText spacer in each crossing column at its first line that does not fit, one line kept per column per page; print gets a `printPageBreak` at the same positions. No header logic. The block ends where its lowest column ends. It keeps the tall-leaf rule (§12.3: it runs over the margins and gap, unmasked, §13.7) when the split is refused for a row's reasons (no line to break at in any crossing column, a non-text block straddling the bottom, a kept line in the band) or when the grid wraps its columns onto more than one row (any column's top differs from the first's; at most two columns sit side by side below 768px). An edit inside a split columns block skips the scheduler's quiet path (`inSplitRow`). Safari ignores `break-before` inside grid items (§7.5), so its print of a split columns block is recorded, not gated.
  - **Probe result** (2026-11-03, Chrome 156, headless `Page.printToPDF` with `preferCSSPageSize`, A4, the Pages print CSS, a `repeat(2, minmax(0, 1fr))` grid whose columns hold ~1.6 pages of paragraphs, a `display: block; break-before: page` span before a chosen word in paragraph 7 of the left column and paragraph 5 of the right): Chrome breaks each grid item independently at its own forced break, so page 2 starts with the chosen word at the top of both columns (pdfjs text by x position), and the paragraph after the block follows the column that ends lowest. Built.

### 13.6 Table rows as leaves

The product spec: "Tables: split between rows. The header row repeats on the next page." M1 placed a table as one atomic leaf and let print break it where Chrome chose (`packRows`), which misses fixture 10 v2 A4 (store 16, PDF 15): Chrome split a 492px row inside its cells. M2 decides every row break itself, on screen and on paper, so Chrome has nothing left to choose.

- **Leaves**: `collectLeaves` runs with `tableRows` on (M0's per-row walk, `visitTable`). M1's whole-table leaf (`wholeTable`) and `packRows` go (my call).
- **Placement**: a row is atomic. A row that does not fit the rest of the page moves to the next page whole, with a printing break before it, under a repeated header; a header row moves with the row after it (existing keep-with-next). A row that fits a fresh page is never split, whatever Chrome would do: the forced break takes the choice away from print.
- **Header repeat**: the header repeats on a continued page when it is at most a quarter of the page capacity (the existing `repeated` rule, my call to keep it). This is now our rule on both sides: the print copy clones the header into a piece only when the screen repeats it.
- **Spacer in a table**: two widgets at the row's position, in order: a borderless spacer `tr` (one cell spanning every column, no padding or border, the spacer height) and, when the header repeats, a `contenteditable="false"` clone of the header row. Both carry the spacer class, so `collectLeaves` skips them and takes their height out of natural positions (§12.3). The clone's key includes the header's content, so an edited header re-clones. An edit inside a repeated header row, or inside a row split in its cells, skips the scheduler's quiet path, so the clones and the other cells refresh on the next pass (`inRepeatedHeader`, `inSplitRow` in `scheduler.ts`; decision). A break before row 0 goes before the table's outermost node, like any first child (§12.4).
- **Print**: unchanged from M0 (§4.3 item 6): the print copy splits the table at every row break and clones the header and `colgroup` into each piece, pinned to the live column widths. This already makes WebKit honour row breaks.
- **A row taller than a page** (first on its page and taller than the room under the header): split inside its cells. In each cell whose content crosses the page bottom, an inText spacer goes at the first line that does not fit (one line kept is enough, as for a text leaf taller than a page); print gets a `printPageBreak` at the same positions. No header is repeated across an in-cell split, on screen or in print: the piece holding that row prints its header as an ordinary first row, not a `thead` (my call; a header cannot sit inside a row on screen). Before relying on it, the builder probes whether Chrome and WebKit honour a forced break inside a table cell; WebKit is expected not to (§7.5), and that result goes in §13.10 as a Safari gap. **If Chrome ignores it** (my call): the in-cell split is not built; a row taller than a page keeps M1's tall-leaf rule, unmasked (§13.7), and fixture 12's tall-row case becomes a recorded gap.
  - **Probe result** (2026-11-03, Chrome 156, headless `Page.printToPDF`, A4, two-cell border-collapse table): Chrome honours a `display: block; break-before: page` span inside a cell's paragraph, in each cell independently and at a different line per cell, so page 2 starts with the chosen words in both cells; with a `thead` it repeats the header on every continued page, hence the body-row rule. Built. WebKit was not probed (no headless print driver here) and is expected not to honour it (§7.5). A row joined by a rowspan, or one with no line to break at in any crossing cell, keeps the tall-leaf rule; so does a row whose split would leave content in the masked band (decision, review): a cell's non-text block (media, embed, nested table, columns) that the cut does not move ends below the page bottom, or the line a cell keeps starts at or below it. After a split the row ends where its lowest cell now ends, and the leaves after it follow from there.
- **Hazards for the builder**: tables use `border-collapse: collapse` (`editor.css`), so the spacer row must not draw or steal borders; prosemirror-tables plugins (column resizing, cell selection) must ignore the widget rows; the v1 `dBlock.is-table` width cap and `.tableWrapper` scroll container (Pages already lets it overflow in print) must not clip the clone.

### 13.7 Split boxes cut at the sheet edge

M1 accepted that a code block, callout, blockquote or list split by a spacer draws its border or background through the bottom margin, the desk gap and the next sheet's top margin (§12.4). Print slices such a box at the page edge (`box-decoration-break: slice`, the default). M2 cuts it on screen the same way.

- **Mechanism** (my call): `PageSheets` also draws a **mask** at every sheet boundary it draws (same windowing): from page *i*'s text bottom to page *i+1*'s text top, sheet-width, painted like what is there with nothing on it (sheet fill in the two margins, desk in the gap, the sheet edges redrawn). It sits above the editor content and below every piece of chrome in the zoom layer (drag handle, floating menus, carets, comment and suggestion chrome, page numbers), `pointer-events: none`, `aria-hidden`.
- Nothing a pass places sits wholly in that band (text, rows and atoms end at or above the text bottom; an in-cell or in-column split that would put a cell's atom or kept line there is refused, §13.5, §13.6), so the mask hides box decoration and the lower part of a cell's first line that already crosses the bottom (one line kept, as for a tall text leaf).
- **No mask across a tall leaf**: a boundary that a tall atomic leaf runs over (its next page starts `continued`) gets no mask, because that leaf's content is in the band (§13.5). A row or columns block split inside its cells or columns starts its pages `inText`, so its boundaries are masked; only one whose split was refused runs over unmasked.
- The cut is at the text bottom; print fills to the page area's bottom (text bottom + the 20px slack). That 20px of background is the one accepted visual difference.
- Dark mode, focus mode and a custom `canvasBackground` follow the sheet's own colour rules (§12.6).

### 13.8 The page-break block in Pages mode

Today the page-break node view is a full-bleed grey strip (`color-bg-secondary`) with a hover "Remove page breaker" button (`page-break-node-view.tsx`). In Pages mode the jump to the next sheet already shows the break, so the break is invisible (user decision, 2026-11-03, replacing the thin marker first built): the node view is an empty zero-height wrapper, and the Pageless `.node-pageBreak` height, margins and fill are zeroed under `[data-page-mode='pages']`. Placement is unchanged, since a forced leaf has no geometry. Backspace at the start of the top-level block after it deletes it in one press (v1 would otherwise select it first; `PageBreak`'s keymap, Pages only). Pageless keeps today's views, focus and preview mode included.

### 13.9 Decided after the builder check

Both decided by the user on 2026-11-03, each departing from the product spec:

1. Tall non-editable atoms are clipped at the page's text height. The product spec cuts everything but images at the page bottom. A tall columns block is not clipped; its first decision here (it runs over the margins and gap, as in M1) is superseded by the user's decision of 2026-11-03: it splits inside its columns at the page bottom, like a tall table row (§13.5).
2. ⌘/Ctrl+Enter inserts a page break in Pageless too (§13.3). The product spec says Pages mode only.

### 13.10 Gate

M2 is done when all of these hold (`scripts/pages-print-check.cjs` and `scripts/pages-perf-check.cjs`, CDP against the demo on 5174, as in M1).

1. **Chrome matrix**: fixtures 01–10 and 02c, plus a new fixture 12 (an image taller than a page, a captioned image near a page tall, a columns block taller than a page, an embed and a Mermaid diagram taller than a page, a table with a header row and a row taller than a page, a table with no header row), both schemas, A4 and Letter, plus 01 and 04 landscape. Every case passes sheets (I4), markers and page count (I3), parity and settle. That includes 04 (back in the matrix with row leaves), 05 and 10 parity, and 10 v2 A4's page count. The tall-row case is gated in Chrome only if the in-cell probe (§13.6) says Chrome honours the break; the tall columns block, only if the grid probe (§13.5) does. Both probes said yes.
2. **Invariants**: I1, I2 and Enter-at-end (§12.13), both schemas.
3. **Performance**: the §12.12 item 6 budgets on fixture 11, with the max wait on (§13.4). The first emit after typing (16–18 ms in M1) is reported, not gated.
4. **Print paths**: a unit test per path in §13.2 (Pages mode reaches the pipeline with the live placement; Pageless makes today's exact call). Manual, in the demo: File ▸ Print and Cmd+P in Pages mode show the 1 inch sheet in Chrome's print dialog.
5. **Shortcuts**: unit tests, v1 and v2: ⌘+Enter (Mac) and Ctrl+Enter (Windows) insert a page break where the menu item does; inside a code block they exit it; ⌘/Ctrl+K opens the link popup; Alt+Enter still does; ⌘+Enter no longer does.
6. **Unit tests** for every new rule: row placement and header repeat, in-cell split positions, the max wait, the tall-block quiet rule, `onPagesError` called once, the wiring and listener tests (§13.4). `npm test`, `npx tsc` clean, `eslint --no-fix` on touched files with no new problems.
7. **Manual spot checks** (the user): Safari, on-screen sheets for 04 and 10, a print of 04 at A4 v2 (row breaks), and a print of 12 at A4 v2 (a row split inside its cells and a columns block split inside its columns: WebKit was not probed, §13.6; it cannot break inside grid items either, §13.5 records the columns case as not gated); live Chrome: the media toolbar overlay, the invisible page break, the mask at a split code block in light and dark mode.

### 13.11 Left to the builder

Internal names and module boundaries, how Cmd/Ctrl+P reaches the pipeline (§13.2), the mask's DOM (§13.7), the exact media toolbar overlay styling within the rules above, fixture 12's wording, and how each probe is run.

### 13.12 Results

Run on 2026-11-03 at the M2 head (`b4b7191f`), demo on 5174, headless Chrome 156 over CDP (`scripts/pages-print-check.cjs`, `scripts/pages-perf-check.cjs`). Unit tests: `npm test` 195 files, 2540 passed, 3 skipped; `npx tsc` clean; `npx eslint --no-fix` on the 51 code files M2 touched: 10 problems, all present before M2 (3 prettier errors in `action-button-node-view.tsx`, 7 hook warnings in `use-tab-editor.tsx` and `editor-utils.tsx`), none new.

**Chrome matrix** (§13.10 item 1; 56 cases: fixtures 01–10, 02c and 12 × v1/v2 × A4/Letter, plus 01 and 04 landscape). **56/56 pass** after the columns split (§13.5; rerun 2026-11-03, `npm test` 195 files, 2540 passed, 3 skipped): 55 in one run, and 06 v2 Letter, which hit a harness error in it (`pass()` returned no store), passed on a rerun with a fresh profile. The first run, before the split, had 54/56: fixture 12 v2's tall columns block printed a page longer than the screen. Pages are store/PDF.

| Fixture | Sheets (I4) | Markers (I3) | Pages (I3) | Parity | Settle |
| -- | -- | -- | -- | -- | -- |
| 01 prose (+ landscape), 02, 02c, 03, 06–09 | ok | ok | equal, every case | ok | ok, 2–4 passes |
| 04 tables (+ landscape) | ok | ok | equal (v2 27–28, v1 30–31) | ok | ok |
| 05 images | ok | ok | equal (8, 9) | ok | ok |
| 10 proposal | ok | ok | equal, v2 A4 15/15 | ok | ok |
| 12 tall blocks | ok | ok | equal (v2 32, 33; v1 33, 34) | ok | ok |

- 04 is back in the matrix and passes with row leaves and repeated header clones; 10 v2 A4 now matches (§12.13's 16/15 gap closed, §13.6).
- 05 and 10 parity pass: the media block's on-screen height equals its print height (§13.5).
- 12: the in-cell row split, the in-column split of the tall columns block (v2 A4: pages 7–9 start inside its columns), the clipped embed and Mermaid, the capped images and the 30-row headerless table all match paper.
- Zoom 1.5, Fit and 0.75 (fixture 01, A4, both schemas): same spacers as at 1, sheets ok.
- 01 v1 A4 landscape printed 33 pages (both sides agree): the demo's v1 loader appended the fixture to the previous case's doc (§7.5); the check stays valid.
- Fixed while running the gate: the debug marker of a page that starts with an iframe was missing from the PDF (it was inserted inside the `<iframe>`, which renders no children); it now sits in a block wrapping the iframe, which takes over its break (`addDebugMarkers`, debug path only). And I1 failed in both schemas (18–19 dispatching passes out of 50): a row spacer's repeated-header height is measured, so at Fit it differed by float noise (29.078125 vs 29.07816) and changed the decoration key; the keys now carry it in whole pixels.

**Invariants** (§13.10 item 2, `--invariants`): all pass.

| Check | v2 | v1 |
| -- | -- | -- |
| I1, no writes | 50 passes, 0 dispatched; 2 tabs' content equal; no write outside `tabs_state` | same |
| I2, undo | 6 undo steps in Pages and in Pageless, across a pass that dispatched | same |
| Enter at the end (held) | 15 → 18 pages, caret always on a sheet, sheets ok | same |

**Performance** (§13.10 item 3; run on the Task 14 code, before the columns split: Task 15 changed only the scheduler's quiet-path exception and columns collection, and fixture 11 has no columns block; fixture 11, A4, 179 pages, max wait on: the 200-key script types for ~10 s, so passes run every ~1 s while typing). Two runs per schema; the spread is run-to-run noise.

| Budget | v2 | v1 | Result |
| -- | -- | -- | -- |
| Keystroke median, Pages ÷ Pageless (≤ 1.10) | 0.97, 0.79 | 1.08, 0.97 | pass |
| Extra per keystroke (< 1 ms) | −0.37, −2.66 ms | 0.88, −0.35 ms | pass |
| Collect + place, median (max) (< 50 ms) | 23.6 (24.4), 23.8 (24.7) ms | 22.6 (25.4), 22.0 (24.4) ms | pass |
| Emit, median (max) (< 16 ms) | 13.4 (14.6), 13.6 (15.0) ms | 14.8 (18.8), 14.6 (16.9) ms | median passes |
| Emit, first pass after typing (reported, not gated) | 13.6, 14.3 ms | 16.4, 16.1 ms | M1: 15.8 / 18.2 ms |

- While typing (the table's emit rows are the forced passes after an Enter), dispatching passes emitted in 10.2–14.3 ms (v2) and 16.1–16.4 ms (v1); passes that changed nothing, in 0.3–0.8 ms. Style recalc per pass, median 0.02–0.03 ms (§12.9 unchanged).

**Print paths, shortcuts, unit rules** (§13.10 items 4–6): unit tests per path in `editor-utils.test.tsx` (toolbar Print, Export ▸ PDF), `use-tab-editor.test.ts` (Cmd/Ctrl+P), `use-ddoc-export.test.tsx` (all tabs), `demo-app-actions.test.ts` (demo File ▸ Print) and `print.test.ts` (`printPagesTab`); shortcuts in `editor-utils.test.tsx` (keys) and `page-break.test.ts` (where the break goes, v1 and v2); row placement, header repeat and in-cell split in `place.test.ts` and `collect-leaves.test.ts`; max wait and the tall-block quiet rule in `scheduler.test.ts`; the wiring and `onPagesError` in `use-pagination-sync.test.tsx` and `index.test.ts`; listeners in `index.test.ts`. All green.

**Probes** (§13.5, §13.6): Chrome honours a forced break inside a table cell, per cell, and inside a grid item, per column; both built. WebKit not probed.

**Pending, manual** (the user runs these; not yet done):

- §13.10 item 4: in the demo, File ▸ Print and Cmd+P in Pages mode show the 1 inch sheet in Chrome's print dialog.
- §13.10 item 7: Safari, on-screen sheets for 04 and 10, a print of 04 at A4 v2 (row breaks) and a print of 12 at A4 v2 (a row split inside its cells and a columns block split inside its columns; expected to fail in WebKit, which then records it as a Safari gap); live Chrome: the media toolbar overlay (hover, selection), the invisible page break (no gap or strip, one Backspace removes it), the mask at a split code block, callout, blockquote and list in light and dark mode, and at a custom `canvasBackground`.
- M1's checklist (§12.13) still stands.

**Known limits** (M1's in §12.13 stand, except those M2 closed: the max wait, quiet passes in tall blocks, `packRows`):

- Tables: a header row with a rowspan clones with rowSpan 1 (the clone can be taller than the reserve); links and iframes inside a header clone stay interactive, and clone content outside the doc JSON (comment highlights, late node views) can go stale until the header is edited; the degraded print path (image embedding changed the structure, §4.3) drops headers from split pieces. The spacer `tr` is `aria-hidden` (a separator role is invalid inside `tbody`), so a screen reader hears no page boundary inside a table.
- In-cell and in-column split: a cell or column whose first line already crosses the bottom keeps that line in the margin (the mask hides its lower part); a row or columns block whose split would put a non-text block or kept line in the band, and a columns block whose grid wraps onto a second row, fall back to the unmasked tall-leaf rule, so they run over the margins instead of splitting. Safari's print of a split columns block is not gated (§13.5).
- Media: a caption longer than one line makes the block taller than its cap (§13.5); the caption allowance is in px and drifts if the root font size is not 16px. Tall Mermaid: the screen crops it, print scales the `svg` to the clip (same height, different look).
- Clipped wrappers (`overflow: hidden` on AI writer and action button) would clip a future popover drawn inside them.
- Mask: `.selectedCell:after` tints over it in a split row; a `url()` desk is stretched to the canvas size; the host's `editorCanvasClassNames` background is not mirrored into the gap; the columns menu stacks above host chrome in Pages (the reverse of Pageless).
- Shortcuts: ⌘/Ctrl+Enter with everything selected or a gap cursor at the top level does nothing (the key is swallowed; a selected block gets the break after it, §13.3); with the editor focused and the link popup open, ⌘/Ctrl+K no longer closes it.
- Print: Pageless Cmd/Ctrl+P runs one microtask later than before; toolbar Print shows no loader while Pages embeds images; all-tabs export finds the active tab through the collaboration extension's `field`.
- Stays from §13.4: the first exact page count dropped when the active-editor ref lags (practically unreachable).
