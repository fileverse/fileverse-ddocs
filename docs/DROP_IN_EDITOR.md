# Drop-in editor v1 (TEC-3051)

Makes `DdocEditor` usable without owning the page: the parent decides its size, the host navbar and footer sit where the host puts them, and UI state is optional. The compound-component split (TEC-2951) is not part of this.

## 1. Scope

In:

- §2 The editor fills its parent. No viewport arithmetic.
- §3 `renderNavbar` stays, rendered in flow or portalled into a host element.
- §4 Every UI-state prop is optional, with plain-value change callbacks.

Out: collaboration config, separately exported pieces (toolbar, tabs, drawer as components), container-based responsive breakpoints.

Compatibility: the prop surface is additive, so existing consumer code compiles unchanged. The layout change in §2 is breaking at runtime and ships as a major version with the consumer change in §6.

## 2. Layout contract

**Rule: `DdocEditor` is `width: 100%; height: 100%` of its parent, always.** The parent must have a definite height. There is no mode prop and no fallback to the viewport.

### 2.1 Structure

```
root            h-full w-full flex flex-col relative overflow-hidden
├─ navbar row   in flow, shrink-0            (§3; absent when portalled or no renderNavbar)
├─ toolbar row  in flow, shrink-0            (desktop #toolbar or the mobile toolbar)
└─ #editor-canvas   flex-1 min-h-0, owns the scroll
```

Today the navbar, both toolbars and the comment drawer are rendered inside `#editor-canvas` as `fixed` elements, and the canvas reserves their space with `mt-[calc(var(--navbar)+var(--toolbar))]`. They move out of the scroller to be siblings above it. `CommentStoreProvider` is hoisted to wrap all three rows, so the navbar, toolbars and drawer stay inside it as they are today.

### 2.2 What is deleted

- The root `height: calc(100dvh - …)` and the `--navbar` / `--toolbar` custom properties.
- The canvas top margins that reserved room for the fixed bars.
- `bottomInset`, `footerInset`, `focusHeight`, and the `minHeight: calc(100dvh - …)` on `.editor-main-lane` (replaced by `min-h-full`).
- `h-[100dvh]` on the unsupported-schema screen (becomes `h-full`).

### 2.3 Chrome that does not scroll with the document

| Piece | Today | v1 |
|---|---|---|
| Desktop and mobile toolbar | `fixed left-0 top-[var(--navbar)]` | in-flow row (§2.1) |
| Tabs sidebar | already in a `sticky top-0` left rail; `max-h-[calc(100vh - …)]`, `top-[124px]` offsets | keep sticky; `max-height` from the canvas height; top offsets drop the navbar and toolbar allowance |
| Comment drawer (desktop) | `@fileverse/ui` `DynamicDrawerV2`, `fixed`, `h-[calc(98vh-140px)]`, `top-[7.25rem]` | sticky against the canvas, inside a zero-size sticky wrapper so it does not take flow space; height from the canvas |
| Comment section | `h-[calc(100dvh-292px)]` and variants | `h-full` of the drawer |
| Mobile tab panel | `fixed`, `bottom: calc(24px + env(safe-area-inset-bottom))` (24px is the ddocs.new footer) | sticky to the canvas bottom, `bottom: 0` |
| Comment bubble card | floating-ui `strategy: 'fixed'` | unchanged; it is anchored to a selection, not to the viewport |

Stays viewport-level: presentation mode, fullscreen toolbar, mobile comment sheet, popovers, dialogs, emoji and colour pickers, print.

### 2.4 Width

`shouldHideRight` compares the scaled page width with `window.innerWidth`. It reads the canvas width instead (a `ResizeObserver` on the canvas, the same element the scroll already lives on). The landscape sidebar clamp `calc((100vw - 1190px) / 2)` uses the canvas width the same way.

### 2.5 Invariants

- No element under the root uses `vh`, `dvh`, `vw`, `w-screen` or `h-screen`, except the viewport-level overlays listed in §2.3.
- No editor chrome is `position: fixed`, with the same exception.
- `#editor-canvas` remains the single scroll container (Split View keeps its own right-pane scroller). Tab position restore, the caret scroll band and drag autoscroll all key off it.
- `id="editor-canvas"`, `id="toolbar"` and `id="Navbar"` are kept; ddocs.new CSS and e2e specs select them.

## 3. Navbar

- `renderNavbar` is unchanged: same signature, still called by the package, still inside `CommentStoreProvider`.
- New prop `navbarContainer?: HTMLElement | null`.
  - Passed: the navbar is rendered with `createPortal` into that element. The host owns its position and size.
  - Omitted: the navbar is the first in-flow row of the root.
  - Passed as `null` (ref not attached yet): render nothing until the element exists. Do not fall back to the in-flow row, which would flash.
- The `<nav id="Navbar">` wrapper and its Escape-returns-focus-to-editor handler are kept in both cases. It loses `fixed`, `w-screen`, `top-0` and `h-[var(--navbar)]`; height comes from its content.
- Visibility: the row is hidden when `isNavbarVisible` is false, in focus mode and in presentation mode, as today. Hiding collapses the row (no translate), because a translated in-flow row leaves a gap.

## 4. State

One internal hook, `useControllableState(value, defaultValue, onChange, legacySetter)`: controlled when `value !== undefined`, internal state otherwise. It accepts updater functions, since internal call sites use `setX(prev => …)`. On change it calls `onChange(next)` and the deprecated setter, each at most once.

| State | Value prop | New callback | Deprecated setter | Uncontrolled default |
|---|---|---|---|---|
| Zoom | `zoomLevel` | `onZoomLevelChange` | `setZoomLevel` | `'1'` |
| Navbar visible | `isNavbarVisible` | `onNavbarVisibleChange` | `setIsNavbarVisible` | `true` |
| TOC | `showTOC` | `onShowTOCChange` | `setShowTOC` | `false` |
| Comment drawer | `commentDrawerOpen` | `onCommentDrawerOpenChange` | `setCommentDrawerOpen` | `false` |
| Presentation | `isPresentationMode` | `onPresentationModeChange` | `setIsPresentationMode` | `false` |
| Split view | `isSplitView` | `onSplitViewChange` | `setIsSplitView` | `false` |
| Focus mode | `isFocusMode` | `onFocusModeChange` | none | already in this shape |

- `zoomLevel`, `setZoomLevel`, `isNavbarVisible`, `setIsNavbarVisible` and `isPreviewMode` become optional. `isPreviewMode` defaults to `false`.
- New `onStatsChange({ words, characters, selectedWords, pages })`, fired when any of the four changes. `setWordCount`, `setCharacterCount`, `setSelectedWordCount` and `setPageCount` keep firing and are deprecated.
- A prop that goes from defined to `undefined` mid-life switches to internal state seeded with the last controlled value.

## 5. Deprecated props

Kept in `DdocProps` with `@deprecated`, still functional unless noted:

- `footerHeight`: no-op. The host footer is outside the editor box.
- The six `setX` setters and four `set*Count` setters in §4.
- `onFocusMode`: superseded by `onFocusModeChange`, still fires.

No prop is removed in this version.

## 6. Consumer migration

Required, in the same release as the major bump:

- **ddocs.new** (`components/ddoc-editor/ddoc-editor.tsx`): wrap `DdocEditor` in a sized flex column, editor in a `flex-1 min-h-0` child, `EditorFooter` after it. Remove `footerHeight`. Its navbar keeps working through `renderNavbar` with no change.
- **Demo** (`demo/src/App.tsx`): the same wrapper.
- `PreviewDdocEditor` is a separate component with its own layout and no viewport units; it is not touched.

Optional, later: pass `navbarContainer` to place the navbar in the host layout; replace `setX` props with the `onXChange` callbacks; drop the mirrored `set*Count` state for `onStatsChange`.

## 7. Gaps

- Responsive breakpoints (`mobile` 960px, the 1280px tab-panel switch, `useResponsive`, `useMediaQuery`) read the window. An editor in a narrow container on a wide screen lays out as desktop.
- The mobile keyboard handling (`isKeyboardVisible`, `scrollIntoView` on resize) assumes the editor spans the visual viewport.
- `--version-sheet-bottom` on the mobile tab panel is a ddocs.new-specific hook and stays as is.
- Print (`handle-print.ts`) builds its own document and is unaffected.

## 8. Gotchas

- `DynamicDrawerV2` sets `fixed` inside `@fileverse/ui`. Override the position from the `className` with `!`; do not fork the ui component for v1. Confirm in the browser that the override wins, since Tailwind class order decides ties.
- A sticky element occupies flow space, unlike `fixed`. Anything that overlays the page (comment drawer, mobile tab panel) needs the zero-size sticky wrapper or it shifts the content.
- `sticky` resolves against the nearest scrolling ancestor. In Split View that is the right-pane scroller, not `#editor-canvas`.
- TEC-2947 (drag autoscroll) was fixed by ending the scroller above the footer and the collapsed tab panel. With the footer outside the box the footer term goes away, but the tab panel still covers the scroller's bottom edge below 1280px; keep the scroll padding for it.
- TEC-2948 (caret scroll band) measures against the scroller's bottom edge; re-check the band once the bottom inset is gone.
- Events from a portalled navbar still bubble through the React tree to the editor root, so handlers on the root (`handleFocusModeMouseDown`) see navbar clicks. They did before as well, since the navbar was a DOM child.
- `package/styles/css-ownership.test.ts` must still pass; new layout rules belong on editor-owned selectors.
