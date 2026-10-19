# Drop-in editor (TEC-3051, 7.0)

`DdocEditor` does not own the page: the parent decides its size, the host navbar and footer sit where the host puts them, and UI state is optional. The compound-component split (TEC-2951) is not part of this.

## 1. Scope

- §2 The editor fills its parent. No viewport arithmetic.
- §2.9 Responsive behaviour follows the editor's width, not the window's.
- §3 `renderNavbar` stays, rendered in flow or portalled into a host element.
- §4 Every UI-state prop is optional, with plain-value change callbacks.

Out: collaboration config, separately exported pieces (toolbar, tabs, drawer as components), more than one editor per page (§7).

The prop surface is additive, so consumer code compiles unchanged. The layout change in §2 is breaking at runtime, hence the major version and the consumer change in §6.

## 2. Layout contract

**Rule: `DdocEditor` is `width: 100%; height: 100%` of its parent, always.** The parent must have a definite height. There is no mode prop and no fallback to the viewport.

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
├─ .ddoc-navbar-row       unstyled collapse row around renderNavbar(); or createPortal → navbarContainer, no element (§3)
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

`CommentStoreProvider` wraps the root's children so the navbar, toolbars and canvas all sit inside it. `.ddoc-editor-root` is the editor-owned class for consumer CSS that used to reach the toolbars through `#editor-canvas` (§6).

### 2.2 Scroll owner

- In normal mode `#editor-canvas` is the one document scroller, so the scrollbar sits at the editor's outer edge, full width under the toolbar. Making the inner content wrapper the scroller was rejected because it moves the scrollbar inward; do not reopen this.
- `data-editor-scroll-container` and `editorScrollContainerRef` are on `#editor-canvas`. `getEditorScrollContainer` returns the attributed element without checking that it scrolls, so the attribute must be on the element whose `scrollTop` changes. Tab position restore, the caret scroll band, heading and comment navigation and the floating comment layout follow it.
- The canvas scrolls on both axes and the inner content wrapper is `overflow-visible`. Any non-visible overflow on it, even horizontal only, would make it the container the sticky left rail binds to (§8).
- **Split View:** the canvas is `overflow-hidden`, the right pane scrolls, and the attribute and ref stay on the inner content wrapper. That wrapper does not scroll, so scroll writes through the resolver are a no-op: the degraded restore in `TAB_SCROLL_POSITION.md` is preserved. The attribute must not sit on the canvas in this mode; an `overflow-hidden` box still accepts `scrollTop` writes.
- One element carries the attribute and the ref at a time; they switch with `isSplitViewActive`. Neither element remounts.

### 2.3 Measured size instead of viewport units

`hooks/use-canvas-metrics.ts` runs a `ResizeObserver` on `#editor-canvas` and publishes `--ddoc-canvas-h` and `--ddoc-canvas-w` (px) on the root. Editor chrome sizes from these instead of `100vh` / `100dvh` / `100vw`: the tabs sidebar `max-height` and landscape clamp, the comment drawer and comment section heights, and `.editor-main-lane`'s `min-height`.

- `shouldHideRight` (`scaledWidth + 296 > width`, hides the right rail in focus mode) and `shouldScroll` (`scaledWidth > width - leftWidth`, start-aligns the main lane) compare against the canvas `clientWidth`.
- The observer writes the custom properties straight onto the root and keeps the last width in a ref. React state holds only `{ shouldHideRight, shouldScroll }`, set only when one changes. The pair is recomputed in the observer callback and in a layout effect keyed on `scaledWidth` (zoom, orientation) and `leftWidth` (outline visibility). The first measurement runs in that layout effect, so the first paint is correct.
- This gives the drawer a definite height without a height chain through the unsized wrappers inside `@fileverse/ui`'s `DynamicDrawerV2`.

### 2.4 Mobile tab panel

Below 1280px the collapsed panel would cover the bottom of the scroller, and the browser's drag-autoscroll belt is the scroller's physical bottom edge (TEC-2947); `scroll-padding` does not shorten the box.

- The root renders a tab-panel slot as a full-width `shrink-0` row under `#editor-canvas`, 50px tall while the panel shows. `DocumentMobileTabPanel` portals into it, so the canvas ends above the panel by construction.
- The panel is `absolute bottom-0` inside the slot; expanded, it grows upward over the canvas without changing the reserved height.
- No `bottom` offset: the host footer is outside the box and carries `env(safe-area-inset-bottom)` itself (§6).

### 2.5 Comment drawer

- The drawer anchor (`.ddoc-drawer-anchor`) is `sticky top-0 left-0`, `width: 100%`, zero height, `flex: none`, `pointer-events: none` (children reset to `auto`), and the canvas's first direct child. The canvas is a flex column so the anchor gets its own line.
- Why this shape: a sticky inset only offsets an element from its flow position, so a zero-width anchor with `right-0` stays at the canvas's left edge and scrolls away horizontally. A full-width anchor pinned top-left always spans the visible width, so its right edge is the visible right edge. Sticky is confined to the containing block, so inside a wrapper it would stop at the wrapper's box. `width: 100%` excludes a classic scrollbar, so the drawer sits just inside it.
- `CommentDrawer` renders inside the anchor. `DynamicDrawerV2` is `fixed` internally; the override goes through its `className` with `!absolute`, `top` and `right` margins and `pointer-events: auto`. Zero height keeps opening the drawer from shifting the page.
- The anchor has `overflow-x: clip`. `DynamicDrawerV2` is always mounted and closes with `translate-x-full`; unclipped, the closed drawer widens the canvas's scrollable area. The `right` margin applies only while open, because the closed drawer must be at `right: 0` to translate fully out. `clip` on one axis does not make the anchor a scroll container.
- Height: `calc(var(--ddoc-canvas-h) - <margins>)`. The comment section scrolls its own list, sized from the same variable minus the header and filter row.
- Presentation mode keeps its viewport-level drawer branch. The anchor is a stacking context, so in presentation mode it gets `ddoc-drawer-anchor--presenting` (`z-index: 60`) to paint above the overlay (`z-50`).
- `SearchReplace` also renders inside the anchor so its `absolute right-0` popover anchor stays at the visible canvas's top-right. The popover content is portalled to the canvas, out of the anchor's clip and `pointer-events: none`.

### 2.6 Shared components: preview and version history

`DocumentOutline`, `DocumentTabsSidebar` and `DocumentMobileTabPanel` are also rendered by `PreviewDdocEditor` and version history, which have no canvas structure.

- They take an internal `layout: 'viewport' | 'contained'` prop, default `'viewport'`, not part of `DdocProps`. Only `DdocEditor` passes `'contained'`.
- `'viewport'` keeps the 5.x classes: `fixed`, `100vh` heights, `--version-sheet-bottom`, the `tabSectionContainer` portal. `'contained'` applies §2.3 and §2.4.

### 2.7 Viewport-level pieces

Stay viewport-level: presentation mode, fullscreen toolbar, mobile comment sheet, comment bubble card (floating-ui `fixed`, anchored to a selection), popovers, dialogs, emoji and colour pickers, print.

### 2.8 Invariants

- Under the root, in `'contained'` layout, nothing uses `vh`, `dvh`, `vw`, `w-screen` or `h-screen`, and no chrome is `position: fixed`, except the §2.7 pieces (`layout-contract.test.ts`).
- One document scroller in normal mode, `#editor-canvas`, carrying `data-editor-scroll-container` (§2.2).
- `id="editor-canvas"` and `id="toolbar"` are kept. `id="Navbar"` is gone (§3).

### 2.9 Responsive behaviour follows the editor

**Rule: inside the root, every breakpoint is evaluated against the root's width.** An editor in a 500px panel on a wide screen lays out as in a 500px window. Thresholds keep the 5.x values and inclusivity (`max-width: 1280px` is true at 1280); at full-window width nothing changes.

**CSS: container queries.** The root is a named query container (`container-type: inline-size; container-name: ddoc-editor`, set by `ddoc-editor-cq`, which the root gets only after the safety check below passes). The Tailwind preset adds `ddoc-sm:` `ddoc-md:` `ddoc-mobile:` `ddoc-lg:` `ddoc-xl:` (640, 768, 960, 1024, 1280px), `ddoc-max-*:` (registered widest first so the narrower wins) and arbitrary `ddoc-min-[Npx]:` / `ddoc-max-[Npx]:`, one `addVariant` call each, no extra plugin. Width `@media` rules in the package stylesheets have an `@container ddoc-editor (…)` twin, with the original scoped to `:where(:not(.ddoc-editor-cq *))`; `:where()` keeps the fallback at the plain screen variant's specificity. `(hover: none)` and print rules stay.

**JS: the observed width.** `useCanvasMetrics` also keeps the root's width in a store (`createEditorWidthStore`: get / set / subscribe), provided through `EditorWidthContext`. `useEditorMediaQuery` takes `useMediaQuery`'s query strings (`min-width` / `max-width` in px), reads the store and re-renders only when its result flips. `useResponsive` is built on it. The store is filled in the §2.3 layout effect, so JS-driven branches do not flash their narrowest layout.

**Outside a root, the window.** A container query with no matching container never applies, so each `ddoc-*` variant also emits the same `@media` query for elements with no `.ddoc-editor-cq` ancestor, and the hook without a provider uses `matchMedia`. `PreviewDdocEditor`, version history, a portalled navbar and anything portalled to `<body>` follow the window.

- Viewport-level pieces (§2.7) keep screen variants and `useMediaQuery`.
- Presentation mode's overlay is a DOM descendant of the root. Under `.ddoc-editor-cq` the overlay (`.ddoc-presentation-overlay`) is itself a `ddoc-editor` container (window-wide, nearest wins), and `PresentationMode` gets a null `EditorWidthContext` so its hooks read the window.
- An element portalled to `<body>` cannot see the container. Where a component can render in such a portal (the no-tabs mobile outline drawer), its mobile/desktop classes are chosen from the JS result, not a CSS variant.
- A container cannot query itself: `ddoc-*` variants work on the root's descendants, not the root.
- CSS switches in the resize frame; the JS hook switches after the observer callback and a render, so a JS-driven branch can lag CSS by a frame during a drag.
- `isNativeMobile` also reads the OS (`platform`); that part is not width.

**Safety check** (`utils/container-query-support.ts`). Early container-query implementations applied layout containment, which traps `position: fixed` descendants (presentation mode, fullscreen toolbar, mobile sheets) inside the container. Once per page, before first paint, the package appends a hidden offset box with `container-type: inline-size` and a `position: fixed; left: 0; top: 0` child to `<body>`, and compares the child's rect with the box's. If the child escapes, the root gets `ddoc-editor-cq`. If it sits at the box's origin, or `CSS.supports('container-type: inline-size')` is false, the root gets no class, the `@media` forms apply, the width store stays empty and the hook answers from the window, i.e. 5.x behaviour. The result is cached. It uses a throwaway element because a root at the viewport origin cannot tell trapped from escaped. Portalling the fixed overlays to `<body>` was rejected for 7.0 (styles scoped under the root would stop reaching them); revisit if the check fails on a current browser.

## 3. Navbar

- `renderNavbar` is unchanged: same signature, called inside `CommentStoreProvider`.
- `navbarContainer?: HTMLElement | null`:
  - Passed: the navbar is portalled into that element. The host owns its position and size.
  - Omitted: the navbar is the first in-flow row of the root.
  - `null`: render nothing until the element exists. Never fall back to the in-flow row, which would flash.
- The host holds the element in state, not `ref.current`, which does not re-render when it attaches:

  ```tsx
  const [navbarEl, setNavbarEl] = useState<HTMLElement | null>(null);
  <div ref={setNavbarEl} />
  <DdocEditor navbarContainer={navbarEl} renderNavbar={renderNavbar} />
  ```

- Changing the target element, or switching between portalled and in-flow, remounts the navbar subtree.
- The editor renders exactly what `renderNavbar` returns, with no `<nav id="Navbar">`, styling or Escape handler; the host supplies those. In flow the output sits in `.ddoc-navbar-row`, an unstyled grid row (`grid-template-columns: minmax(0, 1fr)`, so a long title cannot widen it) that exists to animate the collapse, so `renderNavbar` should return one element.
- Visibility: hidden when `isNavbarVisible` is false, in focus mode and in presentation mode. In flow, hiding collapses `.ddoc-navbar-row` over 300ms (`grid-template-rows: minmax(0, 1fr) → minmax(0, 0fr)`; a bare `0fr` track stops at the navbar's padding and border), with the navbar pinned to the row's bottom so it slides up, plus an opacity fade, off under `prefers-reduced-motion`. The navbar stays mounted. A host can put `ddoc-navbar-row` / `ddoc-navbar-row--hidden` on its own element to get the same animation.
- A portalled navbar is hidden (unmounted) only in presentation mode. It stays in focus mode and when `isNavbarVisible` is false, because its element belongs to the host's layout; the host hides it from `onFocusModeChange` and `onNavbarVisibleChange`.
- `showNavbarToggle?: boolean`, default `true`. `false` removes the collapse chevron from both toolbars.

## 4. State

### 4.1 `useControllableState`

`useControllableState(value, defaultValue, onChange, legacySetter)` returns `[current, set]`. Controlled when `value !== undefined`.

- `set` accepts a value or an updater. Notifications run in `set` itself, never inside a React state updater (Strict Mode runs updaters twice). Each real change calls `onChange(next)` and the legacy setter once, with the plain value.
- Uncontrolled: a ref holds the latest internal value, so several `set(prev => …)` calls before a render compose. No-op when the next value equals the ref.
- Controlled: the prop is the only accepted value. `set` computes from the prop as last rendered; equal to the prop is a no-op, otherwise the host is notified. Two functional updates in one handler both compute from the same prop (no call site does this). A host that declines gets asked again on the next toggle; a host that accepts later changes the prop and nobody is notified.
- Controlled with neither callback: the value is fixed (e.g. `zoomLevel="1"` alone makes zoom inert).
- A prop going from defined to `undefined` falls back to internal state as it was; the last prop value is not carried over.

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

- `zoomLevel`, `setZoomLevel`, `isNavbarVisible`, `setIsNavbarVisible` and `isPreviewMode` are optional; `isPreviewMode` defaults to `false`. Never give a UI-state prop a default in the destructuring.
- `onFocusModeChange` also fires when uncontrolled. The Cmd+Shift+F and Escape shortcuts stay.

### 4.3 `onStatsChange`

`onStatsChange({ words, characters, selectedWords, pages })`, with `pages: number | null`, scoped to the active tab.

- Calculations run when `onStatsChange` or any legacy setter is present. Selected words update on selection, words and characters on the 500ms debounce, pages on the idle task after it.
- Snapshots are eventual: the callback fires with the latest value of all four fields whenever one changes. First emission is after the first debounce tick for a tab.
- Tab switch: `pages` becomes that tab's cached measurement, or `null` until one arrives. Request-id and active-editor guards drop late results from a previous tab or an unmounted editor.
- The callback is read through a ref, so an inline function does not restart the effect.

## 5. Deprecated props

Kept in `DdocProps` with `@deprecated`; none removed in 7.0.

- `footerHeight`: no-op. The host footer is outside the editor box.
- The six `setX` setters in §4.2 and the four `set*Count` setters in §4.3: still fire.
- `onFocusMode`: still fires on every change.

## 6. Consumer migration

The README's "Migrating from 6.x" is the consumer-facing list. In ddocs.new:

- Editor pages are a `h-[100dvh] w-full flex flex-col` column: the editor in a `flex-1 min-h-0` child, the footer as a `shrink-0` row after it, carrying the safe-area inset. The viewer footer is in flow on editor pages and absolute elsewhere (`inFlow`).
- `footerHeight` and the zoom-2 `editorCanvasClassNames` height override are gone.
- `app/ddoc-editor-styles.css` overrides for the toolbars are scoped to `.ddoc-editor-root` with `ddoc-mobile:*` class names (dSheet redefines `mobile:flex` / `mobile:hidden`).
- A mount that passes `zoomLevel` (or any UI-state value) must also pass its callback, or the state is fixed (§4.1).

The demo uses the same column with an in-flow `DemoFooter`. `PreviewDdocEditor` call sites need no change (§2.6).

## 7. Gaps

- One editor per page. The global ids and the `document.querySelector` fallbacks in `getEditorScrollContainer` are not instance-scoped.
- Breakpoints inside `@fileverse/ui` components still read the window.
- A narrow editor on a wide screen uses the mobile comment sheet, which is `fixed inset-0` to the viewport, not the editor box.
- The mobile keyboard handling (`isKeyboardVisible`, `scrollIntoView` on resize) assumes the editor spans the visual viewport.
- Split View scroll restore stays degraded (§2.2).
- Print (`handle-print.ts`) builds its own document and is unaffected.
- The tab-panel slot is a fixed 50px (§2.4), not measured; a taller collapsed panel would overlap the canvas's bottom edge.
- The width store holds the integer `clientWidth`, container queries use the fractional width, so a JS check and a CSS variant can disagree within 1px.
- `zoomService` reads the editor's width only when zoom is applied, so the template-button offset at zoom 2 can be stale after the editor crosses 1280px.
- Which Safari and Firefox versions trap fixed descendants in a container is not established; the §2.9 safety check covers them.

## 8. Gotchas

- `DynamicDrawerV2` exposes classes for its outer, header and content elements only. Anything deeper is reached from an editor-owned selector in the package stylesheet.
- `sticky` binds to the nearest ancestor with any non-visible overflow, on either axis. Do not put overflow on any element between the left rail and the canvas (§2.2).
- The drawer anchor must stay zero-height (sticky takes flow space), full width, unwrapped and the canvas's direct child (§2.5).
- Anything absolutely positioned inside the canvas that hangs past its right or bottom edge adds scrollable area; the anchor's `overflow-x: clip` contains the closed drawer.
- `handleFocusModeMouseDown` is on `#editor-canvas` and does not see navbar or toolbar clicks; both are hidden in focus mode.
- A portalled navbar's events bubble by React ancestry to the root, not to the DOM element it is mounted in.
- The ResizeObserver must not write React state on every frame of a resize; it sets the custom properties directly (§2.3).
- `package/styles/css-ownership.test.ts` must pass; layout rules belong on editor-owned selectors.
- A responsive class inside the root uses a `ddoc-*:` variant and a width check uses `useEditorMediaQuery`. A plain `md:`, `useMediaQuery`, `window.matchMedia` or `window.innerWidth` there silently follows the window. Non-React code reads the width of `closest('.ddoc-editor-cq')` with a window fallback (`zoom-service.ts`).
- On one element and property a screen variant always overrides a `ddoc-*` variant (plugin variants sort first). Do not mix the two for one property.
- The window fallback keys off `ddoc-editor-cq`, not `ddoc-editor-root`: a root that failed the safety check must still get the `@media` form. Do not set `container-type` on `.ddoc-editor-root` directly.
- `container-type: inline-size` means the root's width cannot depend on its content; do not make the root shrink-to-fit.
- The canvas's flex basis is `0px`, not `flex-1`'s `0%`. In a parent with no definite height a percentage basis is content-sized, and `--ddoc-canvas-h` feeds `.editor-main-lane`'s `min-height`, so the canvas would grow on every observer cycle.
- `editorScrollContainerRef` is `isSplitViewActive ? contentWrapperRef : canvasRef`. The ref object switches with the mode, which makes effects keyed on it re-bind; do not go back to one ref whose `.current` is reassigned.
- In landscape outside Split View the content wrapper has no `w-full`: stretch sizes it inside its 24px margins.
- `LinkPreviewCard` is rendered by its own `createRoot` on a `<body>` div: no context, follows the window.
- TEC-2948's caret scroll band measures against the scroller's bottom edge, which is now above the tab-panel slot.
