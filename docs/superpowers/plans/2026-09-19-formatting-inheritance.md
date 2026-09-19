# Formatting Inheritance (TEC-3030 stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every inline format (font family/size, colour, highlight, B/I/U/S, inline code) and every block format (line height, spacing, alignment) survive Enter, empty lines, clicks away and back, reloads and collaborators, in both document schemas.

**Architecture:** Google-Docs "paragraph mark" model. A new `caretMarks` node attr on `paragraph`/`heading` stores the caret style of an *empty* block (JSON of marks; `'[]'` = explicitly cleared, `null` = never stamped). One extension, `CaretMarks`, keeps a per-dispatch context in plugin state and appends four idempotent rules (A1 explicit stamp, A3 emptied-in-place, B restore on entry, C keep pending marks through appended steps). Creation of a block is *declared* by the path that creates it (overridden `splitBlock`/`splitListItem`, the v1 dBlock Enter handler, the callout insert) with `tr.setStoredMarks(style)` as its last operation. The legacy `fontFamily`/`fontSize` paragraph attrs are frozen (read, never written except by `unset*`).

**Tech Stack:** Tiptap 3 / ProseMirror (`@tiptap/pm/*`), Yjs via `@tiptap/extension-collaboration` (undo = Yjs UndoManager), vitest + jsdom.

**Spec:** `docs/FORMATTING_INHERITANCE.md` (final, 2026-09-19). Section numbers below (3.1, 3.2 …) refer to it. Section 6 is the acceptance-test list; every test group there maps to a task here.

## Global Constraints

- Both schemas: v1 (`dBlock` wrappers, `schemaVersion: 1`) and v2 (flat, `schemaVersion: 2`). Behaviour that differs by schema gets a v1 and a v2 case (`describe.each([1, 2])`).
- `caretMarks` has **no HTML form** (`rendered: false`): never in `getHTML()`, never parsed, never exported.
- **Every document write requires `local`** (no `y-sync` meta, no `addToHistory: false`). Rules B and C are stored-marks-only and are tagged with the plugin's meta.
- **`tr.setStoredMarks(style)` is the LAST operation** of every declaring path; any step after it erases the declaration.
- **Capture the style before delegating** to a Tiptap command: the chainable `state` is a facade refreshed from `tr`.
- Legacy `fontFamily`/`fontSize` paragraph attrs: `keepOnSplit: false`; no set-writers remain; `unsetFontFamily`/`unsetFontSize` keep nulling the attr on an empty caret block; readers stay. Middle splits still copy them (documented limitation, pinned by a test).
- Tests must use the real keydown path — `view.someProp('handleKeyDown', f => f(view, keydownEvent))` — never `editor.commands.keyboardShortcut('Enter')` (it replays only steps and drops selection + storedMarks). Read the *created* block by index, not the block at the caret.
- Repo rules: no commits in this plan (the user commits); lint touched files with `npx eslint --no-fix <files>` (a bare `npm run lint` rewrites ~29 untouched files); comments only where the *why* is not obvious, ≤3 lines; `@fileverse/ui` icons only (none needed here); do not rename `mardown-paste-handler`.
- Run tests from the worktree root: `npx vitest run <file>`. Type-check with `npx tsc`.

---

## File structure

| File | Responsibility |
|---|---|
| `package/extensions/caret-marks/caret-style.ts` (new) | Pure helpers: `CARET_MARKS_ATTR`, `serializeMarks`, `parseMarks`, `fillLegacyFont`, `caretStyle`, `filterSplittable`, `stampAttrs`. Imported by the extension, `dblock.ts` and `insert-commands.ts`. |
| `package/extensions/caret-marks/dispatch-context.ts` (new) | The per-dispatch context (`local`, `docChanged`, `oldCaret` survival + `deletedMarks`, `pending`) as pure functions over transactions. |
| `package/extensions/caret-marks/caret-marks.ts` (new) | The `CaretMarks` extension: global attr, `splitBlock`/`splitListItem` overrides, the rules plugin (A1/A3/B/C), the empty-line decoration plugin. |
| `package/extensions/caret-marks/index.ts` (new) | Re-exports. |
| `package/extensions/caret-marks/test-helpers.ts` (new) | Shared jsdom helpers for the caret-marks tests (mounted Collaboration editor, real keydown, native-delete emulation, block readers). |
| `package/extensions/caret-marks/*.test.ts` (new) | `caret-style.test.ts`, `dispatch-context.test.ts`, `caret-marks-attr.test.ts`, `caret-marks.test.ts` (the §6 matrix), `caret-marks-undo.test.ts`. |
| `package/extensions/font-family-persistence.ts`, `package/extensions/font-size/font-size.ts` | Remove set-writers; `keepOnSplit: false` on the paragraph attrs. |
| `package/extensions/typography-persistence.ts` | Deleted. |
| `package/extensions/trailing-node/trailing-node.ts` | Stop copying/syncing font attrs (keep `lineHeight`). |
| `package/utils/insert-commands.ts` | Callout insert declares the caret style. |
| `package/extensions/d-block/dblock.ts` | v1 Enter handler: declared style, carried block attrs incl. `textAlign`, list-exit spacing owner, blockquote fix, never `false` after dispatch. |
| `package/extensions/paragraph-spacing.ts` | v2 list-exit spacing: capture at root, apply in `appendTransaction`. |
| `package/extensions/default-extension.ts` | Register `CaretMarks` in place of `TypographyPersistence`. |
| `package/extensions/paragraph-spacing-carryover.test.ts` | Blockquote exit, list exit (both schemas, production order), list deletion controls. |
| `AGENTS.md` | Add `FORMATTING_INHERITANCE.md` to the docs list. |

---

### Task 1: Caret style helpers

**Files:**
- Create: `package/extensions/caret-marks/caret-style.ts`
- Test: `package/extensions/caret-marks/caret-style.test.ts`

**Interfaces:**
- Produces:
  - `CARET_MARKS_ATTR = 'caretMarks'`
  - `serializeMarks(marks: readonly Mark[]): string`
  - `parseMarks(schema: Schema, value: unknown): Mark[]` — unknown mark types and malformed input yield `[]`/are skipped
  - `fillLegacyFont(schema: Schema, marks: readonly Mark[], legacyBlock: ProseMirrorNode | null): Mark[]` — per property: fills `fontFamily`/`fontSize` the marks leave unset from the block's legacy attrs
  - `caretStyle(source: { storedMarks; selection; doc }, legacyBlock: ProseMirrorNode | null): Mark[]` — `storedMarks ?? $from.marks()` then `fillLegacyFont`; both `EditorState` and `Transaction` satisfy `source`
  - `filterSplittable(marks: readonly Mark[], editor: Editor): Mark[]` — keeps marks in `editor.extensionManager.splittableMarks`
  - `stampAttrs(attrs: Record<string, unknown>, style: readonly Mark[]): Record<string, unknown>` — `{ ...attrs, caretMarks: serializeMarks(style), fontFamily: null, fontSize: null }` (the two legacy keys only when present in `attrs`)

- [ ] **Step 1: Write the failing tests**

```ts
// package/extensions/caret-marks/caret-style.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import {
  CARET_MARKS_ATTR,
  caretStyle,
  fillLegacyFont,
  filterSplittable,
  parseMarks,
  serializeMarks,
  stampAttrs,
} from './caret-style';

const makeEditor = (content: string) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({ schemaVersion: 2 }) as AnyExtension[],
    textDirection: 'auto',
  });
  editor.commands.setContent(content);
  return editor;
};

let editor: Editor;
afterEach(() => editor?.destroy());

describe('serializeMarks / parseMarks', () => {
  it('round-trips marks with attrs and serialises an empty set as "[]"', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    const marks = [
      schema.marks.bold.create(),
      schema.marks.textStyle.create({ fontSize: '24px' }),
    ];
    const json = serializeMarks(marks);
    expect(JSON.parse(json)).toEqual([
      { type: 'bold' },
      { type: 'textStyle', attrs: expect.objectContaining({ fontSize: '24px' }) },
    ]);
    const back = parseMarks(schema, json);
    expect(back.map((m) => m.type.name)).toEqual(['bold', 'textStyle']);
    expect(back[1].attrs.fontSize).toBe('24px');
    expect(serializeMarks([])).toBe('[]');
    expect(parseMarks(schema, '[]')).toEqual([]);
  });

  it('skips unknown mark types and tolerates malformed input', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    expect(parseMarks(schema, '[{"type":"nope"},{"type":"bold"}]').map((m) => m.type.name)).toEqual(['bold']);
    expect(parseMarks(schema, 'not json')).toEqual([]);
    expect(parseMarks(schema, null)).toEqual([]);
    expect(parseMarks(schema, '{"type":"bold"}')).toEqual([]);
  });
});

describe('fillLegacyFont', () => {
  it('fills only the font properties the marks leave unset', () => {
    editor = makeEditor('<p style="font-family: Georgia; font-size: 24px"></p>');
    const { schema } = editor;
    const block = editor.state.doc.firstChild!;
    expect(block.attrs.fontFamily).toBe('Georgia');

    const filled = fillLegacyFont(schema, [], block);
    expect(filled.map((m) => m.type.name)).toEqual(['textStyle']);
    expect(filled[0].attrs).toMatchObject({ fontFamily: 'Georgia', fontSize: '24px' });

    const partial = fillLegacyFont(
      schema,
      [schema.marks.bold.create(), schema.marks.textStyle.create({ fontSize: '32px', color: '#f00' })],
      block,
    );
    const textStyle = partial.find((m) => m.type.name === 'textStyle')!;
    expect(textStyle.attrs).toMatchObject({ fontFamily: 'Georgia', fontSize: '32px', color: '#f00' });
    expect(partial.some((m) => m.type.name === 'bold')).toBe(true);
  });

  it('returns the marks unchanged without a legacy block or legacy attrs', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    const bold = schema.marks.bold.create();
    expect(fillLegacyFont(schema, [bold], null)).toEqual([bold]);
    expect(fillLegacyFont(schema, [bold], editor.state.doc.firstChild!)).toEqual([bold]);
  });
});

describe('caretStyle', () => {
  it('prefers stored marks, then the marks at the caret, then the legacy fill', () => {
    editor = makeEditor('<p style="font-size: 24px"><strong>ab</strong></p>');
    const { schema, state } = editor;
    const block = state.doc.firstChild!;
    editor.commands.setTextSelection(3);
    expect(caretStyle(editor.state, block).map((m) => m.type.name).sort()).toEqual(['bold', 'textStyle']);

    const tr = editor.state.tr.setStoredMarks([schema.marks.italic.create()]);
    expect(caretStyle(tr, block).map((m) => m.type.name).sort()).toEqual(['italic', 'textStyle']);
    expect(caretStyle(tr, null).map((m) => m.type.name)).toEqual(['italic']);
  });
});

describe('filterSplittable / stampAttrs', () => {
  it('drops link (keepOnSplit: false) and keeps code', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    const marks = [
      schema.marks.link.create({ href: 'https://x.y' }),
      schema.marks.code.create(),
      schema.marks.bold.create(),
    ];
    expect(filterSplittable(marks, editor).map((m) => m.type.name).sort()).toEqual(['bold', 'code']);
  });

  it('writes the stamp and nulls legacy font attrs only when present', () => {
    editor = makeEditor('<p></p>');
    const bold = editor.schema.marks.bold.create();
    expect(stampAttrs({ fontFamily: 'Georgia', fontSize: '24px', lineHeight: '2' }, [bold])).toEqual({
      fontFamily: null,
      fontSize: null,
      lineHeight: '2',
      [CARET_MARKS_ATTR]: '[{"type":"bold"}]',
    });
    expect(stampAttrs({ level: 2 }, [])).toEqual({ level: 2, [CARET_MARKS_ATTR]: '[]' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/caret-style.test.ts`
Expected: FAIL — `Cannot find module './caret-style'`.

- [ ] **Step 3: Write the helpers**

```ts
// package/extensions/caret-marks/caret-style.ts
import type { Editor } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';

export const CARET_MARKS_ATTR = 'caretMarks';

/** Both EditorState and Transaction have this shape. */
export type CaretSource = {
  storedMarks: readonly Mark[] | null;
  selection: Selection;
  doc: ProseMirrorNode;
};

export const serializeMarks = (marks: readonly Mark[]): string =>
  JSON.stringify(marks.map((mark) => mark.toJSON()));

export const parseMarks = (schema: Schema, value: unknown): Mark[] => {
  if (typeof value !== 'string') return [];
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const marks: Mark[] = [];
  json.forEach((item: { type?: string; attrs?: Record<string, unknown> }) => {
    const type = item && typeof item === 'object' ? schema.marks[item.type ?? ''] : undefined;
    if (type) marks.push(type.create(item.attrs ?? null));
  });
  return marks;
};

/**
 * Fill the font properties the marks leave unset from a legacy paragraph's
 * fontFamily / fontSize attrs (old docs). Explicit marks win.
 */
export const fillLegacyFont = (
  schema: Schema,
  marks: readonly Mark[],
  legacyBlock: ProseMirrorNode | null,
): Mark[] => {
  const textStyle = schema.marks.textStyle;
  const family = legacyBlock?.attrs.fontFamily ?? null;
  const size = legacyBlock?.attrs.fontSize ?? null;
  if (!textStyle || (!family && !size)) return [...marks];

  const existing = marks.find((mark) => mark.type === textStyle);
  const attrs: Record<string, unknown> = { ...(existing?.attrs ?? {}) };
  let changed = false;
  if (family && !attrs.fontFamily) {
    attrs.fontFamily = family;
    changed = true;
  }
  if (size && !attrs.fontSize) {
    attrs.fontSize = size;
    changed = true;
  }
  if (!changed) return [...marks];
  return [...textStyle.create(attrs).addToSet(marks)];
};

/** What typing a character would produce right now, legacy font filled in. */
export const caretStyle = (
  source: CaretSource,
  legacyBlock: ProseMirrorNode | null,
): Mark[] =>
  fillLegacyFont(
    source.doc.type.schema,
    source.storedMarks ?? source.selection.$from.marks(),
    legacyBlock,
  );

/** Marks Tiptap lets cross a split (everything but link). */
export const filterSplittable = (marks: readonly Mark[], editor: Editor): Mark[] =>
  marks.filter((mark) =>
    editor.extensionManager.splittableMarks.includes(mark.type.name),
  );

/** A stamp carries the font; a block never holds both the stamp and the legacy attrs. */
export const stampAttrs = (
  attrs: Record<string, unknown>,
  style: readonly Mark[],
): Record<string, unknown> => ({
  ...attrs,
  [CARET_MARKS_ATTR]: serializeMarks(style),
  ...('fontFamily' in attrs ? { fontFamily: null } : {}),
  ...('fontSize' in attrs ? { fontSize: null } : {}),
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/caret-style.test.ts`
Expected: PASS (5 tests). Mark order inside a set follows schema rank, so assertions compare parsed JSON, never the raw string, wherever more than one mark is present.

- [ ] **Step 5: Lint**

Run: `npx eslint --no-fix package/extensions/caret-marks/caret-style.ts package/extensions/caret-marks/caret-style.test.ts`
Expected: no errors.

---

### Task 2: The attribute, the decoration, registration, and the shared test helpers

**Files:**
- Create: `package/extensions/caret-marks/caret-marks.ts`, `package/extensions/caret-marks/index.ts`, `package/extensions/caret-marks/test-helpers.ts`
- Modify: `package/extensions/default-extension.ts:67,259` (swap `TypographyPersistence` for `CaretMarks`), `package/extensions/font-family-persistence.ts:90-92`, `package/extensions/font-size/font-size.ts:30-31` (`keepOnSplit: false`)
- Delete: `package/extensions/typography-persistence.ts`
- Test: `package/extensions/caret-marks/caret-marks-attr.test.ts`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces:
  - `CaretMarks: Extension` (name `'caretMarks'`), `caretMarksPluginKey: PluginKey<DispatchContext>` (the rules plugin — its `appendTransaction` is added in Task 4; this task registers only the attr and the decoration plugin), `caretMarksDecorationKey: PluginKey<DecorationSet>`.
  - Test helpers (all take an `Editor`): `makeEditor(schemaVersion, content?: string | null, options?: { ydoc?: Y.Doc; extensions?: AnyExtension[] })`, `track(editor)`, `destroyTracked()`, `endOf(editor, text)`, `startOf(editor, text)`, `selectText(editor, text)`, `caretTo(editor, pos)`, `pressKey(editor, key)`, `pressEnter(editor)`, `type(editor, text = 'x')`, `typedMarks(editor)` (types `x`, returns its mark names sorted), `typedTextStyle(editor)`, `nativeDelete(editor, from, to)`, `backspace(editor)`, `textblocks(editor)`, `createdBlock(editor)`, `caretBlock(editor)`, `stampOf(node)`, `markNames(marks)`, `storedMarkNames(editor)`, `stampBlock(editor, pos, marks)`, `applyRemote(editor, mutate)`, `ySyncPlugin(editor)`, `undoManager(editor)`.

- [ ] **Step 1: Write the shared test helpers**

```ts
// package/extensions/caret-marks/test-helpers.ts
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Plugin, Transaction } from '@tiptap/pm/state';
import * as Y from 'yjs';
import type { UndoManager } from 'yjs';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { CARET_MARKS_ATTR, serializeMarks } from './caret-style';

/**
 * Mounted, Collaboration-backed editor with the production extension set.
 * Collaboration owns the doc, so content is set after construction; pass
 * `null` to leave it to a Yjs sync.
 */
export const makeEditor = (
  schemaVersion: number,
  content: string | null = '<p></p>',
  options: { ydoc?: Y.Doc; extensions?: AnyExtension[] } = {},
) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      ...(getHeadlessExtensions({
        schemaVersion,
        ydoc: options.ydoc,
      }) as AnyExtension[]),
      ...(options.extensions ?? []),
    ],
    textDirection: 'auto',
  });
  if (content !== null) editor.commands.setContent(content);
  return editor;
};

const tracked: Editor[] = [];
export const track = (editor: Editor) => {
  tracked.push(editor);
  return editor;
};
export const destroyTracked = () => {
  tracked.splice(0).forEach((editor) => editor.destroy());
};

/** Position just after the first occurrence of `text`. */
export const endOf = (editor: Editor, text: string) => {
  let end = -1;
  editor.state.doc.descendants((node, pos) => {
    if (end === -1 && node.isText && node.text?.includes(text)) {
      end = pos + node.text.indexOf(text) + text.length;
    }
  });
  if (end === -1) throw new Error(`"${text}" not found`);
  return end;
};
export const startOf = (editor: Editor, text: string) =>
  endOf(editor, text) - text.length;

export const selectText = (editor: Editor, text: string) =>
  editor.commands.setTextSelection({
    from: startOf(editor, text),
    to: endOf(editor, text),
  });

/** A click or arrow key: a selection change and nothing else. */
export const caretTo = (editor: Editor, pos: number) =>
  editor.commands.setTextSelection(pos);

/**
 * The real keydown path. `commands.keyboardShortcut('Enter')` replays only
 * the handler's steps and drops its selection and stored marks.
 */
export const pressKey = (editor: Editor, key: string) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  return (
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ??
    false
  );
};
export const pressEnter = (editor: Editor) => pressKey(editor, 'Enter');

/** The transaction the browser produces for typed text (uses storedMarks). */
export const type = (editor: Editor, text = 'x') =>
  editor.view.dispatch(editor.state.tr.insertText(text));

export const markNames = (marks: readonly Mark[] | null | undefined) =>
  (marks ?? []).map((mark) => mark.type.name).sort();

/** Types `x` and reports the marks it got — what the user sees. */
export const typedMarks = (editor: Editor) => {
  type(editor, 'x');
  const node = editor.state.doc.nodeAt(editor.state.selection.from - 1);
  return markNames(node?.marks);
};
export const typedTextStyle = (editor: Editor) => {
  type(editor, 'x');
  const node = editor.state.doc.nodeAt(editor.state.selection.from - 1);
  return node?.marks.find((m) => m.type.name === 'textStyle')?.attrs ?? null;
};

/**
 * jsdom has no DOM-change path; this is what prosemirror-view dispatches
 * for a native deletion: delete, then ensureMarks(marksAcross).
 */
export const nativeDelete = (editor: Editor, from: number, to: number) => {
  const { doc } = editor.state;
  const tr = editor.state.tr.delete(from, to);
  const marks = doc.resolve(from).marksAcross(doc.resolve(to));
  if (marks) tr.ensureMarks(marks);
  editor.view.dispatch(tr);
};
export const backspace = (editor: Editor) => {
  const { from } = editor.state.selection;
  nativeDelete(editor, from - 1, from);
};

/** Every textblock in document order, with its opening position. */
export const textblocks = (editor: Editor) => {
  const blocks: { node: ProseMirrorNode; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) blocks.push({ node, pos });
  });
  return blocks;
};
/** The block Enter created: always the one after the original. */
export const createdBlock = (editor: Editor) => textblocks(editor)[1];

export const caretBlock = (editor: Editor) => {
  const { $from } = editor.state.selection;
  return { node: $from.parent, pos: $from.before() };
};

export const stampOf = (node: ProseMirrorNode | undefined) =>
  (node?.attrs[CARET_MARKS_ATTR] ?? null) as string | null;

export const storedMarkNames = (editor: Editor) =>
  editor.state.storedMarks === null ? null : markNames(editor.state.storedMarks);

/** Write a stamp by hand (test setup for stale / pre-existing stamps). */
export const stampBlock = (
  editor: Editor,
  pos: number,
  marks: readonly Mark[] | string,
) => {
  const node = editor.state.doc.nodeAt(pos)!;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      [CARET_MARKS_ATTR]:
        typeof marks === 'string' ? marks : serializeMarks(marks),
    }),
  );
};

/** The y-sync plugin Collaboration registered (its key name is 'y-sync$…'). */
export const ySyncPlugin = (editor: Editor) =>
  editor.state.plugins.find((plugin) =>
    String((plugin as unknown as { key: string }).key).startsWith('y-sync$'),
  ) as Plugin;

/** Dispatch a transaction tagged as a remote (y-sync) change. */
export const applyRemote = (
  editor: Editor,
  mutate: (tr: Transaction) => Transaction,
) => {
  editor.view.dispatch(
    mutate(editor.state.tr).setMeta(ySyncPlugin(editor), {
      isChangeOrigin: true,
    }),
  );
};

export const undoManager = (editor: Editor): UndoManager =>
  (editor.state as unknown as Record<string, { undoManager: UndoManager }>)[
    'y-undo$'
  ].undoManager;
```

- [ ] **Step 2: Write the failing attribute tests**

```ts
// package/extensions/caret-marks/caret-marks-attr.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  caretTo,
  caretBlock,
  createdBlock,
  textblocks,
  stampBlock,
  stampOf,
  type,
} from './test-helpers';

afterEach(destroyTracked);

describe.each([1, 2])('caretMarks attribute (schema v%i)', (version) => {
  it('exists on paragraphs and headings, defaults to null, and has no HTML form', () => {
    const editor = track(makeEditor(version, '<h2>t</h2><p>x</p>'));
    editor.state.doc.descendants((node) => {
      if (node.isTextblock) expect(node.attrs.caretMarks).toBeNull();
    });
    stampBlock(editor, caretBlock(editor).pos, '[{"type":"bold"}]');
    expect(editor.getHTML()).not.toContain('caretMarks');
    expect(editor.getHTML()).not.toContain('bold');
  });

  it('survives a JSON round-trip through setContent', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    stampBlock(editor, caretBlock(editor).pos, '[{"type":"bold"}]');
    const json = editor.getJSON();
    const other = track(makeEditor(version, null));
    other.commands.setContent(json);
    expect(stampOf(textblocks(other)[0].node)).toBe('[{"type":"bold"}]');
  });

  it('renders the stamped font on an empty line as a decoration, not markup', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    stampBlock(
      editor,
      caretBlock(editor).pos,
      '[{"type":"textStyle","attrs":{"fontFamily":"Georgia","fontSize":"24px"}}]',
    );
    const p = () => editor.view.dom.querySelector('p') as HTMLParagraphElement;
    expect(p().style.fontSize).toBe('24px');
    expect(p().style.fontFamily).toBe('Georgia');
    expect(editor.getHTML()).not.toContain('24px');

    type(editor, 'x');
    expect(p().style.fontSize).toBe('');
    editor.view.dispatch(editor.state.tr.delete(editor.state.selection.from - 1, editor.state.selection.from));
    expect(p().style.fontSize).toBe('24px');
  });
});

describe('keepOnSplit (schema v2)', () => {
  it('does not copy caretMarks or the legacy font attrs onto the block an end split creates', () => {
    const editor = track(makeEditor(2, '<p style="font-family: Georgia; font-size: 24px">abc</p>'));
    stampBlock(editor, 0, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock();
    const created = createdBlock(editor).node;
    expect(created.attrs.fontFamily).toBeNull();
    expect(created.attrs.fontSize).toBeNull();
    // The split's own declaration (Task 5) stamps it later; at this point it is null or the declared value.
    expect(stampOf(created)).not.toBe('[{"type":"bold"}]');
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/caret-marks-attr.test.ts`
Expected: FAIL — `caretMarks` is `undefined` on nodes (attr not declared) and the decoration assertions fail.

- [ ] **Step 4: Write the extension skeleton (attr + decoration plugin), register it, freeze the legacy attrs' split behaviour, delete TypographyPersistence**

```ts
// package/extensions/caret-marks/caret-marks.ts
import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CARET_MARKS_ATTR, parseMarks } from './caret-style';
import type { DispatchContext } from './dispatch-context';

export const caretMarksPluginKey = new PluginKey<DispatchContext>('caretMarks');
export const caretMarksDecorationKey = new PluginKey<DecorationSet>(
  'caretMarksDecoration',
);

/** Inline style an empty stamped line renders so its caret has the stamp's font. */
const emptyLineStyle = (schema: Schema, attr: unknown): string | null => {
  if (typeof attr !== 'string' || attr === '[]') return null;
  const textStyle = parseMarks(schema, attr).find(
    (mark) => mark.type.name === 'textStyle',
  );
  if (!textStyle) return null;
  const parts: string[] = [];
  if (textStyle.attrs.fontFamily) parts.push(`font-family: ${textStyle.attrs.fontFamily}`);
  if (textStyle.attrs.fontSize) parts.push(`font-size: ${textStyle.attrs.fontSize}`);
  return parts.length ? parts.join('; ') : null;
};

const decorationsBetween = (doc: ProseMirrorNode, from: number, to: number) => {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.content.size === 0) {
      const style = emptyLineStyle(doc.type.schema, node.attrs[CARET_MARKS_ATTR]);
      if (style) decorations.push(Decoration.node(pos, pos + node.nodeSize, { style }));
    }
    return false;
  });
  return decorations;
};

// A decoration, not renderHTML: ProseMirror reuses a <p> whose attrs are
// unchanged, so markup could not follow the block as it gains or loses text.
// Only the top-level blocks a transaction touched are re-scanned (TEC-3008).
const decorationPlugin = () =>
  new Plugin<DecorationSet>({
    key: caretMarksDecorationKey,
    state: {
      init: (_, state) =>
        DecorationSet.create(
          state.doc,
          decorationsBetween(state.doc, 0, state.doc.content.size),
        ),
      apply: (tr, set) => {
        if (!tr.docChanged) return set;
        let next = set.map(tr.mapping, tr.doc);
        const ranges: [number, number][] = [];
        tr.mapping.maps.forEach((map, i) => {
          const rest = tr.mapping.slice(i + 1);
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
          });
        });
        const size = tr.doc.content.size;
        ranges.forEach(([start, end]) => {
          const $start = tr.doc.resolve(Math.max(0, Math.min(start, size)));
          const $end = tr.doc.resolve(Math.max(0, Math.min(end, size)));
          const from = $start.depth ? $start.before(1) : $start.pos;
          const to = $end.depth ? $end.after(1) : $end.pos;
          next = next.remove(
            next.find(from, to).filter((d) => d.from >= from && d.to <= to),
          );
          next = next.add(tr.doc, decorationsBetween(tr.doc, from, to));
        });
        return next;
      },
    },
    props: {
      decorations: (state) => caretMarksDecorationKey.getState(state),
    },
  });

/**
 * Google-Docs paragraph mark: an empty block remembers its caret style in
 * `caretMarks` (JSON marks; '[]' = explicitly cleared, null = never stamped).
 * See docs/FORMATTING_INHERITANCE.md.
 */
export const CaretMarks = Extension.create({
  name: 'caretMarks',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          [CARET_MARKS_ATTR]: {
            default: null,
            keepOnSplit: false,
            rendered: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [decorationPlugin()];
  },
});
```

```ts
// package/extensions/caret-marks/dispatch-context.ts  (type only for now; Task 3 fills it)
import type { Mark } from '@tiptap/pm/model';

export type OldCaret = {
  wasEmpty: boolean;
  pos: number | null;
  deletedMarks: readonly Mark[] | null;
};
export type Pending = { marks: readonly Mark[] | null; explicit: boolean };
export type DispatchContext = {
  local: boolean;
  docChanged: boolean;
  oldCaret: OldCaret | null;
  pending: Pending | null;
};
```

```ts
// package/extensions/caret-marks/index.ts
export { CaretMarks, caretMarksPluginKey, caretMarksDecorationKey } from './caret-marks';
export {
  CARET_MARKS_ATTR,
  caretStyle,
  fillLegacyFont,
  filterSplittable,
  parseMarks,
  serializeMarks,
  stampAttrs,
} from './caret-style';
```

`package/extensions/default-extension.ts`: replace the import on line 67 and the entry on line 259:

```ts
import { CaretMarks } from './caret-marks';
// …
  FontFamily,
  FontFamilyPersistence,
  CaretMarks,
  StarterKit.configure({
```

`package/extensions/font-family-persistence.ts` lines 90–92 — add `keepOnSplit: false`:

```ts
          fontFamily: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) =>
```

`package/extensions/font-size/font-size.ts` lines 30–31 (the `paragraph` attr only, not the `textStyle` one):

```ts
          fontSize: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) =>
```

Delete `package/extensions/typography-persistence.ts` (`git rm package/extensions/typography-persistence.ts`). Both of its plugins are subsumed: inheritance by the split declarations, restoration by Rule B.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/caret-marks-attr.test.ts`
Expected: PASS. If the `keepOnSplit` test's created block still shows the legacy attrs, check that Tiptap's `getSplittedAttributes` sees the flag: it reads `extensionAttribute.attribute.keepOnSplit` from the *global attribute* declaration, which is what was edited.

- [ ] **Step 6: Type-check, lint, and confirm nothing else referenced TypographyPersistence**

Run: `npx tsc && npx eslint --no-fix package/extensions/caret-marks package/extensions/default-extension.ts package/extensions/font-family-persistence.ts package/extensions/font-size/font-size.ts && grep -rn "TypographyPersistence\|typography-persistence" package demo/src index.ts`
Expected: tsc clean, eslint clean, grep empty.

- [ ] **Step 7: Run the existing suite for regressions**

Run: `npx vitest run package/extensions/paragraph-spacing-carryover.test.ts package/extensions/text-style-selection.test.ts package/extensions/default-extension.test.ts`
Expected: PASS (TypographyPersistence had no tests; the carry-over file tests only block attrs).

---

### Task 3: The dispatch context

**Files:**
- Modify: `package/extensions/caret-marks/dispatch-context.ts` (fill in the functions)
- Test: `package/extensions/caret-marks/dispatch-context.test.ts`

**Interfaces:**
- Consumes: `DispatchContext`, `OldCaret`, `Pending` types (Task 2).
- Produces:
  - `EMPTY_CONTEXT: DispatchContext`
  - `isRootTransaction(tr): boolean` — no `appendedTransaction` meta
  - `isLocalRoot(tr): boolean` — `!isChangeOrigin(tr) && tr.getMeta('addToHistory') !== false`
  - `applyDispatchContext(tr, prev, oldState, key: PluginKey): DispatchContext` — rebuilt at a root, updated at an appended transaction

- [ ] **Step 1: Write the failing tests**

```ts
// package/extensions/caret-marks/dispatch-context.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { PluginKey } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  caretTo,
  caretBlock,
  markNames,
  ySyncPlugin,
} from './test-helpers';
import { EMPTY_CONTEXT, applyDispatchContext } from './dispatch-context';

afterEach(destroyTracked);

const key = new PluginKey('caretMarksTest');
const context = (editor: ReturnType<typeof makeEditor>, tr: ReturnType<typeof editor.state.tr.setMeta>) =>
  applyDispatchContext(tr, EMPTY_CONTEXT, editor.state, key);

describe('dispatch context: provenance', () => {
  it('is local for a plain root and not for y-sync or addToHistory:false roots', () => {
    const editor = track(makeEditor(2, '<p>abc</p>'));
    expect(context(editor, editor.state.tr.insertText('z')).local).toBe(true);
    expect(context(editor, editor.state.tr.insertText('z').setMeta('addToHistory', false)).local).toBe(false);
    expect(
      context(editor, editor.state.tr.insertText('z').setMeta(ySyncPlugin(editor), { isChangeOrigin: true })).local,
    ).toBe(false);
  });

  it('tracks pending: explicit unless tagged, cleared by a selection change, left alone by a bare step', () => {
    const editor = track(makeEditor(2, '<p>abc</p>'));
    const bold = editor.schema.marks.bold.create();
    expect(context(editor, editor.state.tr.setStoredMarks([bold])).pending).toEqual({ marks: [bold], explicit: true });
    expect(context(editor, editor.state.tr.setStoredMarks([bold]).setMeta(key, true)).pending).toEqual({
      marks: [bold],
      explicit: false,
    });
    expect(context(editor, editor.state.tr.setStoredMarks(null)).pending).toEqual({ marks: null, explicit: true });

    const withPending = context(editor, editor.state.tr.setStoredMarks([bold]));
    const appendedStep = editor.state.tr.insertText('z').setMeta('appendedTransaction', editor.state.tr);
    expect(applyDispatchContext(appendedStep, withPending, editor.state, key).pending).toEqual(withPending.pending);
    const appendedSelection = editor.state.tr.setSelection(editor.state.selection).setMeta('appendedTransaction', editor.state.tr);
    expect(applyDispatchContext(appendedSelection, withPending, editor.state, key).pending).toBeNull();
    // A root always starts from scratch.
    expect(applyDispatchContext(editor.state.tr.insertText('z'), withPending, editor.state, key).pending).toBeNull();
  });
});

describe('dispatch context: old caret block survival', () => {
  it('follows the block through an insertion before it, dies with its opening token, survives setNodeMarkup', () => {
    const editor = track(makeEditor(2, '<p>one</p><p>two</p>'));
    caretTo(editor, endOf(editor, 'two'));
    const { pos, node } = caretBlock(editor);
    const paragraph = editor.schema.nodes.paragraph.create();

    expect(context(editor, editor.state.tr.insert(pos, paragraph)).oldCaret?.pos).toBe(pos + paragraph.nodeSize);
    expect(context(editor, editor.state.tr.insert(0, paragraph)).oldCaret?.pos).toBe(pos + paragraph.nodeSize);
    expect(context(editor, editor.state.tr.delete(pos, pos + node.nodeSize)).oldCaret?.pos).toBeNull();
    expect(context(editor, editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, lineHeight: '2' })).oldCaret?.pos).toBe(pos);
    expect(context(editor, editor.state.tr.replaceWith(0, editor.state.doc.content.size, paragraph)).oldCaret?.pos).toBeNull();
    expect(context(editor, editor.state.tr.insertText('z')).oldCaret).toMatchObject({ pos, wasEmpty: false });
  });

  it('follows the block through a lift out of a list', () => {
    const editor = track(makeEditor(2, '<ul><li><p>item</p></li></ul>'));
    caretTo(editor, endOf(editor, 'item'));
    const { pos } = caretBlock(editor);
    const range = editor.state.selection.$from.blockRange()!;
    const target = liftTarget(range)!;
    const tr = editor.state.tr.lift(range, target);
    const ctx = context(editor, tr);
    expect(ctx.oldCaret?.pos).not.toBeNull();
    expect(tr.doc.nodeAt(ctx.oldCaret!.pos!)?.textContent).toBe('item');
    expect(ctx.oldCaret?.pos).toBeLessThan(pos);
  });
});

describe('dispatch context: deleted marks', () => {
  it('reports the marks of text deleted inside the caret block, an empty set included', () => {
    const editor = track(makeEditor(2, '<p><strong>ab</strong>c</p>'));
    caretTo(editor, endOf(editor, 'c'));
    const end = endOf(editor, 'c');
    expect(markNames(context(editor, editor.state.tr.delete(end - 1, end)).oldCaret?.deletedMarks)).toEqual([]);
    expect(markNames(context(editor, editor.state.tr.delete(end - 2, end - 1)).oldCaret?.deletedMarks)).toEqual(['bold']);
    expect(context(editor, editor.state.tr.insertText('z')).oldCaret?.deletedMarks).toBeNull();
    expect(context(editor, editor.state.tr.delete(0, 1)).oldCaret?.deletedMarks).toBeNull();
  });

  it('resolves a later step in that step\'s own coordinates and document', () => {
    const editor = track(makeEditor(2, '<p>one</p><p><strong>t</strong>wo</p>'));
    caretTo(editor, endOf(editor, 'wo'));
    const end = endOf(editor, 'wo');
    // Step 0 shifts everything after "one"; step 1 must still find "o" (plain) in doc[1].
    const tr = editor.state.tr.insertText('ZZZ', endOf(editor, 'one'));
    tr.delete(tr.mapping.map(end - 1), tr.mapping.map(end));
    expect(markNames(context(editor, tr).oldCaret?.deletedMarks)).toEqual([]);

    const tr2 = editor.state.tr.insertText('ZZZ', endOf(editor, 'one'));
    const tEnd = endOf(editor, 't');
    tr2.delete(tr2.mapping.map(tEnd - 1), tr2.mapping.map(tEnd));
    expect(markNames(context(editor, tr2).oldCaret?.deletedMarks)).toEqual(['bold']);
  });

  it('keeps the block alive when a block is inserted at its opening and text is then deleted', () => {
    const editor = track(makeEditor(2, '<p>one</p><p>a</p>'));
    caretTo(editor, endOf(editor, 'a'));
    const { pos } = caretBlock(editor);
    const paragraph = editor.schema.nodes.paragraph.create();
    const tr = editor.state.tr.insert(pos, paragraph);
    const end = tr.mapping.map(endOf(editor, 'a'));
    tr.delete(end - 1, end);
    const ctx = context(editor, tr);
    expect(ctx.oldCaret?.pos).toBe(pos + paragraph.nodeSize);
    expect(markNames(ctx.oldCaret?.deletedMarks)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/dispatch-context.test.ts`
Expected: FAIL — `applyDispatchContext is not a function` / `EMPTY_CONTEXT` undefined.

- [ ] **Step 3: Implement the context**

Replace `dispatch-context.ts` with:

```ts
// package/extensions/caret-marks/dispatch-context.ts
import { isChangeOrigin } from '@tiptap/extension-collaboration';
import type { Mark } from '@tiptap/pm/model';
import type { EditorState, PluginKey, Transaction } from '@tiptap/pm/state';
import { ReplaceAroundStep, type Step } from '@tiptap/pm/transform';

export type OldCaret = {
  wasEmpty: boolean;
  /** Opening position of the pre-root caret block, tracked per step; null once its opening token went. */
  pos: number | null;
  /** marksAcross of the last deletion inside that block; null when nothing was deleted there. */
  deletedMarks: readonly Mark[] | null;
};
export type Pending = { marks: readonly Mark[] | null; explicit: boolean };

/**
 * Provenance of the dispatch in progress. ProseMirror's append loop hands a
 * hook only the transactions it has not seen, so the root's origin, stored
 * marks and steps live here, rebuilt at every root transaction.
 */
export type DispatchContext = {
  local: boolean;
  docChanged: boolean;
  oldCaret: OldCaret | null;
  pending: Pending | null;
};

export const EMPTY_CONTEXT: DispatchContext = {
  local: false,
  docChanged: false,
  oldCaret: null,
  pending: null,
};

export const isRootTransaction = (tr: Transaction) =>
  !tr.getMeta('appendedTransaction');

export const isLocalRoot = (tr: Transaction) =>
  !isChangeOrigin(tr) && tr.getMeta('addToHistory') !== false;

// setNodeMarkup re-issues a node's tokens around its content (the gap): the
// block survives at `pos` although its opening token was replaced.
const isWrapperReplacement = (step: Step, pos: number) =>
  step instanceof ReplaceAroundStep &&
  step.from === pos &&
  step.gapFrom === step.from + 1 &&
  step.gapTo === step.to - 1;

// `deleted`, not `deletedAfter`: a zero-width insertion at `pos` reports
// deletedAfter too, and would pronounce the block dead when a paragraph is
// merely inserted in front of it.
const mapBlockPos = (step: Step, pos: number): number | null => {
  const result = step.getMap().mapResult(pos, 1);
  if (result.deleted && !isWrapperReplacement(step, pos)) return null;
  return result.pos;
};

const trackOldCaret = (tr: Transaction, oldState: EditorState): OldCaret | null => {
  const { $from } = oldState.selection;
  const block = $from.parent;
  if (!block.isTextblock) return null;

  let pos: number | null = $from.before();
  const contentFrom = pos + 1;
  const contentTo = contentFrom + block.content.size;
  let deletedMarks: readonly Mark[] | null = null;

  tr.steps.forEach((step, i) => {
    if (pos === null) return;
    if (block.content.size > 0) {
      // The block's content range in step i's own coordinates, and the marks
      // from the doc that step saw — never pre-root positions (review R4-3).
      const before = tr.mapping.slice(0, i);
      const from = before.map(contentFrom, -1);
      const to = before.map(contentTo, 1);
      const doc = tr.docs[i];
      step.getMap().forEach((oldStart, oldEnd) => {
        const a = Math.max(oldStart, from);
        const b = Math.min(oldEnd, to);
        if (a >= b) return;
        deletedMarks = doc.resolve(a).marksAcross(doc.resolve(b)) ?? [];
      });
    }
    pos = mapBlockPos(step, pos);
  });

  return { wasEmpty: block.content.size === 0, pos, deletedMarks };
};

const nextPending = (
  tr: Transaction,
  prev: Pending | null,
  key: PluginKey,
): Pending | null => {
  if (tr.storedMarksSet) {
    return { marks: tr.storedMarks, explicit: !tr.getMeta(key) };
  }
  if (tr.selectionSet) return null;
  return prev;
};

export const applyDispatchContext = (
  tr: Transaction,
  prev: DispatchContext,
  oldState: EditorState,
  key: PluginKey,
): DispatchContext => {
  if (isRootTransaction(tr)) {
    return {
      local: isLocalRoot(tr),
      docChanged: tr.docChanged,
      oldCaret: trackOldCaret(tr, oldState),
      pending: nextPending(tr, null, key),
    };
  }
  const oldCaret =
    prev.oldCaret && prev.oldCaret.pos !== null
      ? {
          ...prev.oldCaret,
          pos: tr.steps.reduce<number | null>(
            (pos, step) => (pos === null ? null : mapBlockPos(step, pos)),
            prev.oldCaret.pos,
          ),
        }
      : prev.oldCaret;
  return { ...prev, oldCaret, pending: nextPending(tr, prev.pending, key) };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/dispatch-context.test.ts`
Expected: PASS. If the lift test fails on `pos`, print `tr.steps[0]` — a lift out of a single-item list is one `ReplaceAroundStep` whose `gapFrom` is the paragraph's opening; `mapResult(pos, 1)` must land at the paragraph's new top-level position, not report `deleted`.

- [ ] **Step 5: Lint**

Run: `npx eslint --no-fix package/extensions/caret-marks/dispatch-context.ts package/extensions/caret-marks/dispatch-context.test.ts`

---

### Task 4: Rules A1, B and C

**Files:**
- Modify: `package/extensions/caret-marks/caret-marks.ts` (add the rules plugin)
- Test: `package/extensions/caret-marks/caret-marks.test.ts` (new; the file grows through Tasks 5–7 and 10)

**Interfaces:**
- Consumes: Task 1 helpers, Task 3 `applyDispatchContext`/`EMPTY_CONTEXT`.
- Produces: the rules plugin under `caretMarksPluginKey` with `state.apply = applyDispatchContext` and `appendTransaction = stampRule ?? restoreRule`. Every transaction the plugin appends carries `setMeta(caretMarksPluginKey, true)`.

- [ ] **Step 1: Write the failing tests**

```ts
// package/extensions/caret-marks/caret-marks.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { CaretMarks } from './caret-marks';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  startOf,
  caretTo,
  caretBlock,
  createdBlock,
  textblocks,
  stampBlock,
  stampOf,
  storedMarkNames,
  typedMarks,
  typedTextStyle,
  type,
} from './test-helpers';

afterEach(destroyTracked);

describe.each([1, 2])('Rule A1 — explicit stamp (schema v%i)', (version) => {
  it('stamps an empty line the user formats, and typing gets the marks', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('stamps "[]" when the user clears the pending marks on an empty line', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('fills the legacy font into an explicit stamp and nulls the legacy attrs', () => {
    const editor = track(makeEditor(version, '<p style="font-size: 32px"></p>'));
    editor.commands.toggleBold();
    const { node } = caretBlock(editor);
    expect(node.attrs.fontSize).toBeNull();
    const stamp = JSON.parse(stampOf(node)!);
    expect(stamp).toHaveLength(2);
    expect(stamp).toEqual(
      expect.arrayContaining([
        { type: 'bold' },
        { type: 'textStyle', attrs: expect.objectContaining({ fontSize: '32px' }) },
      ]),
    );
    expect(typedMarks(editor)).toEqual(['bold', 'textStyle']);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('never stamps a non-empty block', () => {
    const editor = track(makeEditor(version, '<p>abc</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBeNull();
    expect(typedMarks(editor)).toEqual(['bold']);
  });
});

describe.each([1, 2])('Rule B — restore on entry (schema v%i)', (version) => {
  it('restores a stamp when the caret enters the empty line', () => {
    const editor = track(makeEditor(version, '<p></p><p>abc</p>'));
    editor.commands.toggleBold();
    caretTo(editor, endOf(editor, 'abc'));
    expect(storedMarkNames(editor)).toBeNull();
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('keeps "[]" cleared even next to bold text', () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p><p></p>'));
    const empty = textblocks(editor)[1];
    stampBlock(editor, empty.pos, '[]');
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it('falls back to the legacy font attrs of a never-stamped line, without a doc write', () => {
    const editor = track(makeEditor(version, '<p>abc</p><p style="font-family: Georgia"></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(typedTextStyle(editor)?.fontFamily).toBe('Georgia');
  });

  it('falls back to the previous block\'s end marks for a never-stamped, attr-less line', () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p><p></p>'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(stampOf(caretBlock(editor).node)).toBeNull();
  });

  it('is tagged: a restore never counts as the user formatting the line', () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p><p></p>'));
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(editor.state.doc.eq(before)).toBe(true);
  });
});

describe('Rule C — pending marks survive appended steps (schema v2)', () => {
  const orders: [string, (extensions: AnyExtension[]) => AnyExtension[]][] = [
    ['production order', (extensions) => extensions],
    [
      'CaretMarks registered after BlockId',
      (extensions) => [...extensions.filter((e) => e.name !== 'caretMarks'), CaretMarks],
    ],
  ];

  it.each(orders)('re-sets marks that blockIdAssign$ wiped (%s)', (_label, reorder) => {
    const custom = track(
      new Editor({
        element: document.body.appendChild(document.createElement('div')),
        extensions: reorder(getHeadlessExtensions({ schemaVersion: 2 }) as AnyExtension[]),
        textDirection: 'auto',
      }),
    );
    custom.commands.setContent('<p><strong>A</strong>B</p>');
    caretTo(custom, endOf(custom, 'A'));
    // A raw split followed by a declaration: blockIdAssign$ appends a
    // setNodeMarkup for the new block, which nulls storedMarks.
    const tr = custom.state.tr.split(custom.state.selection.from);
    tr.setStoredMarks([custom.schema.marks.bold.create()]);
    custom.view.dispatch(tr);
    expect(createdBlock(custom).node.attrs.blockId).toBeTruthy();
    expect(storedMarkNames(custom)).toEqual(['bold']);
    expect(typedMarks(custom)).toEqual(['bold']);
    expect(createdBlock(custom).node.textContent).toBe('xB');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts`
Expected: FAIL — stamps are `null`, restored stored marks are `null`.

- [ ] **Step 3: Add the rules plugin**

In `caret-marks.ts`, extend the imports and add the rules above `CaretMarks`:

```ts
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import {
  CARET_MARKS_ATTR,
  fillLegacyFont,
  parseMarks,
  serializeMarks,
  stampAttrs,
} from './caret-style';
import {
  EMPTY_CONTEXT,
  applyDispatchContext,
  type DispatchContext,
} from './dispatch-context';

const caretInEmptyBlock = (state: EditorState) => {
  const { selection } = state;
  const block = selection.$from.parent;
  if (
    !selection.empty ||
    !block.isTextblock ||
    block.content.size !== 0 ||
    !(CARET_MARKS_ATTR in block.attrs)
  ) {
    return null;
  }
  return { block, pos: selection.$from.before() };
};

/** Marks at the end of the nearest text block before `pos` (Rule B's last fallback). */
const previousBlockEndMarks = (doc: ProseMirrorNode, pos: number): readonly Mark[] => {
  let end = -1;
  doc.nodesBetween(0, pos, (node, nodePos) => {
    if (nodePos + node.nodeSize > pos) return true;
    if (node.isTextblock) {
      end = nodePos + node.nodeSize - 1;
      return false;
    }
    return true;
  });
  return end < 0 ? [] : doc.resolve(end).marks();
};

/** Rules A1 and A3 — the only document writes; both need `local`. */
const stampRule = (
  ctx: DispatchContext,
  state: EditorState,
  key: PluginKey<DispatchContext>,
): Transaction | null => {
  if (!ctx.local) return null;
  const caret = caretInEmptyBlock(state);
  if (!caret) return null;

  let style: Mark[] | null = null;
  if (ctx.pending?.explicit) {
    style = fillLegacyFont(state.schema, ctx.pending.marks ?? [], caret.block);
  }
  // (Rule A3 is added in Task 6.)
  if (!style) return null;

  if (caret.block.attrs[CARET_MARKS_ATTR] === serializeMarks(style)) return null;
  return state.tr
    .setNodeMarkup(caret.pos, undefined, stampAttrs(caret.block.attrs, style))
    .setStoredMarks(style)
    .setMeta(key, true);
};

/** Rules C and B — stored-marks only, tagged so a restore is never read as explicit. */
const restoreRule = (
  ctx: DispatchContext,
  state: EditorState,
  key: PluginKey<DispatchContext>,
): Transaction | null => {
  if (state.storedMarks !== null || !state.selection.empty) return null;
  if (ctx.pending && ctx.pending.marks !== null) {
    return state.tr.setStoredMarks(ctx.pending.marks).setMeta(key, true);
  }
  const caret = caretInEmptyBlock(state);
  if (!caret) return null;
  const attr = caret.block.attrs[CARET_MARKS_ATTR];
  let marks: readonly Mark[];
  if (typeof attr === 'string') {
    marks = parseMarks(state.schema, attr);
  } else {
    marks = fillLegacyFont(state.schema, [], caret.block);
    if (!marks.length) marks = previousBlockEndMarks(state.doc, caret.pos);
  }
  if (!marks.length) return null;
  return state.tr.setStoredMarks(marks).setMeta(key, true);
};

const rulesPlugin = () =>
  new Plugin<DispatchContext>({
    key: caretMarksPluginKey,
    state: {
      init: () => EMPTY_CONTEXT,
      apply: (tr, prev, oldState) =>
        applyDispatchContext(tr, prev, oldState, caretMarksPluginKey),
    },
    appendTransaction: (_transactions, _oldState, newState) => {
      const ctx = caretMarksPluginKey.getState(newState) ?? EMPTY_CONTEXT;
      return (
        stampRule(ctx, newState, caretMarksPluginKey) ??
        restoreRule(ctx, newState, caretMarksPluginKey)
      );
    },
  });
```

and register it:

```ts
  addProseMirrorPlugins() {
    return [rulesPlugin(), decorationPlugin()];
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts`
Expected: PASS. Watch for an infinite append loop (vitest hangs / "RangeError"): every rule must be a no-op once it has applied — A1 compares the serialised style to the attr, B/C only fire while `storedMarks === null`.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc && npx eslint --no-fix package/extensions/caret-marks`

---

### Task 5: Declared inheritance — the split overrides

**Files:**
- Modify: `package/extensions/caret-marks/caret-marks.ts` (add `addCommands`)
- Test: append to `package/extensions/caret-marks/caret-marks.test.ts`

**Interfaces:**
- Consumes: the core commands `@tiptap/core` exports by name (`import { splitBlock as coreSplitBlock, splitListItem as coreSplitListItem } from '@tiptap/core'`, typed `RawCommands['splitBlock']` / `RawCommands['splitListItem']`), Task 1 `caretStyle`/`filterSplittable`/`stampAttrs`.
- Produces: `splitBlock(options?)` and `splitListItem(typeOrName, overrideAttrs?)` overrides that (1) capture `{ style, pos, sourceWasEmpty }` from `tr` before delegating, (2) delegate, (3) stamp an emptied left half at `pos` when `!sourceWasEmpty`, (4) `tr.setStoredMarks(style)` last. `keepMarks: false` → no declaration.

- [ ] **Step 1: Write the failing tests**

Append to `caret-marks.test.ts`:

```ts
import { CARET_MARKS_ATTR } from './caret-style';

describe('declared inheritance — splitBlock override (schema v2)', () => {
  it('carries bold at the end of a line: stamp, stored marks, typed text', () => {
    const editor = track(makeEditor(2, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    let root: { storedMarksSet: boolean } | null = null;
    editor.on('transaction', ({ transaction }) => {
      root = root ?? transaction;
    });
    expect(editor.commands.splitBlock()).toBe(true);
    expect(root!.storedMarksSet).toBe(true);
    expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('declares an empty style: bold turned off before Enter stays off, stamped "[]"', () => {
    const editor = track(makeEditor(2, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    editor.commands.splitBlock();
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('keeps the pending style in front of the right half on a mid-text split', () => {
    const editor = track(makeEditor(2, '<p><strong>A</strong>B</p>'));
    caretTo(editor, endOf(editor, 'A'));
    editor.commands.splitBlock();
    expect(createdBlock(editor).node.attrs.blockId).toBeTruthy();
    expect(typedMarks(editor)).toEqual(['bold']);
    expect(createdBlock(editor).node.textContent).toBe('xB');
    const b = editor.state.doc.nodeAt(endOf(editor, 'B') - 1);
    expect(b?.marks).toEqual([]);
  });

  it('carries a style set mid-word with nothing selected', () => {
    const editor = track(makeEditor(2, '<p>abc</p>'));
    caretTo(editor, endOf(editor, 'ab'));
    editor.commands.toggleBold();
    editor.commands.splitBlock();
    expect(typedMarks(editor)).toEqual(['bold']);
    expect(editor.state.doc.nodeAt(endOf(editor, 'c') - 1)?.marks).toEqual([]);
  });

  it('carries a legacy font as marks and leaves no attr on the new block', () => {
    const editor = track(makeEditor(2, '<p style="font-size: 32px">abc</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock();
    const created = createdBlock(editor).node;
    expect(created.attrs.fontSize).toBeNull();
    expect(JSON.parse(stampOf(created)!)).toEqual([
      { type: 'textStyle', attrs: expect.objectContaining({ fontSize: '32px' }) },
    ]);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('middle split of a legacy-font paragraph keeps the attr on both halves (documented limitation)', () => {
    const editor = track(makeEditor(2, '<p style="font-size: 32px">abcdef</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock();
    const [left, right] = textblocks(editor);
    expect(left.node.attrs.fontSize).toBe('32px');
    expect(right.node.attrs.fontSize).toBe('32px');
    expect(right.node.textContent).toBe('def');
  });

  it('drops link from the declaration but leaves the original line\'s link stamp alone', () => {
    const editor = track(makeEditor(2, '<p></p>'));
    editor.commands.setLink({ href: 'https://x.y' });
    expect(stampOf(caretBlock(editor).node)).toContain('"type":"link"');
    editor.commands.splitBlock();
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(stampOf(caretBlock(editor).node)).toContain('"type":"link"');
    expect(typedMarks(editor)).toEqual(['link']);
  });

  it('keeps inline code active on an empty line', () => {
    const editor = track(makeEditor(2, '<p></p>'));
    editor.commands.toggleCode();
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"code"}]');
    expect(typedMarks(editor)).toEqual(['code']);
  });

  it('passes keepMarks:false through without a declaration', () => {
    const editor = track(makeEditor(2, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock({ keepMarks: false });
    expect(stampOf(createdBlock(editor).node)).toBeNull();
  });
});

describe.each([
  ['stale non-null stamp on plain text', '<p>abc</p>', '[{"type":"bold"}]', false, '[]', []],
  ['unstamped bold text', '<p><strong>abc</strong></p>', null, false, '[{"type":"bold"}]', ['bold']],
  ['plain text stamped "[]" with bold pending', '<p>abc</p>', '[]', true, '[{"type":"bold"}]', ['bold']],
])('splitBlock at offset 0 — %s (schema v2)', (_label, content, stamp, pendingBold, expectedStamp, expectedMarks) => {
  it('stamps the emptied left half with the captured style; the right half keeps its text', () => {
    const editor = track(makeEditor(2, content));
    if (stamp) stampBlock(editor, 0, stamp);
    caretTo(editor, startOf(editor, 'abc'));
    if (pendingBold) editor.commands.toggleBold();
    editor.commands.splitBlock();
    const [left, right] = textblocks(editor);
    expect(left.node.content.size).toBe(0);
    expect(stampOf(left.node)).toBe(expectedStamp);
    expect(right.node.textContent).toBe('abc');
    expect(editor.state.selection.from).toBe(right.pos + 1);
    // The right-hand caret keeps the pending style in front of the text.
    expect(typedMarks(editor)).toEqual(expectedMarks);
    // Return to the empty line above: the stamp is what typing gets.
    caretTo(editor, left.pos + 1);
    expect(typedMarks(editor)).toEqual(expectedMarks);
  });
});

describe.each([1, 2])('declared inheritance — splitListItem override (schema v%i)', (version) => {
  it('carries bold into the next bullet', () => {
    const editor = track(makeEditor(version, '<ul><li><p><strong>abc</strong></p></li></ul>'));
    caretTo(editor, endOf(editor, 'abc'));
    expect(editor.commands.splitListItem('listItem')).toBe(true);
    expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('carries a legacy font out of a list paragraph as marks', () => {
    const editor = track(makeEditor(version, '<ul><li><p style="font-size: 32px">abc</p></li></ul>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitListItem('listItem');
    const created = createdBlock(editor).node;
    expect(created.attrs.fontSize).toBeNull();
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('stamps the emptied left item on an offset-0 split across the </li><li> boundary', () => {
    const editor = track(makeEditor(version, '<ul><li><p><strong>abc</strong></p></li></ul>'));
    caretTo(editor, startOf(editor, 'abc'));
    editor.commands.splitListItem('listItem');
    const [left, right] = textblocks(editor);
    expect(left.node.content.size).toBe(0);
    expect(stampOf(left.node)).toBe('[{"type":"bold"}]');
    expect(right.node.textContent).toBe('abc');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('middle split of a legacy-font list paragraph keeps the attr on both halves', () => {
    const editor = track(makeEditor(version, '<ul><li><p style="font-size: 32px">abcdef</p></li></ul>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitListItem('listItem');
    const [left, right] = textblocks(editor);
    expect(left.node.attrs.fontSize).toBe('32px');
    expect(right.node.attrs.fontSize).toBe('32px');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts -t "declared inheritance"`
Expected: FAIL — created blocks are unstamped / stored marks lost after `blockIdAssign$`.

- [ ] **Step 3: Confirm nothing else overrides these commands, then add the overrides**

Run: `grep -rn "splitBlock:\|splitListItem:" package/extensions package/utils` — expected empty (an override elsewhere would win or lose by registration order; spec §7).

In `caret-marks.ts`:

```ts
import {
  Extension,
  splitBlock as coreSplitBlock,
  splitListItem as coreSplitListItem,
  type Editor,
} from '@tiptap/core';
import { caretStyle, filterSplittable } from './caret-style';

type SplitCapture = { style: Mark[]; pos: number; sourceWasEmpty: boolean };

// Read from `tr`, before delegating: Tiptap's command `state` is a facade
// refreshed from the working transaction, so a style read afterwards sees
// the new empty paragraph and would clear the bold the split preserved.
const captureSplit = (tr: Transaction, editor: Editor): SplitCapture | null => {
  const { $from } = tr.selection;
  const block = $from.parent;
  if (!block.isTextblock) return null;
  return {
    style: filterSplittable(caretStyle(tr, block), editor),
    pos: $from.before(),
    sourceWasEmpty: block.content.size === 0,
  };
};

// Enter at offset 0 leaves an empty line behind the caret where no rule
// reaches; stamp it here. setStoredMarks must stay last: any later step
// erases the declaration.
const declareSplit = (tr: Transaction, capture: SplitCapture) => {
  if (!capture.sourceWasEmpty) {
    const left = tr.doc.nodeAt(capture.pos);
    if (left?.isTextblock && left.content.size === 0 && CARET_MARKS_ATTR in left.attrs) {
      tr.setNodeMarkup(capture.pos, undefined, stampAttrs(left.attrs, capture.style));
    }
  }
  tr.setStoredMarks(capture.style);
};
```

and inside `CaretMarks`:

```ts
  addCommands() {
    return {
      splitBlock:
        (options) =>
        (props) => {
          const capture =
            options?.keepMarks === false ? null : captureSplit(props.tr, props.editor);
          const ok = coreSplitBlock(options)(props);
          if (ok && props.dispatch && capture) declareSplit(props.tr, capture);
          return ok;
        },
      splitListItem:
        (typeOrName, overrideAttrs) =>
        (props) => {
          const capture = captureSplit(props.tr, props.editor);
          const ok = coreSplitListItem(typeOrName, overrideAttrs)(props);
          if (ok && props.dispatch && capture) declareSplit(props.tr, capture);
          return ok;
        },
    };
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts`
Expected: PASS. If `editor.commands.splitBlock` still runs the core version, confirm the merge order: core `Commands` is prepended by `Editor.createExtensionManager` at priority 100 and `ExtensionManager.commands` reduces in sorted order, later wins — `CaretMarks` must not declare a priority above 100 and must be in `defaultExtensions` (Task 2). If the link case fails at `setLink` (the repo's `CustomLink` wraps Tiptap's), set the pending link directly: `editor.view.dispatch(editor.state.tr.addStoredMark(editor.schema.marks.link.create({ href: 'https://x.y' })))`.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc && npx eslint --no-fix package/extensions/caret-marks`
Expected: clean. If tsc complains about the `splitBlock` signature, type the override as `RawCommands['splitBlock']`.

---

### Task 6: Rule A3 — emptied in place

**Files:**
- Modify: `package/extensions/caret-marks/caret-marks.ts` (`stampRule`)
- Test: append to `package/extensions/caret-marks/caret-marks.test.ts`

**Interfaces:**
- Consumes: `DispatchContext.oldCaret` (Task 3).
- Produces: A3 branch inside `stampRule`: `ctx.pending === null && ctx.docChanged && ctx.oldCaret && !ctx.oldCaret.wasEmpty && ctx.oldCaret.pos === caret.pos && ctx.oldCaret.deletedMarks !== null` → style = `fillLegacyFont(schema, deletedMarks, caret.block)`.

- [ ] **Step 1: Write the failing tests**

```ts
describe.each([1, 2])('Rule A3 — emptied in place (schema v%i)', (version) => {
  const boldStampedPlainChar = (editor: ReturnType<typeof makeEditor>) => {
    // A line stamped bold whose only character is plain.
    stampBlock(editor, textblocks(editor)[0].pos, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'a'));
  };

  it('backspacing the last plain character of a bold-stamped line leaves it plain, persistently', () => {
    const editor = track(makeEditor(version, '<p>a</p><p>zzz</p>'));
    boldStampedPlainChar(editor);
    backspace(editor);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
    backspace(editor);
    caretTo(editor, endOf(editor, 'zzz'));
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it('uses the deleted text\'s marks, not the pending style of the moment', () => {
    const editor = track(makeEditor(version, '<p>a</p>'));
    boldStampedPlainChar(editor);
    editor.commands.toggleBold();
    editor.commands.setColor('#ff0000');
    editor.commands.setFontSize('24px');
    backspace(editor);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('backspacing the last bold character stamps bold (the native path sets stored marks)', () => {
    const editor = track(makeEditor(version, '<p><strong>a</strong></p>'));
    caretTo(editor, endOf(editor, 'a'));
    backspace(editor);
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('detects the deletion when an earlier step in the same root edited another paragraph', () => {
    const editor = track(makeEditor(version, '<p>one</p><p>a</p>'));
    stampBlock(editor, textblocks(editor)[1].pos, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'a'));
    const end = endOf(editor, 'a');
    const tr = editor.state.tr.insertText('ZZ', endOf(editor, 'one'));
    tr.delete(tr.mapping.map(end - 1), tr.mapping.map(end));
    editor.view.dispatch(tr);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('survives a block inserted at the old caret block\'s opening in the same root', () => {
    const editor = track(makeEditor(version, '<p>one</p><p>a</p>'));
    const { pos } = textblocks(editor)[1];
    stampBlock(editor, pos, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'a'));
    const end = endOf(editor, 'a');
    const inserted = version === 1
      ? editor.schema.nodes.dBlock.create(null, editor.schema.nodes.paragraph.create())
      : editor.schema.nodes.paragraph.create();
    const at = version === 1 ? editor.state.selection.$from.before(1) : pos;
    const tr = editor.state.tr.insert(at, inserted);
    tr.delete(tr.mapping.map(end - 1), tr.mapping.map(end));
    editor.view.dispatch(tr);
    expect(caretBlock(editor).node.content.size).toBe(0);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('writes nothing when the caret lands in a different, pre-existing block', () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p><p></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    const { pos, node } = caretBlock(editor);
    const from = version === 1 ? editor.state.selection.$from.before(1) : pos;
    const to = from + (version === 1 ? node.nodeSize + 2 : node.nodeSize);
    editor.view.dispatch(editor.state.tr.delete(from, to));
    expect(caretBlock(editor).node.content.size).toBe(0);
    expect(stampOf(caretBlock(editor).node)).toBeNull();
  });
});
```

Add `backspace` to the helper import at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts -t "Rule A3"`
Expected: FAIL — the stamp stays `[{"type":"bold"}]` after the plain character is deleted.

- [ ] **Step 3: Add A3 to `stampRule`**

Replace the `// (Rule A3 is added in Task 6.)` comment with:

```ts
  else if (
    ctx.pending === null &&
    ctx.docChanged &&
    ctx.oldCaret &&
    !ctx.oldCaret.wasEmpty &&
    ctx.oldCaret.pos === caret.pos &&
    ctx.oldCaret.deletedMarks !== null
  ) {
    // The deleted text's own marks, an empty set included — the case
    // ensureMarks cannot signal (spec 3.2, Rule A3).
    style = fillLegacyFont(state.schema, ctx.oldCaret.deletedMarks, caret.block);
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts`
Expected: PASS. If the "different, pre-existing block" v1 case deletes the wrong range, print `editor.state.doc.toString()` first and adjust `to` — the goal is to delete the whole first dBlock so the caret lands in the second, untouched one.

- [ ] **Step 5: Lint**

Run: `npx eslint --no-fix package/extensions/caret-marks`

---

### Task 7: Freeze the legacy font attrs

**Files:**
- Modify: `package/extensions/font-family-persistence.ts:37-57`, `package/extensions/font-size/font-size.ts:89-109,134-189`, `package/extensions/trailing-node/trailing-node.ts:51-153`, `package/utils/insert-commands.ts:61-96`
- Test: append to `package/extensions/caret-marks/caret-marks.test.ts`

**Interfaces:**
- Consumes: `caretStyle`, `filterSplittable` (Task 1).
- Produces: `setFontFamily`/`setFontSize`/`increaseFontSize`/`decreaseFontSize` no longer write paragraph attrs; `unset*` still null them on an empty caret block; trailing node carries only `lineHeight`; `insertCommands.callout` ends its chain with `tr.setStoredMarks(style)`.

- [ ] **Step 1: Write the failing tests**

```ts
import { insertCommands } from '../../utils/insert-commands';

describe.each([1, 2])('legacy fonts (schema v%i)', (version) => {
  it('setFontSize on an empty line writes a stamp, not a paragraph attr', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.setFontSize('24px');
    const { node } = caretBlock(editor);
    expect(node.attrs.fontSize).toBeNull();
    expect(JSON.parse(stampOf(node)!)).toEqual([
      { type: 'textStyle', attrs: expect.objectContaining({ fontSize: '24px' }) },
    ]);
    expect(typedTextStyle(editor)?.fontSize).toBe('24px');
  });

  it('the stale-mirror case: X on empty, type, select, change to Y, Enter, type → Y', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.setFontSize('24px');
    type(editor, 'abc');
    selectText(editor, 'abc');
    editor.commands.setFontSize('32px');
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('resets family and size independently on an empty legacy line', () => {
    const family = track(makeEditor(version, '<p style="font-family: Georgia; font-size: 32px"></p>'));
    family.commands.unsetFontFamily();
    expect(caretBlock(family).node.attrs.fontFamily).toBeNull();
    const familyStyle = typedTextStyle(family);
    expect(familyStyle?.fontFamily ?? null).toBeNull();
    expect(familyStyle?.fontSize).toBe('32px');

    const size = track(makeEditor(version, '<p style="font-family: Georgia; font-size: 32px"></p>'));
    size.commands.toggleBold();
    size.commands.unsetFontSize();
    const sizeStyle = typedTextStyle(size);
    expect(sizeStyle?.fontSize ?? null).toBeNull();
    expect(sizeStyle?.fontFamily).toBe('Georgia');
    expect(typedMarks(size)).toEqual(['bold', 'textStyle']);
  });

  it('bold on an empty legacy 32px line types bold 32px', () => {
    const editor = track(makeEditor(version, '<p style="font-size: 32px"></p>'));
    editor.commands.toggleBold();
    expect(typedMarks(editor)).toEqual(['bold', 'textStyle']);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });
});

describe('trailing node (schema v1)', () => {
  it('carries no font attrs; entering it restores nothing from an unformatted heading', () => {
    const editor = track(makeEditor(1, '<p style="font-family: Georgia">abc</p><h2>t</h2>'));
    const trailing = textblocks(editor).at(-1)!.node;
    expect(trailing.attrs.class).toBe('trailing-node');
    expect(trailing.attrs.fontFamily).toBeNull();
    expect(trailing.attrs.fontSize).toBeNull();
    caretTo(editor, textblocks(editor).at(-1)!.pos + 1);
    expect(storedMarkNames(editor)).toBeNull();
  });
});

describe.each([1, 2])('callout insert (schema v%i)', (version) => {
  it('declares the caret style on the callout\'s paragraph, replacing a fresh doc\'s only line', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    insertCommands.callout(editor);
    const { node } = caretBlock(editor);
    expect(editor.state.selection.$from.node(-1).type.name).toBe('callout');
    expect(stampOf(node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('declares it with a second paragraph present, and after leaving and re-entering', () => {
    const editor = track(makeEditor(version, '<p></p><p>zzz</p>'));
    caretTo(editor, 1 + (version === 1 ? 1 : 0));
    editor.commands.setColor('#ff0000');
    insertCommands.callout(editor);
    const inside = caretBlock(editor).pos + 1;
    caretTo(editor, endOf(editor, 'zzz'));
    caretTo(editor, inside);
    expect(typedTextStyle(editor)?.color).toBe('#ff0000');
  });
});
```

Add `selectText` and `pressEnter` to the helper import.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts -t "legacy fonts|trailing node|callout"`
Expected: FAIL — `fontSize` attr is `'24px'` after `setFontSize`; trailing node has `fontFamily: 'Georgia'`; callout paragraph unstamped.

- [ ] **Step 3: Remove the set-writers**

`font-family-persistence.ts` `setFontFamily` becomes:

```ts
      setFontFamily:
        (fontFamily: string) =>
        ({ chain, state }) => {
          const existing = getExistingTextStyleAttrs(this.editor);
          const { selection } = state;
          return chain()
            .setMark(
              'textStyle',
              selection.empty ? { ...existing, fontFamily } : { fontFamily },
            )
            .run();
        },
```

`unsetFontFamily` keeps its `tr.setNodeMarkup(... fontFamily: null)` block unchanged (Rule A1 reads the block after the command; a reset must not be refilled). Same edit in `font-size.ts` for `setFontSize`, `increaseFontSize`, `decreaseFontSize` — delete the `if (node?.type.name === 'paragraph' && node.textContent === '') { tr.setNodeMarkup(...) }` block and the now-unused `tr`/`$pos`/`node` bindings in each; `unsetFontSize` unchanged.

`trailing-node.ts`: in Path 1 drop `fontFamily`/`fontSize` (keep `lineHeight`):

```ts
            const lastChild = doc.lastChild;
            let lineHeight: string | null = null;
            if (lastChild?.type.name === 'dBlock') {
              lastChild.descendants((node) => {
                if (node.type.name === 'paragraph') {
                  lineHeight = node.attrs.lineHeight || null;
                }
              });
            }

            const styledNode = type.create({
              class: 'trailing-node',
              // Omit when absent so the schema default applies
              ...(lineHeight ? { lineHeight } : {}),
            });
```

In Path 2 read only `prevLineHeight`, compare only `nextLineHeight === currentAttrs.lineHeight`, and `setNodeMarkup` only `lineHeight: nextLineHeight`. Update the two comments ("inherited font attrs" → "inherited line height"; "sync its font attrs" → "sync its line height").

`insert-commands.ts` callout:

```ts
import { caretStyle, filterSplittable } from '../extensions/caret-marks';

  callout: (editor, range) => {
    // Captured from the pre-insert state and declared last (spec 3.3): Rule
    // A1 stamps the callout's empty paragraph with it.
    const { $from } = editor.state.selection;
    const style = filterSplittable(
      caretStyle(editor.state, $from.parent.isTextblock ? $from.parent : null),
      editor,
    );
    begin(editor, range)
      .insertContent({
        type: 'callout',
        content: [{ type: 'paragraph', content: [] }],
      })
      .command(({ tr }) => {
        tr.setStoredMarks(style);
        return true;
      })
      .run();
  },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts package/extensions/text-style-selection.test.ts`
Expected: PASS. `text-style-selection.test.ts` covers the font commands over a range (unchanged code path).

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc && npx eslint --no-fix package/extensions/font-family-persistence.ts package/extensions/font-size/font-size.ts package/extensions/trailing-node/trailing-node.ts package/utils/insert-commands.ts package/extensions/caret-marks`

---

### Task 8: The v1 Enter handler

**Files:**
- Modify: `package/extensions/d-block/dblock.ts:120-446`
- Test: append to `package/extensions/caret-marks/caret-marks.test.ts` (the Enter matrix for both schemas) and to `package/extensions/paragraph-spacing-carryover.test.ts` (blockquote exit, list-exit owner, alignment)

**Interfaces:**
- Consumes: `caretStyle`, `filterSplittable`, `stampAttrs` (Task 1).
- Produces: module-level `carriedBlockAttrs(node: ProseMirrorNode, spacingOwner?: ProseMirrorNode): { lineHeight?; spaceBefore?; spaceAfter?; textAlign? }` in `dblock.ts`; every dispatching branch of the Enter handler returns `true`.

- [ ] **Step 1: Write the failing tests**

Append to `caret-marks.test.ts` — the schema matrix through the real keydown path:

```ts
describe.each([1, 2])('Enter through the keymap (schema v%i)', (version) => {
  it('carries every inline format at the end of a line, across a second Enter, and after leaving and returning', () => {
    const editor = track(makeEditor(version, '<p>abc</p>'));
    selectText(editor, 'abc');
    editor.commands.setFontFamily('Georgia');
    editor.commands.setFontSize('24px');
    editor.commands.setColor('#ff0000');
    editor.commands.setHighlight({ color: '#ffff00' });
    editor.commands.toggleBold();
    editor.commands.toggleItalic();
    editor.commands.toggleUnderline();
    editor.commands.toggleStrike();
    caretTo(editor, endOf(editor, 'abc'));
    expect(pressEnter(editor)).toBe(true);
    expect(textblocks(editor).length).toBe(2);
    const expected = ['bold', 'highlight', 'italic', 'strike', 'textStyle', 'underline'];
    expect(storedMarkNames(editor)).toEqual(expected);
    expect(pressEnter(editor)).toBe(true);
    expect(textblocks(editor).length).toBe(3);
    const third = textblocks(editor)[2];
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, third.pos + 1);
    expect(typedMarks(editor)).toEqual(expected);
    expect(typedTextStyle(editor)).toMatchObject({ fontFamily: 'Georgia', fontSize: '24px', color: '#ff0000' });
  });

  it('keeps bold pending in front of plain text on a mid-text Enter', () => {
    const editor = track(makeEditor(version, '<p><strong>A</strong>B</p>'));
    caretTo(editor, endOf(editor, 'A'));
    pressEnter(editor);
    expect(typedMarks(editor)).toEqual(['bold']);
    expect(createdBlock(editor).node.textContent).toBe('xB');
    expect(editor.state.doc.nodeAt(endOf(editor, 'B') - 1)?.marks).toEqual([]);
  });

  it('an empty style declared at Enter stays plain, also after the neighbour is made bold', () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    pressEnter(editor);
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    const created = createdBlock(editor).pos;
    selectText(editor, 'abc');
    editor.commands.unsetAllMarks();
    editor.commands.toggleBold();
    caretTo(editor, created + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it.each([
    ['stale non-null stamp on plain text', '<p>abc</p>', '[{"type":"bold"}]', false, '[]', []],
    ['unstamped bold text', '<p><strong>abc</strong></p>', null, false, '[{"type":"bold"}]', ['bold']],
    ['plain text stamped "[]" with bold pending', '<p>abc</p>', '[]', true, '[{"type":"bold"}]', ['bold']],
  ])('Enter at offset 0 — %s', (_label, content, stamp, pendingBold, expectedStamp, expectedMarks) => {
    const editor = track(makeEditor(version, content));
    if (stamp) stampBlock(editor, textblocks(editor)[0].pos, stamp);
    caretTo(editor, startOf(editor, 'abc'));
    if (pendingBold) editor.commands.toggleBold();
    pressEnter(editor);
    const [left, right] = textblocks(editor);
    expect(left.node.content.size).toBe(0);
    expect(stampOf(left.node)).toBe(expectedStamp);
    expect(right.node.textContent).toBe('abc');
    expect(editor.state.selection.from).toBe(right.pos + 1);
    expect(typedMarks(editor)).toEqual(expectedMarks);
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(typedMarks(editor)).toEqual(expectedMarks);
  });

  it('Enter from an empty line stamped with a link: original keeps the link, new line is unlinked', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.setLink({ href: 'https://x.y' });
    pressEnter(editor);
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    expect(stampOf(textblocks(editor)[0].node)).toContain('"type":"link"');
    expect(typedMarks(editor)).toEqual([]);
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(typedMarks(editor)).toEqual(['link']);
  });

  it('Enter at the end of a heading gives a paragraph that carries the marks', () => {
    const editor = track(makeEditor(version, '<h2><em>t</em></h2>'));
    caretTo(editor, endOf(editor, 't'));
    pressEnter(editor);
    expect(createdBlock(editor).node.type.name).toBe('paragraph');
    expect(typedMarks(editor)).toEqual(['italic']);
  });

  it('Enter in a bullet carries marks into the next item', () => {
    const editor = track(makeEditor(version, '<ul><li><p><strong>abc</strong></p></li></ul>'));
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    expect(createdBlock(editor).node.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.node(-1).type.name).toBe('listItem');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('Enter at the end of an old-doc paragraph whose 32px is only an attr yields marks and no attr', () => {
    const editor = track(makeEditor(version, '<p style="font-size: 32px">abc</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    expect(createdBlock(editor).node.attrs.fontSize).toBeNull();
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });
});
```

Append to `paragraph-spacing-carryover.test.ts` (it has its own `makeEditor`; add a real-keydown helper next to `pressEnterAtEndOf`):

```ts
const keydownEnter = (editor: Editor) => {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  return editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false;
};

describe('blockquote exit (schema v1)', () => {
  it('creates exactly one block and keeps the spacing', () => {
    const editor = track(
      makeEditor(1, '<blockquote><p style="margin-top: 0pt; margin-bottom: 0pt">quote</p></blockquote>'),
    );
    editor.commands.setTextSelection(endOf(editor, 'quote'));
    keydownEnter(editor); // new empty paragraph inside the quote
    const before = textblocks(editor).length;
    expect(keydownEnter(editor)).toBe(true); // exit
    expect(textblocks(editor).length).toBe(before);
    const exited = textblocks(editor)[1];
    expect(exited.name).toBe('paragraph');
    expect(exited.attrs.spaceBefore).toBe(0);
    expect(exited.attrs.spaceAfter).toBe(0);
    expect(editor.state.selection.$from.parent.attrs.spaceAfter).toBe(0);
  });
});

describe.each([1, 2])('text alignment carry-over (schema v%i)', (version) => {
  it('carries onto the next paragraph', () => {
    const editor = track(makeEditor(version, '<p style="text-align: center">one</p>'));
    editor.commands.setTextSelection(endOf(editor, 'one'));
    keydownEnter(editor);
    expect(createdBlock(editor)?.attrs.textAlign).toBe('center');
  });
});

describe('list exit spacing owner (schema v1)', () => {
  it('reads a bullet\'s spacing from the listItem', () => {
    const editor = track(
      makeEditor(1, '<ul><li style="margin-top: 12pt; margin-bottom: 8pt"><p>item</p></li></ul>'),
    );
    editor.commands.setTextSelection(endOf(editor, 'item'));
    keydownEnter(editor);
    keydownEnter(editor);
    const exited = textblocks(editor).find((b) => b.name === 'paragraph' && b.attrs.spaceBefore !== null);
    expect(exited?.attrs).toMatchObject({ spaceBefore: 12, spaceAfter: 8 });
  });

  it('reads a checklist\'s spacing from its paragraph, explicit zeros included', () => {
    const editor = track(
      makeEditor(1, '<ul data-type="taskList"><li data-type="taskItem"><p style="margin-top: 0pt; margin-bottom: 0pt">todo</p></li></ul>'),
    );
    editor.commands.setTextSelection(endOf(editor, 'todo'));
    keydownEnter(editor);
    keydownEnter(editor);
    const paragraphs = textblocks(editor).filter((b) => b.name === 'paragraph');
    const exited = paragraphs[paragraphs.length - 1];
    expect(exited.attrs.spaceBefore).toBe(0);
    expect(exited.attrs.spaceAfter).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts -t "Enter through" && npx vitest run package/extensions/paragraph-spacing-carryover.test.ts`
Expected: v1 cases FAIL (highlight/B/I/U/S lost, alignment lost, blockquote exit creates two blocks); v2 cases already pass.

- [ ] **Step 3: Rewrite the v1 Enter handler**

In `dblock.ts` add imports and the helper:

```ts
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { caretStyle, filterSplittable, stampAttrs } from '../caret-marks/caret-style';

/**
 * Block attrs a hand-built v1 block carries from the block being left.
 * spaceBefore is dropped when leaving a heading: a heading's section gap
 * landing on the body text below it would repeat on every Enter (TEC-2701).
 */
const carriedBlockAttrs = (
  node: ProseMirrorNode,
  spacingOwner: ProseMirrorNode = node,
) => {
  const isLeavingHeading = node.type.name === 'heading';
  const spaceBefore = spacingOwner.attrs.spaceBefore ?? null;
  const spaceAfter = spacingOwner.attrs.spaceAfter ?? null;
  return {
    ...(node.attrs.lineHeight ? { lineHeight: node.attrs.lineHeight } : {}),
    ...(spaceBefore !== null && !isLeavingHeading ? { spaceBefore } : {}),
    ...(spaceAfter !== null ? { spaceAfter } : {}),
    ...(node.attrs.textAlign ? { textAlign: node.attrs.textAlign } : {}),
  };
};
```

Replace the `Enter` shortcut (lines 120–446) with:

```ts
      Enter: ({ editor }) => {
        const { state } = editor;
        const {
          selection: { $head, from, to },
          doc,
        } = state;

        const currentNode = $head.node($head.depth);
        const parent = $head.node($head.depth - 1);
        if (!currentNode.isTextblock) return false;

        // The style the new line inherits (docs/FORMATTING_INHERITANCE.md 3.4):
        // captured before anything is built, declared last in every chain.
        const style = filterSplittable(caretStyle(state, currentNode), editor);
        const sourceWasEmpty = currentNode.content.size === 0;
        const declare = ({ tr }: { tr: Transaction }) => {
          tr.setStoredMarks(style);
          return true;
        };

        const headString = $head.toString();
        const nodePaths = headString.split('/');
        const isAtEndOfTheNode = $head.end() === from;
        const isAtStartOfTheNode = $head.start() === from;
        const isInsideTable = nodePaths.some((path) => path.includes('table'));

        if (
          parent?.type.name === 'listItem' ||
          parent?.type.name === 'taskItem'
        ) {
          if (isInsideTable) return false;

          const isCurrentItemEmpty = currentNode.textContent === '';
          const grandParent = $head.node($head.depth - 2);
          const currentIndex = $head.index($head.depth - 2);
          const isLastItem = currentIndex === grandParent.childCount - 1;

          let listDepth = 0;
          for (let d = $head.depth - 1; d >= 0; d--) {
            const node = $head.node(d);
            if (
              node?.type.name === 'listItem' ||
              node?.type.name === 'taskItem'
            ) {
              listDepth++;
            }
          }
          const isTopLevelList = listDepth === 1;

          if (isCurrentItemEmpty && isTopLevelList) {
            const listNode = $head.node($head.depth - 2);
            const currentItem = listNode.child(currentIndex);
            const currentItemStart = $head.before($head.depth - 1);
            const currentItemEnd = currentItemStart + currentItem.nodeSize;

            let hasNestedContent = false;
            currentItem.forEach((node) => {
              if (
                node.type.name === 'bulletList' ||
                node.type.name === 'orderedList'
              ) {
                hasNestedContent = true;
              }
            });
            if (hasNestedContent) return false;

            if (isLastItem) {
              // setParagraphSpacing writes a bullet's spacing on the listItem
              // and skips its paragraph; a task item has no spacing attrs, so
              // its paragraph owns them.
              const spacingOwner =
                parent.type.name === 'listItem' ? parent : currentNode;
              editor
                .chain()
                .deleteRange({ from: currentItemStart, to: currentItemEnd })
                .insertContentAt(currentItemStart, {
                  type: 'dBlock',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: carriedBlockAttrs(currentNode, spacingOwner),
                    },
                  ],
                })
                .focus(currentItemStart + 2)
                .command(declare)
                .run();
              return true;
            }

            editor
              .chain()
              .deleteRange({ from: currentItemStart, to: currentItemEnd })
              .run();
            return true;
          }
          if (isCurrentItemEmpty && !isTopLevelList) {
            // The block is moved, not created: it keeps its own stamp.
            const itemType = parent.type.name as 'listItem' | 'taskItem';
            if (!editor.can().liftListItem(itemType)) return false;
            editor.chain().liftListItem(itemType).run();
            return true;
          }
        }

        if (
          parent?.type.name === 'blockquote' &&
          currentNode.type.name === 'paragraph' &&
          currentNode.textContent === ''
        ) {
          // insertContentAt replaces the empty line and leaves the caret in the
          // new paragraph. A focus(from + 2) here aimed past it, the chain
          // failed, and the keymap fell through to core Enter (root cause 5).
          editor
            .chain()
            .insertContentAt(from, {
              type: 'dBlock',
              content: [
                { type: 'paragraph', attrs: carriedBlockAttrs(currentNode) },
              ],
            })
            .command(declare)
            .run();
          return true;
        }

        if (parent?.type.name !== 'dBlock') {
          if (isInsideTable) return false;
        }

        if (parent?.type.name === 'dBlock') {
          let currentActiveNodeTo = -1;
          let currentActiveNodeType = '';

          doc.descendants((node, pos) => {
            if (currentActiveNodeTo !== -1) return false;
            if (node.type.name === this.name) return;

            const [nodeFrom, nodeTo] = [pos, pos + node.nodeSize];

            if (nodeFrom <= from && to <= nodeTo) {
              currentActiveNodeTo = nodeTo;
              currentActiveNodeType = node.type.name;
            }
            return false;
          });

          const content = doc
            .slice(from, currentActiveNodeTo)
            ?.toJSON().content;

          try {
            if (currentActiveNodeType === 'codeBlock') {
              // Defer to CustomCodeBlockLowlight's Enter handler, which
              // implements single-newline insertion and triple-Enter exit.
              return false;
            }

            if (
              ['columns', 'heading'].includes(currentActiveNodeType) &&
              isAtEndOfTheNode
            ) {
              editor
                .chain()
                .insertContent({
                  type: 'dBlock',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: carriedBlockAttrs(currentNode),
                    },
                  ],
                })
                .focus(from + 4)
                .command(declare)
                .run();
              return true;
            } else if (
              currentActiveNodeType === 'columns' ||
              (currentActiveNodeType === 'heading' && !isAtStartOfTheNode)
            ) {
              editor
                .chain()
                .command(
                  ({
                    tr,
                    dispatch,
                  }: {
                    tr: Transaction;
                    dispatch: Dispatch;
                  }) => {
                    if (dispatch) {
                      tr.insertText('\n');
                    }
                    return true;
                  },
                )
                .focus(from)
                .run();
              return true;
            }

            const finalContent =
              content && content.length > 0 && !isAtEndOfTheNode
                ? content
                : [
                    {
                      type: 'paragraph',
                      attrs: carriedBlockAttrs(currentNode),
                    },
                  ];
            const originalPos = $head.before();

            editor
              .chain()
              .insertContentAt(
                { from, to: currentActiveNodeTo },
                {
                  type: this.name,
                  content: finalContent,
                },
              )
              .command(({ tr }) => {
                // Enter at offset 0 moves the text on and leaves this line
                // empty behind the caret, where no rule reaches it (spec 3.2).
                if (isAtStartOfTheNode && !sourceWasEmpty) {
                  const left = tr.doc.nodeAt(originalPos);
                  if (left?.isTextblock && left.content.size === 0) {
                    tr.setNodeMarkup(
                      originalPos,
                      undefined,
                      stampAttrs(left.attrs, style),
                    );
                  }
                }
                return true;
              })
              .focus(from + 4)
              .command(declare)
              .run();
            return true;
          } catch (error) {
            console.error(`Error inserting content into dBlock node: ${error}`);
            return false;
          }
        }

        return false;
      },
```

Remove the now-unused `attrs`/`headMarks`/`textStyleMark`/`lineHeightAttr`/`spacingAttrs`/`isLeavingHeading` bindings (all folded into `carriedBlockAttrs`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts package/extensions/paragraph-spacing-carryover.test.ts`
Expected: PASS for both schemas. If the v1 "offset 0" case leaves the caret in the wrong block, print `editor.state.doc.toString()` after Enter: the caret must be at `right.pos + 1`, i.e. `from + 4` in the pre-Enter coordinates; do not change `focus(from + 4)` without re-checking that against the printed structure. If the blockquote test still sees two blocks, assert that the chain returned `true` from every command (`editor.can().chain()…`) — a failing command in the chain is what the old `.focus(from + 2)` caused.

- [ ] **Step 5: Run the whole suite, type-check, lint**

Run: `npm test && npx tsc && npx eslint --no-fix package/extensions/d-block/dblock.ts package/extensions/paragraph-spacing-carryover.test.ts`
Expected: green.

---

### Task 9: v2 list-exit spacing

**Files:**
- Modify: `package/extensions/paragraph-spacing.ts:107-288` (add a third plugin)
- Test: append to `package/extensions/paragraph-spacing-carryover.test.ts`

**Interfaces:**
- Consumes: `isChangeOrigin` (already imported there).
- Produces: `paragraphSpacingListExit` plugin (`PluginKey<ListExitCapture | null>`): captures at a local root where the caret's block is the same node object as before the root, was inside a `listItem`/`taskItem`, is in no item now, and has both spacing attrs `null`; maps its position through appended transactions; applies the owner's spacing in `appendTransaction`.

- [ ] **Step 1: Write the failing tests**

```ts
describe.each([1, 2])('list exit spacing in production plugin order (schema v%i)', (version) => {
  it.each([
    ['bullet', '<ul><li style="margin-top: 12pt; margin-bottom: 8pt"><p>item</p></li></ul>'],
    ['ordered', '<ol><li style="margin-top: 12pt; margin-bottom: 8pt"><p>item</p></li></ol>'],
    ['task', '<ul data-type="taskList"><li data-type="taskItem"><p style="margin-top: 12pt; margin-bottom: 8pt">item</p></li></ul>'],
  ])('Enter-Enter out of a %s list keeps the item\'s spacing', (_kind, content) => {
    const editor = track(makeEditor(version, content));
    editor.commands.setTextSelection(endOf(editor, 'item'));
    keydownEnter(editor);
    keydownEnter(editor);
    const paragraph = editor.state.selection.$from.parent;
    expect(editor.state.selection.$from.depth).toBe(version === 1 ? 2 : 1);
    expect(paragraph.attrs.spaceBefore).toBe(12);
    expect(paragraph.attrs.spaceAfter).toBe(8);
  });
});

describe('list exit (schema v2)', () => {
  it('gives a paragraph lacking a block id its spacing, an id, and the pending caret style', () => {
    const editor = track(makeEditor(2, '<ul><li style="margin-top: 12pt; margin-bottom: 8pt"><p><strong>item</strong></p></li></ul>'));
    editor.commands.setTextSelection(endOf(editor, 'item'));
    keydownEnter(editor);
    // Strip the block id the split assigned, so the repair after the lift is real.
    const { $from } = editor.state.selection;
    const list = editor.state.doc.firstChild!;
    editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...list.attrs, blockId: null }));
    void $from;
    keydownEnter(editor);
    const paragraph = editor.state.selection.$from.parent;
    expect(editor.state.selection.$from.depth).toBe(1);
    expect(paragraph.attrs.blockId).toBeTruthy();
    expect(paragraph.attrs.spaceBefore).toBe(12);
    expect(paragraph.attrs.spaceAfter).toBe(8);
    expect(paragraph.attrs.caretMarks).toBe('[{"type":"bold"}]');
  });

  it('never restyles when a selected list before a paragraph is deleted, locally or remotely', () => {
    const editor = track(makeEditor(2, '<ul><li style="margin-top: 12pt"><p>item</p></li></ul><p>after</p>'));
    const listSize = editor.state.doc.firstChild!.nodeSize;
    editor.commands.setTextSelection(endOf(editor, 'item'));
    editor.view.dispatch(editor.state.tr.delete(0, listSize));
    expect(editor.state.doc.firstChild?.attrs.spaceBefore).toBeNull();

    const remote = track(makeEditor(2, '<ul><li style="margin-top: 12pt"><p>item</p></li></ul><p>after</p>'));
    remote.commands.setTextSelection(endOf(remote, 'item'));
    const ySync = remote.state.plugins.find((p) => String((p as unknown as { key: string }).key).startsWith('y-sync$'))!;
    const undoStackBefore = (remote.state as unknown as Record<string, { undoManager: { undoStack: unknown[] } }>)['y-undo$'].undoManager.undoStack.length;
    remote.view.dispatch(remote.state.tr.delete(0, listSize).setMeta(ySync, { isChangeOrigin: true }));
    expect(remote.state.doc.firstChild?.attrs.spaceBefore).toBeNull();
    expect((remote.state as unknown as Record<string, { undoManager: { undoStack: unknown[] } }>)['y-undo$'].undoManager.undoStack.length).toBe(undoStackBefore);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run package/extensions/paragraph-spacing-carryover.test.ts -t "list exit"`
Expected: v2 bullet/ordered cases FAIL (`spaceBefore` null after the lift); v1 cases pass (Task 8); task-list cases pass (the paragraph owns the attrs).

- [ ] **Step 3: Add the list-exit plugin**

In `paragraph-spacing.ts`, add to the imports and the plugin list:

```ts
type ListExitCapture = {
  pos: number;
  spaceBefore: number | null;
  spaceAfter: number | null;
};

const listExitKey = new PluginKey<ListExitCapture | null>(
  'paragraphSpacingListExit',
);

// The node that owns the spacing for a caret inside a list: the listItem for
// bullets and numbering (setParagraphSpacing skips their paragraph), the
// paragraph itself under a taskItem (which has no spacing attrs).
const listSpacingOwner = ($pos: ResolvedPos): ProseMirrorNode | null => {
  for (let depth = $pos.depth - 1; depth > 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'listItem') return node;
    if (node.type.name === 'taskItem') return $pos.parent;
  }
  return null;
};

const insideListItem = ($pos: ResolvedPos) => {
  for (let depth = $pos.depth - 1; depth > 0; depth--) {
    const name = $pos.node(depth).type.name;
    if (name === 'listItem' || name === 'taskItem') return true;
  }
  return false;
};
```

(`import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';`)

Then, as the third entry of `addProseMirrorPlugins`:

```ts
      // Enter-Enter out of a bullet or numbered list lifts the paragraph
      // (liftEmptyBlock); the item that owned the spacing is gone. The node
      // object survives the lift at the root, but BlockId's appended
      // setNodeMarkup replaces it before this plugin's appendTransaction runs
      // — so capture by identity at the root and apply by position later.
      new Plugin<ListExitCapture | null>({
        key: listExitKey,
        state: {
          init: () => null,
          apply: (tr, prev, oldState, newState) => {
            if (tr.getMeta(listExitKey) === 'applied') return null;
            if (tr.getMeta('appendedTransaction')) {
              return prev && { ...prev, pos: tr.mapping.map(prev.pos) };
            }
            if (
              !tr.docChanged ||
              isChangeOrigin(tr) ||
              tr.getMeta('addToHistory') === false
            ) {
              return null;
            }
            const $old = oldState.selection.$from;
            const $new = newState.selection.$from;
            const block = $old.parent;
            if (!block.isTextblock || $new.parent !== block) return null;
            if (!insideListItem($old) || insideListItem($new)) return null;
            if (block.attrs.spaceBefore !== null || block.attrs.spaceAfter !== null) {
              return null;
            }
            const owner = listSpacingOwner($old);
            if (!owner) return null;
            const spaceBefore = owner.attrs.spaceBefore ?? null;
            const spaceAfter = owner.attrs.spaceAfter ?? null;
            if (spaceBefore === null && spaceAfter === null) return null;
            return { pos: $new.before(), spaceBefore, spaceAfter };
          },
        },
        appendTransaction: (_transactions, _oldState, newState) => {
          const capture = listExitKey.getState(newState);
          if (!capture) return null;
          const node = newState.doc.nodeAt(capture.pos);
          if (
            !node?.isTextblock ||
            node.attrs.spaceBefore !== null ||
            node.attrs.spaceAfter !== null
          ) {
            return null;
          }
          return newState.tr
            .setNodeMarkup(capture.pos, undefined, {
              ...node.attrs,
              spaceBefore: capture.spaceBefore,
              spaceAfter: capture.spaceAfter,
            })
            .setMeta(listExitKey, 'applied');
        },
      }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run package/extensions/paragraph-spacing-carryover.test.ts package/extensions/paragraph-spacing.test.ts package/extensions/paragraph-spacing-schema-parity.test.ts`
Expected: PASS. If the "paragraph lacking a block id" case has a null `caretMarks`, the CaretMarks stamp ran before this plugin's `setNodeMarkup` replaced the node — that is fine only if this plugin spreads `node.attrs` read *afresh* (`newState.doc.nodeAt`), which the code above does; check the assertion reads the final state. If the remote case's undo-stack assertion fails, some plugin appended a repair after the simulated remote root (an appended transaction without y-sync meta makes y-prosemirror write the root's change to Yjs as a local transaction) — switch that case to the two-`Y.Doc` sync from Task 11, which produces a real remote root.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc && npx eslint --no-fix package/extensions/paragraph-spacing.ts package/extensions/paragraph-spacing-carryover.test.ts`

---

### Task 10: Loads, remote roots, maintenance, suggest mode, navigation & survival

**Files:**
- Test: append to `package/extensions/caret-marks/caret-marks.test.ts`
- Modify: only if a test exposes a defect in `caret-marks.ts`

**Interfaces:**
- Consumes: everything above; `applyRemote`, `ySyncPlugin` helpers; `SuggestionTrackingExtension` from `../suggestion/suggestion-tracking-extension`.

- [ ] **Step 1: Write the tests**

```ts
import { SuggestionTrackingExtension } from '../suggestion/suggestion-tracking-extension';
import { applyRemote } from './test-helpers';

describe.each([1, 2])('loads and replacement never stamp (schema v%i)', (version) => {
  it('keeps a loaded "[]" stamp although a style was pending, and restores nothing stale', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    const stamped = track(makeEditor(version, '<p></p>'));
    stampBlock(stamped, caretBlock(stamped).pos, '[]');
    const json = stamped.getJSON();
    editor.commands.setContent(json);
    expect(editor.getJSON()).toEqual(json);
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it('keeps a loaded non-empty stamp untouched, through the headless path too', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.setColor('#ff0000');
    const stamped = track(makeEditor(version, '<p></p>'));
    stampBlock(stamped, caretBlock(stamped).pos, '[{"type":"bold"}]');
    const json = stamped.getJSON();
    editor.commands.setContent(json);
    expect(editor.getJSON()).toEqual(json);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('y-sync and addToHistory:false roots never stamp, even with a style pending', () => {
    const editor = track(makeEditor(version, '<p>abc</p><p></p>'));
    const empty = textblocks(editor)[1];
    caretTo(editor, empty.pos + 1);
    editor.commands.toggleBold();
    stampBlock(editor, empty.pos, '[]');
    const before = editor.state.doc;
    applyRemote(editor, (tr) => tr.insertText('Z', endOf(editor, 'abc')).setStoredMarks([editor.schema.marks.italic.create()]));
    expect(stampOf(textblocks(editor)[1].node)).toBe('[]');
    editor.view.dispatch(editor.state.tr.insertText('Y', endOf(editor, 'abc')).setStoredMarks([editor.schema.marks.italic.create()]).setMeta('addToHistory', false));
    expect(stampOf(textblocks(editor)[1].node)).toBe('[]');
    void before;
  });

  it('suggest mode drops the stamp but marks still carry within the session', () => {
    const editor = track(
      makeEditor(version, '<p></p>', {
        extensions: [SuggestionTrackingExtension.configure({ getIsSuggestionMode: () => true })],
      }),
    );
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBeNull();
    expect(storedMarkNames(editor)).toEqual(['bold']);
  });
});

describe.each([1, 2])('navigation and survival (schema v%i)', (version) => {
  it('clicking or arrowing into an unstamped blank line writes nothing', () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p><p></p><p style="font-size: 24px"></p>'));
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    caretTo(editor, textblocks(editor)[2].pos + 1);
    caretTo(editor, endOf(editor, 'abc'));
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('maintenance elsewhere while the caret rests on a blank line writes nothing to that line', () => {
    const editor = track(makeEditor(version, '<h2>t</h2><p></p>'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    editor.commands.toggleBold();
    const heading = textblocks(editor)[0];
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(heading.pos, undefined, { ...heading.node.attrs, id: 'x' }).setMeta('addToHistory', false),
    );
    expect(stampOf(textblocks(editor)[1].node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('deleting a formatted paragraph, or a list, before an unstamped blank line does not stamp it', () => {
    for (const first of ['<p><strong>abc</strong></p>', '<ul><li><p><strong>abc</strong></p></li></ul>']) {
      const editor = track(makeEditor(version, `${first}<p></p>`));
      caretTo(editor, endOf(editor, 'abc'));
      const size = editor.state.doc.firstChild!.nodeSize;
      editor.view.dispatch(editor.state.tr.delete(0, size));
      expect(stampOf(caretBlock(editor).node)).toBeNull();
      expect(typedMarks(editor)).toEqual([]);
    }
  });

  it('inserting a paragraph before, after, or between formatted ones stamps no survivor', () => {
    const editor = track(makeEditor(version, '<p><strong>a</strong></p><p><em>b</em></p>'));
    caretTo(editor, endOf(editor, 'a'));
    const paragraph = version === 1
      ? editor.schema.nodes.dBlock.create(null, editor.schema.nodes.paragraph.create())
      : editor.schema.nodes.paragraph.create();
    const second = textblocks(editor)[1];
    const at = version === 1 ? second.pos - 1 : second.pos;
    editor.view.dispatch(editor.state.tr.insert(at, paragraph));
    editor.state.doc.descendants((node) => {
      if (node.isTextblock && node.content.size > 0) expect(stampOf(node)).toBeNull();
    });
    const inserted = textblocks(editor)[1];
    expect(inserted.node.content.size).toBe(0);
    expect(stampOf(inserted.node)).toBeNull();
  });

  it('a remote root landing the caret on an empty legacy line: typing gets the font, no doc write', () => {
    const editor = track(makeEditor(version, '<p>abc</p><p style="font-size: 32px"></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    const empty = textblocks(editor)[1];
    applyRemote(editor, (tr) =>
      tr
        .insertText('Z', 1 + (version === 1 ? 1 : 0))
        .setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(empty.pos + 1)))),
    );
    const before = editor.state.doc;
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
    expect(before.nodeAt(textblocks(editor)[1].pos)?.attrs.fontSize).toBe('32px');
  });
});
```

(`import { TextSelection } from '@tiptap/pm/state';` at the top of the file.)

- [ ] **Step 2: Run the tests**

Run: `npx vitest run package/extensions/caret-marks/caret-marks.test.ts`
Expected: PASS. Any failure here is a spec-vs-implementation defect, not a test to weaken: fix it in `caret-marks.ts`/`dispatch-context.ts`, re-run the whole file, and add a regression case to the group it belongs to.

- [ ] **Step 3: Lint**

Run: `npx eslint --no-fix package/extensions/caret-marks`

---

### Task 11: Undo/redo against the real Yjs UndoManager, and a collaborator pair

**Files:**
- Test: `package/extensions/caret-marks/caret-marks-undo.test.ts`

**Interfaces:**
- Consumes: `undoManager(editor)` helper; `editor.commands.undo()/redo()` (Collaboration).

- [ ] **Step 1: Write the tests**

```ts
// package/extensions/caret-marks/caret-marks-undo.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  caretTo,
  caretBlock,
  createdBlock,
  textblocks,
  stampOf,
  storedMarkNames,
  typedMarks,
  type,
  pressEnter,
  undoManager,
} from './test-helpers';

afterEach(destroyTracked);

// The UndoManager merges everything inside a 500ms window into one item.
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

describe.each([1, 2])('undo / redo (schema v%i)', (version) => {
  it('undoes and redoes Enter together with its stamp', async () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p>'));
    await settle();
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    await settle();
    expect(textblocks(editor).length).toBe(2);
    expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');

    editor.commands.undo();
    await settle(150);
    expect(textblocks(editor).length).toBe(1);
    expect(undoManager(editor).redoStack.length).toBe(1);

    editor.commands.redo();
    await settle(150);
    expect(textblocks(editor).length).toBe(2);
    expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');
  });

  it('round-trips format-then-clear on an empty line', async () => {
    const editor = track(makeEditor(version, '<p></p>'));
    await settle();
    editor.commands.toggleBold();
    await settle();
    editor.commands.toggleBold();
    await settle();
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    editor.commands.undo();
    await settle(150);
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    editor.commands.redo();
    await settle(150);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
  });

  it('keeps redo after an undo that empties the document', async () => {
    const editor = track(makeEditor(version, '<p></p>'));
    await settle();
    type(editor, 'abc');
    await settle();
    editor.commands.undo();
    await settle(150);
    expect(editor.state.doc.textContent).toBe('');
    expect(undoManager(editor).redoStack.length).toBe(1);
    editor.commands.redo();
    await settle(150);
    expect(editor.state.doc.textContent).toBe('abc');
  });
});

describe.each([1, 2])('collaborator pair (schema v%i)', (version) => {
  const pair = () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = track(makeEditor(version, '<p></p>', { ydoc: docA }));
    const b = track(makeEditor(version, null, { ydoc: docB }));
    const sync = () => {
      Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
      Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    };
    sync();
    return { a, b, sync };
  };

  it('a stamp written by one client renders the same empty-line font on the other', () => {
    const { a, b, sync } = pair();
    a.commands.setFontSize('24px');
    sync();
    const p = b.view.dom.querySelector('p') as HTMLParagraphElement;
    expect(p.style.fontSize).toBe('24px');
    expect(stampOf(textblocks(b)[0].node)).toContain('24px');
  });

  it('a remote update while the caret is on an empty line adds no local history item', () => {
    const { a, b, sync } = pair();
    b.commands.setTextSelection(textblocks(b)[0].pos + 1);
    const before = undoManager(b).undoStack.length;
    a.commands.setFontSize('24px');
    sync();
    expect(undoManager(b).undoStack.length).toBe(before);
    expect(storedMarkNames(b)).toEqual(['textStyle']);
    expect(typedMarks(b)).toEqual(['textStyle']);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run package/extensions/caret-marks/caret-marks-undo.test.ts`
Expected: PASS. If a redo stack is empty after undo, a local doc write followed the undo: find which appended transaction had steps on a non-local root (log `editor.on('transaction', ({ appendedTransactions }) => …)`) — every doc write must be gated by `ctx.local`.

---

### Task 12: Final verification, docs, graph

**Files:**
- Modify: `AGENTS.md` (docs list), `docs/PARAGRAPH_SPACING.md` (one line under the Enter carry-over section pointing at the list-exit rule and `FORMATTING_INHERITANCE.md`)

- [ ] **Step 1: Full suite, type-check, lint of every touched file**

Run:
```bash
npm test
npx tsc
npx eslint --no-fix package/extensions/caret-marks package/extensions/d-block/dblock.ts package/extensions/paragraph-spacing.ts package/extensions/paragraph-spacing-carryover.test.ts package/extensions/font-family-persistence.ts package/extensions/font-size/font-size.ts package/extensions/trailing-node/trailing-node.ts package/utils/insert-commands.ts package/extensions/default-extension.ts
npx vitest run package/styles/css-ownership.test.ts package/extensions/docx
```
Expected: all green; the docx and css-ownership suites untouched.

- [ ] **Step 2: Docs**

`AGENTS.md`, Conventions bullet: add `FORMATTING_INHERITANCE.md` to the list of design specs in `docs/`. `docs/PARAGRAPH_SPACING.md`: under the Enter carry-over section add: "List exit (Enter-Enter out of a bullet/numbered list) is handled by `paragraphSpacingListExit` in v2 and by the dBlock Enter handler's spacing owner in v1; see `FORMATTING_INHERITANCE.md` §3.5."

- [ ] **Step 3: Refresh the knowledge graph**

Run: `graphify update .`

- [ ] **Step 4: Manual QA (live Chrome, demo)**

Start the demo inside `demo/` (`cd demo && npx vite`), v1 = plain new doc, v2 = `?v2=1`. Lean checklist from spec §4:
1. Format a run (font, size, colour, highlight, B/I/U/S) → Enter at its end → type; Enter twice; click away and back into the empty line → type.
2. Set marks on an empty line, click away/back, type; clear marks on an empty line, click away/back, type.
3. 24px on empty → type → select → 32px → Enter → type → 32px.
4. Backspace the last character of a line (native path!) → type: the deleted character's marks.
5. Bold `A` + plain `B`, caret between, Enter, type → `x` bold, `B` plain.
6. Heading end → Enter; bullet Enter; Enter-Enter out of bullet/ordered/task list → spacing kept.
7. The reported repro: "Pretend to work" template → select all → spacing 0/0 → click the end of the last quote paragraph → Enter → Enter: one paragraph, spacing kept, no stray line (v1).
8. Undo Enter (Cmd-Z) → redo (Cmd-Shift-Z).
9. Collab pair (two tabs on one room): a stamp written in one tab shows the empty-line font in the other.
10. `?v2=1` for every row above.

Report each row as pass/fail with the schema.

---

## Self-review against the spec

- **3.1 attr** → Task 2 (`rendered: false`, `keepOnSplit: false`, decoration, incremental ranges). **3.2 context** → Task 3; **rules A1/B/C** → Task 4; **A3** → Task 6; **split overrides** (capture → delegate → left stamp → `setStoredMarks` last, `keepMarks:false` passthrough) → Task 5. **3.3 legacy freeze** → Task 2 (`keepOnSplit`), Task 7 (writers, TypographyPersistence, trailing node, callout). **3.4 v1 handler** → Task 8. **3.5 list exit** → Task 8 (v1 owner) + Task 9 (v2). **3.6 undo/collab** → Task 11. **§6 groups**: load/replacement + suggest → Task 10; legacy fonts → Task 7; splits & pending marks → Tasks 4, 5, 8; deletion → Task 6; navigation & survival → Task 10; restore provenance → Task 10 (remote root + maintenance); declared inheritance → Tasks 5, 7, 8; rendering → Task 2; undo/redo → Task 11; carry-over → Tasks 8, 9. `text-style-selection`/docx/css-ownership stay green → Task 12.
- **Names used across tasks:** `CARET_MARKS_ATTR`, `serializeMarks`, `parseMarks`, `fillLegacyFont`, `caretStyle`, `filterSplittable`, `stampAttrs` (Task 1) are the only names Tasks 2–8 import; `applyDispatchContext`/`EMPTY_CONTEXT`/`DispatchContext` (Task 3) are used by Task 4; `caretMarksPluginKey` is created in Task 2 and consumed in Task 4; helper names in `test-helpers.ts` match every test's import list.
- **Known soft spots to watch at execution time:** (1) the exact v1 position arithmetic in the "different, pre-existing block" and "insert at the old caret block's opening" cases — print the doc and fix the *test's* positions, not the handler; (2) simulated remote roots (`applyRemote`) are meta-only — a repair appended after one makes y-prosemirror write the root's change locally, so undo-stack assertions belong with the real two-`Y.Doc` sync (Task 11); (3) Task 8's blockquote test relies on `insertContentAt` splitting the quote — verify with `doc.toString()` that the exited paragraph is top-level.
