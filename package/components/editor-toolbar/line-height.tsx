import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  LucideIcon,
} from '@fileverse/ui';
import cn from 'classnames';
import { Editor } from '@tiptap/core';
import { getLineHeightOptions, IEditorToolElement } from '../editor-utils';
import { CustomSpacingDialog } from './custom-spacing-dialog';

const LineHeightPicker = ({
  currentLineHeight,
  onSetLineHeight,
  onOpenCustomSpacing,
}: {
  currentLineHeight?: string;
  onSetLineHeight: (lineHeight: string) => void;
  onOpenCustomSpacing: () => void;
}) => {
  const lineHeightOptions = getLineHeightOptions();

  return (
    <div className="z-50 flex flex-col justify-center items-center overflow-hidden rounded color-bg-default p-2 gap-1 shadow-elevation-1">
      {lineHeightOptions.map((lineHeight) => (
        <DropdownMenuItem
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSetLineHeight(lineHeight.value)}
          key={lineHeight.value}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1 text-sm color-text-default transition min-w-[120px]',
            {
              ['!bg-[hsl(var(--color-bg-brand))]']:
                currentLineHeight === lineHeight.value,
            },
          )}
        >
          {currentLineHeight === lineHeight.value ? (
            <LucideIcon name="Check" size="sm" />
          ) : (
            <div className="w-4" />
          )}
          <span className="font-medium">{lineHeight.label}</span>
          <span className="text-xs color-text-secondary">
            {lineHeight.description}
          </span>
        </DropdownMenuItem>
      ))}

      <div className="w-full my-1 h-[1px] color-bg-default-hover" />

      <DropdownMenuItem
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpenCustomSpacing}
        className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm color-text-default transition min-w-[120px]"
      >
        <div className="w-4" />
        <span className="font-medium">Custom spacing</span>
      </DropdownMenuItem>
    </div>
  );
};

export const LineHeightDropdown = ({
  tool,
  editor,
  currentLineHeight,
  onSetLineHeight,
}: {
  tool: IEditorToolElement;
  editor: Editor | null;
  currentLineHeight?: string;
  onSetLineHeight: (lineHeight: string) => void;
}) => {
  // Held here rather than in the picker: selecting the item closes the
  // dropdown, which would unmount a dialog rendered inside it.
  const [isCustomSpacingOpen, setIsCustomSpacingOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            icon={tool.icon}
            variant="ghost"
            size="sm"
            disabled={tool.disabled}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="p-0 b-0">
          <LineHeightPicker
            currentLineHeight={currentLineHeight}
            onSetLineHeight={onSetLineHeight}
            onOpenCustomSpacing={() => setIsCustomSpacingOpen(true)}
          />
        </DropdownMenuContent>
      </DropdownMenu>

      <CustomSpacingDialog
        editor={editor}
        open={isCustomSpacingOpen}
        onOpenChange={setIsCustomSpacingOpen}
      />
    </>
  );
};
