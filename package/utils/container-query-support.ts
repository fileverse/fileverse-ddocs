let cached: boolean | null = null;

// Early container-query implementations make the container the containing
// block for position: fixed descendants, which would trap the editor's
// viewport-level overlays. See docs/DROP_IN_EDITOR.md §2.9.
export const canUseEditorContainerQueries = (): boolean => {
  if (cached !== null) return cached;
  if (
    typeof document === 'undefined' ||
    typeof CSS === 'undefined' ||
    !CSS.supports?.('container-type: inline-size')
  ) {
    return (cached = false);
  }

  const box = document.createElement('div');
  box.setAttribute('data-ddoc-cq-probe', '');
  box.style.cssText =
    'position:absolute;left:40px;top:40px;width:10px;height:10px;visibility:hidden;pointer-events:none;container-type:inline-size';
  const child = document.createElement('div');
  child.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px';
  box.appendChild(child);
  document.body.appendChild(box);
  // Trapped means the child sits at the box's origin, wherever the page is
  // scrolled; a box that happens to be at the viewport origin reads as trapped.
  const boxRect = box.getBoundingClientRect();
  const childRect = child.getBoundingClientRect();
  const escaped =
    Math.abs(childRect.left - boxRect.left) > 1 ||
    Math.abs(childRect.top - boxRect.top) > 1;
  box.remove();

  return (cached = escaped);
};
