import React, { forwardRef } from 'react';
import { Button, IconButton, LucideIcon, PopoverClose } from '@fileverse/ui';

// Memoized button components to prevent unnecessary re-renders
export const ActionButton = React.memo(
  forwardRef<
    HTMLButtonElement,
    {
      onClick: () => void;
      icon: string;
      text: string;
      variant?: 'ghost';
      className?: string;
    }
  >(({ onClick, icon, text, variant = 'ghost', className = '' }, ref) => (
    <PopoverClose asChild>
      <Button
        ref={ref}
        variant={variant}
        onClick={onClick}
        className={`justify-start gap-2 ${className}`}
      >
        <LucideIcon name={icon} size="sm" />
        {text}
      </Button>
    </PopoverClose>
  )),
);

ActionButton.displayName = 'ActionButton';

export const GripButton = React.memo(
  forwardRef<
    HTMLButtonElement,
    {
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
      className: string;
    }
  >(({ onClick, className, ...props }, ref) => (
    <IconButton
      icon={'GripVertical'}
      variant={'ghost'}
      size="sm"
      ref={ref}
      className={className}
      contentEditable={false}
      draggable
      data-drag-handle
      {...props}
      onClick={onClick}
    />
  )),
);

GripButton.displayName = 'GripButton';

export const PlusButton = React.memo(
  forwardRef<
    HTMLButtonElement,
    {
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
      className: string;
    }
  >(({ onClick, className, ...props }, ref) => (
    <IconButton
      icon={'Plus'}
      variant={'ghost'}
      size="sm"
      ref={ref}
      className={className}
      {...props}
      onClick={onClick}
    />
  )),
);

PlusButton.displayName = 'PlusButton';

export const CollapseButton = React.memo(
  forwardRef<
    HTMLButtonElement,
    {
      isCollapsed: boolean;
      onToggle: () => void;
      className: string;
    }
  >(({ isCollapsed, onToggle, className, ...props }, ref) => (
    <IconButton
      variant={'ghost'}
      icon={isCollapsed ? 'ChevronRight' : 'ChevronDown'}
      size="sm"
      ref={ref}
      className={className}
      data-test="collapse-button"
      {...props}
      onClick={onToggle}
    />
  )),
);

CollapseButton.displayName = 'CollapseButton';

export const CopyLinkButton = React.memo(
  forwardRef<
    HTMLButtonElement,
    {
      onClick: () => void;
      className: string;
    }
  >(({ onClick, className, ...props }, ref) => (
    <IconButton
      variant={'ghost'}
      icon={'Link'}
      size="sm"
      ref={ref}
      className={className}
      data-test="copy-heading-link-button"
      {...props}
      onClick={onClick}
    />
  )),
);

CopyLinkButton.displayName = 'CopyLinkButton';
