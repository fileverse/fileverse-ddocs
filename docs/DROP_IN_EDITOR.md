# Drop-in editor v1 (TEC-3051)

Makes `DdocEditor` usable without owning the page: the parent decides its size, the host navbar and footer sit where the host puts them, and UI state is optional. The compound-component split (TEC-2951) is not part of this.

## 1. Scope

In:

- §2 The editor fills its parent. No viewport arithmetic.
- §3 `renderNavbar` stays, rendered in flow or portalled into a host element.
- §4 Every UI-state prop is optional, with plain-value change callbacks.

Out: collaboration config, separately exported pieces (toolbar, tabs, drawer as components), container-based responsive breakpoints, more than one editor per page (§7).

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
├─ #editor-canvas         flex-1 min-h-0 overflow-auto, [data-editor-scroll-container]
│  ├─ drawer anchor       sticky top-0 right-0, zero size (§2.5)
│  │  └─ CommentDrawer    absolute inside the anchor
│  └─ content wrapper     does not scroll
│     ├─ left rail        sticky top-0 → tabs sidebar / TOC
│     ├─ page
│     └─ right rail
└─ tab-panel slot         shrink-0, below 1280px (§2.4)
```

Today the navbar, both toolbars and the comment drawer are rendered inside `#editor-canvas` as `fixed` elements, and the canvas reserves their space with `mt-[calc(var(--navbar)+var(--toolbar))]`. The navbar and toolbars move above the canvas. `CommentStoreProvider` is hoisted to wrap the root's children so all of them stay inside it.

`.ddoc-editor-root` is a new editor-owned class on the root, for consumer CSS that used `#editor-canvas` as an ancestor of the toolbars (§6).

### 2.2 Scroll owner

- **Normal mode: `#editor-canvas` is the one document scroller.** Its scrollbar sits at the outer edge of the editor, under the toolbar.
- `data-editor-scroll-container` and `editorScrollContainerRef` move from the inner content wrapper onto `#editor-canvas`. `getEditorScrollContainer` returns the attributed element first without checking that it scrolls, so the attribute must be on the element whose `scrollTop` changes. Tab position restore, the caret scroll band, heading and comment navigation, and the floating comment layout all follow it.
- The inner content wrapper keeps no vertical scrolling. If it stays `overflow-auto` for horizontal overflow it is still a scroll container for `sticky` purposes (§8).
- **Split View: unchanged.** The right-pane wrapper scrolls, and the degraded scroll restore documented in `TAB_SCROLL_POSITION.md` is preserved, not fixed.
- First implementation step: confirm in the browser which element scrolls today, since the attribute currently sits on the inner wrapper.

### 2.3 Measured size instead of viewport units

A `ResizeObserver` on `#editor-canvas` publishes `--ddoc-canvas-h` and `--ddoc-canvas-w` (px) on the root. Every remaining `100vh` / `100dvh` / `100vw` in editor chrome becomes a `calc()` on these, with the navbar and toolbar allowance removed from the constant.

- Tabs sidebar `max-height` and the landscape clamp `calc((100vw - 1190px) / 2)`.
- Comment drawer and comment section heights.
- `shouldHideRight`, which compares the scaled page width with `window.innerWidth`, reads the observed canvas width from state.

This gives the drawer and comment section a definite height without a height chain through the unsized wrappers inside `@fileverse/ui`'s `DynamicDrawerV2`.

### 2.4 Mobile tab panel

Below 1280px the collapsed panel covers the bottom of the scroller. TEC-2947 fixed drag autoscroll by ending the scroller above it (`bottomInset`), because the browser's autoscroll belt is the scroller's physical bottom edge; `scroll-padding` does not shorten the box and is not a substitute.

- The root renders a tab-panel slot as a full-width `shrink-0` row under `#editor-canvas`. `DocumentMobileTabPanel` portals into it. The slot's in-flow height is the collapsed panel's height, so the canvas ends above the panel by construction.
- Expanded, the panel content is `absolute bottom-0` inside the slot and grows upward over the canvas. The reserved height does not change.
- No `bottom` offset: the host footer is outside the box. The `env(safe-area-inset-bottom)` term moves to the host footer (§6).

### 2.5 Comment drawer

- The canvas has a drawer anchor: an editor-owned element, `sticky top-0 right-0`, zero width and height. Sticky keeps it in place while the canvas scrolls in either direction; zero size keeps it out of the flow so the page does not shift.
- `CommentDrawer` renders inside the anchor. `DynamicDrawerV2` sets `fixed` internally; the override goes through its `className` with `!absolute`, positioned from the anchor.
- The drawer floats just inside the canvas scrollbar, which runs the full canvas height.
- Height: `calc(var(--ddoc-canvas-h) - <margins>)`. The comment section inside keeps scrolling its own list, with its height from the same variable minus the drawer header and filter row.
- Presentation mode keeps its current viewport-level drawer branch.

### 2.6 Shared components: preview and version history

`DocumentOutline`, `DocumentTabsSidebar` and `DocumentMobileTabPanel` are also rendered by `PreviewDdocEditor` and in version-history mode, which have no canvas structure.

- They take an internal `layout: 'viewport' | 'contained'` prop, default `'viewport'`. Only `DdocEditor` passes `'contained'`.
- `'viewport'` keeps today's classes exactly: `fixed`, the `100vh` heights, `--version-sheet-bottom`, the `tabSectionContainer` portal.
- `'contained'` applies §2.3 and §2.4.
- The prop is not part of `DdocProps`.

### 2.7 What is deleted

- The root `height: calc(100dvh - …)` and the `--navbar` / `--toolbar` custom properties.
- The canvas top margins that reserved room for the fixed bars.
- `bottomInset`, `footerInset`, `mobileTabPanelInset`, `focusHeight`, and the `minHeight: calc(100dvh - …)` on `.editor-main-lane` (replaced by `min-h-full`).
- `h-[100dvh]` on the unsupported-schema screen (becomes `h-full`).

Stays viewport-level: presentation mode, fullscreen toolbar, mobile comment sheet, comment bubble card (floating-ui `fixed`, anchored to a selection), popovers, dialogs, emoji and colour pickers, print.

### 2.8 Invariants

- Under the root, in `'contained'` layout, nothing uses `vh`, `dvh`, `vw`, `w-screen` or `h-screen`, and no chrome is `position: fixed`, except the viewport-level overlays in §2.7.
- One document scroller in normal mode, `#editor-canvas`, carrying `data-editor-scroll-container` (§2.2).
- `id="editor-canvas"`, `id="toolbar"` and `id="Navbar"` are kept.

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
- `set` accepts a value or an updater. The next value is computed from a ref holding the latest value, so several `set(prev => …)` calls before a render compose.
- `set` is a no-op when the next value equals the current one.
- Notifications run in `set` itself, never inside a React state updater (Strict Mode invokes updaters twice). Each real change calls `onChange(next)` once and the legacy setter once.
- A controlled prop changing from outside updates the ref and notifies nobody.
- A prop going from defined to `undefined` switches to internal state seeded with the last controlled value.

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
- `app/ddoc-editor-styles.css` scopes its `mobile:flex` / `mobile:hidden` corrections under `#editor-canvas`. The toolbars are no longer inside the canvas; retarget to `.ddoc-editor-root`. Update the fixture in `tests/e2e/unauth/dsheet-toolbar-order.spec.ts` to the new tree.
- The navbar keeps working through `renderNavbar` with no change.

**Demo** (`demo/src/App.tsx`): the same column; `DemoFooter` is `fixed bottom-0` and becomes an in-flow row.

`PreviewDdocEditor` call sites need no change (§2.6).

Optional, later: pass `navbarContainer`; replace `setX` props with the `onXChange` callbacks; replace the mirrored `set*Count` state with `onStatsChange`.

## 7. Gaps

- One editor per page. The preserved global ids and the `document.querySelector` fallbacks in `getEditorScrollContainer` are not instance-scoped. "Drop-in" does not mean instance isolation.
- Responsive breakpoints (`mobile` 960px, the 1280px tab-panel switch, `useResponsive`, `useMediaQuery`) read the window. An editor in a narrow container on a wide screen lays out as desktop.
- The mobile keyboard handling (`isKeyboardVisible`, `scrollIntoView` on resize) assumes the editor spans the visual viewport.
- Split View scroll restore stays degraded (§2.2).
- Print (`handle-print.ts`) builds its own document and is unaffected.

## 8. Gotchas

- `DynamicDrawerV2` exposes classes for its outer, header and content elements only. Anything deeper must be reached from an editor-owned selector in the package stylesheet. Confirm in the browser that `!absolute` wins over its `fixed`.
- `sticky` binds to the nearest ancestor with any non-visible overflow, on either axis. The left rail sits inside the inner content wrapper, which is `overflow-auto` today. If that wrapper is the nearer scroll container the rail sticks to it and not to the canvas. The sidebar must hold position while the canvas scrolls; if the wrapper's overflow prevents that, move horizontal overflow to the canvas.
- A sticky element occupies flow space, unlike `fixed`. The drawer anchor is zero-size for that reason.
- `handleFocusModeMouseDown` is on `#editor-canvas`. With the navbar and toolbars above the canvas it no longer sees their clicks. Both are hidden in focus mode, so nothing depends on it.
- A portalled navbar's events bubble by React ancestry to the root, not to the DOM element it is mounted in.
- TEC-2948 (caret scroll band) measures against the scroller's bottom edge; re-check the band now that the canvas ends above the tab-panel slot instead of using an inset.
- The ResizeObserver in §2.3 must not write state on every frame of a resize drag; set the custom properties directly on the root and keep only the `shouldHideRight` boolean in state.
- `package/styles/css-ownership.test.ts` must still pass; new layout rules belong on editor-owned selectors.
