type EditorLike = { view: { dom: HTMLElement } } | null | undefined;

/**
 * Drop the DOM selection that lives inside the editor (and blur it) so iOS /
 * Android dismiss their native edit menu and selection handles when a sheet
 * takes over the screen. ProseMirror ignores `selectionchange` while the view
 * is unfocused, so `state.selection` survives and commands issued from the
 * sheet still apply to the selected text.
 */
export const dismissNativeSelection = (editor: EditorLike) => {
  const dom = editor?.view?.dom;
  if (!dom) return;

  if (dom.contains(document.activeElement)) {
    (document.activeElement as HTMLElement | null)?.blur?.();
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const { anchorNode, focusNode } = selection;
  if (!anchorNode || !dom.contains(anchorNode)) return;
  if (focusNode && !dom.contains(focusNode)) return;
  selection.removeAllRanges();
};
