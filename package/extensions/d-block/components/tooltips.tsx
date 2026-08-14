import React from 'react';
import { Tooltip } from '@fileverse/ui';

export const ButtonTooltip = React.memo(
  ({
    text,
    position = 'bottom',
    children,
  }: {
    text: string | React.ReactNode;
    position?: 'bottom';
    children: React.ReactNode;
  }) => (
    <Tooltip text={text} position={position} asTriggerChild>
      {children}
    </Tooltip>
  ),
);

export const AddBlockTooltip = React.memo(
  ({ children }: { children: React.ReactNode }) => (
    <ButtonTooltip
      text={
        <div className="flex flex-col">
          <div className="text-xs">Click to add below</div>
          <div className="text-xs">Opt + Click to add above</div>
        </div>
      }
      position="bottom"
    >
      {children}
    </ButtonTooltip>
  ),
);

export const DragTooltip = React.memo(
  ({ children }: { children: React.ReactNode }) => (
    <ButtonTooltip
      text={
        <div className="flex flex-col">
          <div className="text-xs">Hold to drag</div>
          <div className="text-xs">Opt + Click to delete</div>
        </div>
      }
      position="bottom"
    >
      {children}
    </ButtonTooltip>
  ),
);

export const CollapseTooltip = React.memo(
  ({
    isCollapsed,
    children,
  }: {
    isCollapsed: boolean;
    children: React.ReactNode;
  }) => (
    <ButtonTooltip
      text={isCollapsed ? 'Expand section' : 'Collapse section'}
      position="bottom"
    >
      {children}
    </ButtonTooltip>
  ),
);

export const CopyLinkTooltip = React.memo(
  ({ children }: { children: React.ReactNode }) => (
    <ButtonTooltip text="Copy link to heading" position="bottom">
      {children}
    </ButtonTooltip>
  ),
);
