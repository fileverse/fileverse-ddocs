import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import type { DdocProps } from '../types';

type EditorNavbarProps = {
  editor: Editor | null;
  renderNavbar?: DdocProps['renderNavbar'];
  /** undefined: in flow. null: host element not attached yet, render nothing. */
  container?: HTMLElement | null;
  isHidden: boolean;
};

// Renders the host's navbar as given: no wrapper element, no styling.
export const EditorNavbar = ({
  editor,
  renderNavbar,
  container,
  isHidden,
}: EditorNavbarProps) => {
  if (!renderNavbar || !editor || container === null || isHidden) return null;

  const navbar = renderNavbar({
    get editor() {
      return editor.getJSON();
    },
    liveEditor: editor,
  });

  return container ? createPortal(navbar, container) : navbar;
};
