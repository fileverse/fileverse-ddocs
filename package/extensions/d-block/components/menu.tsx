import React, { forwardRef } from 'react';
import { Surface } from '../../../common/surface';
import { ActionButton } from './buttons';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { Popover, PopoverTrigger, PopoverContent } from '@fileverse/ui';

interface MenuProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  actions: {
    resetTextFormatting: () => void;
    copyNodeToClipboard: () => void;
    duplicateNode: () => void;
    deleteNode: () => void;
  };
}

const MenuTrigger = forwardRef<HTMLDivElement, { children: React.ReactNode }>(
  // flex kills the inherited line-box height (24px) that otherwise makes
  // this wrapper taller than the 20px grip button and top-aligns it 2px
  // above its sibling buttons in the cluster row.
  (props, ref) => (
    <div ref={ref} className="flex items-center">
      {props.children}
    </div>
  ),
);

MenuTrigger.displayName = 'MenuTrigger';

export const DBlockMenu = React.memo(
  ({ isOpen, onOpenChange, trigger, actions }: MenuProps) => (
    <FocusScope onMountAutoFocus={(e) => e.preventDefault()} trapped={false}>
      <Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <MenuTrigger>{trigger}</MenuTrigger>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={8}
          className="z-10 shadow-elevation-3"
        >
          <Surface className="p-2 flex flex-col min-w-[16rem]">
            <ActionButton
              onClick={actions.resetTextFormatting}
              icon="RemoveFormatting"
              text="Clear formatting"
            />
            <ActionButton
              onClick={actions.copyNodeToClipboard}
              icon="Clipboard"
              text="Copy to clipboard"
            />
            <ActionButton
              onClick={actions.duplicateNode}
              icon="Copy"
              text="Duplicate"
            />
            <ActionButton
              onClick={actions.deleteNode}
              icon="Trash2"
              text="Delete"
              className="color-text-danger"
            />
          </Surface>
        </PopoverContent>
      </Popover>
    </FocusScope>
  ),
);
