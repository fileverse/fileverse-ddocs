import React from 'react';
import {
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerClose,
  Drawer,
  IconButton,
} from '@fileverse/ui';
import cn from 'classnames';

interface UtilsModalProps {
  title: string;
  content: React.ReactNode;
  isOpen?: boolean;
  setIsOpen?: (open: boolean) => void;
  contentClassName?: string;
  onCloseAutoFocus?: () => void;
}

const UtilsModal = ({
  title,
  content,
  isOpen,
  setIsOpen,
  contentClassName,
  onCloseAutoFocus,
}: UtilsModalProps) => {
  return (
    <Drawer open={isOpen} onOpenChange={setIsOpen}>
      <DrawerContent
        className="w-full z-20 !gap-4"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DrawerHeader className="p-4 border-b color-border-default">
          <DrawerTitle className="flex justify-between items-center text-left sm:text-center text-base">
            {title}
            <DrawerClose asChild>
              <IconButton icon={'X'} size="sm" variant={'ghost'} />
            </DrawerClose>
          </DrawerTitle>
        </DrawerHeader>
        <div
          className={cn(
            'flex flex-col gap-4 w-full h-full pb-4 text-base color-text-default',
            contentClassName,
          )}
        >
          {content && content}
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default UtilsModal;
