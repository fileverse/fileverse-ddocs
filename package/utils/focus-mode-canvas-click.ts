// Floating UI that lives in the canvas but outside the editor content: the
// bubble menu is appended to #editor-canvas, dialogs and popovers are portals.
const FLOATING_UI_SELECTOR = [
  '[data-editor-bubble-menu]',
  '[data-radix-dialog-content]',
  '[role="dialog"]',
  '[data-modal]',
  '[data-overlay]',
  '[data-radix-popper-content-wrapper]',
  '[data-floating-ui-portal]',
].join(', ');

/** Whether a focus-mode mousedown landed on the bare canvas around the page. */
export const isFocusModeCanvasClick = (
  target: Element,
  editorContent: Element | null,
) => !editorContent?.contains(target) && !target.closest(FLOATING_UI_SELECTOR);
