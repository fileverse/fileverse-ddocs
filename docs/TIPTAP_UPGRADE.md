# Tiptap 3.11.0 → 3.34.0 (TEC-3019)

## 1. Intent

Move every `@tiptap/*` package from 3.11.0 to 3.34.0 for the upstream bug fixes, performance work and security patches, with **no regression** in our custom layers (list engine, Pages mode, dBlock/flat schemas, comments and suggestions, collaboration, paste/import/export, fonts and caret styles) or in ddocs.new. Delete the custom code the upgrade makes obsolete, each deletion backed by a test that fails if the upstream fix is absent.

- **Goals**: one exact version for every `@tiptap/*` package; every behaviour change listed in §5 pinned by a test before the bump and decided after it; obsolete code (§6) removed; a durable "what we rely on" checklist (§9) for the next upgrade.
- **Non-goals**: adopting new upstream APIs (Decorations API, `dispatchTransaction`/`transformPastedHTML` hooks, `insertDefaultBlock`, `MappablePosition`, `schemaSpec`, managed suggestion popups, `clearable` marks); refactoring our overrides to look more like upstream; removing unused-but-harmless `@tiptap/*` dependencies other than R3/R4; Tiptap 4.
- **Anti-goals**: a green suite that hides a behaviour change nobody decided on; any change to what existing documents contain or how they load (existing Yjs blobs must load and edit exactly as before, both schemas, and the upgrade must not add new Yjs roots to documents); breaking ddocs.new's integration surface (AGENTS.md "Consumer repo").

Decided 2026-11-16: Tiptap 3.34.0, not the ticket's 3.31.0 (3.31.0 lacks 3.31.2's `prosemirror-view` paste XSS fix, GHSA-c8x8-7fp4-3x9w, and 3.31.4's split/undo fixes). y-tiptap 3.3.0 (§5.10); revised 2026-11-17 from "3.0.9 plus a vendored resolver" after 3.3.0 was checked against the two reasons 3.0.10+ had been rejected.

### Pros and cons

3.11.0 shipped on 2025-11-19, 3.34.0 on 2026-11-13: a year and 23 minor releases behind.

**Pros**
- **Security.** The `prosemirror-view` paste XSS fix (crafted pasted HTML could run JavaScript; 3.31.2), `mergeAttributes` no longer lets pasted HTML attributes change an object's prototype (3.30.4), and extra CSS declarations in content are no longer rendered (3.31.4). Paste is a core path for us (docx, Google Docs, Word, markdown).
- **Bugs fixed upstream that hit us or would.** Pasting editor content no longer adds empty paragraphs (prosemirror-model 1.25.11). Caret placement after Enter in React node views (3.29.1–3.29.2). Freezes and Enter in node views on iOS/Android (3.31.1, 3.31.4). Safari scrolling to top on `focus()` (3.15.3). Inserting a table with an empty cell no longer throws (3.29.0). Checked task items split correctly (3.31.4). Typing spaces after a link no longer extends it (3.31.4).
- **Collaboration.** y-tiptap 3.0.3–3.3.0 fix remote carets jumping or splitting during drag-and-drop and structural edits, crashes on stale awareness, and an UndoManager memory leak when the Y.Doc outlives the editor (we keep 4 tab editors warm on one Y.Doc); 3.3.0 republishes awareness only when the local caret moved. Drag-and-drop no longer leaves a duplicate block when a collaborator edits mid-drag (3.26.1, 3.27.2).
- **Performance.** Placeholder no longer scans the whole document per transaction (3.23.6–3.27.3), large transactions such as big pastes are faster (3.32.1), React node views cost less on large documents (3.30.6), code highlighting skips selection-only changes (3.32.3).
- **Custom code we stop owning.** The `removeEmptyTextStyle` backport (R1) and two dead dependencies (R3, R4).
- **Version hygiene.** One exact `@tiptap/*` version instead of today's mix (3.11.0 pinned, 3.20.2 floated in ddocs.new). The §5 probes and the §9 checklist stay as a regression net, so the next upgrade (and Tiptap 4) is smaller and safer.

**Cons**
- **Behaviour changes we must neutralise.** Most §5 rules are "Keep", so the upgrade adds code as well as removing it: our own "selection covers node" check in three node views (§5.7), disabling or overriding upstream handlers for keys we do not bind (blockquote Backspace, list Delete, OrderedList paste; §5.16–5.17), possibly a Typography undo fix (§5.12) and memoised menu props (§5.13). Only R1 is a certain removal; R2 is expected to stay.
- **y-tiptap 3.3.0 is new and undocumented.** Published 2026-11-10; 3.0.10–3.3.0 have no release notes and rewrite (in TypeScript) the binding internals we reach into (§5.10.3). Mitigated by an exact pin, a 3.0.1 → 3.3.0 source audit before the bump, and the §5.10 probes; live behaviour (remote typing on large shared docs, mixed-version carets) is only measurable in the ddocs.new QA (§8.2).
- **Changes users will notice even when accepted.** Mod-Z right after an auto-format reverts just the format (§5.12); editing one of two adjacent links no longer rewrites the other (§5.4).
- **Mixed-version window.** ddocs.new is a PWA, so old and new clients edit the same docs for a while; an old client can drop a pasted link's `title` (§5.14). Cosmetic, but real.
- **Risk sits in private internals.** y-tiptap binding fields, `pmViewDesc`, plugin key names and upstream plugin specs (§9) carry no compatibility promise; they are exactly what the probes guard.
- **Cost.** Probes for all 18 §5 rows, most in both schemas, a ProseMirror refresh with its own changelog review, two manual QA rounds (demo, then ddocs.new under React 19 with live collaboration), and a prerelease cycle. Collaboration can only be QA'd in ddocs.new.
- **Bundle size.** Tiptap and ProseMirror are bundled into our dist, so it grows by whatever 3.34 adds; not yet measured (§7).

**Net.** Worth doing: the paste XSS fix alone justifies it, and the collaboration, mobile and node-view fixes come with it. The cost is the probe and QA work, plus a few new overrides; the main open risk is the young, undocumented y-tiptap 3.3.0, gated by the §5.10 audit and probes and by §8.2.

## 2. Versions and dependency changes

| Change | Detail |
| --- | --- |
| `@tiptap/*` | Every package pinned to exactly `3.34.0` (today core, pm, react, collaboration, drag-handle, node-range are exact and the rest `^3.11.0`, which already floats; ddocs.new resolves core 3.20.2 today). StarterKit 3.30+ pins its own sub-packages exactly, and 3.34 peers are exact, so the set stays coherent. |
| `@tiptap/y-tiptap` | 3.0.1 → exactly `3.3.0`, declared in `dependencies` (we import it directly but it is only transitive today; it stays bundled because `isBundled` matches `@tiptap/`). 3.34's collaboration and drag-handle packages are tested against 3.3.0 (their devDependency; peer `^3.0.7`), and staying on 3.0.1 would leave consumers with an unmet peer. Rejected: 3.0.6–3.0.9 (positions at the start of a v2 doc resolve to `null`, §5.10.1; full node rebuild on every remote update) and 3.0.10–3.2.x (write `__tiptap_position_migrations:<fragment>` root maps into documents). 3.3.0 has neither (§5.10). Its peers (`yjs ^13.6.13`, `y-protocols ^1.0.1`, `prosemirror-* ^1`) are met here and in ddocs.new. Pinning exactly matters: npm would otherwise float the transitive copy. |
| ProseMirror | Through `@tiptap/pm` 3.34 (`prosemirror-view ^1.42.6`, `prosemirror-model ^1.25.12`, `prosemirror-tables ^1.8.5`). Against today's registry that resolves view 1.41.3 → 1.42.9, transform 1.10.5 → 1.12.5, schema-list 1.5.1 → 1.6.0, inputrules 1.5.1 → 1.6.0, tables → 1.8.5. Upstream Tiptap notes do not cover these: read each package's changelog for the range and add a §5 row for anything reaching the list engine (schema-list, transform), Pages mode (view) or tables. Record the resolved versions in the PR. |
| `@_ueberdosis/prosemirror-tables` | **Remove** (and its `isBundled` entry). Nothing imports it. |
| `@tiptap/markdown` | **Remove**. Nothing imports it; markdown runs on `tiptap-markdown` and `extensions/mardown-paste-handler/`. |
| `prosemirror-model`, `prosemirror-state`, `y-prosemirror` | Keep. After install, `npm ls prosemirror-model prosemirror-state prosemirror-view prosemirror-transform` must show **one** copy each (direct `prosemirror-*` imports in ~12 files share `instanceof` checks with `@tiptap/pm`). |
| `tiptap-markdown ^0.9`, `@aarkue/tiptap-math-extension ^1.4` | Peers `@tiptap/core ^3.0` (and `pm ^3.0`): compatible. |
| `uuid` | TOC 3.34 declares `uuid ^14`; ours is external at `^10` and the bundled TOC will call the consumer's copy. It only uses `v4()`, unchanged across those majors: keep `^10`, covered by the TOC probe (§5.9). |

Installs are targeted (`npm install` of the changed packages), and `package-lock.json` is committed with each step (CI runs `npm ci`).

## 3. Approach

Chosen (A): pin current behaviour with probes on 3.11, then bump in attributable steps, decide each probe that flips, then delete obsolete code one commit at a time.

Rejected: (B) stepping through intermediate Tiptap versions (3.22, 3.31.4): the notes already attribute each change to a version, StarterKit's exact pins make intermediate stops fiddly, and it multiplies manual QA. (C) bump and fix what the existing suite catches: the suite does not cover most of §5, which are exactly the silent regressions this ticket must rule out.

## 4. Sequence

Branch `TEC-3019`. One commit per step; the full suite runs after each of steps 2–4.

1. **Probes on 3.11.** Add the tests in §5 (v1 and v2 case wherever the schema matters). They assert today's behaviour and pass on 3.11.
2. **ProseMirror refresh on 3.11.** Update `prosemirror-*` within 3.11's own ranges to the versions §2 lists (lockfile only). This ships the XSS fix independently and makes any ProseMirror regression attributable.
3. **y-tiptap 3.3.0** (§5.10), still on Tiptap 3.11, after the 3.0.1 → 3.3.0 source audit.
4. **Tiptap 3.34.0** and the remaining §2 changes. `npm ls` single-copy check, `npx tsc`, `npm test`, `npm run build`.
5. **Decide.** For each probe that failed in steps 2–4, apply its row's rule: **Keep** = adapt our code so today's behaviour holds; **Accept** = take upstream's and update the probe to assert it. A probe never just gets deleted.
6. **Removals** (§6), one commit each, test first.
7. **Docs.** §9 lives here. `LIST_TOGGLE.md` §7: change "Verified on 3.11.0" to 3.34.0, point to §9, and correct "Anchors resolve through `y-prosemirror`" (they resolve through `@tiptap/y-tiptap`).
8. **Manual QA in the demo** (§8.1), both schemas.
9. **Prerelease** per AGENTS.md "Release" (e.g. `7.2.4-tiptap.0`, published with `--tag`), repinned in a ddocs.new worktree, then **QA in ddocs.new** (§8.2). Merge only after both pass.

Rollback: before merge, nothing ships. After release, revert the merge and publish the next patch; documents edited on the new version stay readable by the old one (§5.14: only `link.title` and CSS-parsed `orderedList.type` values are new, both ignored by 3.11; no new Yjs roots).

## 5. Behaviour changes that reach our code

Each row: the upstream change, what of ours it reaches, the probe, and the decision rule if the probe flips.

### 5.1 Enter at the start of a list item (3.31.4)

When the caret is at offset 0 of an item's first child, `splitListItem` now gives the **item** attrs reset by `keepOnSplit: false` to the new empty item above and leaves the text-keeping item's attrs untouched; at 3.11 it was the other way round. Only item-level attrs move: the inner paragraph is not in `typesAfter` (no `nextType` when text follows the caret), so it is copied whole into both halves on both versions, and paragraph attrs (BlockId, `fontFamily`, `fontSize`, `caretMarks`) are unaffected. The only item attr with `keepOnSplit: false` today is TaskItem's `checked`; listItem has none. Reaches: `caret-marks` wrapping `coreCommands.splitListItem`, the task-item checkbox, the TEC-3110 marker decoration. `list-toggle`'s Enter handler only covers an empty paragraph exiting a nested list, so it does not take this path. The suggestion owner-Accept split (`comment-decoration-plugin.ts:1605-1636`) builds its own split with 3.11-style placement but only for `listItem`, which has no `keepOnSplit: false` attrs, so typed and accepted Enter stay identical; if a listItem attr with `keepOnSplit: false` is ever added, align that path.
Probe: Enter at offset 0 of a checked task item with text; Enter at offset 0 of a list item whose paragraph has a font, size and BlockId (v2). Assert `checked` on both items, the paragraph attrs on both halves, and that BlockId ends unique.
Rule: **Accept** (the item with the text keeps its checked state). **Keep** if paragraph attrs or BlockId uniqueness differ from 3.11.

### 5.2 Backspace and Delete in lists (3.25.0, 3.32.1)

Stock `ListKeymap` Backspace now lifts a non-first item out of its list before merging; Delete on a selection starting at an item end deletes the text. Ours runs first for Backspace (§7 of `LIST_TOGGLE.md`), so that change surfaces only where our handlers (`list-toggle` Backspace, v2 `list-normalization.ts:62`, v1 dBlock keymap at priority 1000) return `false`. The Delete hoist is §5.16: we bind no Delete.
Probe: real `keydown` (as `list-toggle-backspace` does) for every case our handlers decline: Backspace at start of a non-first item with and without a sublist, Delete with a selection starting at an item end. Both schemas. Anchor survival per §5.16.
Rule: **Keep** where the result differs from today, unless today's result is a bug with a ticket (then **Accept** and note it there).

### 5.3 Tab after a list (3.30.0)

Stock `ListKeymap` now binds Tab: at the start of a paragraph right after a list it sinks the paragraph into the list's last item. `tab-indent.ts` (priority 1000) binds Tab first.
Probe: Tab at offset 0 of a paragraph directly after a bullet, ordered and task list; Tab inside a list item; Shift-Tab. Both schemas.
Rule: **Keep** (our indent wins). If `indentOnTab` returns `false` in any of these, make it consume the key there.

### 5.4 `extendMarkRange('link')` and `getMarkRange` (3.22.0)

`extendMarkRange` lost its `attributes = {}` default and now matches the first link at the position, so it no longer spans adjacent links with different hrefs; `getMarkRange` changed the same way. Reaches: `utils/apply-link-with-text.ts:14`, `paste-as/paste-as-menu.tsx:56`, `paste-as/paste-as-candidate.ts:82,131`, `components/editor-utils.tsx:1398,1424`, `hooks/use-editor-commands.ts:322,329`.
Probe: two adjacent links with different hrefs; edit, unset and re-apply from a caret in each; the paste-as candidate on a pasted URL next to an existing link.
Rule: **Accept** (editing one link must not rewrite its neighbour). `paste-as-menu.tsx:56` already passes `{ href }`.

### 5.5 Stored marks after select-all + delete (3.33.1)

The core keymap now appends `tr.setStoredMarks(null)` after deleting a whole-document selection. Our rule is `docs/FORMATTING_INHERITANCE.md` Rule A3: an emptied line keeps the deleted text's marks. caret-marks may read the appended null as an explicit clear and stamp `'[]'` on the paragraph (a document write).
Probe: bold + colour + font family + size text; Cmd-A; Backspace; type. Assert the typed text's marks, the paragraph's `caretMarks`/font attrs, and that no extra Yjs write happened beyond the deletion. Same with a link in the deleted text.
Rule: **Keep** Rule A3's behaviour (marks carried, no `'[]'` stamp), except that a link must not carry into the emptied line (it does not today; assert it).

### 5.6 Style parsing and rendering (3.20.1, 3.23.2, 3.31.4)

`mergeAttributes` parses inline `style` values containing `:`/`;`; Color, FontFamily and Highlight now store the **raw authored value** through `getStyleProperty` instead of the browser-normalised `element.style.*` (e.g. `#333` instead of `rgb(51, 51, 51)`); FontSize and LineHeight too; rendering drops extra CSS declarations smuggled through attrs. Reaches every consumer of the stored strings: the paste colour clean-up (`use-tab-editor.tsx:979-1029`, `utils/color-utils.ts:1-35` `isBlackOrWhiteShade`, which handles any grey in `rgb()` form but only ten fixed hex values), toolbar active state, font-family matching against the font catalog, docx import, HTML paste, HTML/ODT/markdown export, print, `data-original-color`.
Probe: paste HTML with `color: #333`, `#1f2328`, `rgb(51,51,51)`, a quoted multi-word font family, highlight, font size, line height and all combined; one Google Docs and one Word fixture; the docx fixtures. Assert the stored attribute strings (not just rendered CSS), that the paste colour clean-up still strips near-black/near-white greys, that the toolbar shows the right font and colour, and an HTML round-trip snapshot.
Rule: **Keep** wherever a stored string differs from 3.11 and a consumer behaves differently (for the clean-up: make `isBlackOrWhiteShade` handle hex greys). **Accept** only string differences no consumer can observe.

### 5.7 React node view `selected` (3.31.0, 3.22.5)

At 3.11 `selected` meant "the selection covers the node" (`handleSelectionUpdate`); now it follows ProseMirror node selections only, and `selectionInside` / `selectedOnTextSelection` mean "the selection is inside the node", so neither restores the old meaning (Cmd-A or a drag across a media node). Reaches node views that read `selected`: resizable-media, ai-writer, table-cell.
Probe: NodeSelection on media and ai-writer; Cmd-A; a text selection dragged across a media node; a TextSelection and a CellSelection over table cells. Assert the rendered selected chrome.
Rule: **Keep**: in those three views compute "selection covers this node" from the editor state (`from <= pos && to >= pos + node.nodeSize`) instead of reading `selected`.

### 5.8 Placeholder rewrite (3.23.6, 3.24.0, 3.27.3, 3.32.3)

Placeholder became an incremental `StateField` over touched top-level nodes and no longer leaves `is-empty` behind with `includeChildren`. Our config: `includeChildren: true, showOnlyCurrent: true`, `placeholder: () => ''`. CSS (`editor.css:6-56,2341`, `index.css:230`) and `presentation-mode.tsx:184` read `.is-empty` / `.is-editor-empty`.
Probe: classes for an empty doc, an empty paragraph under the caret (v1 inside a dBlock, v2 top level), after the caret leaves it, inside a list item and a table cell.
Rule: **Accept** if visible placeholders match today; **Keep** otherwise.

### 5.9 Upstream plugins we re-wrap or fork

- `custom-code-block-lowlight.ts:32-66` spreads the upstream lowlight plugin's spec and calls its `apply`, which changed in 3.32.3 (skips selection-only changes). Probe: typing outside and inside a code block; language change; paste of a code block; highlights present and no upstream `apply` for text typed elsewhere (spy). Rule: **Keep** the wrapper.
- `table-of-contents.ts:80-116` re-wraps TOC's `appendTransaction`; upstream fixed a duplicate `onUpdate` (3.22.5), skips IME composition (3.13.0), and uses `uuid` v4 (§2). Probe: one `onUpdate` per heading edit; `data-toc-id` stable and unique across edits. Rule: **Keep** ours.
- `supercharged-table/` imports nothing from `@tiptap/extension-table`, so that package's changes cannot reach us; the exposure is `prosemirror-tables` 1.8.x (cell selection, column resizing, `fixTables`). Probe: existing table suites; CellSelection, column resize, row/column insert and delete, merge/split. Rule: **Keep**.

### 5.10 Collaboration binding (y-tiptap 3.0.1 → 3.3.0)

3.3.0 (published 2026-11-10) is what Tiptap 3.34's collaboration and drag-handle packages are tested against. 3.0.10–3.3.0 have no release notes and are a TypeScript rewrite, so before the bump the builder diffs the 3.0.1 and 3.3.0 sources for every internal named in this section and records what changed in the PR.

#### 5.10.1 Positions at the start of a document

3.0.6–3.0.9 return `null` from `relativePositionToAbsolutePosition` for an item-based position that resolves to absolute position ≤ 1 (`isMisresolvedTextPosition`); position 1 is the first text position of a v2 doc (v1 starts at 2). 3.3.0 replaced that check with "the decoded type's item is deleted" and resolves both reproduced cases, verified against the published 3.3.0 dist on 2026-11-17: a comment on "ello" of "Hello" after "H" is deleted resolves to 1–5 (v2 shape) and 2–6 (wrapped), and an `assoc = 1` point anchor at the doc start (`createCommentAnchorPointFromEditor`) resolves to 1 / 2. Our 7 call sites (`comment-decoration-plugin.ts:97,103,140,1507,1513`, `tab-position-memory.ts:120,126`) keep importing it from `@tiptap/y-tiptap`; upstream's own uses (remote carets, drag-handle anchor restore) get the same fix.
Probes (v2 and v1): the two cases above; a comment spanning the first character; suggestion add point at doc start; tab switch away and back with the caret at doc start; remote caret at position 1; multi-block drag starting at the first block with a collaborator edit mid-drag.
Rule: **Keep** (every one resolves as on 3.0.1).

#### 5.10.2 Position-migration maps

3.0.10–3.2.x wrote `__tiptap_position_migrations:<fragment>` root maps into the Y.Doc on local structural edits. 3.3.0 writes none: on view init and after every transaction it clears any such map that already exists and is non-empty (`addToHistory: false`). Our documents never had them, so nothing is written; a document once edited by a 3.0.10–3.2.x client elsewhere would get one clearing write.
Probe: after each T1 fixture loads, and after a block reorder and a multi-block drag, `[...ydoc.share.keys()]` is unchanged and the Yjs update count matches 3.11 (explicit).
Rule: **Keep**.

#### 5.10.3 Other 3.0.1 → 3.3.0 changes

- **Remote updates.** `_typeChanged` deletes only the changed types from `mapping`, as 3.0.1 does (3.0.9's full rebuild on every remote update is gone).
- **Write path.** `updateYFragment` reconciles reordered children (`reconcileMappedChildren`).
- **Cursor recovery.** Structural transactions are detected (`isStructuralTransaction`) and positions recovered (`findAbsolutePositionAfterStructuralChange`); the cursor plugin view sets local awareness only when the local cursor changed.
- **Undo.** `addToHistory` is read only from doc-changing transactions; the UndoManager's `captureTransaction` skips `addToHistory: false`.
- **Binding lifecycle.** `beforeTransactionSelection` is set by a Y.Doc `beforeAllTransactions` listener and cleared by `afterAllTransactions`; an `afterTransaction` listener clears migration maps; invalid content is tracked in `_invalidContentError`. Our cleanup nulls `beforeTransactionSelection` (harmless, since the listener clears it anyway); confirm destroy removes all three listeners when our cleanup runs.
- **Cursor rebuild.** `use-tab-editor.tsx:2046-2096` rebuilds y-tiptap's `yCursorPlugin` from its `spec.state.init/apply`, `props` and `view` and matches `awarenessUpdated`; 3.3.0 keeps that shape. Assert it.

Our other internals: `utils/y-prosemirror-cleanup.ts:44-110` mutates binding fields (`mapping`, `isOMark`, `beforeTransactionSelection`, `_domSelectionInView`) and UndoManager fields (`restore`, `undoStack`, `redoStack`), all present by name in 3.3.0 (confirm meaning in the source diff); `comment-decoration-plugin.ts:1751` uses `ySyncPluginKey` as a Yjs origin, `:1709` widens the undo scope, `:1175` reads `isChangeOrigin`; `hooks/use-tab-manager.ts:486` reads `undoManager.undoStack`; `utils/upload-images.tsx:47` reads `isChangeOrigin`; string matches on `'y-sync$'` in `dblock-media-plugin.ts:147`, `suggestion-tracking-extension.ts:290`, `undo-selection.ts:55`. PluginKey names get `$`, `$1`… in creation order, and y-prosemirror (bundled for export/diff) also creates a `'y-sync'` key.

Probes (jsdom; live checks are in §8.2): (a) `ySyncPluginKey.key === 'y-sync$'` in the jsdom editor **and** in the built `dist` (a node script importing the built entry); (b) two-client harness (two editors on two Y.Docs exchanging updates): remote edit, remote reorder/drag of a block above the caret, undo/redo, and after every operation both docs' JSON are identical and comment anchors resolve at the Yjs layer (`resolveCommentAnchorRangeInState`, not decorations); (c) remote caret renders and follows edits; (d) undo step counts around our `addToHistory: false` maintenance writes (BlockId, paragraph spacing, caret-marks, pagination meta) and around a remote edit; (e) Pages mode's steps-less pagination transaction does not split the user's undo group; (f) awareness updates per remote keystroke stay at one (check `sync-local` throttling).
Rule: **Keep** today's behaviour everywhere; adapt the cleanup or cursor rebuild if a field changed meaning. Remote-typing performance on large shared docs is gated in §8.2.

Not affected: `enableContentCheck` / `onContentError` changes (3.22, 3.25, 3.33); we do not enable the check.

### 5.11 Pages mode and React rendering

Pages mode leans hardest on view internals (§9): `pmViewDesc.contentDOM`, `coordsAtPos`/`posAtCoords` per line, widget decorations with `key`/`side`/`marks: []`, a steps-less meta transaction refused by `filterTransaction` when it carries steps, `view.dom.style.minHeight`, `isChangeOrigin`, y-tiptap's remote replace. Upstream changes reaching it:
- React node views no longer render synchronously: `flushSync` is gone and rendering is queued by microtask (`ReactRenderer.tsx`, `EditorContent.tsx`). Reaches pagination measurement of cells, media and code blocks; the first-open position of the slash and emoji popups (`slash-comand.tsx:235-249`, `emoji.tsx:84-92`); jsdom tests that assert node-view content synchronously.
- `EditorContent` mount and unmount now move **every** child of the content host (`append(...view.dom.parentNode.childNodes)`), and `PageSheets` portals the sheet-edge masks into that host (`page-sheets.tsx:145-147,273-279`): recreating the active editor in Pages mode may make React throw `removeChild` NotFoundError.
- 3.22.1 re-renders node views when only their position changes; 3.28.0 batches portal notifications; 3.30.6 reduces node-view overhead.

Probes: the `extensions/pagination/*.test.ts` suites pass unchanged; pagination dispatches for one keystroke in a long doc stay 0 or 1; placement is identical for a fixture with tables, media and code blocks (measured after node views render); switch schema/tab/remount the editor while in Pages mode (no throw, masks present); slash and emoji popup first-open position.
Rule: **Keep**.

### 5.12 Input rules and paste (3.22.2, 3.29.0, 3.31.4, 3.34.0)

Input rules changed mechanism: 3.34 dispatches the typed character first, then the rule transaction with `closeHistory` and an `inputRule` meta, and Collaboration calls `undoManager.stopCapturing()` on that meta. So every Typography rule (smart quotes, apostrophes, dashes) and every markdown shortcut now splits the undo group, and the raw-character transaction passes through caret-marks, BlockId, comment analysis, suggestion tracking and Yjs on its own. Also: undoing an input rule restores its characters under Collaboration (3.31.4); Backspace undo after auto-formatting with BlockId-like extensions (3.34.0); rules no longer crash across inline atoms (3.29.0). Paste: prosemirror-model 1.25.11 fixes extra empty paragraphs when pasting editor content (3.29.0); selection after pasting at the end of a marked node respects inclusive marks (3.22.2).
Probes (both schemas): Mod-Z after typing a sentence with apostrophes and quotes (count undo steps); `- `, `1. `, `[ ] `, `# `, `> `, `**bold**` then Mod-Z and Backspace; the same in suggestion mode (one suggestion, not two); copy→paste of a two-paragraph selection; the existing markdown-paste, paste-as, `commonmark-emphasis` and docx suites.
Rule: **Accept** that Mod-Z right after an auto-format reverts just the format (that is its purpose). **Keep** one undo step per typed word otherwise: if Typography rules fragment ordinary typing, stop them from closing history. **Keep** suggestion mode producing one suggestion per typed run. **Keep** anything our paste handlers decided deliberately (TEC-2677).

### 5.13 Menus and drag handle

BubbleMenu now dispatches an `updateOptions` transaction whenever a prop's identity changes, uses `pluginKey` as its meta key (3.20.0), updates props after init (3.18.0), stops repositioning hidden menus (3.22.0) and forwards HTML props (3.20.3). All four of our menus pass inline `options`, and three pass inline `appendTo`/`shouldShow` closures (`editor-bubble-menu.tsx:313-335`, `columns-menu.tsx:53-66`, `comment-bubble-card.tsx:109-127`, `paste-as-menu.tsx:124-137`). React `DragHandle` renders children through a portal (3.23.1) and no longer re-registers its plugin when a callback's identity changes (3.30.0). Also reached: `dblock-drag-handle.tsx`, the `'hideDragHandle'` meta, `zoom-platform.ts` (floating-ui platform through `computePositionConfig`).
Probe: count transactions per React re-render of each menu's parent (must be 0); `npx tsc` (drop `@ts-nocheck` from `editor-bubble-menu.tsx` only if it type-checks cleanly).
Rule: **Keep** (memoise `options` and closures where the count is not 0).

### 5.14 Schema attributes and mixed-version collaboration

The only attribute 3.34 adds to our schema is `link.title` (3.19.0, parsed from `<a title>`; `custom-link` defines none). `orderedList.type` already exists at 3.11; what is new is parsing it from CSS `list-style-type` (the Google Docs pattern) and the plain-text paste handler that creates typed lists (§5.17). Our `list-decimal` class renders every ordered list as `1.`. Table cell `align` (3.22.0) does not reach us (`supercharged-table` defines its own cells). Both values default to `null`, so existing docs and Yjs blobs are unchanged.
ddocs.new is a PWA (Serwist precache): after release, 7.2.x (3.11) and new clients edit the same docs. The Yjs wire format is the same and no new Yjs roots are written (§2). An old client ignores `link.title` and may drop it when it rewrites that node: **accepted** (cosmetic, transient). Remote carets between y-tiptap 3.0.1 and 3.3.0 clients must render both ways (§8.2).
Probe: paste `<a title="x" href>` and a Google Docs list with `list-style-type: lower-alpha`; assert the stored attributes, how the list renders, and that markdown/ODT/docx export succeeds.
Rule: **Accept** `link.title`. For typed ordered lists, **Keep** today's rendering (`1.`) unless the user-facing decision is made to render types; record the observed behaviour in the PR.

### 5.15 ddocs.new

Checked in `../ddocs.new` (2026-11-16). It is affected only in these ways:
- **Types.** It imports `JSONContent`/`Editor` types from `@tiptap/core` and `@tiptap/react` without declaring them, resolved through our transitive dependencies: two copies today (`@tiptap/core` 3.20.2 hoisted and 3.11.0 nested), one 3.34.0 copy after the exact pins. Both repos use `skipLibCheck`. Its `tsc` and `next build` must pass on the prerelease.
- **Its own tests mount our editor under React 19**: `npm run test:unit` (vitest; e.g. `legacy-content-initialization.test.tsx` counts `.node-resizableMedia`, a class 3.34 keeps) and the Playwright suites in `tests/e2e` (page objects for toolbar, slash commands, pages mode, export).
- **Not affected**: no runtime Tiptap or ProseMirror import (markdown goes through our `exportMarkdownFile`); no server-side import of the package; `useEditor`'s Next.js `immediatelyRender` change (3.23.5) does not apply (we build editors with `new Editor`, and the one `useEditor` passes `false`); its `yjs`/`y-protocols` overrides satisfy y-tiptap 3.3.0's peers; its CSS targets no Tiptap class names; the version-history diff compares two snapshots built the same way.
- **Version restore** (`utils/version-restore/apply-version-restore.ts`, checked 2026-11-17). Restore runs on Yjs only: it applies the version blob to a scratch `Y.Doc`, reads tabs through our `buildVersionDiffSnapshot` (y-prosemirror, unchanged), strips `comment` formats from `Y.XmlText` runs, and copies fragments and known maps into the live doc in one transaction. What the upgrade could break, each checked: (1) it throws `UnknownYjsRootError` for any top-level Yjs entry outside its allowlist (`utils/ddoc-yjs-roots.ts`), so a y-tiptap that writes `__tiptap_position_migrations:*` (3.0.10–3.2.x) would block restoring every doc it touched; 3.3.0 writes none (§5.10.2). (2) It relies on y-tiptap's mark encoding in `Y.XmlText` (mark name as the format key, `name--<hash>` for overlapping marks); 3.0.1 and 3.3.0 use the same scheme and the same hash. (3) The live editor receives the restore as one large non-local change: y-tiptap re-renders the replaced fragments, anchors in removed text stop resolving, and the restore is not on the user's undo stack, all as today. Gate: its `apply-version-restore` and `restored-from` unit tests (in `npm run test:unit`) and the §8.2 restore checks.

### 5.16 Upstream handlers that delete and re-insert content

Delete-and-reinsert kills comment anchors (AGENTS.md "Lists"). Two upstream handlers now do it in places we do not intercept:
- **Blockquote Backspace** (3.26.0–3.34.0): in v2, Backspace at the start of a block right after a quote merges its inline content into the quote via `tr.replace`; a heading loses its type, and paragraph attrs go with it. Also: Backspace at the start of a non-first child lifts it out of the quote.
- **List Delete hoist** (3.25.0, `hoistBranchingNestedList`, priority 101): Delete at the end of an item with a branching nested sublist hoists the sublist. We bind no Delete, so nothing of ours runs first.

Probes (both schemas): each case with a comment anchored in the affected text; assert the document and that anchors still resolve at the Yjs layer; a heading after a quote keeps its level or the merge is refused.
Rule: **Keep** today's document result and anchors. Where upstream's result is better and anchors survive, **Accept** and record it.

### 5.17 OrderedList plain-text paste (3.27.x–3.31.4)

`OrderedList` now registers a `handlePaste` for plain text that looks like an ordered list (`ordered-list.ts:292-329`). It runs whenever our markdown paste handler returns `false` (`mardown-paste-handler/index.ts:1058-1063`), bypassing the TEC-2677 literal-text rules, and can create typed lists (`a.`, `i)`).
Probe: plain-text paste of `1. a\n2. b`, `a. x\nb. y`, `i) x`, `(216) 555-1234`, and a TEC-2677 literal-text fixture, both schemas.
Rule: **Keep**: our handler decides. If upstream's handler changes any result, disable it (configure or extend OrderedList without the paste plugin).

### 5.18 Other core and Link changes

- `NodeView.ignoreMutation` now lets selection mutations through for node views without `contentDOM` (3.31.4). Probe: typing in the AI-writer textarea and action-button inputs, and caret placement after clicking into them (Safari in §8.1). Rule: **Keep**.
- `insertContentAt` no longer shifts `from - 1` for inline content at the start of a non-empty paragraph (3.22.3); 18 call sites. Probe: every call site that inserts inline content at a paragraph start (find them with grep; mentions/emoji/slash inserts, paste-as, AI writer accept). Rule: **Accept** if the result is the correct position; **Keep** where a caller compensated for the old shift (remove the compensation).
- Link's paste handler now passes `link.value`, not `link.href`, to `shouldAutoLink` (3.31.4/3.32.3); our check requires a protocol, so pasting `example.com` over a selection stops linking. Probe: paste `example.com` and `https://example.com` over a selection and into empty text. Rule: **Keep** today's linking.
- Link: typing spaces after a link no longer extends it (3.31.4); `defaultProtocol` used for pasted links without a protocol (3.32.3). Probe: type a space after a link; paste `www.example.com`. Rule: **Accept**.
- TaskItem node view: HTML attribute updates and `contentElement` parsing changed (3.15.2). Probe: task item toggle, nested task items, HTML round-trip. Rule: **Keep**.
- Code block: ArrowUp in a code block that is the first node now inserts a block above it (3.29.0, v2 only in practice). Rule: **Accept**.

## 6. Removals

Each one is its own commit, with a test that fails on 3.11 behaviour (or proves the code is unreferenced) written first.

| # | What | Why it is obsolete | Gate |
| --- | --- | --- | --- |
| R1 | `removeEmptyTextStyle` override in `extensions/text-style.ts` (keep `ExtendedTextStyle` and its `data-original-color` attribute) | 3.30.3 ships the same command: it skips non-inline nodes (3.11 skipped only textblocks, so dBlock/list/blockquote wrappers lost every run's style). Verified line for line against the 3.34.0 source. | New test: unsetting one run's colour inside a v1 dBlock, a list item and a blockquote keeps the other runs' styles. Passes with the override on 3.11, fails without it on 3.11, passes without it on 3.34. `custom-link/index.ts:33-44` chains the command and needs no change. |
| R2 | `rescueLeafBlockDragStart` in `dblock-drag-handle.tsx:106-148` and its call site | 3.14.0 resolves the parent when `nodeAt(pos)` is null; 3.20.0 uses offset 0 for atoms. iframe and tweet are `atom: true` and should now work; by reading 3.34's `dragHandler` / `getSelectionRanges` (`extendOnBoundaryOverlap: false`), empty paragraphs and captionless media still produce no range. **Expected outcome: kept.** | Manual only: with the rescue disabled, drag each childless block type in Chrome (v2) in the demo, then in ddocs.new with a collaborator connected (§8.2). Remove only if every type moves in both; otherwise keep it and list the types that still fail in the comment above the function. |
| R3 | `@_ueberdosis/prosemirror-tables` dependency and its `isBundled` entry | Unused. | `npm ls` single copies (§2). |
| R4 | `@tiptap/markdown` dependency | Unused. | `npm run build` and tests green. |

Seen but **out of scope**: `extensions/sync-cursor.ts` is unreferenced dead code using y-prosemirror's cursor plugin; `.node-dBlock` CSS rules may be dead since dBlock became a vanilla NodeView; other unimported `@tiptap/*` dependencies (`extension-table`, `-mathematics`, `-placeholder`, `-blockquote`). Also pre-existing and unrelated to the upgrade: multi-line suggestions (#616, 2026-10-16) write the root maps `acceptedSuggestionBreakPoints` and `suggestionAddPointOverrides`, which ddocs.new's restore allowlist does not list, so restoring a version that contains them should already throw `UnknownYjsRootError` (not yet reproduced). File a follow-up instead of touching them here.

## 7. Done when

- Every §5 probe exists, runs on both schemas where relevant, and asserts the decided behaviour; each **Accept** is listed in the PR description with the resolved ProseMirror versions.
- `npx tsc`, `npm run lint` (touched files, `--no-fix`), `npm test`, `npm run build` green; `npm ls` single copies.
- `dist` size (raw and gzip, per entry) recorded before and after in the PR.
- §8.1 passed in the demo and §8.2 passed in ddocs.new (including its type check, build, unit and editor e2e suites), both schemas.
- R1–R4 resolved (R2 may end as "kept, with reason").

## 8. Manual QA (Chrome; both schemas unless noted)

### 8.1 Demo (React 18, no collaboration server)

- **Lists**: Enter at start/middle/end of items, nested exit, the Backspace/Delete/Tab cases from §5.2, §5.3, §5.16, list type toggles with comments inside.
- **Typing and undo**: a paragraph with apostrophes and quotes, markdown shortcuts, then Mod-Z (§5.12).
- **Pages mode**: long doc typing, page breaks, a table crossing a page with a repeated header, zoom 50/100/200, print preview, switching tabs and schema while in Pages mode (§5.11).
- **Drag**: every block type including childless ones (R2), multi-block drag.
- **Block views**: selected chrome on media, AI writer, table cells, including Cmd-A and drag-selecting across media (§5.7); code block typing and language switch; slash and emoji popup position.
- **Paste**: Google Docs, Word, markdown, plain-text lists (§5.17), a bare URL and `example.com` over a selection (§5.18), copy-paste within the doc, near-black text from a dark-theme source (§5.6).
- **Fonts**: font family/size/colour persistence through Enter, select-all delete (§5.5), docx import fixtures.
- **Menus**: bubble menu, comment card, columns menu, link edit with adjacent links (§5.4).
- **Comments and suggestions** (single user): create, a comment on the doc's first characters (§5.10.1), anchor survival across list toggles and quote/list Backspace/Delete, suggestion accept/reject.
- **iOS Safari** (simulator): typing and Enter inside a React node view (code block); clicking into the AI-writer textarea (§5.18).

### 8.2 ddocs.new prerelease (React 19, live collaboration)

Run by both the user and Claude (Claude drives Chrome, the user covers what Claude cannot, such as a second account).
- **Automated first**: in a ddocs.new worktree pinned to the prerelease, `npx tsc --noEmit`, `npm run build`, `npm run test:unit`, then the Playwright suites touching the editor (§5.15).
- **Mixed versions** (§5.14): one window on production (7.2.x), one on the prerelease, same doc: typing both ways, remote carets visible both ways, comment anchors, a link with a title.
- **Collaboration** (two windows or two accounts): remote carets render and follow edits; remote drag of a block above the caret; undo/redo on both sides; comment anchors (including one on the doc's first characters) after remote edits; suggestion accept by the owner while a collaborator types; tab switch away and back.
- **Remote-typing performance** (§5.10.3): a long doc (tables and media, Pages mode on and off) while a collaborator types continuously; no visible lag or dropped input on the receiving side; compare against production.
- **Repeat under React 19**: §8.1's Pages mode, Drag (including R2's childless blocks, now with a collaborator connected) and Block views sections.
- **Version restore** (§5.15): in both schemas, with tabs, comments and Pages mode on, restore (a) a version saved on production (7.2.x) and (b) a version saved on the prerelease after a block drag and a block reorder. No "Cannot restore" error; with a collaborator connected, both windows converge on the restored content; the restored doc keeps working (typing, undo of new edits, new comments, version list shows the restore).
- **Integration surface**: `PreviewDdocEditor` and version history, headless conversions (template insert, import, duplicate, markdown zip export), export modal, print.

## 9. What we rely on (upgrade checklist)

For the next upgrade: read this table and `LIST_TOGGLE.md` §7, run the listed suites first.

| Relies on | Where | Fails first |
| --- | --- | --- |
| Later extension wins for commands and keymaps at equal priority; reversed plugin order | `list-toggle`, `font-family-persistence` (after FontFamily), `tab-indent` (1000), dBlock keymaps (1000), suggestion tracking (1001), emoji (highest) | `list-toggle-*`, §5.2–5.3 probes |
| Keys we do not bind fall through to upstream handlers (Delete, Backspace after a quote, plain-text paste) | list Delete hoist, blockquote Backspace, OrderedList `handlePaste` | §5.16–5.17 probes |
| `preventDispatch` meta stops a `false` command dispatching | `list-toggle/shared.ts:85` | `list-toggle-wrap` |
| Core `splitBlock`/`splitListItem` and `getSplittedAttributes` semantics | `caret-marks.ts:254,263`, `list-toggle` Enter, suggestion Accept split | `list-toggle-enter`, §5.1 probe |
| Input rules' transaction shape (separate typed-character transaction, `closeHistory`, `inputRule` meta) | caret-marks, BlockId, suggestion tracking, undo grouping | §5.12 probes |
| y-tiptap `relativePositionToAbsolutePosition` resolves positions at the start of a v2 doc (broken in 3.0.6–3.0.9) | comments, tab position memory (7 call sites) | §5.10.1 probes |
| y-tiptap private binding and UndoManager fields | `utils/y-prosemirror-cleanup.ts` | §5.10.3 |
| y-tiptap `yCursorPlugin` spec shape and `awarenessUpdated` meta | `use-tab-editor.tsx:2046-2096` | §5.10.3(c) |
| `ySyncPluginKey.key === 'y-sync$'` | `dblock-media-plugin.ts:147`, `suggestion-tracking-extension.ts:290`, `undo-selection.ts:55` | §5.10.3(a) |
| Remote changes and Yjs undo arrive as one whole-doc replace with `isChangeOrigin` | pagination `meta.ts`, BlockId, comments, paragraph spacing, caret-marks, upload images | pagination suites, `list-toggle-anchors` |
| Private `tr.meta` / `appendedTransaction` / `pointer` metas | `undo-selection.ts:27-35`, `caret-marks/dispatch-context.ts:38`, `comment-store-provider.tsx:648` | `undo-selection`, caret-marks suites |
| View internals: `pmViewDesc.contentDOM`, `nodeDOM`, `coordsAtPos`, widget decorations, `view.dragging` | pagination, `dblock-drag-handle.tsx`, `dblock-node-view.ts:28-36` | pagination suites, manual drag |
| React node views render asynchronously; `EditorContent` moves every child of the content host | pagination measurement, popups, `page-sheets.tsx` portal | §5.11 probes |
| Node view `selected` semantics | resizable-media, ai-writer, table-cell | §5.7 probe |
| Stored style strings are raw authored values | `color-utils.ts`, paste colour clean-up, toolbar, font matching | §5.6 probe |
| Menu prop identity triggers `updateOptions` dispatches | the four BubbleMenu call sites | §5.13 probe |
| Re-wrapping upstream plugins by spreading their spec (same PluginKey) | `custom-code-block-lowlight.ts`, `table-of-contents.ts` | §5.9 probes |
| Rebuilding an editor from `extensionManager.extensions` with `getExtensionField`/`flattenExtensions` | `utils/helpers.tsx:26-80`, presentation mode, export | print/export suites |
| Upstream class names: `.is-empty`, `.is-editor-empty`, `.drag-handle`, `.tableWrapper`, `.ProseMirror-selectednode`, `data-node-view-content`, `node-<name>`, `collaboration-cursor__*` | `editor.css`, `index.css`, pagination, print, ddocs.new unit tests | §5.8 probe, `css-ownership`, manual |
| Markdown drop order: `transformPasted` runs on drop; our `handleDOMEvents.drop` fires before prosemirror-view's | `mardown-paste-handler/index.ts:863-890` | markdown paste suites |
| One copy each of `prosemirror-model/state/view/transform` | ~12 files import `prosemirror-*` directly | `npm ls` |

## 10. Left to the builder

Probe file names and layout (next to the code they cover); exact fixture wording; how the dist key check in §5.10.3(a) is scripted; whether §5 probes identical to an existing test are folded into it; how upstream handlers are disabled where a rule says so; commit wording.
