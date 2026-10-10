import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  LucideIcon,
} from '@fileverse/ui';
import {
  useEditorCommands,
  type EditorCommandId,
} from '../hooks/use-editor-commands';
import { useEditingContext } from '../hooks/use-editing-context';

type MenuItem = {
  id: EditorCommandId;
  label: string;
  icon: string;
  shortcut?: string;
};

const clipboardItems: MenuItem[] = [
  { id: 'edit.cut', label: 'Cut', icon: 'Scissors', shortcut: 'X' },
  { id: 'edit.copy', label: 'Copy', icon: 'Copy', shortcut: 'C' },
  { id: 'edit.paste', label: 'Paste', icon: 'Clipboard', shortcut: 'V' },
  {
    id: 'edit.pasteWithoutFormatting',
    label: 'Paste without formatting',
    icon: 'ClipboardType',
    shortcut: '⇧V',
  },
];
const tableInsertItems: MenuItem[] = [
  {
    id: 'table.addRowAbove',
    label: 'Insert row above',
    icon: 'AddRowAbove',
  },
  {
    id: 'table.addRowBelow',
    label: 'Insert row below',
    icon: 'AddRowBelow',
  },
  {
    id: 'table.addColumnLeft',
    label: 'Insert column left',
    icon: 'AddLeftColumn',
  },
  {
    id: 'table.addColumnRight',
    label: 'Insert column right',
    icon: 'AddRightColumn',
  },
];
const tableDeleteItems: MenuItem[] = [
  { id: 'table.deleteRow', label: 'Delete row', icon: 'Trash2' },
  { id: 'table.deleteColumn', label: 'Delete column', icon: 'Trash2' },
  { id: 'table.deleteTable', label: 'Delete table', icon: 'Trash2' },
];

export function EditorContextMenu({
  editor,
  onError,
}: {
  editor: Editor;
  onError?: (message: string) => void;
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const commands = useEditorCommands(editor, { onError });
  const { isPreviewMode, isSuggestionMode } = useEditingContext();
  const readOnly = isPreviewMode || isSuggestionMode || !editor.isEditable;
  const modifier =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform)
      ? '⌘'
      : 'Ctrl+';

  useEffect(() => {
    const dom = editor.view.dom;
    const open = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Embedded controls (code editors, inputs, media) keep their own menu.
      const control = target.closest(
        'input, textarea, [contenteditable="false"]',
      );
      if (control && control !== dom) return;
      event.preventDefault();
      const { selection } = editor.state;
      const keyboard = event.clientX === 0 && event.clientY === 0;
      const position = keyboard
        ? null
        : editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (
        position &&
        (selection.empty ||
          position.pos < selection.from ||
          position.pos > selection.to)
      ) {
        editor.view.dispatch(
          editor.state.tr.setSelection(
            TextSelection.near(editor.state.doc.resolve(position.pos)),
          ),
        );
      }
      const coords = keyboard
        ? editor.view.coordsAtPos(editor.state.selection.from)
        : null;
      setPoint({
        x: coords?.left ?? event.clientX,
        y: coords?.bottom ?? event.clientY,
      });
    };
    const close = (event?: Event) => {
      if (
        event?.target instanceof Element &&
        event.target.closest('.ddoc-context-menu')
      )
        return;
      setPoint(null);
    };
    dom.addEventListener('contextmenu', open);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      dom.removeEventListener('contextmenu', open);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [editor]);

  const sections = [
    clipboardItems.filter((item) => !readOnly || item.id === 'edit.copy'),
    ...(!readOnly && editor.isActive('table')
      ? [tableInsertItems, tableDeleteItems]
      : []),
    [
      {
        id: 'edit.selectAll',
        label: 'Select all',
        icon: 'TextSelect',
        shortcut: 'A',
      },
      ...(!readOnly
        ? [
            {
              id: 'format.clearFormatting',
              label: 'Clear formatting',
              icon: 'RemoveFormatting',
            },
          ]
        : []),
    ] as MenuItem[],
  ];

  return (
    <DropdownMenu
      open={point !== null}
      onOpenChange={(open) => {
        if (!open) setPoint(null);
      }}
      modal={false}
    >
      {/* clientX/clientY are viewport coordinates. A fixed anchor inside the
          editor's transformed/zoomed canvas would use that canvas as its
          containing block instead, offsetting and scaling the menu position. */}
      {createPortal(
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            tabIndex={-1}
            style={{
              position: 'fixed',
              left: point?.x ?? 0,
              top: point?.y ?? 0,
              width: 0,
              height: 0,
              pointerEvents: 'none',
            }}
          />
        </DropdownMenuTrigger>,
        editor.view.dom.ownerDocument.body,
      )}
      <DropdownMenuContent
        aria-label="Document editing"
        aria-labelledby={undefined}
        className="ddoc-context-menu min-w-[260px] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto"
        align="start"
        sideOffset={0}
        collisionPadding={8}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
        }}
        onEscapeKeyDown={() => {
          if (!editor.isDestroyed) editor.view.focus();
        }}
      >
        {sections.map((items, index) => (
          <div key={index}>
            {index > 0 && <DropdownMenuSeparator />}
            {items.map((item) => (
              <DropdownMenuItem
                key={item.id}
                disabled={!commands[item.id].isEnabled}
                onSelect={() => {
                  setPoint(null);
                  commands[item.id].run();
                }}
              >
                <LucideIcon name={item.icon} size="sm" className="mr-3" />
                {item.label}
                {item.shortcut && (
                  <DropdownMenuShortcut>
                    {modifier}
                    {item.shortcut}
                  </DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
