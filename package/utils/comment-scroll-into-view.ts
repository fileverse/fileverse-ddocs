import type { MutableRefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { getCommentMarkRange } from '../extensions/comment';
import {
  CommentAnchor,
  getCommentAnchorRange,
  resolveCommentAnchorPointInState,
} from '../extensions/comment/comment-decoration-plugin';
import { getEditorScrollContainer } from './get-editor-scroll-container';

const MOBILE_COMMENT_DRAWER_SHEET_SELECTOR =
  '[data-mobile-comment-drawer-sheet]';
const EDITOR_COMMENT_LAYOUT_SELECTOR = '.editor-comment-layout';
const DEFAULT_VIEWPORT_PADDING = 24;
const MOBILE_DRAWER_CLEARANCE = 16;
export const MOBILE_COMMENT_DRAWER_CANVAS_OFFSET_VAR =
  '--mobile-comment-drawer-canvas-offset';

type CommentSelectionRange = {
  from: number;
  to: number;
};

const getCommentAnchorSelector = (commentId: string) => {
  const safeCommentId =
    typeof CSS !== 'undefined' && CSS.escape
      ? CSS.escape(commentId)
      : commentId.replace(/"/g, '\\"');

  return `[data-comment-id="${safeCommentId}"]`;
};

// No width check: the sheet is only rendered in the mobile comment layout,
// which follows the editor's width, not the window's.
const getMobileCommentDrawerSheetRect = () => {
  if (typeof window === 'undefined') {
    return null;
  }

  const drawerSheet = document.querySelector<HTMLElement>(
    MOBILE_COMMENT_DRAWER_SHEET_SELECTOR,
  );

  if (!drawerSheet) {
    return null;
  }

  const computedStyle = window.getComputedStyle(drawerSheet);

  if (
    computedStyle.display === 'none' ||
    computedStyle.visibility === 'hidden'
  ) {
    return null;
  }

  const drawerRect = drawerSheet.getBoundingClientRect();

  return drawerRect.height > 0 ? drawerRect : null;
};

const getEditorCommentLayout = (editorRoot?: HTMLElement | null) =>
  editorRoot?.closest<HTMLElement>(EDITOR_COMMENT_LAYOUT_SELECTOR) ??
  document.querySelector<HTMLElement>(EDITOR_COMMENT_LAYOUT_SELECTOR);

const setMobileCommentDrawerCanvasOffset = (
  offset: number,
  editorRoot?: HTMLElement | null,
) => {
  if (typeof document === 'undefined') {
    return;
  }

  const commentLayout = getEditorCommentLayout(editorRoot);

  if (!commentLayout) {
    return;
  }

  commentLayout.style.setProperty(
    MOBILE_COMMENT_DRAWER_CANVAS_OFFSET_VAR,
    `${Math.min(0, Math.round(offset))}px`,
  );
};

export const clearMobileCommentDrawerCanvasOffset = (
  editorRoot?: HTMLElement | null,
) => {
  if (typeof document === 'undefined') {
    return;
  }

  getEditorCommentLayout(editorRoot)?.style.removeProperty(
    MOBILE_COMMENT_DRAWER_CANVAS_OFFSET_VAR,
  );
};

export const resolveCommentSelectionRange = ({
  editor,
  commentId,
  commentAnchorsRef,
}: {
  editor: Editor;
  commentId: string;
  commentAnchorsRef?: MutableRefObject<CommentAnchor[]>;
}): CommentSelectionRange | null => {
  const anchor = commentAnchorsRef?.current.find(
    (entry) => entry.id === commentId && !entry.deleted,
  );
  const anchorRange =
    anchor && commentAnchorsRef
      ? getCommentAnchorRange(
          editor,
          commentId,
          () => commentAnchorsRef.current,
        )
      : null;

  if (anchorRange) {
    return anchorRange;
  }

  // Add suggestions are point anchors, so they do not resolve to a text range.
  // Return a collapsed selection at the anchor so click-to-focus can still
  // move the caret and scroll the editor to the suggestion location.
  if (anchor?.isSuggestion && anchor.suggestionType === 'add') {
    const point = resolveCommentAnchorPointInState(anchor, editor.state);

    if (point !== null) {
      return { from: point, to: point };
    }
  }

  // Legacy mark comments do not have decoration anchors, so prefer the full
  // mark range before falling back to a single DOM node position.
  const markRange = getCommentMarkRange(editor.state, commentId);

  if (markRange) {
    return markRange;
  }

  const commentElement = editor.view.dom.querySelector<HTMLElement>(
    getCommentAnchorSelector(commentId),
  );

  if (!commentElement) {
    return null;
  }

  const from = editor.view.posAtDOM(commentElement, 0);

  return {
    from,
    to: from + (commentElement.textContent?.length ?? 0),
  };
};

export const scrollCommentSelectionRangeIntoView = ({
  editor,
  selectionRange,
  behavior = 'smooth',
}: {
  editor: Editor;
  selectionRange: CommentSelectionRange;
  behavior?: ScrollBehavior;
}) => {
  if (!editor.view?.dom) {
    return;
  }

  const editorRoot = editor.view.dom as HTMLElement;
  const scrollContainer = getEditorScrollContainer({
    targetElement: editorRoot,
    editorRoot,
  });

  if (!scrollContainer) {
    return;
  }

  const mobileDrawerRect = getMobileCommentDrawerSheetRect();

  if (!mobileDrawerRect) {
    clearMobileCommentDrawerCanvasOffset(editorRoot);
    const containerRect = scrollContainer.getBoundingClientRect();
    const startRect = editor.view.coordsAtPos(selectionRange.from);
    const endRect = editor.view.coordsAtPos(
      Math.max(selectionRange.from, selectionRange.to - 1),
    );
    const targetTop = Math.min(startRect.top, endRect.top);
    const targetBottom = Math.max(startRect.bottom, endRect.bottom);
    const targetHeight = Math.max(1, targetBottom - targetTop);

    scrollContainer.scrollTo({
      top:
        scrollContainer.scrollTop +
        targetTop -
        containerRect.top -
        containerRect.height / 2 +
        targetHeight / 2,
      behavior,
    });
    return;
  }

  clearMobileCommentDrawerCanvasOffset(editorRoot);

  const containerRect = scrollContainer.getBoundingClientRect();
  const startRect = editor.view.coordsAtPos(selectionRange.from);
  const endRect = editor.view.coordsAtPos(
    Math.max(selectionRange.from, selectionRange.to - 1),
  );
  const targetTop = Math.min(startRect.top, endRect.top);
  const targetBottom = Math.max(startRect.bottom, endRect.bottom);
  const targetHeight = Math.max(1, targetBottom - targetTop);

  const visibleTop = containerRect.top + DEFAULT_VIEWPORT_PADDING;
  const visibleBottom = Math.min(
    containerRect.bottom - DEFAULT_VIEWPORT_PADDING,
    mobileDrawerRect.top - MOBILE_DRAWER_CLEARANCE,
  );
  const availableHeight = visibleBottom - visibleTop;

  if (availableHeight <= 1) {
    clearMobileCommentDrawerCanvasOffset(editorRoot);
    return;
  }

  let scrollDelta = 0;

  if (targetHeight >= availableHeight) {
    scrollDelta = targetTop - visibleTop;
  } else if (targetBottom > visibleBottom) {
    scrollDelta = targetBottom - visibleBottom;
  } else if (targetTop < visibleTop) {
    scrollDelta = targetTop - visibleTop;
  }

  if (Math.abs(scrollDelta) < 1) {
    clearMobileCommentDrawerCanvasOffset(editorRoot);
    return;
  }

  const previousScrollTop = scrollContainer.scrollTop;
  const nextScrollTop = Math.min(
    Math.max(0, previousScrollTop + scrollDelta),
    Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight),
  );
  const appliedScrollDelta = nextScrollTop - previousScrollTop;

  scrollContainer.scrollTo({
    top: nextScrollTop,
    behavior,
  });

  const adjustedTargetTop = targetTop - appliedScrollDelta;
  const adjustedTargetBottom = targetBottom - appliedScrollDelta;
  // Real scroll should absorb as much movement as possible. The translate
  // fallback only covers the leftover space that the drawer still obscures.
  const residualCanvasShift =
    targetHeight >= availableHeight
      ? Math.max(0, adjustedTargetTop - visibleTop)
      : Math.max(0, adjustedTargetBottom - visibleBottom);

  if (residualCanvasShift < 1) {
    clearMobileCommentDrawerCanvasOffset(editorRoot);
    return;
  }

  setMobileCommentDrawerCanvasOffset(-residualCanvasShift, editorRoot);
};
