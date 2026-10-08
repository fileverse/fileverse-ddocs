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

export const EditorNavbar = ({
  editor,
  renderNavbar,
  container,
  isHidden,
}: EditorNavbarProps) => {
  if (!renderNavbar || container === null) return null;

  const nav = (
    <nav
      id="Navbar"
      onKeyDown={(e) => {
        // Escape returns focus to the editor, as the formatting toolbar does.
        if (e.key === 'Escape' && editor) {
          e.preventDefault();
          editor.commands.focus();
        }
      }}
      className={cn(
        'color-bg-default p-2 flex gap-10 items-center justify-between w-full shrink-0 border-b color-border-default z-[45]',
        isHidden && 'hidden',
      )}
    >
      {editor &&
        renderNavbar({
          get editor() {
            return editor.getJSON();
          },
          liveEditor: editor,
        })}
    </nav>
  );

  return container ? createPortal(nav, container) : nav;
};
