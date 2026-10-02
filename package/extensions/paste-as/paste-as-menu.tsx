import { Button, LucideIcon } from '@fileverse/ui';
import { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useCallback, useRef } from 'react';
import {
  embedPasteAsCandidate,
  getPasteAsCandidate,
  type PasteAsCandidate,
} from './paste-as-candidate';

interface PasteAsMenuProps {
  editor: Editor;
}

const EMBED_OPTION: Record<
  PasteAsCandidate['kind'],
  { label: string; icon: 'GalleryVertical' | 'Image' }
> = {
  tweet: { label: 'Embed Tweet', icon: 'GalleryVertical' },
  image: { label: 'Image', icon: 'Image' },
};

/**
 * "Paste as" menu under a freshly pasted bare URL that could become an
 * embed (tweet or image, see getPasteAsCandidate): Enter embeds it, Esc or
 * clicking away keeps it as a plain link (TEC-2758). Focus stays in the
 * editor so continued typing just dismisses the menu; Arrow keys move
 * focus onto the buttons for anyone who wants to pick with the keyboard.
 */
export const PasteAsMenu = ({ editor }: PasteAsMenuProps) => {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const embedRef = useRef<HTMLDivElement>(null);

  const kind = useEditorState({
    editor,
    selector: ({ editor }) => getPasteAsCandidate(editor.state)?.kind ?? null,
  });

  // Shown while the paste is armed (see PasteAs); any edit or caret move
  // disarms it. No show-once flag: BubbleMenu re-runs this on every editor
  // focus event, and one always follows a paste in the app.
  const shouldShow = ({ editor }: { editor: Editor }) =>
    editor.isEditable && getPasteAsCandidate(editor.state) !== null;

  const handleKeepAsUrl = useCallback(() => {
    const endPos = editor.state.selection.to;
    const href = editor.getAttributes('link').href;
    editor.commands.extendMarkRange('link', { href });
    editor
      .chain()
      .focus()
      .setTextSelection(endPos) // Jump to end of link
      .unsetMark('link') // Ensure next char isn't linked
      .insertContent({ type: 'text', text: ' ' }) // Insert the "namespace" space
      .run();
  }, [editor]);

  const handleOutsideClick = useCallback(
    (e: MouseEvent) => {
      if (embedRef.current && embedRef.current.contains(e.target as Node))
        return;
      handleKeepAsUrl();
    },
    [handleKeepAsUrl],
  );

  const handleEmbed = useCallback(() => {
    const candidate = getPasteAsCandidate(editor.state);
    if (candidate) embedPasteAsCandidate(editor, candidate);
  }, [editor]);

  // Capture phase: Enter must not reach ProseMirror (it would split the
  // block before the embed replaces it). With a button focused, Enter and
  // Space are left to the button itself.
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const { key } = e;
      const currentIndex = btnRefs.current.findIndex(
        (btn) => btn === document.activeElement,
      );

      if (key === 'Enter' && currentIndex === -1) {
        e.preventDefault();
        e.stopPropagation();
        handleEmbed();
        return;
      }
      if (key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleKeepAsUrl();
        return;
      }
      if (key === 'ArrowDown' || key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        const count = btnRefs.current.length;
        const nextIndex =
          key === 'ArrowDown'
            ? (currentIndex + 1) % count
            : (Math.max(currentIndex, 0) - 1 + count) % count;
        btnRefs.current[nextIndex]?.focus();
      }
    },
    [handleEmbed, handleKeepAsUrl],
  );

  const option = EMBED_OPTION[kind ?? 'image'];
  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: 'bottom',
        onShow: () => {
          document.addEventListener('keydown', handleKeyDown, true);
          document.addEventListener('mousedown', handleOutsideClick);
        },
        onHide: () => {
          document.removeEventListener('keydown', handleKeyDown, true);
          document.removeEventListener('mousedown', handleOutsideClick);
        },
      }}
      shouldShow={shouldShow}
      className="p-2 border color-border-default shadow-elevation-3 color-bg-default rounded-lg"
    >
      <div className="flex flex-col gap-0.5" ref={embedRef}>
        <p className="text-helper-sm text-xs color-text-secondary p-2">
          Paste as
        </p>
        <Button
          variant={'ghost'}
          className="text-body-sm justify-start px-2 py-[5px] gap-0 focus-visible:bg-[hsl(var(--color-button-secondary-hover))] focus-visible:ring-0 focus-visible:ring-offset-0"
          onClick={handleEmbed}
          ref={(el) => (btnRefs.current[0] = el)}
        >
          <LucideIcon name={option.icon} className="size-4 mr-2" />
          <span className="mr-4">{option.label}</span>
          <span className="text-helper-sm text-xs color-text-secondary ml-auto">
            ⮐
          </span>
        </Button>
        <Button
          variant={'ghost'}
          className="text-body-sm justify-start px-2 py-[5px] gap-0 focus-visible:bg-[hsl(var(--color-button-secondary-hover))] focus-visible:ring-0 focus-visible:ring-offset-0"
          onClick={handleKeepAsUrl}
          ref={(el) => (btnRefs.current[1] = el)}
        >
          <LucideIcon name={'Link'} className="size-4 mr-2" />
          <span className="mr-4">URL</span>
          <span className="text-helper-sm text-xs color-text-secondary ml-auto">
            Esc
          </span>
        </Button>
      </div>
    </BubbleMenu>
  );
};
