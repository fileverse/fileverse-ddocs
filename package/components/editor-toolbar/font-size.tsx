import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  LucideIcon,
} from '@fileverse/ui';
import cn from 'classnames';
import type { Editor } from '@tiptap/core';
import { getCurrentFontSize, getFontSizeOptions } from '../../utils/typography';

const FontSizePicker = ({
  editor,
  currentSize,
  onSetFontSize,
  mobileSheet = false,
}: {
  editor: Editor;
  currentSize?: string;
  onSetFontSize: (fontSize: string) => void;
  mobileSheet?: boolean;
}) => {
  const fontSizes = getFontSizeOptions(editor);

  return (
    <div
      className={cn(
        'z-50 flex flex-col items-center overflow-y-auto rounded color-bg-default p-2 shadow-elevation-1',
        mobileSheet
          ? 'w-full gap-0 max-h-[min(320px,var(--radix-dropdown-menu-content-available-height))]'
          : 'gap-1 max-h-[var(--radix-dropdown-menu-content-available-height)]',
      )}
    >
      {fontSizes.map((fontSize) => (
        <DropdownMenuItem
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSetFontSize(fontSize.value)}
          key={fontSize.title}
          className={cn(
            'flex w-full items-center justify-center rounded px-2 py-1 text-center text-sm color-text-default transition',
            {
              ['!bg-[hsl(var(--color-bg-brand))] color-text-on-brand']:
                currentSize === fontSize.value,
            },
          )}
        >
          <p className={mobileSheet ? 'font-normal' : 'font-medium'}>
            {fontSize.title}
          </p>
        </DropdownMenuItem>
      ))}
    </div>
  );
};

export const FontSizeDropdown = ({
  editor,
  currentSize,
  onSetFontSize,
  triggerClassName,
  mobileSheet = false,
}: {
  editor: Editor;
  currentSize?: string;
  onSetFontSize: (fontSize: string) => void;
  triggerClassName?: string;
  /** Mobile sheet layout: menu matches trigger width, 8px radius, 320px cap */
  mobileSheet?: boolean;
}) => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={
            triggerClassName ??
            'bg-transparent hover:!color-bg-default-hover rounded gap-2 h-[30px] py-2 px-1 flex items-center justify-center w-[52px]'
          }
        >
          <span className="text-body-sm-bold line-clamp-1">
            {getCurrentFontSize(editor, currentSize as string)}
          </span>
          <LucideIcon name="ChevronDown" size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={cn(
          'p-0 b-0',
          mobileSheet &&
            'rounded-lg w-[var(--radix-dropdown-menu-trigger-width)]',
        )}
        align={mobileSheet ? 'start' : undefined}
      >
        <FontSizePicker
          editor={editor}
          currentSize={currentSize}
          onSetFontSize={onSetFontSize}
          mobileSheet={mobileSheet}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
