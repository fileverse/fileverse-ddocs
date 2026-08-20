import { Editor } from '@tiptap/core';
import { isUndoRedoSelection } from '../../extensions/undo-selection';

// Mobile selection handles can blur the editor while the native selection
// still belongs to the editor content. Detect that case from the DOM selection.
export const isSelectionInsideEditor = (editor: Editor) => {
  const selection = window.getSelection();
  const editorElement = editor.view?.dom;

  if (!selection || !editorElement) {
    return false;
  }

  return Boolean(
    selection.anchorNode &&
      selection.focusNode &&
      editorElement.contains(selection.anchorNode) &&
      editorElement.contains(selection.focusNode),
  );
};

const shouldShowBubbleMenu = (editor: Editor, ignoreFocus = false) => {
  if (!ignoreFocus && !editor.isFocused) {
    return false;
  }

  // Undo/redo re-selects the range it just changed so you can see what moved.
  // That is not a selection gesture, so it must not summon the toolbar; the
  // next click or keystroke clears the flag.
  if (isUndoRedoSelection(editor.state)) {
    return false;
  }

  const selection = window.getSelection();
  const commentCards = document.querySelectorAll('.comment-card');

  // Check if selection is within editor canvas and not in comment drawer
  if (selection) {
    for (const card of commentCards) {
      if (
        card.contains(selection.anchorNode) ||
        card.contains(selection.focusNode)
      ) {
        return false;
      }
    }
  }

  const { from, to, empty } = editor.state.selection;
  const isImageSelected = editor.isActive('image');
  const isCodeBlockSelected = editor.isActive('codeBlock');
  const isHorizontalRule = editor.isActive('horizontalRule');
  const ignoreList = [
    'resizableMedia',
    'iframe',
    'pageBreak',
    'aiWriter',
    'actionButton',
  ];

  if (ignoreList.includes(editor.state.doc.nodeAt(from)?.type.name ?? ''))
    return false;

  if (empty || isImageSelected || isCodeBlockSelected || isHorizontalRule) {
    return false;
  }

  let hasYellowHighlight = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.marks) {
      node.marks.forEach((mark) => {
        if (mark.type.name === 'highlight' && mark.attrs.color === 'yellow') {
          hasYellowHighlight = true;
        }
      });
    }
  });

  return !hasYellowHighlight;
};

export const shouldShow = ({ editor }: { editor: Editor }) => {
  return shouldShowBubbleMenu(editor);
};

// Reuse the normal bubble-menu guards, but skip only the editor-focus gate for
// the mobile native-selection fallback.
export const shouldShowIgnoringFocus = (editor: Editor) =>
  shouldShowBubbleMenu(editor, true);

/**
 * Whether the bubble menu should take itself out of the way.
 *
 * It floats at an inline `z-index: 61` while @fileverse/ui dialogs stack at
 * `z-50`, so a modal cannot paint over it — anything that owns the screen has
 * to hide the menu explicitly or it overlaps the dialog.
 */
export const isBubbleMenuHidden = ({
  isCommentOpen,
  isLinkPopupOpen,
  isBubbleMenuSuppressed,
  isCustomSpacingOpen,
}: {
  isCommentOpen: boolean;
  isLinkPopupOpen: boolean;
  isBubbleMenuSuppressed: boolean;
  isCustomSpacingOpen: boolean;
}) =>
  isCommentOpen ||
  isLinkPopupOpen ||
  isBubbleMenuSuppressed ||
  isCustomSpacingOpen;
