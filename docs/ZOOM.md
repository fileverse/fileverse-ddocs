# Zoom

Status: implemented on branch TEC-3271 (sub-issues TEC-3267, TEC-3270, TEC-3301, TEC-3302, TEC-2465). Architecture borrows from Edentext (`src/lib/utils/zoom.ts`, `Editor.svelte`): a CSS-transform page plus a box that reserves the scaled footprint, a fixed scroll anchor, and chrome that keeps its own size.

## 1. Model

- Zoom is `transform: scale(z)` on the page layer. Layout, wrapping, page count, print and export stay at 100%. Not CSS `zoom`: it changes what `getBoundingClientRect` returns, and that differs between browsers. ProseMirror's `coordsAtPos` / `posAtCoords` depend on those values.
- Presets only: Fit, 50%, 75%, 100%, 125%, 150%, 200%. The value stays a string on the public API: `'fit'`, `'0.5'`, `'0.75'`, `'1'`, `'1.25'`, `'1.5'`, `'2'`.
- Legacy and bad values: `'1.4'` (the old hard-coded Fit) reads as `'fit'`. Empty or unknown strings read as `'1'`. Normalisation happens at read time; the consumer's stored value is never rewritten.
- Fit is the largest scale at which the page fits the canvas next to the floating comments, as in Google Docs: `(canvasWidth - leftRail - commentColumn - 2 * gutter) / baseWidth`, clamped to `[0.5, 2]`, rounded to 2 decimals and not snapped to a preset. `gutter` is 24px. `leftRail` is 181px while the outline renders: the rail's min-content (148px outline + `px-4`), since the flexible rail cannot shrink below it. *(The clamp, the gutter and the no-snap rule are design calls.)*
- `commentColumn` is the floating-comment slot beside the page: the `12px` slot gap + `FLOATING_CARD_WIDTH` (300px) + `FLOATING_COMMENT_RIGHT_SPACE` (48px) = 360px. The cards live outside the scaled layer, so the column does not scale. It counts only while floating comments are showing: the container renders (`shouldRender`) and is not hidden (drawer open or inline comments disabled). It is not mounted in focus mode. Otherwise it is `0`.
- At Fit, `.editor-comment-layout` gets `margin-right: gutter + commentColumn` (the column only while it shows). The flexible left rail absorbs all slack, so this margin is what keeps the right gutter and keeps the cards in view. Other presets keep today's layout: at 150% and 200% the column can sit past the canvas edge. *(Design call.)*
- Fit recomputes when the canvas resizes (`use-canvas-metrics.ts` already observes it), on orientation change, and when the comment column appears or disappears. That last case means adding the first comment re-zooms, as in Google Docs. The scroll anchor (§4) keeps the reading position.
- No zoom on mobile and none in Split View (both already render unscaled). Shortcuts do nothing there.

## 2. Keyboard shortcuts

- `Mod+=` goes to the next preset and `Mod+-` to the previous one. They step through the percentage presets only and never land on Fit. From Fit, the step goes to the nearest preset above or below the computed Fit scale. At either end of the list the shortcut does nothing (no wrap-around). *(Design call.)*
- `Mod+=` and `Mod+-` always zoom the editor, wherever focus is, while a zoomable `DdocEditor` is mounted. They are bound on `window` (keydown) and `preventDefault` stops browser zoom.
- Matched on `event.key` exactly `'='` or `'-'` with Shift up. `Mod++` (Shift+`=`) and `Mod+_` (Shift+`-`) are left to the browser, as is `Mod+0`.
- When the editor cannot zoom (mobile, Split View) or is presenting, nothing is bound and the browser handles every key.
- The listener uses the capture phase, so editor keymaps cannot swallow the shortcut.
- Not a ProseMirror keymap: zoom must also work when focus is in the toolbar, the rail or outside the editor.

## 3. Layout: the page box (fixes TEC-3267)

The cause, confirmed in the demo at 150%: the canvas colour sits on `#editor-wrapper`, whose height is the unscaled content height (3968px). The scaled layer is `height: 66.67%` with a transform, so the content reaches 5952px and the colour stops two-thirds of the way down. Below 100% the reverse happens: the wrapper is taller than the content and leaves a blank tail.

- `#editor-wrapper` becomes the page box. It is the scaled footprint in both directions, `width = baseWidth * z` and `height = contentHeight * z`, and it carries the canvas and page background.
- Inside it, the scaled layer is `width: baseWidth`, `transform: scale(z)`, `transform-origin: top left`, with no percentage height.
- `contentHeight` comes from a `ResizeObserver` on the scaled layer (`offsetHeight` is unscaled). It is written straight to the wrapper's style, the way `use-canvas-metrics.ts` writes `--ddoc-canvas-*`, so typing does not re-render React. `min-height` keeps the canvas height as now.
- Remove the `zoomLevel === '1.4' || '1.5'` `color-bg-default` special case; the page box makes it unnecessary.

## 4. Scroll anchor

- When zoom changes, the document point at the top edge of the visible canvas stays at that screen position.
- Before the new scale applies, record `docY = (canvasRect.top - layerRect.top) / oldZ`. After the commit, in a layout effect, set `scrollTop` so that `layerRect.top + docY * newZ` equals the old screen y.
- Horizontally, when the page overflows, keep the page's left edge fixed. When it fits, it stays centred and nothing is written.
- In Split View the scroller is `contentWrapperRef`, not the canvas, but Split View is unscaled, so the anchor never runs there.

## 5. Chrome stays its own size (fixes TEC-3301)

Rule: UI chrome (block controls, bubble menu, floating toolbars) renders at its 100% size at every zoom and lines up with the scaled content it belongs to.

- **Drag handle cause, confirmed:** Tiptap's `DragHandle` puts `.drag-handle` inside a zero-size `position: absolute` wrapper within the scaled layer. Floating-ui finds the offset parent's scale as `rect.width / offsetWidth`, which falls back to 1 for a zero-width element. It therefore writes viewport-pixel `top`/`left`, and the transform scales them again. At 150% the handle sat 97px below its block, and it renders 1.5× too big.
- **Drag handle fix:** `COMPUTE_POSITION_CONFIG` carries `platform: zoomAwarePlatform` (`extensions/d-block/zoom-platform.ts`), a module constant, so the config keeps its identity. Overriding `getScale` alone is not enough: floating-ui measures the offset parent's scale with an internal helper in `getElementRects` and uses `platform.getScale` only for overflow clipping. So `zoomAwarePlatform` overrides both. Inside the layer, `getElementRects` divides the reference rect by `zoom / measuredScale`, which is a no-op if floating-ui ever measures the zoom itself.
- **Cluster size:** `handleNodeChange` already writes the cluster's `transform` (the first-line offset), so the counter-scale goes into the same write: `getClusterTransform(lineHeight, z)` gives `translateY(offset) scale(1/z)` with `transform-origin: top right`, where the offset centres a `24/z` (layer units) cluster on the first line. A zoom change while hovering re-applies it.
- **Bubble menu:** counter-scaled (`counterScaleStyle`) only below 1280px, where it mounts inside the layer. At 1280px and wider it is appended to the unscaled `#editor-canvas` and has no transform (seen in the browser: 46×625 at 100% and 200%).
- **Audit:** slash, emoji and table-cell menus mount on `body`, and the comment bubble card on `#editor-canvas`, so they are unscaled. Caret scroll band, sync cursors and the page-break node view work in content or screen space. Floating comment cards line up with their anchors. The columns menu mounts inside the layer and is counter-scaled. Media resize divides the pointer delta by the zoom (`toLayoutDelta`).

## 6. Left rail (fixes TEC-3302)

- When `scaledWidth > canvasWidth - leftWidth`, the canvas scrolls sideways. The rail is `sticky top-0` only, so it scrolls away with the page.
- Make the rail `sticky left-0` as well, with its existing `z-[2]`, so the page slides under it. Its background is the canvas's (`color-bg-secondary`, or `color-bg-default` when presenting, plus `documentStyling.background` outside focus mode). While the canvas scrolls sideways it also takes `min-height: var(--ddoc-canvas-h)`, so it covers the whole visible column and not only its content. The rail stays inside the scroller, so the scrollbar stays at the container edge (layout contract in `AGENTS.md`).
- The right rail already hides through `shouldHideRight`.

## 7. State plumbing (TEC-2465, revised)

- Zoom state already goes through `useControllableState` in `ddoc-editor.tsx`. What remains is the prop drilling and the `zoom-service.ts` singleton.
- Add a `ZoomContext` provided in `ddoc-editor.tsx`: `{ zoomLevel, scale, setZoomLevel, stepZoom }`. `scale` is the resolved number, and for Fit it is the computed scale. The toolbar dropdown, fullscreen toolbar, bubble menu, drag handle and shortcuts read from it. *(Design call: a React context, not the per-instance zustand store the ticket proposed. The state lives in one hook, and the value only changes on a zoom change, which is when every consumer needs it.)*
- Delete `zoom-service.ts` and its effect in `use-tab-editor.tsx`. It moved `.template-buttons` with `-translate-x-[300%]` at 200% through DOM class changes. Without it the empty-document chips stay at the page's top right and scale with the page, so at 200% on a canvas narrower than the page they need a sideways scroll, like the page's right half. *(Design call; the alternative is anchoring them after the placeholder.)*
- Public API unchanged: `zoomLevel`, `onZoomLevelChange`, and the deprecated `setZoomLevel`.

## 8. Pages mode (TEC-3006)

Pages mode (Linear tech spec "Pages mode: tech spec") builds on this zoom and must not need it reworked. What it relies on, and what this design guarantees:

- **Transform, unscaled layout.** Pagination measures `offsetTop` / `offsetHeight` (unscaled) and divides client rects and `posAtCoords` input by the scale. Zoom stays `transform: scale()` on one layer; never CSS `zoom`.
- **`baseWidth` is an input.** Pages swaps it for the paper width (A4 794, Letter 816, landscape 1123 / 1056). Fit, the page box, the scroll anchor and the rail decisions all take `baseWidth`; nothing in zoom code hard-codes 850 or 1190.
- **The scaled layer stays the one place for page content.** `PageSheets` renders inside it, behind ProseMirror, so sheets scale, anchor and scroll with the text.
- **Scale readable outside React.** The layer carries `data-ddoc-zoom-layer` and `data-ddoc-zoom="<scale>"`; `getZoomScale(node)` in `utils/zoom.ts` reads the closest layer (1 when none). The pagination plugin and the drag-handle platform both use it. React consumers (`PageSheets` windowing) use `useZoom()`. A pass on zoom change is Pages' own effect in `ddoc-editor.tsx`, keyed on `scale`.
- **Page box height comes from the layer's `offsetHeight`**, which includes spacers and the sheet stack's `min-height`, so the desk colour covers every sheet. The observer watches the layer and writes to the wrapper outside it, so it cannot loop with Pages' observer on the content children.
- **Background stays one style value on the wrapper** (`getCanvasStyle()`), so Pages can paint the desk there and the sheet fill on the sheets. No colour classes on the layer.
- **Breakpoints and Split View agree.** Zoom is off at 850px and below and in Split View; Pages is off below 1024px and in Split View.
- Fit produces non-preset scales (rounded to 2 decimals). Pages rounds spacer heights to whole pixels for fractional zoom, so this needs nothing extra; its QA matrix covers zoom 0.5 to 2, Fit included.

## 9. Non-goals

- Continuous zoom, Ctrl+wheel, pinch, a slider.
- Zoom on mobile or in Split View.
- Any change to print or export.
- Changes in ddocs.new (it persists the string as-is, so `'fit'` and `'1.25'` need nothing there).

## 10. Tests

- Unit: preset stepping (never onto Fit; from Fit; at the ends), legacy and empty normalisation, the Fit computation with and without the comment column, `getZoomScale` inside and outside the layer, and the shortcut handler (`=` / `-` zoom from any focus; Shift variants and `Mod+0` pass through).
- `layout-contract.test.ts`: the scaled layer has no percentage height, and the wrapper gets a scaled height.
- Manual QA in the demo, on both schemas, at every preset and at 1280px and wider: canvas colour to the end of the document, block controls aligned and normal size, bubble menu size, rail fixed during horizontal scroll, scroll position kept across zoom changes, shortcuts in and out of focus, and Fit with and without floating comments (adding the first comment re-fits, and the cards are not clipped).
