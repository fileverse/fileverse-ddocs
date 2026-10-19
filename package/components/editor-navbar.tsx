import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import cn from 'classnames';
import type { DdocProps } from '../types';

type EditorNavbarProps = {
  editor: Editor | null;
  renderNavbar?: DdocProps['renderNavbar'];
  /** undefined: in flow. null: host element not attached yet, render nothing. */
  container?: HTMLElement | null;
  isHidden: boolean;
};

// Renders the host's navbar as given. In flow it sits in an unstyled row that
// only animates the collapse; a portalled navbar gets no element at all.
export const EditorNavbar = ({
  editor,
  renderNavbar,
  container,
  isHidden,
}: EditorNavbarProps) => {
  if (!renderNavbar || !editor || container === null) return null;

  const navbar = renderNavbar({
    get editor() {
      return editor.getJSON();
    },
    liveEditor: editor,
  });

  if (container) return isHidden ? null : createPortal(navbar, container);

  return (
    <div
      className={cn('ddoc-navbar-row', isHidden && 'ddoc-navbar-row--hidden')}
    >
      {navbar}
    </div>
  );
};
