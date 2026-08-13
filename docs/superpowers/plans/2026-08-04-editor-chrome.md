# Editor Chrome (Floating Block Controls + Container Padding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Commit convention (user-directed 2026-08-05):** commit at the end of each task with a conventional message (`feat:`/`fix:`/`chore:`). Never add any AI attribution — no `Co-Authored-By`, no "Generated with" lines.

**Goal:** Move all block chrome (padding, drag/plus/collapse/copy-link controls, template buttons) out of the editable document: container-level padding on `.ProseMirror` and one floating drag-handle cluster, per spec `docs/superpowers/specs/2026-08-04-editor-chrome-design.md`.

**Architecture:** Keep the dBlock schema untouched. `DBlockNodeView` shrinks to a plain wrapper (no gutter/flex). A single `<DragHandle>` (official Tiptap extension) rendered outside the contenteditable replaces per-block gutters; the template overlay portals to the editor panel div instead of inside the document. Padding moves to scoped `.ProseMirror` CSS.

**Tech Stack:** Tiptap 3.11.0 (pinned), `@tiptap/extension-drag-handle-react@3.11.0`, React 18, vitest + jsdom + @testing-library.

## Global Constraints

- **Supply-chain protocol (Shai-Hulud worm, active since 2026-08-04):** only install packages with publish date **before 2026-08-04**; exact pins (no `^`); `npm install --ignore-scripts` for this branch's installs; review every lockfile diff entry; never run `npm update`.
- New dep versions: `@tiptap/extension-drag-handle@3.11.0`, `@tiptap/extension-drag-handle-react@3.11.0`, `@tiptap/extension-node-range@3.11.0` (all published 2025-11-19).
- Padding values (from spec): md+ `72px 80px 20vh`; below md `24px 16px 20vh 36px` (36px left = collapse-chevron room). Padding breakpoint is `md` (768px); plus/grip visibility gates at `lg` (1024px) — intentionally different.
- Doc JSON must remain byte-identical — no schema or content changes.
- Behavior parity: plus (Alt = insert above), grip menu actions, Alt-click grip = delete, collapse chevron visible on all screen sizes, copy-link only in preview mode on headings, no chrome in presentation-preview.
- Run tests with `npx vitest run <file>`; full suite `npx vitest run`.

---

### Task 0: Restore the deleted test harness (pre-existing breakage)

Commit f20d313 deleted `package/utils/make-editor.ts` but left `package/utils/selection-utils.test.ts` and `package/hooks/use-editor-commands.test.tsx` importing it — both files currently fail to collect. Restore the helper verbatim; `getHeadlessExtensions` still exists (`package/hooks/use-headless-editor.tsx:25`).

**Files:**
- Create: `package/utils/make-editor.ts`

**Interfaces:**
- Produces: `makeEditor(content?: string): Editor` — jsdom editor factory used by all tests in this plan.

- [ ] **Step 1: Recreate the file exactly as deleted (verified against `git show f20d313~1:package/utils/make-editor.ts`)**

```ts
import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

/**
 * Shared jsdom editor factory for unit tests (use-editor-commands.test.tsx,
 * selection-utils.test.ts, ...). Collaboration owns the doc, so content must
 * be set via `setContent` *after* construction — passing `content` to the
 * `Editor` constructor is silently ignored once Collaboration is configured.
 */
export const makeEditor = (content: string = '<p></p>'): Editor => {
  const editor = new Editor({
    extensions: getHeadlessExtensions(),
    // matches useHeadlessEditor/ddoc-editor; required for dir tracking
    textDirection: 'auto',
  });
  editor.commands.setContent(content);
  return editor;
};
```

- [ ] **Step 2: Verify both broken suites now collect and pass**

Run: `npx vitest run package/utils/selection-utils.test.ts package/hooks/use-editor-commands.test.tsx`
Expected: PASS (previously "Test Files 1 failed / no tests").

---

### Task 1: Install drag-handle dependencies under the supply-chain protocol

**Files:**
- Modify: `package.json` (deps + `overrides`)
- Modify: `package-lock.json` (via npm, then reviewed)

**Interfaces:**
- Produces: importable `@tiptap/extension-drag-handle-react` (component `DragHandle`), `@tiptap/extension-node-range`.

- [ ] **Step 1: Verify publish dates of the exact versions (all must be < 2026-08-04)**

Run:
```bash
npm view @tiptap/extension-drag-handle time --json | python3 -c "import json,sys; print(json.load(sys.stdin)['3.11.0'])"
npm view @tiptap/extension-drag-handle-react time --json | python3 -c "import json,sys; print(json.load(sys.stdin)['3.11.0'])"
npm view @tiptap/extension-node-range time --json | python3 -c "import json,sys; print(json.load(sys.stdin)['3.11.0'])"
```
Expected: all three print a 2025-11-19 timestamp. If any print a 2026-08 date, STOP and report.

- [ ] **Step 2: Add worm-guard overrides to `package.json`** (pins the families the attack poisoned to the majors already in our lockfile)

```json
"overrides": {
  "keyv": "4.5.4",
  "flat-cache": "3.2.0",
  "file-entry-cache": "6.0.1"
}
```

- [ ] **Step 3: Install with scripts disabled and exact pins**

Run:
```bash
npm install --save-exact --ignore-scripts \
  @tiptap/extension-drag-handle@3.11.0 \
  @tiptap/extension-drag-handle-react@3.11.0 \
  @tiptap/extension-node-range@3.11.0
```

- [ ] **Step 4: Review the lockfile diff — every added package**

Run: `git diff package-lock.json | grep -E '^\+.*"(resolved|version)"' | sort -u | head -50`
Check each newly added name/version: (a) not on the compromised list (keyv 6.0.0, flat-cache 6.1.24, file-entry-cache 11.1.6, cacheable-request 13.0.20, cacheable 2.5.1, @cacheable/* — see spec), (b) publish date pre-2026-08-04 via `npm view <name> time --json`, (c) no new `preinstall`/`postinstall` in its lockfile entry (`git diff package-lock.json | grep -i 'install"'` → expect empty). Expected additions: the three tiptap packages and possibly `@floating-ui/dom` and `@tiptap/y-tiptap` (peer). Anything else unexplained: STOP and report.

- [ ] **Step 5: Sanity-check the suite still passes**

Run: `npx vitest run package/utils/selection-utils.test.ts`
Expected: PASS.

---

### Task 2: Floating handle cluster component (coexists with old gutter for now)

New component rendering the official `DragHandle` with our existing buttons. Mounted by `DBlockToolbarProvider` alongside its current machinery — the old gutter stays until Task 3, so the editor keeps working after this task (dev will briefly show both control sets; acceptable intermediate state).

**Files:**
- Create: `package/extensions/d-block/dblock-drag-handle.tsx`
- Create: `package/extensions/d-block/dblock-drag-handle.test.tsx`
- Modify: `package/extensions/d-block/dblock-toolbar.tsx` (mount only — render `<DBlockDragHandle>` next to existing output in `DBlockToolbarProvider`)

**Interfaces:**
- Consumes: `useContentItemActions(editor, resolveCurrentBlock: () => ResolvedContentItem | null)` from `package/hooks/use-content-item-actions.tsx` where `ResolvedContentItem = { editor: Editor; node: Node; pos: number }`; `getDBlockRenderMeta(node, pos)`, `getHeadingLinkSlug(node, pos)`, `toggleHeadingCollapse(editor, pos)` from `./dblock-collapse`; button/tooltip/menu components from `./components/*`; `DBlockRuntimeState` from `./dblock-runtime`.
- Produces: `DBlockDragHandle({ editor, runtimeState, onCopyHeadingLink }: { editor: Editor; runtimeState: DBlockRuntimeState; onCopyHeadingLink?: (link: string) => void }): JSX.Element | null` — the only floating-chrome entry point after Task 3.

- [ ] **Step 1: Confirm the DragHandle React API against the installed types**

Read `node_modules/@tiptap/extension-drag-handle-react/dist/index.d.ts`. Confirm: component name (`DragHandle`), props `editor`, `children`, `onNodeChange({ node, editor, pos })`, and the positioning prop (`computePositionConfig` in 3.11). If prop names differ, adapt Step 3's code to the actual names before writing it.

- [ ] **Step 2: Write the failing test**

`package/extensions/d-block/dblock-drag-handle.test.tsx`:

```tsx
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';
import { DBlockDragHandle } from './dblock-drag-handle';
import { DEFAULT_DBLOCK_RUNTIME_STATE } from './dblock-runtime';

beforeAll(() => {
  // floating-ui in jsdom
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe('DBlockDragHandle', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('renders the control cluster outside the editable DOM', () => {
    editor = makeEditor('<p>hello</p>');
    document.body.appendChild(editor.view.dom);
    render(
      <DBlockDragHandle
        editor={editor}
        runtimeState={DEFAULT_DBLOCK_RUNTIME_STATE}
      />,
    );
    const cluster = screen.getByLabelText('block-controls');
    expect(cluster).toBeTruthy();
    expect(editor.view.dom.contains(cluster)).toBe(false);
  });

  it('renders nothing in presentation preview', () => {
    editor = makeEditor('<p>hello</p>');
    const { container } = render(
      <DBlockDragHandle
        editor={editor}
        runtimeState={{
          ...DEFAULT_DBLOCK_RUNTIME_STATE,
          isPresentationMode: true,
          isPreviewMode: true,
        }}
      />,
    );
    expect(container.querySelector('[aria-label="block-controls"]')).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run package/extensions/d-block/dblock-drag-handle.test.tsx`
Expected: FAIL — module `./dblock-drag-handle` not found.

- [ ] **Step 4: Implement `dblock-drag-handle.tsx`**

Port the button cluster from `DBlockToolbar` (in `dblock-toolbar.tsx`) onto the floating handle. Key structure (visibility rules copied verbatim from `DBlockToolbar`):

```tsx
import React, { useCallback, useState } from 'react';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useMediaQuery } from 'usehooks-ts';
import { cn } from '@fileverse/ui';
import useContentItemActions, {
  ResolvedContentItem,
} from '../../hooks/use-content-item-actions';
import {
  getDBlockRenderMeta,
  getHeadingLinkSlug,
  toggleHeadingCollapse,
} from './dblock-collapse';
import type { DBlockRuntimeState } from './dblock-runtime';
import { DBlockMenu } from './components/menu';
import {
  CollapseButton,
  CopyLinkButton,
  GripButton,
  PlusButton,
} from './components/buttons';
import {
  AddBlockTooltip,
  CollapseTooltip,
  CopyLinkTooltip,
  DragTooltip,
} from './components/tooltips';

interface HoveredBlock {
  node: ProseMirrorNode;
  pos: number;
}

export const DBlockDragHandle = ({
  editor,
  runtimeState,
  onCopyHeadingLink,
}: {
  editor: Editor;
  runtimeState: DBlockRuntimeState;
  onCopyHeadingLink?: (link: string) => void;
}) => {
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isBelowLargeScreen = useMediaQuery('(max-width: 1024px)');

  const resolveBlock = useCallback((): ResolvedContentItem | null => {
    if (!hovered) return null;
    const node = editor.state.doc.nodeAt(hovered.pos);
    if (node?.type.name !== 'dBlock') return null;
    return { editor, node, pos: hovered.pos };
  }, [editor, hovered]);
  const actions = useContentItemActions(editor, resolveBlock);

  if (runtimeState.isPresentationMode && runtimeState.isPreviewMode) {
    return null;
  }

  const meta = hovered
    ? getDBlockRenderMeta(hovered.node, hovered.pos)
    : null;

  const shouldShowEditingControls =
    !runtimeState.isPreviewMode && !isBelowLargeScreen;
  const shouldShowCollapse = Boolean(meta?.isHeading);
  const shouldShowCopyLink =
    runtimeState.isPreviewMode &&
    Boolean(meta?.isHeading) &&
    !runtimeState.isPreviewEditor &&
    !isBelowLargeScreen;

  const handleAddBlock = (event: React.MouseEvent<HTMLDivElement>) => {
    const current = resolveBlock();
    if (!current) return;
    const insertPos = event.altKey
      ? current.pos
      : current.pos + current.node.nodeSize;
    current.editor.commands.insertContentAt(insertPos, {
      type: 'dBlock',
      content: [{ type: 'paragraph' }],
    });
  };

  const handleDragClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.altKey) {
      actions.deleteNode();
      return;
    }
    setMenuOpen((open) => !open);
  };

  const handleToggleCollapse = () => {
    const current = resolveBlock();
    if (current) toggleHeadingCollapse(current.editor, current.pos);
  };

  const handleCopyHeadingLink = () => {
    const current = resolveBlock();
    if (!current) return;
    const link = getHeadingLinkSlug(current.node, current.pos);
    if (link) onCopyHeadingLink?.(link);
  };

  const buttonClassName = cn(
    'd-block-button color-text-default hover:color-bg-default-hover aspect-square h-5 w-5 shrink-0',
  );

  if (!shouldShowEditingControls && !shouldShowCollapse && !shouldShowCopyLink) {
    // Still mount DragHandle so hover tracking keeps working; render an
    // empty cluster (e.g. mobile hovering a paragraph).
  }

  return (
    <DragHandle
      editor={editor}
      computePositionConfig={{ placement: 'left-start' }}
      onNodeChange={({ node, pos }) => {
        if (node) setHovered({ node, pos });
      }}
    >
      <div
        aria-label="block-controls"
        className="flex h-6 items-center justify-end gap-[2px] pr-2"
      >
        {shouldShowEditingControls ? (
          <>
            <AddBlockTooltip>
              <PlusButton onClick={handleAddBlock} className={buttonClassName} />
            </AddBlockTooltip>
            <DBlockMenu
              isOpen={menuOpen}
              onOpenChange={setMenuOpen}
              trigger={
                <DragTooltip>
                  <GripButton
                    onClick={handleDragClick}
                    className={buttonClassName}
                  />
                </DragTooltip>
              }
              actions={actions}
            />
          </>
        ) : null}
        {shouldShowCollapse ? (
          <CollapseTooltip isCollapsed={Boolean(meta?.isThisHeadingCollapsed)}>
            <CollapseButton
              isCollapsed={Boolean(meta?.isThisHeadingCollapsed)}
              onToggle={handleToggleCollapse}
              className={buttonClassName}
            />
          </CollapseTooltip>
        ) : null}
        {shouldShowCopyLink ? (
          <CopyLinkTooltip>
            <CopyLinkButton
              onClick={handleCopyHeadingLink}
              className={cn(
                'd-block-button color-text-default color-bg-default-hover aspect-square h-6 w-6 shrink-0',
              )}
            />
          </CopyLinkTooltip>
        ) : null}
      </div>
    </DragHandle>
  );
};
```

Notes for the implementer:
- `GripButton` currently sets `draggable data-drag-handle` attributes (`components/buttons.tsx:44-45`) — keep them; inside `DragHandle` they make the grip the drag initiator.
- The menu close-on-node-change behavior from the old toolbar (`useEffect` on `handle.id`) becomes: close the menu when `hovered?.pos` changes — add `useEffect(() => setMenuOpen(false), [hovered?.pos])`.

- [ ] **Step 5: Mount it in `DBlockToolbarProvider`** (additive only — do not remove existing machinery yet)

In `dblock-toolbar.tsx`, inside the provider's returned fragment, after `{children}` add:

```tsx
{editor ? (
  <DBlockDragHandle
    editor={editor}
    runtimeState={runtimeState}
    onCopyHeadingLink={
      getDBlockViewFromElement(
        editor.view.dom.querySelector('[data-dblock-node-view]'),
      )?.onCopyHeadingLink
    }
  />
) : null}
```

(The `onCopyHeadingLink` plumbing simplifies in Task 3 when the registry dies: pass the callback into the provider as a prop from `ddoc-editor.tsx` instead. If that wiring is awkward now, hardcode `undefined` here and complete it in Task 3 — copy-link only matters in preview mode.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run package/extensions/d-block/dblock-drag-handle.test.tsx`
Expected: PASS. If `DragHandle` throws in jsdom on missing browser APIs, stub them in the test's `beforeAll` (same pattern as ResizeObserver) and note which stub was needed.

- [ ] **Step 7: Manual check in the demo app**

Run: `rm -rf demo/node_modules/.vite && npm run dev -- --force` (known linked-UI cache issue). Hover blocks: floating cluster appears in the left margin; drag via grip moves blocks; old gutter still present (expected until Task 3).

---

### Task 3: The layout switch — container padding, plain node view, delete gutter machinery

**Files:**
- Modify: `package/extensions/d-block/dblock-node-view.ts` (rewrite, ~229 → ~70 lines)
- Modify: `package/extensions/d-block/dblock-toolbar.tsx` (delete `DBlockToolbar`, registry usage, hover/refresh listeners; keep provider shell + `DBlockDragHandle` + template overlay)
- Delete: `package/extensions/d-block/dblock-view-registry.ts`
- Modify: `package/styles/editor.css` (container padding, remove translateY hacks, presentation padding)
- Modify: `package/types.ts:25` (add `main-doc-editor` class to `DdocEditorProps.attributes.class`)
- Modify: `package/hooks/use-content-item-actions.tsx:6` only if imports break (it imports from `dblock-collapse`, unaffected)
- Create: `package/extensions/d-block/dblock-node-view.test.ts`

**Interfaces:**
- Consumes: `DBlockDragHandle` from Task 2 (now the only chrome).
- Produces: simplified DOM contract — `div[data-type="d-block"] > div[data-node-view-content]`, wrapper classes limited to: `d-block-hidden`, `invalid-content`, `is-table`, presentation/preview classes. Tests and Task 4 rely on this shape.

- [ ] **Step 1: Write the failing DOM test**

`package/extensions/d-block/dblock-node-view.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';

describe('DBlockNodeView (simplified chrome-less wrapper)', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('renders no gutter and no per-block padding classes', () => {
    editor = makeEditor('<p>hello</p>');
    const block = editor.view.dom.querySelector('[data-type="d-block"]')!;
    expect(block).toBeTruthy();
    expect(block.querySelector('[data-dblock-gutter]')).toBeNull();
    expect(block.className).not.toMatch(/px-4|pl-2|pr-8|pr-\[80px\]|pl-\[8px\]/);
    // contentDOM is the direct (and only) element child
    expect(block.children.length).toBe(1);
    expect(
      (block.firstElementChild as HTMLElement).dataset.nodeViewContent,
    ).toBe('true');
  });

  it('keeps the is-table marker class for table blocks', () => {
    editor = makeEditor(
      '<table><tbody><tr><td><p>x</p></td></tr></tbody></table>',
    );
    const block = editor.view.dom.querySelector('[data-type="d-block"]')!;
    expect(block.className).toMatch(/is-table/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run package/extensions/d-block/dblock-node-view.test.ts`
Expected: FAIL — gutter present / flex classes present.

- [ ] **Step 3: Rewrite `dblock-node-view.ts`**

```ts
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Decoration, NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import {
  DBLOCK_HIDDEN_CLASS,
  getDBlockRenderMeta,
} from './dblock-collapse';
import type { DBlockRuntimeState } from './dblock-runtime';
import { getDBlockRuntimeState } from './dblock-runtime';

interface DBlockNodeViewOptions {
  editor: Editor;
  node: ProseMirrorNode;
  getPos: () => number;
  decorations: readonly Decoration[];
  HTMLAttributes: Record<string, unknown>;
  getRuntimeState?: () => DBlockRuntimeState;
}

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const hasHiddenDecoration = (decorations: readonly Decoration[]) =>
  decorations.some((decoration) =>
    String(
      (decoration as { type?: { attrs?: { class?: string } } }).type?.attrs
        ?.class ?? '',
    )
      .split(/\s+/)
      .includes(DBLOCK_HIDDEN_CLASS),
  );

const setAttributes = (
  element: HTMLElement,
  attributes: Record<string, unknown>,
) => {
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'class' || value === undefined || value === null) return;
    element.setAttribute(key, String(value));
  });
};

export class DBlockNodeView implements NodeView {
  node: ProseMirrorNode;
  editor: Editor;
  getPos: () => number;
  dom: HTMLDivElement;
  contentDOM: HTMLDivElement;
  private decorations: readonly Decoration[];
  private getRuntimeState?: () => DBlockRuntimeState;

  constructor({
    editor,
    node,
    getPos,
    decorations,
    HTMLAttributes,
    getRuntimeState,
  }: DBlockNodeViewOptions) {
    this.editor = editor;
    this.node = node;
    this.getPos = getPos;
    this.decorations = decorations;
    this.getRuntimeState = getRuntimeState;

    this.dom = document.createElement('div');
    this.dom.dataset.type = 'd-block';
    setAttributes(this.dom, HTMLAttributes);

    this.contentDOM = document.createElement('div');
    this.contentDOM.dataset.nodeViewContent = 'true';
    this.dom.appendChild(this.contentDOM);

    this.syncDOM();
  }

  update(node: ProseMirrorNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.decorations = decorations;
    this.syncDOM();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }

  private syncDOM() {
    const runtime = getDBlockRuntimeState(this.getRuntimeState);
    const isPresentationPreview =
      runtime.isPresentationMode && runtime.isPreviewMode;
    const position = this.safeGetPos();
    const meta = getDBlockRenderMeta(this.node, position ?? 0);
    const shouldHide =
      !isPresentationPreview && hasHiddenDecoration(this.decorations);

    this.dom.className = joinClasses(
      'd-block w-full relative',
      meta.isTable && 'is-table pointer-events-auto',
      this.node.attrs?.isCorrupted && 'invalid-content',
      runtime.isPreviewMode && 'pointer-events-none',
      shouldHide && DBLOCK_HIDDEN_CLASS,
    );
  }

  private safeGetPos() {
    try {
      const position = this.getPos();
      return typeof position === 'number' ? position : null;
    } catch {
      return null;
    }
  }
}
```

Notes:
- `runtime.isPreviewMode && 'pointer-events-none'` replicates the old presentation-preview content-shell rule; check the old `syncDOM` (`git show HEAD:package/extensions/d-block/dblock-node-view.ts`) while porting — preview (non-presentation) mode must NOT get `pointer-events-none` (old code only applied it under `isPresentationPreview`). Adjust to `isPresentationPreview && 'pointer-events-none'`.
- Heading-alignment flex-reverse classes (`getHeadingAlignmentClass`) are dropped — copy-link lives in the floating cluster now. Remove the now-unused import from `dblock-collapse` if nothing else uses it (check with grep; it's exported for the old toolbar only).
- The `is-table` width cap (`max-w-full lg:max-w-[90%]`, previously on the content shell) moves to CSS in Step 5.

- [ ] **Step 4: Strip the old machinery from `dblock-toolbar.tsx` and delete the registry**

- Delete the `DBlockToolbar` component, `resolveCurrentDBlock`, all `dblock-view-registry` imports/usages, the `pointerover/pointerout/focusin/focusout` listeners, `activeHandle`/`refreshKey` state, and `editor.on('transaction'|'selectionUpdate', refreshToolbar)`.
- `DBlockToolbarProvider` keeps: `{children}`, `<DBlockDragHandle …>` (from Task 2 — wire `onCopyHeadingLink` as a new provider prop, passed from `ddoc-editor.tsx` where the old node-view option `onCopyHeadingLink` was configured; grep `onCopyHeadingLink` to find the source), and `<DBlockTemplateOverlay …>` (untouched until Task 4 — it still portals into the content shell; since the shell no longer exists, temporarily portal into `handle.contentElement`'s replacement: `editor.view.dom.querySelector('[data-type="d-block"] > [data-node-view-content]')` — this is a one-task bridge; Task 4 removes it).
- Delete `package/extensions/d-block/dblock-view-registry.ts`; remove the `registerDBlockView` call and `unregister` from the node view (already done in Step 3's rewrite), and remove `uuid` import if now unused.
- In `dblock.ts` `addNodeView()`, drop the `onCopyHeadingLink` option pass-through if the node view no longer accepts it (it doesn't — the provider owns it now); also remove `decorations`/`HTMLAttributes` params only if unused — they ARE used, keep them.

- [ ] **Step 5: CSS — container padding, hack removal, table cap, presentation inset**

In `package/types.ts:25` append `main-doc-editor` to the class string in `DdocEditorProps.attributes.class`. Verify both main-doc call sites spread `DdocEditorProps` (`grep -rn "DdocEditorProps" package --include='*.ts*'` → `use-tab-editor.tsx` today; if `preview-ddoc-editor.tsx`/`use-headless-editor` construct separate visible editors with their own props, add the class there too — decide by checking which of them render the full document with dBlock node views).

In `package/styles/editor.css`, inside the top-level `.ProseMirror { … }` block scope nothing; instead add after it:

```css
.ProseMirror.main-doc-editor {
  padding: 24px 16px 20vh 36px;
}

@media (min-width: 768px) {
  .ProseMirror.main-doc-editor {
    padding: 72px 80px 20vh;
  }
}

/* table blocks keep their width cap now that the content shell is gone */
.ProseMirror [data-type='d-block'].is-table > [data-node-view-content] {
  max-width: 100%;
}
@media (min-width: 1024px) {
  .ProseMirror [data-type='d-block'].is-table > [data-node-view-content] {
    max-width: 90%;
  }
}
```

Remove the heading transform hacks (`editor.css:66-76`):

```css
h1 { transform: translateY(-0.5rem); }
h2 { transform: translateY(-0.25rem); }
h3 { transform: translateY(0); }
```

Presentation preview inset: find the presentation-mode CSS section (`grep -n "presentation\|slide" package/styles/editor.css | head`) and add the container equivalent of the old per-block `px-4 md:px-[80px]`:

```css
/* presentation preview: container inset replaces old per-block px-4 md:px-[80px] */
.presentation-mode .ProseMirror.main-doc-editor {
  padding: 16px;
}
@media (min-width: 768px) {
  .presentation-mode .ProseMirror.main-doc-editor {
    padding: 16px 80px;
  }
}
```

(Adjust `.presentation-mode` to the actual wrapper class found by the grep — check `package/components/presentation-mode/` for the class it puts on the editor container.)

Also audit bottom spacers: `grep -rn "pb-40\|padding-bottom" package/styles package/ddoc-editor.tsx | head`. The `max-sm:!pb-40` on preview-mode `EditorContent` (`ddoc-editor.tsx:1282`) predates the 20vh bottom padding — remove it if the 20vh covers the same need in preview mode; keep anything serving a different purpose (note findings in the task summary).

- [ ] **Step 6: Run the new DOM test + full suite**

Run: `npx vitest run package/extensions/d-block/dblock-node-view.test.ts && npx vitest run`
Expected: new test PASS; full suite green. Any failing test that asserted gutter DOM: update it to the new DOM contract (wrapper > contentDOM only) and say so in the summary.

- [ ] **Step 7: Manual demo verification (the payoff checks)**

In the demo app (`rm -rf demo/node_modules/.vite && npm run dev -- --force`):
1. Insert divider via `/divider` → caret lands in the text column, NOT at the window edge.
2. Upload an image → caret/placeholder stays in the text column.
3. Click below the last block → caret at text-column left edge.
4. Text column position: ~80px inset on desktop, symmetric; mobile viewport (devtools) 36px left / 16px right.
5. Collapse chevron on a heading works at mobile width.
6. Drag a block, drag a block inside a 2-column layout (known tuning spot — if handle positioning is off inside columns, record specifics rather than hacking a fix; it gets its own follow-up).
7. Presentation mode + preview mode render with correct insets and no chrome.

---

### Task 4: Template overlay outside the editable DOM

**Files:**
- Modify: `package/extensions/d-block/dblock-toolbar.tsx` (`DBlockTemplateOverlay` + `getTemplateTarget`)
- Create: `package/extensions/d-block/dblock-template-overlay.test.tsx`

**Interfaces:**
- Consumes: simplified DOM contract from Task 3 (`div[data-type="d-block"]` first child of `.ProseMirror`), panel div `[data-ddoc-editor-panel]` with `position: relative` when active (`ddoc-editor.tsx:1231-1266`).
- Produces: `getTemplateTarget(editor, runtimeState)` exported (for tests) returning `{ pos: number; node: Node } | null`; overlay renders into the active panel div, never inside `.ProseMirror`.

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';
import { getTemplateTarget } from './dblock-toolbar';
import { DEFAULT_DBLOCK_RUNTIME_STATE } from './dblock-runtime';

describe('getTemplateTarget', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('targets a single empty dBlock', () => {
    editor = makeEditor('<p></p>');
    editor.commands.setTextSelection(2);
    const target = getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE);
    expect(target).not.toBeNull();
    expect(target!.pos).toBe(0);
  });

  it('returns null once the doc has content', () => {
    editor = makeEditor('<p>hello</p>');
    const target = getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE);
    expect(target).toBeNull();
  });

  it('returns null in preview mode', () => {
    editor = makeEditor('<p></p>');
    const target = getTemplateTarget(editor, {
      ...DEFAULT_DBLOCK_RUNTIME_STATE,
      isPreviewMode: true,
    });
    expect(target).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run package/extensions/d-block/dblock-template-overlay.test.tsx`
Expected: FAIL — `getTemplateTarget` not exported.

- [ ] **Step 3: Rework `getTemplateTarget` and the overlay**

- Export `getTemplateTarget`. Simplify its return to `{ pos, node }` — drop the `handle`/`contentElement` fields (registry is gone). The "first dBlock element" lookup becomes `editor.view.dom.querySelector('[data-type="d-block"]')`.
- `DBlockTemplateOverlay` portals into the active panel: `const panel = editor?.view.dom.closest('[data-ddoc-editor-panel]')`. Render via `createPortal` into `panel` an absolutely-positioned wrapper:

```tsx
if (!target || isFocusMode || !panel) return null;
const firstBlock = editor.view.dom.querySelector('[data-type="d-block"]');
if (!firstBlock) return null;
const panelRect = panel.getBoundingClientRect();
const blockRect = firstBlock.getBoundingClientRect();
return createPortal(
  <div
    data-template-overlay="true"
    contentEditable={false}
    style={{
      position: 'absolute',
      top: blockRect.bottom - panelRect.top + 8,
      left: blockRect.left - panelRect.left,
      width: blockRect.width,
    }}
  >
    {renderTemplateButtons(/* unchanged args */)}
  </div>,
  panel,
);
```

- Recompute on doc/selection changes: the overlay component re-renders via a `refreshKey` bumped by `editor.on('transaction')` in the provider (add a minimal `useEffect` subscription in the provider — the old one was deleted in Task 3; re-add scoped to the overlay: `editor.on('transaction', bump)` where `bump` is `setRefreshKey(k => k+1)`), plus a `window.addEventListener('resize', bump)` in the overlay itself.
- Delete the Task 3 bridge portal (into `[data-node-view-content]`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run package/extensions/d-block/dblock-template-overlay.test.tsx && npx vitest run`
Expected: PASS; full suite green.

- [ ] **Step 5: Manual demo verification**

Empty new doc → template buttons appear under the first line; click one → template inserts (verify the existing `insertContentAt(pos + nodeSize - 4, …)` still lands correctly — it's untouched, but the overlay no longer occupies document flow); place caret in the buttons' area → caret can NOT enter them (they're outside `.ProseMirror`); type text → overlay disappears.

---

### Task 5: Full verification, version bump, PR notes

**Files:**
- Modify: `package.json` (version `4.3.2` → `4.4.0`)

- [ ] **Step 1: Full suite + typecheck + lint**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json && npm run lint --if-present`
Expected: all green.

- [ ] **Step 2: Full manual QA sweep in the demo app** (ticket-mapped)

The Task 3 Step 7 list, plus: list Enter/Backspace behavior unchanged (out of scope here — just no regressions), split view, focus mode, AI writer trigger (space in empty block), comments on text (decorations render), undo/redo across drag operations.

- [ ] **Step 3: Bump version and write PR notes**

`package.json` version → `4.4.0`. PR body must flag for the app team: (a) mobile text-column inset is now symmetric-ish (36px left for chevron / 16px right) — visual change; (b) drag/plus controls now float in the left margin; (c) new deps pinned exact at 3.11.0 with npm `overrides` guarding the Shai-Hulud package families — do not `npm update` while the attack is active.

---

## Self-review notes (kept for the record)

- Spec coverage: A (Task 3), B (Tasks 2+3), C verification (Tasks 3/5), template overlay (Task 4), dependency safety (Task 1), spec's "flagged risk" fallback (custom dragstart) intentionally not pre-built — YAGNI; Task 2 Step 7 surfaces whether it's needed.
- The old node view's `data-dblock-pos` stamping and `safeGetPos` position dataset are dropped (nothing reads them after the registry dies — verified via grep `dblockPos`).
- Type consistency: `ResolvedContentItem` matches `use-content-item-actions.tsx:9-13`; `DBlockRuntimeState` unchanged.
