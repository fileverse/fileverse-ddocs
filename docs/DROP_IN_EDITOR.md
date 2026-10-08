# Drop-in editor v1 (TEC-3051)

Makes `DdocEditor` usable without owning the page: the parent decides its size, the host navbar and footer sit where the host puts them, and UI state is optional. The compound-component split (TEC-2951) is not part of this.

## 1. Scope

In:

- §2 The editor fills its parent. No viewport arithmetic.
- §2.9 Responsive behaviour follows the editor's width, not the window's.
- §3 `renderNavbar` stays, rendered in flow or portalled into a host element.
- §4 Every UI-state prop is optional, with plain-value change callbacks.

Out: collaboration config, separately exported pieces (toolbar, tabs, drawer as components), more than one editor per page (§7).

Compatibility: the prop surface is additive, so existing consumer code compiles unchanged. The layout change in §2 is breaking at runtime and ships as a major version with the consumer change in §6.

## 2. Layout contract

**Rule: `DdocEditor` is `width: 100%; height: 100%` of its parent, always.** The parent must have a definite height. There is no public mode prop and no fallback to the viewport.

### 2.1 Structure

```
┌─ host parent (host decides width × height) ───────────────────┐
│ ┌─ root · 100% × 100% · flex column · no scroll ────────────┐ │
│ │ NAVBAR row     renderNavbar()  (or portalled to the host) │ │
│ │ TOOLBAR row                                               │ │
│ │ ┌─ #editor-canvas · takes the rest · overflow: auto ──┬─┐ │ │
│ │ │ ┌sticky─┐  ┌───── page ─────┐  ┌sticky────────┐     │▲│ │ │
│ │ │ │ tabs/ │  │ content        │  │ comment      │     │█│ │ │
│ │ │ │ TOC   │  │ (scrolls)      │  │ drawer       │     │ │ │ │
│ │ │ └───────┘  │                │  └──────────────┘     │▼│ │ │
│ │ └─────────────────────────────────────────────────────┴─┘ │ │
│ │ TAB PANEL row  (below 1280px only)                        │ │
│ └───────────────────────────────────────────────────────────┘ │
│ host footer                                                   │
└───────────────────────────────────────────────────────────────┘
```

```
root  .ddoc-editor-root   h-full w-full flex flex-col overflow-hidden
├─ nav#Navbar             shrink-0, in flow, or createPortal → navbarContainer (§3)
├─ #toolbar / mobile      shrink-0, in flow
├─ #editor-canvas         flex: 1 1 0px, min-h-0, flex flex-col overflow-auto, [data-editor-scroll-container]
│  ├─ drawer anchor       sticky top-0 left-0, full width, zero height (§2.5)
│  │  └─ CommentDrawer    absolute, at the anchor's right edge
│  └─ content wrapper     overflow-visible, does not scroll
│     ├─ left rail        sticky top-0 → tabs sidebar / TOC
│     ├─ page
│     └─ right rail
└─ tab-panel slot         shrink-0, below 1280px (§2.4)
```

Today the navbar, both toolbars and the comment drawer are rendered inside `#editor-canvas` as `fixed` elements, and the canvas reserves their space with `mt-[calc(var(--navbar)+var(--toolbar))]`. The navbar and toolbars move above the canvas. `CommentStoreProvider` is hoisted to wrap the root's children so all of them stay inside it.

`.ddoc-editor-root` is a new editor-owned class on the root, for consumer CSS that used `#editor-canvas` as an ancestor of the toolbars (§6).

### 2.2 Scroll owner

- **Decided: in normal mode `#editor-canvas` is the one document scroller.** The reason is the scrollbar: it must sit at the outer edge of the editor, spanning the full width under the toolbar, not beside the page.
- Rejected: making the inner `data-editor-scroll-container` wrapper the scroller and the canvas a non-scrolling box. The attribute sits on that wrapper today, which makes it look like the scroller, and it would allow an `absolute` drawer; but it moves the scrollbar inward. Do not reopen this from the attribute's current position.
- In normal mode `data-editor-scroll-container` and `editorScrollContainerRef` move from the inner content wrapper onto `#editor-canvas`. `getEditorScrollContainer` returns the attributed element first without checking that it scrolls, so the attribute must be on the element whose `scrollTop` changes. Tab position restore, the caret scroll band, heading and comment navigation, and the floating comment layout all follow it.
- The canvas scrolls on both axes. In normal mode the inner content wrapper becomes `overflow-visible` (it is `overflow-auto` today). Any non-visible overflow on it, even horizontal only, would make it the scroll container that the sticky left rail binds to, and the rail would stop holding position (§8).
- **Split View: unchanged.** The canvas stays `overflow-hidden`, the right-pane wrapper scrolls, and the attribute and ref stay on the inner content wrapper, where they are today. That wrapper does not scroll, so scroll writes through the resolver remain a no-op: the degraded restore documented in `TAB_SCROLL_POSITION.md` is preserved, not fixed. The attribute must not sit on the canvas in this mode; an `overflow-hidden` box still accepts `scrollTop` writes, which would be a new behaviour, not the documented no-op.
- Only one element carries the attribute and the ref at a time; they switch with `isSplitViewActive`. Neither element remounts.
- Not yet measured: whether the inner wrapper is the element that scrolls today. This does not affect the decision above, only how much visibly changes.

### 2.3 Measured size instead of viewport units

A `ResizeObserver` on `#editor-canvas` publishes `--ddoc-canvas-h` and `--ddoc-canvas-w` (px) on the root. Every remaining `100vh` / `100dvh` / `100vw` in editor chrome becomes a `calc()` on these, with the navbar and toolbar allowance removed from the constant.

- Tabs sidebar `max-height` and the landscape clamp `calc((100vw - 1190px) / 2)`.
- Comment drawer and comment section heights.
- The two width decisions that read `window.innerWidth` today: `shouldHideRight` (`scaledWidth + 296 > width`, hides the right rail in focus mode) and `shouldScroll` (`scaledWidth > width - leftWidth`, switches the main lane from centred to start-aligned). Both compare against the observed canvas `clientWidth`.

The observer writes the custom properties straight onto the root and keeps the last width in a ref. React state holds only the pair `{ shouldHideRight, shouldScroll }`, and is set only when one of the two changes. The pair is recomputed from the ref in two places: the observer callback, and a layout effect keyed on the other inputs (`scaledWidth`, which covers zoom and orientation, and `leftWidth`, which covers outline visibility). The first measurement runs in that layout effect, so the first paint is already correct.

This gives the drawer and comment section a definite height without a height chain through the unsized wrappers inside `@fileverse/ui`'s `DynamicDrawerV2`.

### 2.4 Mobile tab panel

Below 1280px the collapsed panel covers the bottom of the scroller. TEC-2947 fixed drag autoscroll by ending the scroller above it (`bottomInset`), because the browser's autoscroll belt is the scroller's physical bottom edge; `scroll-padding` does not shorten the box and is not a substitute.

- The root renders a tab-panel slot as a full-width `shrink-0` row under `#editor-canvas`. `DocumentMobileTabPanel` portals into it. The slot's in-flow height is the collapsed panel's height, so the canvas ends above the panel by construction.
- Expanded, the panel content is `absolute bottom-0` inside the slot and grows upward over the canvas. The reserved height does not change.
- No `bottom` offset: the host footer is outside the box. The `env(safe-area-inset-bottom)` term moves to the host footer (§6).

### 2.5 Comment drawer

- The canvas has a drawer anchor: an editor-owned element, `sticky top-0 left-0`, `width: 100%`, zero height, `flex: none`, `pointer-events: none`. It is a direct child of the canvas and comes first. The canvas is a flex column in normal mode so the anchor gets its own line.
- Why this shape: a sticky inset only offsets an element from where it sits in the flow; it does not align it to an edge. A zero-width anchor with `right-0` therefore stays at the canvas's left edge and scrolls away horizontally (measured). A full-width anchor pinned at the top left always covers the visible width, so its right edge is the visible right edge.
- It must be a direct child of the canvas. Sticky is confined to the containing block; when that is the scroller itself the limit is the whole scrollable area, so the anchor holds at any scroll offset. Inside a wrapper it would stop at the wrapper's box.
- `width: 100%` is the canvas's content width, which excludes a classic scrollbar. The drawer therefore sits just inside the scrollbar with no measurement.
- `CommentDrawer` renders inside the anchor. `DynamicDrawerV2` sets `fixed` internally; the override goes through its `className` with `!absolute`, `top` and `right` margins from the anchor, and `pointer-events: auto`.
- Zero height keeps the anchor out of the flow, so opening the drawer does not shift the page.
- The anchor has `overflow-x: clip`. `DynamicDrawerV2` is always mounted and closes with `translate-x-full`, so the `right` margin is applied only while it is open; unclipped, the closed drawer hangs past the right edge and widens the canvas's scrollable area (measured: 640px to 960px). `clip` on one axis leaves the other visible and does not make the anchor a scroll container. `pointer-events: none` is inherited, so the anchor's children are reset to `auto`; the mobile comment sheet renders through the same component.
- Measured in headless Chrome (640px canvas offset by 32px, 1400×3000px content, 336px drawer, `right: 16px`): the drawer's right edge stayed 16px inside the visible content edge at scroll (0, 0), (240, 160), (380, 1000) and the maximum, with overlay and with classic scrollbars, in a block and in a flex-column canvas; content stayed at the canvas top. This is geometry only; the real drawer still needs the §10 check.
- Height: `calc(var(--ddoc-canvas-h) - <margins>)`. The comment section inside keeps scrolling its own list, with its height from the same variable minus the drawer header and filter row.
- Presentation mode keeps its current viewport-level drawer branch. The anchor is sticky, so it is a stacking context and the drawer's own `z-60` is scoped inside it; in presentation mode the anchor gets `ddoc-drawer-anchor--presenting` (`z-index: 60`) so the drawer paints above the presentation overlay (`z-50`).
- `SearchReplace` also renders inside the anchor. Its popover anchor is `absolute right-0`; as a plain child of the canvas it would scroll away with the document now that the canvas scrolls. The popover content is portalled to the canvas, so the anchor's `pointer-events: none` and clip do not reach it.

### 2.6 Shared components: preview and version history

`DocumentOutline`, `DocumentTabsSidebar` and `DocumentMobileTabPanel` are also rendered by `PreviewDdocEditor` and in version-history mode, which have no canvas structure.

- They take an internal `layout: 'viewport' | 'contained'` prop, default `'viewport'`. Only `DdocEditor` passes `'contained'`.
- `'viewport'` keeps today's classes exactly: `fixed`, the `100vh` heights, `--version-sheet-bottom`, the `tabSectionContainer` portal.
- `'contained'` applies §2.3 and §2.4.
- The prop is not part of `DdocProps`.

### 2.7 What is deleted

- The root `height: calc(100dvh - …)` and the `--navbar` / `--toolbar` custom properties.
- The canvas top margins that reserved room for the fixed bars.
- `bottomInset`, `footerInset`, `mobileTabPanelInset`, `focusHeight`, and the `minHeight: calc(100dvh - …)` on `.editor-main-lane` (replaced by `min-height: var(--ddoc-canvas-h)`; a percentage does not resolve through the auto-height wrappers above it).
- `h-[100dvh]` on the unsupported-schema screen (becomes `h-full`).

Stays viewport-level: presentation mode, fullscreen toolbar, mobile comment sheet, comment bubble card (floating-ui `fixed`, anchored to a selection), popovers, dialogs, emoji and colour pickers, print.

### 2.8 Invariants

- Under the root, in `'contained'` layout, nothing uses `vh`, `dvh`, `vw`, `w-screen` or `h-screen`, and no chrome is `position: fixed`, except the viewport-level overlays in §2.7.
- One document scroller in normal mode, `#editor-canvas`, carrying `data-editor-scroll-container` (§2.2).
- `id="editor-canvas"`, `id="toolbar"` and `id="Navbar"` are kept.

### 2.9 Responsive behaviour follows the editor

**Rule: inside the root, every breakpoint is evaluated against the root's width.** An editor in a 500px panel on a wide screen lays out as it would in a 500px window. Without this the fill-parent contract only works for full-width embeds.

Today three things read the window: `useMediaQuery` (23 calls in 16 files, thresholds from 480px to 1560px), `useResponsive` (12 files), and Tailwind screen variants in class names (`sm:` `md:` `lg:` `xl:` `mobile:` and their `max-` forms, about 70 uses in 16 files), plus about ten width `@media` rules in the package stylesheets.

**Mechanism: CSS container queries for class names, the observed width for JS.**

- CSS: the root is a named query container (`container-type: inline-size; container-name: ddoc-editor`, set by the class `ddoc-editor-cq`, which the root gets only after the safety check below passes). The Tailwind preset (`@fileverse-dev/ddoc/tailwind`) adds variants `ddoc-sm:` `ddoc-md:` `ddoc-mobile:` `ddoc-lg:` `ddoc-xl:` (640, 768, 960, 1024, 1280px) and `ddoc-max-*:`, each an `@container ddoc-editor (…)` rule, plus arbitrary-value `ddoc-min-[Npx]:` and `ddoc-max-[Npx]:` for the one-off thresholds (`toc.tsx`). The named `ddoc-max-*` variants are registered widest first so the narrower one wins, as with Tailwind's own `max-*`. Class names inside the root move from the screen variants to these. The variants are defined by the preset itself, with no extra Tailwind plugin, and consumers already use the preset, so they change nothing.
- JS: the observer from §2.3 also watches the root's width and keeps it in a small store (subscribe / get), provided through context from the root. `useEditorMediaQuery('(max-width: 1280px)')` takes the same query strings as `useMediaQuery`, supports `min-width` and `max-width` in px, and compares against the store. It re-renders only when its own result flips. `useResponsive` is built on it, so its 12 callers follow with no edit; the direct `useMediaQuery` calls inside the root change their import.
- Width `@media` rules in the package stylesheets that style editor chrome or content get an `@container ddoc-editor (…)` twin, and the original is scoped to `:where(:not(.ddoc-editor-cq *))`. `:where()` keeps the fallback at the specificity of the plain screen variant, so the cascade is the same with and without the class; the preset's fallback form uses it too. `(hover: none)` and print rules are not width rules and stay.

**Outside a root, everything falls back to the window.** A container query with no matching container never applies, so each `ddoc-*` variant has a second form: the same `@media` query on elements with no `.ddoc-editor-cq` ancestor. The hook without a provider uses `matchMedia`. So `PreviewDdocEditor`, version history, a portalled navbar and anything portalled to `<body>` behave exactly as today, and shared components need no `layout` branch for this. Both forms were generated with Tailwind 3.4.18 from one `addVariant` call per breakpoint.

**Viewport-level pieces keep the window** (§2.7): presentation mode and its preview panel, dialogs and modals (`utils-modal`, `confirm-delete-modal`), popovers. Their `useMediaQuery` calls and screen variants are left alone.

- Presentation mode's overlay is a DOM descendant of the root, so on its own its content CSS would follow the root's width. Under `.ddoc-editor-cq` the overlay (`.ddoc-presentation-overlay`) is itself a `ddoc-editor` container: it is window-wide and the nearest named container wins. `PresentationMode` is also wrapped in a null `EditorWidthContext` so its hooks read the window.
- An element portalled to `<body>` cannot see the container, so its `ddoc-*` classes use the window while a JS check made inside the root uses the editor. Where a component can render in such a portal (the no-tabs mobile outline drawer), its mobile/desktop classes are chosen from the JS result, not from a CSS variant.

- **Decided: CSS container queries**, on their browser support (above 95% on caniuse). Rejected: a `data-ddoc-bp` attribute written by the observer with attribute-selector variants.
- Risk with that decision: early container-query implementations applied layout containment, which makes the container the containing block for `position: fixed` descendants. Presentation mode, the fullscreen toolbar and the mobile sheets are fixed descendants of the root, so in such a browser they would be trapped inside the editor box (in ddocs.new too: presentation mode would leave the footer showing). Chrome 154 does not trap them (measured); which Safari and Firefox versions do is not established.
- **Safety check, so the worst case is today's behaviour.** Once per page, before the first paint, the package appends a hidden test element to `<body>`: a small offset box with `container-type: inline-size` holding a `position: fixed; left: 0; top: 0` child. The child's rect is compared with the box's, so page scroll does not matter. If the child is away from the box's origin, fixed descendants escape and the root gets `ddoc-editor-cq`. If it sits at the box's origin, or `CSS.supports('container-type: inline-size')` is false, the root does not get the class: nothing is a container, the `@media` form of every variant applies, the width store stays empty and the JS hook answers from the window. That browser then behaves exactly as it does today, breakpoints following the window. The result is cached for the page.
- The check uses a throwaway element, not the root, because a root that starts at the viewport origin cannot tell "trapped" from "escaped".
- Rejected for v1: portalling the fixed overlays to `<body>` so no ancestor can trap them. It also covers a host `transform` on an ancestor, but styles scoped under the root stop reaching the overlays. Revisit if the check fails on a current browser.
- A container cannot be queried by itself: `ddoc-*` variants work on the root's descendants, not on the root element.
- CSS switches in the same frame as the resize. The JS hook switches on the observer callback and a React render, so a JS-driven branch (mobile toolbar vs desktop, tab panel vs sidebar) can lag CSS by a frame during a drag. The first paint is correct: the store is filled in the §2.3 layout effect.
- Thresholds keep today's exact values and inclusivity (`max-width: 1280px` is true at 1280).
- At full-window width nothing changes: the root's width is the window's.
- `isNativeMobile` also reads the OS (`platform`); that part is not width and is unchanged.
- The narrow-width comment UI is a `fixed inset-0` sheet. In a narrow editor on a wide screen it covers the viewport, not the editor box. It stays viewport-level in v1 (§7).

## 3. Navbar

- `renderNavbar` is unchanged: same signature, still called by the package, still inside `CommentStoreProvider`.
- New prop `navbarContainer?: HTMLElement | null`.
  - Passed: the navbar is rendered with `createPortal` into that element. The host owns its position and size.
  - Omitted: the navbar is the first in-flow row of the root.
  - Passed as `null`: render nothing until the element exists. Do not fall back to the in-flow row, which would flash.
- The host must hold the element in state, not read `ref.current`, which does not re-render when it attaches:

  ```tsx
  const [navbarEl, setNavbarEl] = useState<HTMLElement | null>(null);
  <div ref={setNavbarEl} />
  <DdocEditor navbarContainer={navbarEl} renderNavbar={renderNavbar} />
  ```

- Changing the target element, or switching between portalled and in-flow, remounts the navbar subtree and loses its local state.
- The `<nav id="Navbar">` wrapper and its Escape-returns-focus-to-editor handler are kept in both cases. It loses `fixed`, `w-screen`, `top-0` and `h-[var(--navbar)]`; height comes from its content.
- Visibility: hidden when `isNavbarVisible` is false, in focus mode and in presentation mode, as today. Hiding collapses the row (no translate), because a translated in-flow row leaves a gap.

## 4. State

### 4.1 `useControllableState`

`useControllableState(value, defaultValue, onChange, legacySetter)` returns `[current, set]`.

- Controlled when `value !== undefined`; internal state otherwise.
- `set` accepts a value or an updater. Notifications run in `set` itself, never inside a React state updater (Strict Mode invokes updaters twice). Each real change calls `onChange(next)` once and the legacy setter once, both with the plain value.

Uncontrolled:

- A ref holds the latest internal value. `set` computes from it, writes it, and sets state, so several `set(prev => …)` calls before a render compose. It is a no-op when the next value equals the ref.

Controlled: the prop is the only accepted value. A request the host has not accepted is never treated as current.

- Two values are kept apart: the committed value (the prop, as last rendered) and a pending request (the last value asked for in the current batch, or none).
- `set` computes from the pending request if there is one, otherwise from the committed value. If the result equals that basis it is a no-op. Otherwise it becomes the pending request and the host is notified.
- A batch is one synchronous task. The pending request is cleared in a microtask queued by the first `set` of the batch, and on every commit of the component, whichever comes first. So several functional updates in one handler compose, and a later, separate action always starts from the prop.
- Host declines (no re-render, or a re-render with the same value): the request is dropped at the end of the task. The next toggle computes from the prop and asks again.
- Host accepts later: the prop changes, nobody is notified. A toggle made in between computed from the old prop and asked for the same value again.
- Controlled with neither callback: the value is fixed; `set` notifies nobody.
- A prop going from defined to `undefined` switches to internal state seeded with the last committed prop value, never a pending request.

### 4.2 States

| State | Value prop | New callback | Legacy notifier | Uncontrolled default |
|---|---|---|---|---|
| Zoom | `zoomLevel` | `onZoomLevelChange` | `setZoomLevel` | `'1'` |
| Navbar visible | `isNavbarVisible` | `onNavbarVisibleChange` | `setIsNavbarVisible` | `true` |
| TOC | `showTOC` | `onShowTOCChange` | `setShowTOC` | `false` |
| Comment drawer | `commentDrawerOpen` | `onCommentDrawerOpenChange` | `setCommentDrawerOpen` | `false` |
| Presentation | `isPresentationMode` | `onPresentationModeChange` | `setIsPresentationMode` | `false` |
| Split view | `isSplitView` | `onSplitViewChange` | `setIsSplitView` | `false` |
| Focus mode | `isFocusMode` | `onFocusModeChange` | `onFocusMode` | `false` |

- `zoomLevel`, `setZoomLevel`, `isNavbarVisible`, `setIsNavbarVisible` and `isPreviewMode` become optional. `isPreviewMode` defaults to `false`.
- Focus mode moves onto the shared hook. Two behaviours change from `useFocusMode` today: `onFocusModeChange` also fires when uncontrolled, and controlled-to-uncontrolled keeps the last value instead of resetting to `false`. The Cmd+Shift+F and Escape shortcuts stay.

### 4.3 `onStatsChange`

`onStatsChange({ words, characters, selectedWords, pages })`, with `pages: number | null`.

- Scope: the active tab, as the four setters are today.
- The calculations run when `onStatsChange` or any legacy setter is present. Scheduling is unchanged: selected words on selection events, words and characters on the 500ms debounce, pages on the idle task after it.
- Snapshots are eventual, not synchronized: the callback fires with the latest known value of all four fields whenever one changes, and not when none did.
- First emission: after the first debounce tick for a tab.
- Tab switch: `pages` becomes that tab's cached measurement, or `null` until one arrives. The existing request-id and active-editor guards drop a late result from a previous tab or an unmounted editor.
- The callback is read through a ref, so an inline function does not restart the effect.
- `setWordCount`, `setCharacterCount`, `setSelectedWordCount` and `setPageCount` keep firing.

## 5. Deprecated props

Kept in `DdocProps` with `@deprecated`, still functional unless noted:

- `footerHeight`: no-op. The host footer is outside the editor box.
- The six `setX` setters in §4.2 and the four `set*Count` setters in §4.3.
- `onFocusMode`: still fires on every change.

No prop is removed in this version.

## 6. Consumer migration

Required, in the same release as the major bump.

**ddocs.new**

- The editor page gets a definite-height column: `h-dvh flex flex-col`, with the editor in a `flex-1 min-h-0` child and the footer as a `shrink-0` row after it.
- `Footer` (`components/footer/footer.tsx`) is `absolute bottom-0` and is shared with the version-history screen. It needs an in-flow variant for the editor page, keeping its content-driven height and safe-area padding; version history keeps the absolute one. Wrapping it without this leaves it overlapping the editor.
- Remove `footerHeight`.
- Remove the zoom override `editorCanvasClassNames = '!h-[calc(100vh-24px)]'` at zoom `'2'`; it defeats the parent-height contract.
- `app/ddoc-editor-styles.css` scopes `mobile:flex` / `mobile:hidden` corrections under `#editor-canvas`, to undo dSheet's redefinition of those classes. The toolbars are no longer inside the canvas and their classes are now `ddoc-mobile:*` (§2.9), which dSheet does not define. Update the fixture in `tests/e2e/unauth/dsheet-toolbar-order.spec.ts` to the new tree and class names; delete the override if the spec passes without it, otherwise retarget it to `.ddoc-editor-root .ddoc-mobile\:*`.
- The navbar keeps working through `renderNavbar` with no change.

**Demo** (`demo/src/App.tsx`): the same column; `DemoFooter` is `fixed bottom-0` and becomes an in-flow row.

`PreviewDdocEditor` call sites need no change (§2.6).

Optional, later: pass `navbarContainer`; replace `setX` props with the `onXChange` callbacks; replace the mirrored `set*Count` state with `onStatsChange`.

## 7. Gaps

- One editor per page. The preserved global ids and the `document.querySelector` fallbacks in `getEditorScrollContainer` are not instance-scoped. "Drop-in" does not mean instance isolation.
- Breakpoints inside `@fileverse/ui` components still read the window; only the package's own classes and hooks follow the editor (§2.9).
- A narrow editor on a wide screen uses the mobile comment sheet, which is `fixed` to the viewport (§2.9). Containing it in the editor box is not in v1.
- The mobile keyboard handling (`isKeyboardVisible`, `scrollIntoView` on resize) assumes the editor spans the visual viewport.
- Split View scroll restore stays degraded (§2.2).
- Print (`handle-print.ts`) builds its own document and is unaffected.
- The tab-panel slot's height is a fixed 50px (§2.4), not measured; a taller collapsed panel would overlap the canvas's bottom edge.
- The width store holds the integer `clientWidth` while container queries use the fractional width, so a JS check and a CSS variant can disagree within 1px at a fractional editor width.
- `zoomService` reads the editor's width only when zoom is applied, not on resize, so the template-button offset at zoom 2 can be stale after the editor crosses 1280px (as it was for a window resize).

## 8. Gotchas

- `DynamicDrawerV2` exposes classes for its outer, header and content elements only. Anything deeper must be reached from an editor-owned selector in the package stylesheet. Confirm in the browser that `!absolute` wins over its `fixed`.
- `sticky` binds to the nearest ancestor with any non-visible overflow, on either axis. The left rail sits inside the inner content wrapper, which is why that wrapper is `overflow-visible` in normal mode (§2.2). Do not put overflow back on any element between the rail and the canvas.
- A sticky element occupies flow space, unlike `fixed`. The drawer anchor is zero-height for that reason.
- A sticky inset does not align an element to an edge, and sticky stops at the containing block. Both shaped the drawer anchor (§2.5); do not shrink it to zero width or wrap it.
- The drawer anchor spans the canvas above the content: keep it zero-height and `pointer-events: none`, with its children reset to `auto`.
- Anything absolutely positioned inside the canvas that hangs past its right or bottom edge adds scrollable area. The closed drawer does; the anchor's `overflow-x: clip` is what contains it (§2.5).
- `handleFocusModeMouseDown` is on `#editor-canvas`. With the navbar and toolbars above the canvas it no longer sees their clicks. Both are hidden in focus mode, so nothing depends on it.
- A portalled navbar's events bubble by React ancestry to the root, not to the DOM element it is mounted in.
- TEC-2948 (caret scroll band) measures against the scroller's bottom edge; re-check the band now that the canvas ends above the tab-panel slot instead of using an inset.
- The ResizeObserver in §2.3 must not write state on every frame of a resize drag; set the custom properties directly on the root and keep only the two width decisions in state (§2.3).
- `package/styles/css-ownership.test.ts` must still pass; new layout rules belong on editor-owned selectors.
- A new responsive class inside the root must use a `ddoc-*:` variant, and a new width check must use `useEditorMediaQuery`. A plain `md:` or `useMediaQuery` there silently follows the window again (§2.9).
- A direct `window.matchMedia` or `window.innerWidth` call inside the root is a window check too and needs the same treatment. Non-React code reads the width of `closest('.ddoc-editor-cq')` and falls back to the window without one (`zoom-service.ts`); a check that only guards an element rendered from a JS breakpoint can be dropped (`getMobileCommentDrawerSheetRect`).
- The canvas's flex basis is `0px`, not `flex-1`'s `0%`. In a parent with no definite height a percentage basis is content-sized, and `--ddoc-canvas-h` feeds `.editor-main-lane`'s `min-height`, so the canvas would grow on every observer cycle instead of collapsing.
- The closed comment drawer must be at `right: 0` of the anchor: it closes by translating its own width, so any `right` offset leaves that much of it inside the anchor's clip (§2.5).
- The width store must be filled before first paint (the same layout effect as §2.3), or JS-driven branches flash their narrowest layout.
- The window fallback keys off `ddoc-editor-cq`, not `ddoc-editor-root`: a root that failed the safety check must still get the `@media` form. Do not set `container-type` on `.ddoc-editor-root` directly.
- On one element and property a screen variant always overrides a `ddoc-*` variant (plugin variants sort first). Do not mix the two for one property; convert both.
- `LinkPreviewCard` is rendered by its own `createRoot` on a `<body>` div: it has no context and follows the window.
- `editorScrollContainerRef` is `isSplitViewActive ? contentWrapperRef : canvasRef`. The ref object switches with the mode, which is what makes effects keyed on it (the floating comment layout's scroll listener) re-bind; do not go back to one ref whose `.current` is reassigned.
- In landscape outside Split View the content wrapper has no `w-full`: stretch sizes it inside its 24px margins. `width: 100%` plus the margins would overflow the canvas.
- `container-type: inline-size` means the root's width cannot depend on its content. It never does (`w-full`); do not make the root shrink-to-fit.

## 9. Documentation

The lasting record of this revamp is the README and `AGENTS.md`, updated in the same release. This spec is a working document.

**README**

- Usage: the editor fills its parent, and the parent needs a definite height. A minimal mount with a sized wrapper, navbar and footer.
- A "Migrating from 5.x" section beside "Migrating from 4.x": the sized parent, the footer in flow, `footerHeight` no longer used, CSS that targeted `#editor-canvas` as a toolbar ancestor.
- UI/UX Props: `navbarContainer` with the callback-ref example from §3; the `onXChange` callbacks and `onStatsChange`; the `setX` and `set*Count` props marked deprecated; `zoomLevel`, `isNavbarVisible` and `isPreviewMode` shown as optional with their defaults.
- Sizing: the layout follows the editor's width (§2.9); nothing to configure.
- Known limits from §7: one editor per page, the viewport-level mobile comment sheet.

**AGENTS.md**

- Architecture: the layout contract (root fills the parent; navbar and toolbar rows; `#editor-canvas` is the scroller and carries `data-editor-scroll-container`; drawer anchor; tab-panel slot) and the rule that editor chrome uses no viewport units or `fixed`.
- The internal `layout` prop on the shared tab components, and that preview and version history stay on `'viewport'`.
- `useControllableState` as the way to add any new UI state prop.
- Responsive rules: `ddoc-*:` variants and `useEditorMediaQuery` inside the root, screen variants and `useMediaQuery` only for viewport-level overlays.
- The ddocs.new section: the sized column, the in-flow footer variant, `.ddoc-editor-root`.

## 10. Acceptance

| Area | Required evidence |
|---|---|
| Parent sizing | A short, offset host; host-only resize; content overflow confined to the canvas; no viewport fallback. |
| Navbar | Omitted renderer, inline renderer, `null` portal target, attached target, target replacement, visibility toggle, Escape focus return. |
| Modes | Normal, preview through `DdocEditor`, focus, presentation and Split View; toolbar visibility rules and mounted editor / node-view identity preserved across mode switches. |
| Width | A canvas-only resize updates the rail decision and the landscape clamp without a window resize. Shrink and grow the canvas across the page-fit threshold while staying on one side of the rail threshold: alignment switches between centred and start. Repeat after changing zoom and outline visibility. |
| Responsive | With the window at 1600px, narrow the host from 1400px to 400px: the tab sidebar becomes the tab panel at 1280px, the desktop toolbar becomes the mobile toolbar at 960px, the comment UI and block chrome switch at their thresholds, each exactly where a window of that width switches today. Widen again: all reverse. At full-window width every breakpoint matches `main`. Preview, version history, presentation mode and dialogs still follow the window. No narrow-layout flash on load. In Chrome, Safari and Firefox, presentation mode, the fullscreen toolbar and the mobile comment sheet still cover the viewport from an editor in a small box, whether or not the root has `ddoc-editor-cq`. With the safety check forced to fail, the editor follows the window as on `main`. |
| Bottom chrome | Editor bottom edge equals the footer's top edge in ddocs.new and the demo, including a non-zero safe-area inset and larger text; hiding the footer in focus mode returns the space; collapsed and expanded tab panel; caret visibility; native drag autoscroll near the canvas bottom with the panel collapsed, expanded, and collapsed again. |
| Scroll | Normal mode: tab restore, heading and comment navigation, caret navigation and floating comments all act on the element whose `scrollTop` changes. Split View: only the right pane scrolls; tab scroll restore is exempt (degraded as before, §2.2) and the canvas `scrollTop` stays 0. |
| Comment drawer | In a short host with long threads the header, filters, list and input stay reachable; scrolling the document does not move or resize the drawer; opening it does not shift the page; with a wide or zoomed page the drawer stays just inside the canvas's visible right edge and scrollbar at `scrollLeft` 0, midway and maximum, and after a host-only resize; repeat in Split View and presentation mode. |
| Shared components | Preview and version history keep tab access, the desktop tab portal, and the mobile `--version-sheet-bottom` offset. |
| State | For every row in §4.2: omitted props, controlled `false`, new callback alone, legacy setter alone, both, several functional updates in one handler, controlled-to-uncontrolled handoff; a host that declines a request (with and without a re-render) and a later toggle still derived from the prop; delayed acceptance; handoff after a declined request; controlled with no callback; one notification per change under Strict Mode; focus-mode shortcuts and `onFocusMode` retained. |
| Stats | With only `onStatsChange`, all four fields update on load, selection, edits and tab changes; a late page result from a previous tab or an unmounted editor cannot overwrite the snapshot; an inline callback causes no render loop. |
| Integration | At 200% zoom the canvas stays inside the editor's allocation; after dSheet-to-dDoc navigation exactly the intended toolbar shows on each side of 960px. |
| Package | Type check and build; state and scroll tests; `package/styles/css-ownership.test.ts`; browser QA for layout and scrolling. |
