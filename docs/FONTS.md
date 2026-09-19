# Font Decoupling — `@fileverse/ddoc` Package - Specs

**Status:** Implemented (`fonts` prop on `DdocProps`, `package/utils/font-loader.ts`, system-only `package/styles/fonts.css`, `react-window` picker).
**Scope:** Package only (`@fileverse/ddoc`). Consumer-side changes (`ddocs.new`) are out of scope for this branch but referenced for context.
**Breaking change:** Yes — bumped as a major version.

## 1. Problem

The package eagerly imports 17 Google font families (with full weight/italic ranges) via `@import url('https://fonts.googleapis.com/...')` in `package/styles/fonts.css`. Every consumer pulls all of them on every load, regardless of which fonts the user actually picks.

This violates Fileverse's privacy principles (DNS resolution + round-trip to Google, usage tracking), wastes bandwidth, and forces redundant edits whenever a font is added or removed — the consumer (`ddocs.new`) duplicates the same `@import` in its `app/globals.css` and maintains its own `FONT_OPTIONS` constant.

The font picker (`EditorFontFamily` in `package/components/editor-utils.tsx`) compounds the cost: each picker row is styled with its own `fontFamily`, so the browser must download every font just to render the picker.

## 2. Goals

- Zero external font requests from the package. The package makes no network calls for fonts.
- Decouple the font catalog from the package. The consumer owns its catalog; adding/removing a font is a consumer-only change.
- Lazy, on-demand font loading via the CSS Font Loading API.
- Font picker renders without downloading any font binaries (SVG previews only).
- Virtualized picker list — render cost independent of catalog size.

## 3. Non-goals

- Refactoring `package/extensions/font-family-persistence.ts`. It stays as-is.
- Migrating existing documents. The textStyle / paragraph `fontFamily` storage format is unchanged; old docs render correctly once the consumer registers the matching fonts.
- Consumer-side implementation (`ddocs.new` PR). Called out in §10 for context only.

## 4. Architecture

### 4.1 Responsibility split

**Package owns (self-contained, zero external requests):**

- Baseline fonts only:
  - **Pure-system fonts** that need no network — Arial, Calibri, Comic Sans MS, Cursive, Georgia, Impact, Lucida Grande, Monospace, Palatino, Serif, Times New Roman, Trebuchet MS, Verdana.
- Picker UI, font-loading runtime (CSS Font Loading API wrapper), virtualization, and the `FontDescriptor` type.

**Consumer owns:**

- The extended font catalog, passed via the new `fonts` prop on `DdocEditor` / `PreviewDdocEditor`.
- Hosting woff2 files. The package is URL-agnostic; `ddocs.new` will self-host via `@fontsource/*` packages so all font bytes are served from its own origin.
- Hosting SVG previews (one SVG sprite or per-font React components, consumer's choice).

### 4.2 No deprecation path

The package falls back to baseline-only when no `fonts` prop is provided. There is no compat shim that re-enables the Google `@import`. Consumers wanting the previous catalog must pass the equivalent descriptors.

## 5. Public API

### 5.1 `FontDescriptor` type (new, exported from `index.ts`)

```ts
export type FontDescriptor = {
  /** Display name in the picker, e.g. "Poppins" */
  name: string;
  /** CSS font-family stack used in textStyle marks, e.g. "Poppins, sans-serif" */
  family: string;
  /**
   * woff2 source(s).
   *   - string: single file covers all weights (variable font).
   *   - Record<number, string>: per-weight file map, e.g. { 400: '/p-400.woff2', 700: '/p-700.woff2' }.
   *   - omitted: pure system font, no loading.
   */
  url?: string | Record<number, string>;
  /** SVG preview rendered in the picker. Falls back to font name in default font if absent. */
  preview?: React.ReactNode;
};
```

Notes:

- `weights` is implicit. For per-weight maps, keys are the weights to load. For a single string, the weight defaults to `400`.
- `preview` accepts any SVG-rendering React node — e.g. `<PoppinsPreview />` from an SVGR import or `<svg><use href="#font-poppins"/></svg>` referencing a sprite symbol. The package is agnostic.

### 5.2 New prop on editor components

```tsx
<DdocEditor fonts={extraFonts} ... />
```

- `fonts?: FontDescriptor[]` — defaults to `[]`.
- Consumer entries override baseline entries with the same `family`.
- The consumer is responsible for stable identity (memoization). The editor re-registers when the prop's identity changes.

## 6. Runtime — font loader

A functional module at `package/utils/font-loader.ts`. Module-level state is fine because `document.fonts` is itself a browser-level singleton.

```ts
// State
const catalog = new Map<string, FontDescriptor>(); // key: primary family token (e.g. "Poppins")
const loaded = new Map<string, Promise<void>>();   // key: `${name}|${weight}`

export function registerFonts(fonts: FontDescriptor[]): void {
  catalog.clear();
  for (const f of fonts) catalog.set(primaryToken(f.family), f);
}

export function isLoaded(family: string): boolean { /* ... */ }

export async function ensureLoaded(family: string): Promise<void> {
  if (typeof document === 'undefined') return; // SSR safety
  const desc = catalog.get(primaryToken(family));
  if (!desc?.url) return; // baseline / system / unknown — CSS handles fallback

  const entries: Array<[number, string]> =
    typeof desc.url === 'string' ? [[400, desc.url]] : Object.entries(desc.url).map(([w, u]) => [Number(w), u]);

  const weightPromises = entries.map(([weight, url]) => {
    const key = `${desc.name}|${weight}`;
    let p = loaded.get(key);
    if (!p) {
      const face = new FontFace(desc.name, `url(${url}) format('woff2')`, {
        weight: String(weight),
        display: 'swap',
      });
      p = face.load()
        .then((f) => { document.fonts.add(f); })
        .catch((err) => {
          loaded.delete(key); // do not cache failure — allow retry
          console.warn(`Font ${desc.name} ${weight} failed to load`, err);
        });
      loaded.set(key, p);
    }
    return p;
  });

  await Promise.allSettled(weightPromises); // one weight failing must not reject the family
}
```

`primaryToken(family)` extracts the first token of the CSS font-family stack (e.g. `"Poppins, sans-serif"` → `"Poppins"`) so callers can pass either the raw family value stored in the textStyle mark or the bare name.

## 7. Wiring

### 7.1 Editor lifecycle (in `DdocEditor` / `PreviewDdocEditor`)

- A `useEffect` watching `props.fonts` calls `registerFonts(props.fonts ?? [])`. Runs on mount and whenever the catalog identity changes.
- On editor `onCreate` and on `setContent`, walk the doc once and collect distinct `fontFamily` values from textStyle marks and paragraph node attrs. For each, fire-and-forget `ensureLoaded(family)`. Text remains readable during load via `font-display: swap`.

### 7.2 Picker (`EditorFontFamily` in `editor-utils.tsx`)

- Replace the inline `style={{ fontFamily: font.title }}` on each row — picker rows render in the editor's default font.
- Render `{font.preview ?? <p className="font-medium">{font.name}</p>}`.
- Virtualize with `react-window`'s `FixedSizeList`. Fixed row height (the picker is already a uniform list).
- On click, `await ensureLoaded(font.value)` before applying the textStyle mark. Show a brief inline spinner on the clicked row while loading.
- Selected-state styling is unchanged.

### 7.3 Picker cost after change

Opening the picker triggers zero font binary requests. Previews are SVG (a sprite sheet of ~50–80 KB total covers the full catalog and is cached forever). The first time a user _selects_ a font, only that font's woff2 loads.

## 8. Files changed / deleted / added

### Deleted

- `package/styles/fonts.css` — the `@import url('https://fonts.googleapis.com/...')` line. The `local()`-based `@font-face` blocks (Calibri, Times New Roman) stay; they are pure system declarations with no network.

### Modified

- `package/components/editor-utils.tsx` — `fontStack` trimmed to baseline-only entries (the 14 listed in §4.1). `EditorFontFamily` rewritten per §7.2.
- `package/ddoc-editor.tsx` and `package/preview-ddoc-editor.tsx` — accept the new `fonts` prop; wire `registerFonts` and doc-load font scan per §7.1.
- `index.ts` — export `FontDescriptor`.

### Added

- `package/utils/font-loader.ts` — functional module per §6.
- `react-window` dependency (verify if not already present; light footprint).

### Unchanged (explicit)

- `package/extensions/font-family-persistence.ts`.
- TextStyle / paragraph `fontFamily` storage format.

## 9. Privacy & performance impact

| Concern                              | Before                             | After           |
| ------------------------------------ | ---------------------------------- | --------------- |
| External font requests from package  | ~17 families × all weights eagerly | 0               |
| DNS / round-trip to Google           | Yes, on every consumer page        | None            |
| Picker opens → font bytes downloaded | All non-loaded fonts               | 0               |
| Font select → bytes downloaded       | Already loaded (eager)             | One font (lazy) |
| Adding a font                        | Edits in package + consumer        | Consumer only   |

## 10. Consumer-side follow-up (out of scope, for context)

A separate PR in `ddocs.new`:

- Install `@fontsource-variable/*` (preferred — single woff2 per font covering all weights) or `@fontsource/*` per font.
- Build `editorFonts: FontDescriptor[]` importing woff2 URLs from those packages; the bundler resolves them to fingerprinted same-origin asset URLs.
- Set up an SVG sprite (via the consumer's Vite/Next plugin) with one symbol per font preview. Inject the sprite once at app root.
- Pass `<DdocEditor fonts={editorFonts} />`.
- Delete the duplicate Google `@import` from `app/globals.css` and the consumer's local `FONT_OPTIONS`.

## 11. Release notes draft

> **BREAKING** — `@fileverse/ddoc` no longer bundles Google Fonts. The package now ships with Inter + system fonts only and makes zero external font requests. To restore previous font availability, register your fonts via the new `fonts` prop on `DdocEditor` and `PreviewDdocEditor`. See the font-catalog migration guide for setup instructions.

# Font Autoload Extension — Lift RTC Coverage Into the Editor Layer

**Status:** Not implemented. As of 2026-09 there is no `package/extensions/font-autoload.ts` and `defaultExtensions` registers no `FontAutoload` extension. The interim `useEffect` autoload described in §1 is not present in `use-tab-editor.tsx` either; the only `ensureLoaded` call site is the picker click in `package/components/editor-utils.tsx`, so the RTC gap in §1 is still open.
**Scope:** Package only (`@fileverse/ddoc`). Follow-up to the font-decoupling spec at the top of this file.
**Breaking change:** No (internal architectural refactor; no API surface change).

## 1. Problem

The original font-decoupling design covered the editor-load and post-`setContent` font-scan paths but not real-time collaboration (RTC). When collaborator A applies a non-baseline font and Yjs propagates the textStyle mark to B, B's editor applies the mark but never calls `ensureLoaded(family)`. CSS then falls back through the family stack (e.g. `Poppins, sans-serif` → sans-serif) and the receiver sees the wrong font.

A quick fix landed as a `useEffect` in `package/hooks/use-tab-editor.tsx` subscribing to `editor.on('update')` with a 150 ms throttle. It works correctly but has three problems:

1. **Architectural placement.** Font-autoload is editor-lifecycle business, not React-lifecycle business. The current implementation sits in a 1000+ line React hook alongside unrelated state, with a `setTimeout`-based throttle reimplemented locally.
2. **Re-scans full doc on every transaction.** Even a single keystroke walks the entire doc, throttled or not.
3. **Doesn't distinguish remote vs local.** The picker click already calls `ensureLoaded` for local font selections; the update handler duplicates that work.

The codebase already uses Tiptap extensions for editor-lifecycle concerns (e.g. `font-family-persistence`, `sync-cursor`, the comment plugins). Font-autoload should follow the same pattern.

## 2. Goals

- Move font-autoload into the editor extension layer.
- Single seam covering every path that introduces a fontFamily mark: initial mount, Yjs sync, paste, undo/redo, programmatic `setContent`, future extensions.
- React only to _new_ fontFamily values (no duplicate work after the first load is kicked off).
- Skip transactions that don't change the doc (selection-only updates).
- Remove the React-`useEffect` autoload paths in `use-tab-editor.tsx` once the extension covers them.

## 3. Non-goals

- Step-level granularity (only scanning the changed slice of the doc rather than the whole doc). The full-doc walk is sub-millisecond for typical docs and dedup-collapsed for repeat families; step inspection is reserved for a future v2 if a real perf signal appears with very large docs.
- Touching `package/extensions/font-family-persistence.ts`. It stays as-is.
- Modifying the picker. `EditorFontFamily` keeps its `await ensureLoaded(font.value)` on click for the loading-spinner UX.
- Any change to `package/utils/font-loader.ts`. The extension consumes its existing `ensureLoaded` API.

## 4. Architecture

A new Tiptap `Extension` named `FontAutoload`, defined in `package/extensions/font-autoload.ts`, wraps a single ProseMirror plugin. The plugin owns no state. Its `view` lifecycle:

- On mount: scan the initial doc once and call `ensureLoaded` for every distinct fontFamily value found.
- On update: if the doc reference changed (i.e. not a selection-only update), scan and call `ensureLoaded` for every fontFamily value in the new doc.

The plugin holds a closure-tracked `prevDoc` to detect doc-identity changes. ProseMirror docs are immutable, so reference equality is a reliable "did the doc change" check.

Dedup is owned by `font-loader.ts`'s existing `loaded` Map keyed by `${name}|${weight}`. The plugin never tracks its own "ensured" set; calling `ensureLoaded` for an already-loaded family is a Map.has() check and an early return. Keeping dedup in one place avoids two-sources-of-truth.

The extension is registered in `package/extensions/default-extension.ts` alongside the other editor extensions. No consumer-facing API change.

## 5. Implementation

### 5.1 New file: `package/extensions/font-autoload.ts`

```ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ensureLoaded } from '../utils/font-loader';

const fontAutoloadKey = new PluginKey('fontAutoload');

const ensureFontsForDoc = (doc: PMNode): void => {
  doc.descendants((node) => {
    if (node.attrs?.fontFamily) void ensureLoaded(node.attrs.fontFamily);
    for (const mark of node.marks) {
      if (mark.type.name === 'textStyle' && mark.attrs?.fontFamily) {
        void ensureLoaded(mark.attrs.fontFamily);
      }
    }
    return true;
  });
};

export const FontAutoload = Extension.create({
  name: 'fontAutoload',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: fontAutoloadKey,
        view: (view) => {
          ensureFontsForDoc(view.state.doc);
          let prevDoc = view.state.doc;
          return {
            update: (view) => {
              if (view.state.doc === prevDoc) return;
              prevDoc = view.state.doc;
              ensureFontsForDoc(view.state.doc);
            },
          };
        },
      }),
    ];
  },
});
```

### 5.2 Register the extension

In `package/extensions/default-extension.ts` (or wherever the editor's extension array is assembled), import and append `FontAutoload`:

```ts
import { FontAutoload } from './font-autoload';

// ...inside the extensions array:
FontAutoload,
```

The exact insertion point follows whatever ordering convention the file uses; no dependencies on other extensions, so order is not load-bearing.

### 5.3 Remove the now-redundant manual paths

In `package/hooks/use-tab-editor.tsx`:

1. **Delete the throttled `editor.on('update')` `useEffect`** added by the previous fix. It currently sits just below the existing `useEffect([editor])` that sets `isInitialEditorCreation.current = false`. The entire block including the `setTimeout`/`pending`-flag dance goes.
2. **Delete the `ensureFontsForEditor(editor)` call** inside the existing `useEffect([editor])` (around line 666). Keep the effect; only remove that one call.
3. **Delete the `ensureFontsForEditor(editor)` call** inside the hydration `queueMicrotask` block after `setContent` (around line 897).
4. **Delete the helpers** `collectFontFamilies` and `ensureFontsForEditor` (defined at lines 79–97). They have no remaining callers.
5. **Delete the import** `import { ensureLoaded } from '../utils/font-loader';` at the top of the file. No remaining usage.

### 5.4 What stays unchanged (explicit)

- `package/utils/font-loader.ts`.
- `package/extensions/font-family-persistence.ts`.
- `package/components/editor-utils.tsx` (`EditorFontFamily` keeps its own `await ensureLoaded` on click).
- TextStyle / paragraph `fontFamily` storage format.
- All consumer-facing API (no prop changes, no export changes).

## 6. Coverage analysis

| Path that introduces a fontFamily    | Covered by                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Picker click (local)                 | `EditorFontFamily.onClick → await ensureLoaded` + plugin `update` (dedup no-op)                                              |
| Picker click (collaborator)          | Plugin `update` triggered by inbound Yjs transaction                                                                         |
| Paste                                | Plugin `update` triggered by paste transaction                                                                               |
| Undo / redo                          | Plugin `update` triggered by history transaction                                                                             |
| `editor.commands.setContent(...)`    | Plugin `update` triggered by replace transaction                                                                             |
| Tab switch / hydration               | Plugin `update` triggered when the new doc is mounted; also plugin `view` re-runs if the editor instance itself is recreated |
| Initial mount with prefilled content | Plugin `view` callback's one-shot scan                                                                                       |

The picker's own `ensureLoaded` call is retained because it returns a Promise the picker awaits to manage its inline loading spinner. The plugin's call for the same family arrives a tick later, hits the `loaded` Map, and returns immediately — no duplicate work.

## 7. Risks and edge cases

- **Plugin lifecycle vs collab readiness.** When the editor mounts before Yjs has synced, the initial `view` scan runs on an empty doc, then the plugin's `update` handler fires once Yjs hydrates the doc. Both paths exercise `ensureFontsForDoc` correctly.
- **SSR safety.** Tiptap plugins only instantiate when the editor mounts in the browser. `ensureLoaded` itself already guards with `typeof document === 'undefined' && return`.
- **Doc-identity check.** ProseMirror docs are immutable, so `view.state.doc === prevDoc` reliably distinguishes content-changing transactions from selection-only ones. If a transaction's mark-change happens to produce a structurally-identical doc reference (which it does not — Mark steps always rebuild affected nodes), the check could miss; in practice this does not occur.
- **Walk cost.** ~Sub-millisecond for typical docs (<1k nodes); ~10ms for 10k+ node docs. Walk happens per-transaction, not per-frame. Acceptable for v1. Step-level inspection remains a future optimization if a real perf signal appears.

## 8. Files touched

### Created

- `package/extensions/font-autoload.ts` (~30 lines).

### Modified

- `package/extensions/default-extension.ts` — append `FontAutoload` to the extensions array.
- `package/hooks/use-tab-editor.tsx` — delete ~30 lines: the throttled `useEffect`, two `ensureFontsForEditor` call sites, the two helpers, and the now-unused `ensureLoaded` import.

### Unchanged (explicit)

- `package/utils/font-loader.ts`.
- `package/extensions/font-family-persistence.ts`.
- `package/components/editor-utils.tsx`.
- `index.ts` (no new exports).

## 9. Verification

Verification is `npm test` (vitest) for anything unit-testable, plus build + manual smoke check:

1. `npm run build` — must pass with zero TS errors.
2. Manual: open the demo in two browser windows pointing at the same collab doc. In window A, apply Poppins (or any consumer-registered font) to some text. In window B, the same text should re-render in Poppins within ~one network round-trip. Confirm via DevTools Network panel that exactly one Poppins woff2 fetch fires in window B at that moment.
3. Manual: paste content from another editor with a fontFamily mark — receiver loads the font.
4. Manual: undo / redo a font change — the font remains loaded.

No regressions expected in the picker UX (loading spinner still works because the picker keeps its own `await ensureLoaded`).

# Package Font Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove eager Google Fonts `@import` from `@fileverse/ddoc`; expose a `fonts` prop so consumers register their own font catalog; lazy-load via CSS Font Loading API; SVG-preview + virtualize the picker.

**Architecture:** Package keeps system-only baseline fonts. New functional `font-loader` module wraps `FontFace` for on-demand loading. New `fonts?: FontDescriptor[]` prop on `DdocEditor` / `PreviewDdocEditor` registers a consumer-owned catalog. Picker rows render an SVG `preview` React node (no inline `fontFamily`) inside a `react-window` `FixedSizeList`.

**Tech Stack:** React 18, TypeScript, Vite, Tiptap, `react-window` (new), CSS Font Loading API.

**Spec:** the "Font Decoupling" spec at the top of this file.

**Testing note:** This repo uses vitest (`npm test`; tests sit next to the code as `*.test.ts(x)`). Each task is verified by `npm run build` (must pass with zero TS errors), `npm test`, and a manual smoke check in the demo app (`npm run dev`).

---

## File Structure

**Create:**

- `package/utils/font-loader.ts` — `registerFonts`, `ensureLoaded`, `isLoaded`, `primaryToken` helpers. Module-level state; `document.fonts` is the browser singleton.

**Modify:**

- `package/styles/fonts.css` — delete Google `@import` line. Keep `local()` `@font-face` blocks.
- `package/components/editor-utils.tsx` — trim `fontStack` to baseline system fonts; rewrite `EditorFontFamily` picker (preview rendering, virtualization, `ensureLoaded` on click); export `fonts` (typed as `FontDescriptor[]`) for backward use within the file.
- `package/types.ts` — extend `DdocProps` with `fonts?: FontDescriptor[]`.
- `package/use-ddoc-editor.tsx` — accept the `fonts` prop, call `registerFonts` in a `useEffect`, scan the editor doc for distinct `fontFamily` values on `onCreate` / after `setContent` and `ensureLoaded` each.
- `package/ddoc-editor.tsx` — destructure & forward `fonts` prop into `useDdocEditor`.
- `package/preview-ddoc-editor.tsx` — destructure & forward `fonts` prop.
- `index.ts` — export `FontDescriptor` type.
- `package.json` — add `react-window` + `@types/react-window`.
- `demo/src/App.tsx` (or whichever entry passes props) — pass a small sample `fonts` array so the demo still renders extended fonts after the Google `@import` is gone.

**Unchanged:**

- `package/extensions/font-family-persistence.ts`.
- TextStyle / paragraph `fontFamily` storage format.

---

## Task 1: Add `FontDescriptor` type

**Files:**

- Modify: `package/types.ts` (append near other exported types)
- Modify: `index.ts` (add export)

- [ ] **Step 1: Add the type to `package/types.ts`**

Append at the end of the file:

```ts
import type { ReactNode } from 'react';

export type FontDescriptor = {
  /** Display name in the picker, e.g. "Poppins" */
  name: string;
  /** CSS font-family stack stored in textStyle marks, e.g. "Poppins, sans-serif" */
  family: string;
  /**
   * woff2 source(s).
   *   - string: single file covering all weights (variable font).
   *   - Record<number, string>: per-weight map, e.g. { 400: '/p-400.woff2', 700: '/p-700.woff2' }.
   *   - omitted: pure system font, no loading.
   */
  url?: string | Record<number, string>;
  /**
   * SVG preview rendered in the picker. Any React node that renders an <svg> element.
   * Falls back to the font name in the default font when absent.
   */
  preview?: ReactNode;
};
```

(If `import type { ReactNode } from 'react'` already exists at the top of the file, do not duplicate it — just add the type.)

- [ ] **Step 2: Export from `index.ts`**

Add to the existing exports (after the `IComment` export):

```ts
export type { FontDescriptor } from './package/types';
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors.

- [ ] **Step 4: Commit**

```bash
git add package/types.ts index.ts
git commit -m "feat(font): add FontDescriptor type"
```

---

## Task 2: Create the `font-loader` module

**Files:**

- Create: `package/utils/font-loader.ts`

- [ ] **Step 1: Create `package/utils/font-loader.ts`**

```ts
import type { FontDescriptor } from '../types';

const catalog = new Map<string, FontDescriptor>();
const loaded = new Map<string, Promise<void>>();

/** "Poppins, sans-serif" -> "Poppins"; "'Times New Roman', serif" -> "Times New Roman" */
export function primaryToken(family: string): string {
  const first = family.split(',')[0]?.trim() ?? '';
  return first.replace(/^['"]|['"]$/g, '');
}

export function registerFonts(fonts: FontDescriptor[]): void {
  catalog.clear();
  for (const f of fonts) catalog.set(primaryToken(f.family), f);
}

export function isLoaded(family: string): boolean {
  const desc = catalog.get(primaryToken(family));
  if (!desc?.url) return true;
  const entries = typeof desc.url === 'string' ? [[400, desc.url]] : Object.entries(desc.url);
  return entries.every(([w]) => loaded.has(`${desc.name}|${w}`));
}

export async function ensureLoaded(family: string): Promise<void> {
  if (typeof document === 'undefined') return;
  const desc = catalog.get(primaryToken(family));
  if (!desc?.url) return;

  const entries: Array<[number, string]> =
    typeof desc.url === 'string'
      ? [[400, desc.url]]
      : Object.entries(desc.url).map(([w, u]) => [Number(w), u]);

  const weightPromises = entries.map(([weight, url]) => {
    const key = `${desc.name}|${weight}`;
    let p = loaded.get(key);
    if (!p) {
      const face = new FontFace(desc.name, `url(${url}) format('woff2')`, {
        weight: String(weight),
        display: 'swap',
      });
      p = face
        .load()
        .then((f) => {
          document.fonts.add(f);
        })
        .catch((err) => {
          loaded.delete(key);
          // eslint-disable-next-line no-console
          console.warn(`Font ${desc.name} ${weight} failed to load`, err);
        });
      loaded.set(key, p);
    }
    return p;
  });

  await Promise.allSettled(weightPromises);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors.

- [ ] **Step 3: Commit**

```bash
git add package/utils/font-loader.ts
git commit -m "feat(font): add functional font-loader module"
```

---

## Task 3: Delete Google `@import` and trim baseline `fontStack`

**Files:**

- Modify: `package/styles/fonts.css`
- Modify: `package/components/editor-utils.tsx:62-90`

- [ ] **Step 1: Edit `package/styles/fonts.css`**

Delete lines 1–2 (the `/* Google Fonts Import */` comment and the `@import url('https://fonts.googleapis.com/...')` line). The remaining `local()` `@font-face` blocks stay untouched.

After edit, the file's first non-blank content should be:

```css
/* System Font Faces */
@font-face {
  font-family: 'Calibri';
  src: local('Calibri');
  font-display: swap;
}
```

- [ ] **Step 2: Trim `fontStack` in `package/components/editor-utils.tsx`**

Replace the existing `fontStack` object (currently lines 62–90) with the baseline-only version:

```ts
const fontStack = {
  Arial: 'Arial, Arial, Helvetica, sans-serif',
  Calibri: 'Calibri, sans-serif',
  'Comic Sans MS': 'Comic Sans MS, Comic Sans',
  Cursive: 'Cursive',
  Georgia: 'Georgia, serif',
  Impact: 'Impact, Charcoal, sans-serif',
  'Lucida Grande': 'Lucida Sans Unicode, Lucida Grande, sans-serif',
  Monospace: 'monospace',
  Palatino: 'Palatino Linotype, Book Antiqua, Palatino, serif',
  Serif: 'serif',
  'Times New Roman': 'Times New Roman, serif',
  'Trebuchet MS': 'Trebuchet MS, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
};
```

Removed entries (now consumer-provided): `IBM Plex Sans`, `IBM Plex Serif`, `IBM Plex Mono`, `Inclusive Sans`, `Inter`, `JetBrains Mono`, `Lato`, `Oswald`, `Playfair Display`, `Poppins`, `PT Sans Narrow`, `REM`, `Roboto`, `Volkhov`.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors. The bundled `dist/style.css` should no longer contain `fonts.googleapis.com`.

Run: `grep -c "fonts.googleapis.com" dist/style.css || echo "0 matches"`
Expected: `0 matches`.

- [ ] **Step 4: Commit**

```bash
git add package/styles/fonts.css package/components/editor-utils.tsx
git commit -m "refactor(font): drop Google @import; baseline=system fonts only

Package no longer makes external font requests. Non-system fonts move to
the consumer-provided catalog (added in subsequent tasks)."
```

---

## Task 4: Extend `DdocProps` with `fonts` prop

**Files:**

- Modify: `package/types.ts` (the `DdocProps` interface around line 152)

- [ ] **Step 1: Add the prop to `DdocProps`**

Inside the `DdocProps` interface body, add:

```ts
  /**
   * Optional catalog of fonts available to the editor in addition to the package
   * baseline (system fonts only). Each entry is loaded lazily via the CSS Font
   * Loading API when first selected in the picker or when a document references
   * its family.
   */
  fonts?: FontDescriptor[];
```

Ensure `FontDescriptor` is in scope (it's defined in the same file per Task 1).

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors.

- [ ] **Step 3: Commit**

```bash
git add package/types.ts
git commit -m "feat(font): add fonts prop to DdocProps"
```

---

## Task 5: Wire `registerFonts` + doc-load scan in `useDdocEditor`

**Files:**

- Modify: `package/use-ddoc-editor.tsx`
- Modify: `package/ddoc-editor.tsx` (destructure & forward `fonts`)
- Modify: `package/preview-ddoc-editor.tsx` (destructure & forward `fonts`)

- [ ] **Step 1: Read current signatures**

Before editing, open `package/use-ddoc-editor.tsx` and locate (a) the destructured props parameter object and (b) the editor's `onCreate` / content-set effect. The exact line numbers vary; record them before patching.

- [ ] **Step 2: Add imports to `use-ddoc-editor.tsx`**

Add near other utility imports:

```ts
import { registerFonts, ensureLoaded } from './utils/font-loader';
import type { FontDescriptor } from './types';
```

- [ ] **Step 3: Accept the new prop and register the catalog**

Add `fonts` to the destructured props (next to other props like `initialContent`):

```ts
  fonts,
```

After the props are destructured, add the registration effect:

```ts
useEffect(() => {
  registerFonts(fonts ?? []);
}, [fonts]);
```

- [ ] **Step 4: Add the doc-scan helper above the hook body**

```ts
function collectFontFamilies(editor: Editor): Set<string> {
  const families = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.attrs?.fontFamily) families.add(node.attrs.fontFamily);
    for (const mark of node.marks) {
      if (mark.type.name === 'textStyle' && mark.attrs?.fontFamily) {
        families.add(mark.attrs.fontFamily);
      }
    }
    return true;
  });
  return families;
}
```

`Editor` is already imported from `@tiptap/react`; reuse the existing import.

- [ ] **Step 5: Invoke `ensureLoaded` on editor create / content set**

Locate the editor's `onCreate` hook in the same file (look for `onCreate:` or wherever the editor instance becomes ready). Add inside it:

```ts
onCreate: ({ editor }) => {
  // ...existing onCreate logic...
  for (const f of collectFontFamilies(editor)) {
    void ensureLoaded(f);
  }
},
```

If the file calls `editor.commands.setContent(...)` elsewhere after the editor is created (search the file for `setContent`), follow each such call with:

```ts
for (const f of collectFontFamilies(editor)) {
  void ensureLoaded(f);
}
```

`void` is intentional — fire-and-forget; `font-display: swap` keeps text readable during the load.

- [ ] **Step 6: Forward the prop from `ddoc-editor.tsx`**

In `package/ddoc-editor.tsx`, locate where props are passed to `useDdocEditor` (search the file for `useDdocEditor(`). Add `fonts` to the destructured props at the top of the component and pass it through:

```tsx
const DdocEditor = forwardRef(
  ({ /* ...existing props..., */ fonts, ...rest }: DdocProps, ref) => {
    // ...
    useDdocEditor({ /* ...existing args..., */ fonts });
```

(Exact insertion point depends on the file's current shape — keep destructure ordering consistent with neighbors.)

- [ ] **Step 7: Forward the prop from `preview-ddoc-editor.tsx`**

Same change as Step 6, applied to `PreviewDdocEditorContent`'s destructured props and its `useDdocEditor` call. The destructure block is the one starting at line 19 (`isPreviewMode = false, initialContent, ...`); add `fonts,` to the list.

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors.

- [ ] **Step 9: Commit**

```bash
git add package/use-ddoc-editor.tsx package/ddoc-editor.tsx package/preview-ddoc-editor.tsx
git commit -m "feat(font): register fonts and scan doc for needed families

useDdocEditor now calls registerFonts(props.fonts) and ensureLoaded for
each fontFamily referenced by the doc on create / setContent."
```

---

## Task 6: Install `react-window`

**Files:**

- Modify: `package.json`, `package-lock.json` (via npm)

- [ ] **Step 1: Install**

Run: `npm install react-window && npm install -D @types/react-window`
Expected: both packages added to `dependencies` and `devDependencies` respectively.

- [ ] **Step 2: Verify**

Run: `node -e "console.log(require('react-window/package.json').version)"`
Expected: a version string printed (any current version is fine).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add react-window for font picker virtualization"
```

---

## Task 7: Rewrite `EditorFontFamily` picker

**Files:**

- Modify: `package/components/editor-utils.tsx` (around lines 1207–1247)

- [ ] **Step 1: Add imports**

At the top of the file (near other component imports), add:

```ts
import { FixedSizeList } from 'react-window';
import { ensureLoaded } from '../utils/font-loader';
import type { FontDescriptor } from '../types';
```

- [ ] **Step 2: Update the `fonts` array shape**

Locate `export const fonts = [...]` (around line 92). Augment each entry with the optional `preview` field by accepting an additional source. Replace the existing block with:

```ts
type PickerEntry = {
  title: string;
  value: string;
  command: (editor: Editor) => void;
  preview?: React.ReactNode;
};

export const baselineFonts: PickerEntry[] = [
  {
    title: 'Default',
    value: 'default',
    command: (editor: Editor) => {
      editor.chain().focus().unsetFontFamily().run();
    },
  },
  ...Object.entries(fontStack).map<PickerEntry>(([key, value]) => ({
    title: key,
    value,
    command: (editor: Editor) => {
      editor.chain().focus().setFontFamily(value).run();
    },
  })),
];

/** @deprecated kept for backward import paths; prefer baselineFonts + consumer catalog */
export const fonts = baselineFonts;
```

- [ ] **Step 3: Add a helper to build picker entries from a consumer catalog**

Add below `baselineFonts`:

```ts
export function buildPickerEntries(consumerFonts: FontDescriptor[]): PickerEntry[] {
  const consumerEntries: PickerEntry[] = consumerFonts.map((f) => ({
    title: f.name,
    value: f.family,
    preview: f.preview,
    command: (editor: Editor) => {
      editor.chain().focus().setFontFamily(f.family).run();
    },
  }));

  // Consumer entries override baseline entries with the same family value.
  const byValue = new Map<string, PickerEntry>();
  for (const e of baselineFonts) byValue.set(e.value, e);
  for (const e of consumerEntries) byValue.set(e.value, e);
  return [...byValue.values()];
}
```

- [ ] **Step 4: Replace `EditorFontFamily` with a virtualized, preview-aware version**

Replace the existing `EditorFontFamily` (around lines 1207–1247) with:

```tsx
const ROW_HEIGHT = 36;
const MAX_VISIBLE_ROWS = 12;

export const EditorFontFamily = ({
  elementRef,
  editor,
  setToolVisibility,
  fonts: consumerFonts = [],
}: {
  elementRef: React.RefObject<HTMLDivElement>;
  editor: Editor;
  setToolVisibility: Dispatch<SetStateAction<IEditorTool>>;
  fonts?: FontDescriptor[];
}) => {
  const entries = useMemo(() => buildPickerEntries(consumerFonts), [consumerFonts]);
  const [loadingValue, setLoadingValue] = useState<string | null>(null);

  const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
    const font = entries[index];
    const isActive = editor.isActive('textStyle', { fontFamily: font.value });
    const isLoading = loadingValue === font.value;
    return (
      <button
        style={style}
        onMouseDown={(e) => e.preventDefault()}
        onClick={async () => {
          setLoadingValue(font.value);
          try {
            await ensureLoaded(font.value);
            font.command(editor);
            setToolVisibility(IEditorTool.NONE);
          } finally {
            setLoadingValue(null);
          }
        }}
        key={font.title}
        className={cn(
          'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm color-text-default transition',
          isActive
            ? 'color-bg-brand xl:hover:brightness-90 color-text-on-brand'
            : 'hover:color-bg-default-hover',
        )}
      >
        {font.preview ?? <p className="font-medium">{font.title}</p>}
        {isLoading && <span className="ml-auto text-xs opacity-60">…</span>}
      </button>
    );
  };

  const height = Math.min(entries.length, MAX_VISIBLE_ROWS) * ROW_HEIGHT;

  return (
    <div
      ref={elementRef}
      className={cn(
        'z-50 w-48 color-bg-default px-1 py-2 shadow-elevation-1 transition-all rounded',
      )}
    >
      <FixedSizeList
        height={height}
        itemCount={entries.length}
        itemSize={ROW_HEIGHT}
        width="100%"
      >
        {Row}
      </FixedSizeList>
    </div>
  );
};
```

Ensure `useMemo` and `useState` are imported from React at the top of the file (they likely already are — verify, add if not).

- [ ] **Step 5: Pass `fonts` into the picker from callers**

Find every site that renders `<EditorFontFamily ... />`. Run:

```bash
grep -rn "EditorFontFamily" package
```

For each callsite, add the `fonts` prop sourced from the same place that already passes props to the editor (typically the editor toolbar receives `fonts` via context or the editor's parent component). If the callsite is inside a component that has access to the editor's props, thread `fonts` through one level. If not, accept a small prop-drilling change rather than introducing context — minimal change.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors.

- [ ] **Step 7: Commit**

```bash
git add package/components/editor-utils.tsx
git commit -m "feat(font): virtualized picker with SVG previews and lazy load

- Picker rows no longer inline-style fontFamily (no eager font fetch).
- Renders FontDescriptor.preview ReactNode when provided.
- react-window FixedSizeList for catalog-size-independent render cost.
- ensureLoaded awaited on click before applying the textStyle mark."
```

---

## Task 8: Update demo to register a sample catalog

**Files:**

- Modify: `demo/src/App.tsx` (or whichever file currently renders `<DdocEditor />` in the demo)

- [ ] **Step 1: Locate the demo entry**

Run: `grep -rn "DdocEditor" demo/src`
Identify the file rendering `<DdocEditor .../>`.

- [ ] **Step 2: Add a sample catalog**

Above the component, add a small inline sample (any 2–3 fonts loaded from a public URL the demo can reach — Google Fonts is acceptable _for the demo only_ since the demo is not production):

```ts
import type { FontDescriptor } from '../../index';

const demoFonts: FontDescriptor[] = [
  {
    name: 'Poppins',
    family: 'Poppins, sans-serif',
    url: 'https://fonts.gstatic.com/s/poppins/v22/pxiEyp8kv8JHgFVrJJfecnFHGPc.woff2',
  },
  {
    name: 'Inter',
    family: 'Inter, sans-serif',
    url: 'https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50ojIw2boKoduKmMEVuLyfMZg.woff2',
  },
];
```

Pass it to the editor:

```tsx
<DdocEditor fonts={demoFonts} {/* ...existing props */} />
```

The demo is a manual-test tool; production consumers will swap these URLs for self-hosted ones.

- [ ] **Step 3: Run the demo and smoke-check**

Run: `npm run dev`
Expected: demo opens; editor loads; open the font picker — Poppins and Inter appear at the bottom of the list, picker rows are no longer pre-styled with their fontFamily (text renders in default font), selecting Poppins applies it correctly and the woff2 is fetched only at that moment (verify in DevTools Network tab — filter "woff2").

Verify in DevTools:

1. Hard-reload the page with Network panel open and "Disable cache" on.
2. Filter requests by `font` type.
3. **Expected:** no `fonts.gstatic.com` or `fonts.googleapis.com` requests on initial load.
4. Open the font picker. **Expected:** still no font requests.
5. Click Poppins. **Expected:** exactly one woff2 request appears (the Poppins URL above).

- [ ] **Step 4: Commit**

```bash
git add demo/src/App.tsx
git commit -m "chore(demo): register sample fonts via new fonts prop"
```

---

## Task 9: Final verification

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: PASS, zero TS errors. `dist/style.css` exists.

- [ ] **Step 2: Confirm no Google Fonts leak**

Run: `grep -c "fonts.googleapis.com\|fonts.gstatic.com" dist/style.css dist/*.js 2>/dev/null; echo done`
Expected: every line reads `0` (or the file is binary-skipped). No matches in the built output.

- [ ] **Step 3: Confirm baseline-only font list**

Run: `grep -c "Poppins\|Lato\|Oswald\|Roboto\|JetBrains" dist/*.js | head`
Expected: `0` for each (these strings should no longer be in the built bundle).

- [ ] **Step 4: Manual demo smoke (already done in Task 8 — re-confirm)**

Repeat the DevTools Network check from Task 8 Step 3.

- [ ] **Step 5: No commit needed**

This task is verification only. If any step fails, return to the prior task that introduced the failing artifact.

---

## Notes for the implementer

- **Minimal-change discipline.** Do not refactor `font-family-persistence.ts`, the broader toolbar, or unrelated code. The user has a standing preference for minimal scope.
- **Tests.** vitest is already set up (`npm test`); do not introduce another framework. Verification is build + `npm test` + manual demo check.
- **SSR safety.** `font-loader.ts` already guards with `typeof document !== 'undefined'`. Do not call `ensureLoaded` from module-level code or constructors that run during SSR.
- **Picker callsite changes.** If `EditorFontFamily` is rendered from multiple places, prefer threading `fonts` one level rather than introducing a React context — keep the diff small.

# Font Autoload Extension Implementation Plan

> **Status:** Not implemented as of 2026-09 (see the status note on the design section above).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift font autoload out of the React `useEffect` layer in `use-tab-editor.tsx` and into a dedicated Tiptap extension that covers every doc-mutating path (initial mount, Yjs sync, paste, undo/redo, `setContent`, etc.) through a single ProseMirror plugin.

**Architecture:** New `FontAutoload` Tiptap extension wrapping one stateless ProseMirror plugin. The plugin scans the doc for fontFamily values on mount (`view` callback) and on every doc-changing transaction (`update` callback, gated on `view.state.doc !== prevDoc`). Calls `ensureLoaded` for each family found. Dedup is owned by `font-loader`'s existing `loaded` Map.

**Tech Stack:** Tiptap (`@tiptap/core`), ProseMirror (`@tiptap/pm/state`, `@tiptap/pm/model`), TypeScript, Vite.

**Spec:** the "Font Autoload Extension" design earlier in this file.

**Testing note:** This repo uses vitest (`npm test`; tests sit next to the code as `*.test.ts(x)`). Verification is `npm run build` (must pass with zero TS errors), `npm test`, plus a manual collab smoke check.

**Commits:** The user prefers to commit themselves once the work passes review. **Do NOT run `git commit` after any task.** Stop after the final verification step.

---

## File Structure

**Create:**

- `package/extensions/font-autoload.ts` — the new extension wrapping a single stateless PM plugin (~30 lines).

**Modify:**

- `package/extensions/default-extension.ts` — import and append `FontAutoload` to the extensions array (one new import line, one new line in the array).
- `package/hooks/use-tab-editor.tsx` — delete the helpers (`collectFontFamilies`, `ensureFontsForEditor`), the unused `ensureLoaded` import, the throttled `useEffect`, and both inline `ensureFontsForEditor(editor)` calls. Net: ~30 lines removed.

**Unchanged (explicit):**

- `package/utils/font-loader.ts`.
- `package/extensions/font-family-persistence.ts`.
- `package/components/editor-utils.tsx` (the picker keeps its own `await ensureLoaded` for the click-spinner UX).
- `index.ts` (no new exports — the extension is internal).

---

## Task 1: Create the `FontAutoload` extension

**Files:**

- Create: `package/extensions/font-autoload.ts`

- [ ] **Step 1: Write the extension file**

Create `package/extensions/font-autoload.ts` with the exact content below:

```ts
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ensureLoaded } from '../utils/font-loader';

const fontAutoloadKey = new PluginKey('fontAutoload');

const ensureFontsForDoc = (doc: PMNode): void => {
  doc.descendants((node) => {
    if (node.attrs?.fontFamily) void ensureLoaded(node.attrs.fontFamily);
    for (const mark of node.marks) {
      if (mark.type.name === 'textStyle' && mark.attrs?.fontFamily) {
        void ensureLoaded(mark.attrs.fontFamily);
      }
    }
    return true;
  });
};

export const FontAutoload = Extension.create({
  name: 'fontAutoload',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: fontAutoloadKey,
        view: (view) => {
          ensureFontsForDoc(view.state.doc);
          let prevDoc = view.state.doc;
          return {
            update: (view) => {
              if (view.state.doc === prevDoc) return;
              prevDoc = view.state.doc;
              ensureFontsForDoc(view.state.doc);
            },
          };
        },
      }),
    ];
  },
});
```

- [ ] **Step 2: Verify the file type-checks in isolation**

Run: `npm run build`
Expected: PASS, zero TS errors. (The extension is created but not yet registered — Vite will tree-shake it; that's fine for now. The check confirms the file itself compiles.)

---

## Task 2: Register the extension in `default-extension.ts`

**Files:**

- Modify: `package/extensions/default-extension.ts`

- [ ] **Step 1: Add the import**

Open `package/extensions/default-extension.ts`. Locate the existing import of `FontFamilyPersistence` (line 89):

```ts
import { FontFamilyPersistence } from './font-family-persistence';
```

Add directly below it:

```ts
import { FontAutoload } from './font-autoload';
```

- [ ] **Step 2: Append `FontAutoload` to the extensions array**

Inside the `defaultExtensions` factory, the returned array contains `FontFamily, FontFamilyPersistence, CaretMarks, ...` (`TypographyPersistence` was removed in TEC-3030; an empty line's font now lives in the `caretMarks` stamp). Insert `FontAutoload,` right after `FontFamilyPersistence,` so it reads:

```ts
  FontFamilyPersistence,
  FontAutoload,
  CaretMarks,
```

Order is not load-bearing (the plugin has no dependencies on other extensions), but adjacency to `FontFamilyPersistence` matches the conceptual grouping.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors.

---

## Task 3: Remove the redundant manual autoload paths from `use-tab-editor.tsx`

**Files:**

- Modify: `package/hooks/use-tab-editor.tsx`

This task deletes the React-side autoload machinery that the extension now subsumes. Do NOT touch any other behavior in this 1000+ line file.

- [ ] **Step 1: Delete the throttled `editor.on('update')` `useEffect`**

Locate the `useEffect` whose body contains a `setTimeout` with `150` and `pending` flag, and which subscribes via `editor.on('update', handler)`. It sits below the existing `useEffect([editor])` that sets `isInitialEditorCreation.current = false`. The block to delete looks like:

```ts
  // Pick up newly-introduced fonts from remote (Yjs) updates and local edits
  // (paste, undo, etc.) that don't go through the picker. ensureLoaded is
  // idempotent so a throttled scan is safe and cheap after the first call.
  useEffect(() => {
    if (!editor) return;
    let pending = false;
    const handler = () => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        if (!editor.isDestroyed) ensureFontsForEditor(editor);
      }, 150);
    };
    editor.on('update', handler);
    return () => {
      editor.off('update', handler);
    };
  }, [editor]);
```

Delete the entire block (including the leading comment).

- [ ] **Step 2: Remove the `ensureFontsForEditor(editor)` call in the editor-ready effect**

Locate the `useEffect([editor])` near line 663 that currently reads:

```ts
  // TODO: to see why this is necessary
  useEffect(() => {
    if (editor) {
      isInitialEditorCreation.current = false;
      ensureFontsForEditor(editor);
    }
  }, [editor]);
```

Delete only the line `ensureFontsForEditor(editor);`. Keep the `isInitialEditorCreation.current = false;` line and the rest of the effect. After edit:

```ts
  // TODO: to see why this is necessary
  useEffect(() => {
    if (editor) {
      isInitialEditorCreation.current = false;
    }
  }, [editor]);
```

- [ ] **Step 3: Remove the `ensureFontsForEditor(editor)` call in the hydration block**

Around line 917 there's a second `ensureFontsForEditor(editor);` invocation inside the hydration `queueMicrotask` block. Search the file for `ensureFontsForEditor(editor)` — after Step 2 there is exactly one remaining occurrence; delete that line.

- [ ] **Step 4: Delete the helpers `collectFontFamilies` and `ensureFontsForEditor`**

Locate the top-of-file definitions (around lines 79–97):

```ts
const collectFontFamilies = (editor: Editor): Set<string> => {
  const families = new Set<string>();
  editor.state.doc.descendants((node) => {
    if (node.attrs?.fontFamily) families.add(node.attrs.fontFamily);
    for (const mark of node.marks) {
      if (mark.type.name === 'textStyle' && mark.attrs?.fontFamily) {
        families.add(mark.attrs.fontFamily);
      }
    }
    return true;
  });
  return families;
};

const ensureFontsForEditor = (editor: Editor) => {
  for (const family of collectFontFamilies(editor)) {
    void ensureLoaded(family);
  }
};
```

Delete both function declarations entirely.

- [ ] **Step 5: Delete the now-unused import**

At the top of the file (around line 77):

```ts
import { ensureLoaded } from '../utils/font-loader';
```

Delete this line. Verify no remaining `ensureLoaded` usage in the file:

```bash
grep -n "ensureLoaded\|collectFontFamilies\|ensureFontsForEditor" package/hooks/use-tab-editor.tsx
```

Expected output: empty (no matches).

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: PASS, zero TS errors. (Pre-existing diagnostics unrelated to fonts may persist — only assert that no NEW errors appeared and that no errors mention `ensureLoaded`, `collectFontFamilies`, or `ensureFontsForEditor`.)

---

## Task 4: Final verification

This task is verification only. Do not commit.

- [ ] **Step 1: Clean build**

Run: `rm -rf dist && npm run build`
Expected: PASS, zero TS errors. `dist/style.css` and `dist/index.es.js` exist.

- [ ] **Step 2: Confirm no Google Fonts leak (regression check from the prior plan)**

Run: `grep -c "fonts.googleapis.com\|fonts.gstatic.com" dist/style.css dist/index.es.js`
Expected: every line reads `0`. (This was achieved by the previous plan; confirm we haven't regressed.)

- [ ] **Step 3: Confirm the new extension is bundled**

Run: `grep -c "fontAutoload" dist/index.es.js`
Expected: at least `1`. (The plugin key name appears in the bundle once the extension is registered.)

- [ ] **Step 4: Confirm `use-tab-editor.tsx` is clean of the old helpers**

Run: `grep -n "ensureLoaded\|collectFontFamilies\|ensureFontsForEditor" package/hooks/use-tab-editor.tsx`
Expected: empty (no matches).

- [ ] **Step 5: Manual collab smoke (suggested, optional for the implementer)**

Open the demo (`npm run dev`) in two browser windows pointing at the same collab doc. In window A, apply a consumer-registered font (e.g. Poppins) via the picker. In window B, the same text should re-render in Poppins within ~one network round-trip. Confirm via DevTools Network panel that exactly one Poppins woff2 fetch fires in window B at that moment.

If demo collab setup isn't trivial from a fresh session, the implementer may skip this step and surface the suggestion in the final report for the user to validate.

- [ ] **Step 6: Stop. Do NOT commit.**

Report the diff stats (e.g. `git diff --stat`) and the build output to the user. The user will commit themselves.

---

## Notes for the implementer

- **Minimal-change discipline.** Do not touch `font-family-persistence.ts`, the picker (`editor-utils.tsx`), `font-loader.ts`, or any unrelated extension. The user has a standing preference for minimal scope.
- **Tests.** vitest is already set up (`npm test`); do not introduce another framework. Verification is build + `npm test` + a suggested manual smoke check.
- **No commits.** The user commits themselves. Skip every commit step you might be tempted to add.
- **SSR safety.** The plugin only runs when the editor mounts in the browser. `ensureLoaded` already guards `typeof document === 'undefined'`. No extra guards needed in the extension.
- **Order in the extension array.** Adjacent to `FontFamilyPersistence` for readability, but not load-bearing — the plugin has no extension dependencies.
