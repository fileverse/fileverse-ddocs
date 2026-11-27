/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ComponentProps,
  CSSProperties,
  HTMLAttributes,
  MouseEvent,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import cn from 'classnames';
import {
  LucideIcon,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  TextField,
  Tooltip,
} from '@fileverse/ui';
import { useDroppable } from '@dnd-kit/core';
import { Tab } from './utils/tab-utils';
import { TAB_INDENT_PX } from './use-tab-tree-view';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TabEmojiPicker } from './tab-emoji-picker';

export type TabDropIntent = 'into' | 'before' | 'after';

export interface TabMoveActions {
  getTargets?: () => Tab[];
  onMoveInto?: (targetId: string) => void;
  onMoveOut?: () => void;
}

export interface TabItemProps {
  moveActions?: TabMoveActions;
  rowRef?: (element: HTMLDivElement | null) => void;
  dropIntent?: TabDropIntent | 'invalid';
  dropIndent?: number;
  tabId: string;
  name: string;
  emoji: string;
  commentCount?: number;
  onNameChange: (name: string, emoji?: string) => void;
  onEmojiChange: (emoji: string) => void;
  onClick: () => void;
  isActive: boolean;
  isEditing?: boolean;
  setIsEditing?: React.Dispatch<React.SetStateAction<boolean>>;
  onDuplicate?: (id: string) => void;
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
  hideContentMenu?: boolean;
  alwaysShowMenu?: boolean;
  menuPopoverClassName?: string;
  // Replaces in-place editing, e.g. with a rename modal on mobile.
  onRename?: () => void;
  showOutline?: boolean;
  handleShowOutline?: (value: boolean) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  isPreviewMode: boolean;
  isVersionHistoryMode?: boolean;
  onCopyLink?: () => void;
  onDelete?: () => void;
  isConnected?: boolean;
  // Subtabs. Absent on a doc without subtabs, so the row looks as before.
  onAddSubtab?: () => void;
  /** Left offset in px for the row's level. */
  indent?: number;
  expandState?: 'expanded' | 'collapsed' | 'leaf';
  onToggleExpand?: () => void;
}

interface SortableTabItemProps
  extends Omit<TabItemProps, 'dragHandleProps' | 'isEditing' | 'setIsEditing'> {
  id: string;
  // Rendered inside the dragged element, so a tab's subtabs move with it.
  children?: ReactNode;
  enableRowDrop?: boolean;
}

interface TabContextMenuItem {
  id: string;
  label: string;
  icon: ComponentProps<typeof LucideIcon>['name'];
  onSelect?: () => void;
  visible?: boolean;
  closeOnSelect?: boolean;
  textClassName?: string;
  iconStroke?: string;
  tooltipText?: string;
  disabled?: boolean;
  submenu?: { getTabs: () => Tab[]; onSelect: (id: string) => void };
}

interface TabContextMenuProps {
  sections: TabContextMenuItem[][];
  popoverSide?: 'top' | 'bottom';
  popoverClassName?: string;
  onOpenChange?: (open: boolean) => void;
  useDropdown?: boolean;
}

const menuItemClassName =
  'space-xsm gap-xsm hover:color-bg-default-hover cursor-pointer h-[30px] border-radius-sm flex items-center w-full';

export const SortableTabItem = ({
  children,
  enableRowDrop,
  ...props
}: SortableTabItemProps) => {
  const [isEditing, setIsEditing] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: props.id,
    // A plain `false` would override the list's own `disabled` (viewers,
    // version history), so pass nothing unless renaming.
    disabled: isEditing || undefined,
  });

  const { setNodeRef: setRowRef } = useDroppable({
    id: `tab-row:${props.id}`,
    disabled: !enableRowDrop,
    data: { tabRowId: props.id },
  });

  // Filter tabIndex keeping it makes the tab list a focus fallback when the editor blurs.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { tabIndex, ...dragHandleAttributes } = attributes;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(isDragging && 'opacity-0', 'w-full')}
    >
      <TabItem
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        {...props}
        rowRef={enableRowDrop ? setRowRef : undefined}
        dragHandleProps={{
          ...dragHandleAttributes,
          ...listeners,
        }}
      />
      {children}
    </div>
  );
};

export const TabItem = ({
  isEditing,
  setIsEditing,
  moveActions,
  rowRef,
  dropIntent,
  dropIndent = 0,
  tabId,
  name,
  emoji,
  commentCount = 0,
  onNameChange,
  onEmojiChange,
  onClick,
  isActive,
  onDuplicate,
  dragHandleProps,
  hideContentMenu = false,
  alwaysShowMenu = false,
  menuPopoverClassName,
  onRename,
  showOutline,
  handleShowOutline,
  canMoveUp = false,
  canMoveDown = false,
  onMoveUp,
  onMoveDown,
  isPreviewMode,
  isVersionHistoryMode,
  onCopyLink,
  onDelete,
  isConnected = true,
  onAddSubtab,
  indent = 0,
  expandState,
  onToggleExpand,
}: TabItemProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openEmojiPickerTrigger, setOpenEmojiPickerTrigger] = useState(0);
  const [title, setTitle] = useState(name);
  const originalTitleRef = useRef(title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Prevents the input blur handler from issuing a second rename commit
  // right after we already submitted a combined name+emoji update.
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    if (!isEditing) {
      setTitle(name);
    }
  }, [name, isEditing]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    if (onRename) {
      onRename();
      return;
    }
    originalTitleRef.current = title;
    setIsEditing?.(true);
  };

  const commitTitle = () => {
    // Read from the input ref to avoid stale state when emoji is selected
    // in the same interaction as a title edit.
    const nextTitle =
      (inputRef.current?.value ?? title).trim() || originalTitleRef.current;
    setTitle(nextTitle);
    return nextTitle;
  };

  const stopEditing = () => {
    const nextTitle = commitTitle();
    onNameChange(nextTitle);
    setIsEditing?.(false);
  };

  const cancelEditing = () => {
    setTitle(originalTitleRef.current);
    setIsEditing?.(false);
  };

  const shouldShowContextMenu =
    alwaysShowMenu || isActive || isHovered || menuOpen;
  const editMenuSections: TabContextMenuItem[][] = [
    [
      {
        id: 'add-subtab',
        label: 'Add subtab',
        icon: 'Plus',
        onSelect: () => onAddSubtab?.(),
        visible: Boolean(onAddSubtab),
      },
      {
        id: 'rename',
        label: 'Rename',
        icon: 'SquarePen',
        onSelect: startEditing,
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        icon: 'Copy',
        onSelect: () => onDuplicate?.(tabId),
      },
      {
        id: 'choose-emoji',
        label: 'Choose emoji',
        icon: 'SmilePlus',
        onSelect: () => setOpenEmojiPickerTrigger((prev) => prev + 1),
      },
    ],
    [
      {
        id: 'copy-link',
        label: 'Copy link',
        icon: 'Share2',
        onSelect: onCopyLink,
        tooltipText: !isConnected
          ? 'Login/Signup to share this Tab'
          : undefined,
        disabled: !isConnected,
      },
      {
        id: 'toggle-outline',
        label: showOutline ? 'Hide outline' : 'Show outline',
        icon: 'List',
        onSelect: () => handleShowOutline?.(!showOutline),
        visible: Boolean(handleShowOutline),
      },
    ],
    [
      {
        id: 'move-up',
        label: 'Move up',
        icon: 'MoveUp',
        onSelect: () => onMoveUp?.(),
        visible: canMoveUp,
      },
      {
        id: 'move-down',
        label: 'Move down',
        icon: 'MoveDown',
        onSelect: () => onMoveDown?.(),
        visible: canMoveDown,
      },
      {
        id: 'move-into',
        label: 'Move into',
        icon: 'IndentIncrease',
        visible: Boolean(moveActions?.getTargets && moveActions.onMoveInto),
        submenu:
          moveActions?.getTargets && moveActions.onMoveInto
            ? {
                getTabs: moveActions.getTargets,
                onSelect: moveActions.onMoveInto,
              }
            : undefined,
      },
      {
        id: 'move-out',
        label: 'Move out',
        icon: 'IndentDecrease',
        visible: Boolean(moveActions?.onMoveOut),
        onSelect: moveActions?.onMoveOut,
      },
    ],
    [
      {
        id: 'delete-tab',
        label: 'Delete',
        icon: 'Trash2',
        onSelect: () => onDelete?.(),
        visible: Boolean(onDelete),
        textClassName: 'color-text-danger',
        iconStroke: 'hsl(var(--color-icon-danger))',
      },
    ],
  ];

  const previewModeMenu: TabContextMenuItem[][] = [
    [
      {
        id: 'copy-link',
        label: 'Copy link',
        icon: 'Share2',
        onSelect: onCopyLink,
      },
      {
        id: 'toggle-outline',
        label: showOutline ? 'Hide outline' : 'Show outline',
        icon: 'List',
        onSelect: () => handleShowOutline?.(!showOutline),
        visible: Boolean(handleShowOutline),
      },
    ],
  ];

  const menuSections = isPreviewMode ? previewModeMenu : editMenuSections;
  return (
    <div
      ref={rowRef}
      data-drop-intent={dropIntent}
      style={
        dropIntent === 'before' || dropIntent === 'after'
          ? ({ '--tab-drop-indent': `${dropIndent}px` } as CSSProperties)
          : undefined
      }
      data-testid={`tab-item-${tabId}`}
      data-active={isActive}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onDoubleClick={() => {
        if (isPreviewMode || onRename) return;
        startEditing();
      }}
      onClick={onClick}
      {...dragHandleProps}
      className={cn(
        'flex items-center active:cursor-grabbing relative justify-between h-[40px] px-[12px] py-[8px] rounded-[4px]',
        (isActive || dropIntent === 'into') && 'color-bg-default-hover',
        // Desktop rows (the phone list always shows the menu): a touch
        // screen would keep the hover colour after a tap.
        !alwaysShowMenu &&
          dropIntent !== 'invalid' &&
          'hover:color-bg-default-hover',
        (dropIntent === 'before' || dropIntent === 'after') &&
          'after:absolute after:start-[var(--tab-drop-indent)] after:end-0 after:h-0.5 after:bg-[hsl(var(--color-border-focused))] after:pointer-events-none',
        dropIntent === 'before' && 'after:top-[-2px]',
        dropIntent === 'after' && 'after:bottom-[-2px]',
      )}
    >
      <div
        className="flex items-center gap-[8px] min-w-0 flex-1"
        style={indent ? { paddingLeft: indent } : undefined}
      >
        {expandState && (
          <button
            type="button"
            data-testid={`tab-expand-${tabId}`}
            aria-label={expandState === 'collapsed' ? 'Expand' : 'Collapse'}
            disabled={expandState === 'leaf'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand?.();
            }}
            className={cn(
              'w-[16px] h-[16px] shrink-0 flex items-center justify-center rounded-[2px]',
              expandState === 'leaf'
                ? 'invisible'
                : 'hover:color-bg-secondary-hover',
            )}
          >
            <LucideIcon
              name={
                expandState === 'collapsed' ? 'ChevronRight' : 'ChevronDown'
              }
              className="w-[14px] h-[14px]"
            />
          </button>
        )}
        <TabEmojiPicker
          emoji={emoji}
          setEmoji={(_emoji) => {
            if (isEditing) {
              // Emit a single metadata update when name and emoji change together.
              skipBlurCommitRef.current = true;
              const nextTitle = commitTitle();
              onNameChange(nextTitle, _emoji);
              setIsEditing?.(false);
              return;
            }
            onEmojiChange(_emoji);
          }}
          disableEmoji={Boolean(isPreviewMode || isVersionHistoryMode)}
          isEditing={isEditing ?? false}
          openPickerTrigger={openEmojiPickerTrigger}
        />

        {!isEditing ? (
          <div className="min-w-0 flex [&>*]:w-full">
            <Tooltip text={title} position="bottom">
              <span
                data-testid={`tab-name-${tabId}`}
                className="block w-full truncate select-none text-heading-xsm color-text-default"
              >
                {title}
              </span>
            </Tooltip>
          </div>
        ) : (
          <TextField
            data-testid="tab-rename-input"
            ref={inputRef}
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              if (skipBlurCommitRef.current) {
                skipBlurCommitRef.current = false;
                return;
              }
              const nextFocused = e.relatedTarget as HTMLElement | null;
              if (nextFocused?.closest('[data-emoji-picker]')) {
                return;
              }
              stopEditing();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') stopEditing();
              if (e.key === 'Escape') cancelEditing();
            }}
            className="h-[24px] px-[6px]  py-0 rounded-[6px] text-heading-xsm  border-transparent focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-border-focused))]"
          />
        )}
      </div>
      {!isVersionHistoryMode && (
        <div className="flex gap-[8px] items-center">
          {commentCount > 0 && (
            <span className="h-[18px] color-text-default text-[12px] text-helper-text-bold rounded-full min-w-[18px] text-center color-bg-tertiary">
              {commentCount}
            </span>
          )}

          {!hideContentMenu && (
            <div
              data-testid="tab-context-menu-slot"
              className="w-[24px] h-[24px] shrink-0"
            >
              {shouldShowContextMenu && (
                <TabContextMenu
                  sections={menuSections}
                  onOpenChange={setMenuOpen}
                  useDropdown={Boolean(moveActions?.getTargets)}
                  popoverClassName={menuPopoverClassName}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const TabDragPreview = ({
  name,
  emoji,
}: {
  name: string;
  emoji: string;
}) => {
  return (
    <div
      data-testid="tab-drag-preview"
      className="
        flex items-center gap-[8px] px-[12px] py-[8px] w-[231px] h-[40px] rounded-[4px] color-bg-secondary shadow-elevation-3"
    >
      {emoji ? (
        <span className=" text-[16px] leading-[16px] w-[16px] flex items-center justify-center">
          {emoji}
        </span>
      ) : (
        <LucideIcon name="FileText" className="w-[16px]" />
      )}

      <span className="text-heading-xsm color-text-default truncate">
        {name}
      </span>
    </div>
  );
};
export const TabContextMenuAction = ({
  item,
}: {
  item: TabContextMenuItem;
}) => {
  const [isTooltipOpen, setIsTooltipOpen] = useState(false); // used to fix tooltip being visible by default without hovering on item
  const content = (
    <div
      data-testid={`tab-menu-${item.id}`}
      className={cn(menuItemClassName, item.disabled && '!cursor-not-allowed')}
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if (item.disabled) {
          return;
        }
        item.onSelect?.();
      }}
    >
      <LucideIcon
        name={item.icon}
        stroke={item.iconStroke}
        className={cn('w-[16px] h-[16px]')}
      />
      <p
        className={cn(
          'text-heading-xsm color-text-default',
          item.textClassName,
        )}
      >
        {item.label}
      </p>
    </div>
  );

  const action =
    item.closeOnSelect === false ? (
      content
    ) : (
      <PopoverClose asChild>{content}</PopoverClose>
    );

  if (!item.tooltipText) {
    return action;
  }

  return (
    <div
      onMouseEnter={() => setIsTooltipOpen(true)}
      onMouseLeave={() => setIsTooltipOpen(false)}
      className="[&_[data-testid='tooltip-trigger']]:w-full [&_[data-testid='tooltip-trigger']]:block"
    >
      <Tooltip text={item.tooltipText} position="top" open={isTooltipOpen}>
        {action}
      </Tooltip>
    </div>
  );
};

export const TabContextMenu = ({
  sections,
  popoverSide = 'bottom',
  popoverClassName,
  onOpenChange,
  useDropdown,
}: TabContextMenuProps) => {
  const [open, setOpen] = useState(false);
  const visibleSections = sections
    .map((section) =>
      section
        .filter((item) => item.visible !== false)
        .map((item) => ({
          item,
          destinations: open ? item.submenu?.getTabs() : undefined,
        }))
        .filter(
          ({ item, destinations }) => !item.submenu || destinations?.length,
        ),
    )
    .filter((section) => section.length > 0);

  if (useDropdown) {
    return (
      <DropdownMenu
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          onOpenChange?.(nextOpen);
        }}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Tab options"
            data-testid="tab-context-menu-trigger"
            className="h-6 w-6 rounded hover:color-bg-secondary-hover flex items-center justify-center"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
          >
            <LucideIcon name="EllipsisVertical" className="h-4 w-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side={popoverSide}
          sideOffset={4}
          className={cn('w-[160px] space-xsm', popoverClassName)}
          onClick={(event) => event.stopPropagation()}
        >
          {visibleSections.map((section, index) => (
            <div key={section[0].item.id}>
              {index > 0 && <DropdownMenuSeparator />}
              {section.map(({ item, destinations }) => {
                const { submenu } = item;
                const label = (
                  <>
                    <LucideIcon
                      name={item.icon}
                      stroke={item.iconStroke}
                      className="h-4 w-4"
                    />
                    <span className={item.textClassName}>{item.label}</span>
                  </>
                );
                if (submenu && destinations) {
                  const destinationItems = destinations.map((tab) => (
                    <DropdownMenuItem
                      key={tab.id}
                      style={{
                        paddingInlineStart:
                          8 + ((tab.depth ?? 1) - 1) * TAB_INDENT_PX,
                      }}
                      onSelect={() => submenu.onSelect(tab.id)}
                    >
                      <span className="truncate">{tab.name}</span>
                    </DropdownMenuItem>
                  ));
                  return (
                    <DropdownMenuSub key={item.id}>
                      <DropdownMenuSubTrigger
                        data-testid={`tab-menu-${item.id}`}
                        className={menuItemClassName}
                      >
                        {label}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent
                        sideOffset={12}
                        collisionPadding={4}
                        className={cn(
                          'w-max min-w-[min(9rem,var(--radix-dropdown-menu-content-available-width))] max-w-[min(16rem,var(--radix-dropdown-menu-content-available-width))] max-h-[min(20rem,var(--radix-dropdown-menu-content-available-height))] !overflow-y-auto',
                          popoverClassName,
                        )}
                      >
                        {destinationItems}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  );
                }
                return (
                  <DropdownMenuItem
                    key={item.id}
                    data-testid={`tab-menu-${item.id}`}
                    title={item.tooltipText}
                    disabled={item.disabled}
                    className={menuItemClassName}
                    onSelect={item.onSelect}
                  >
                    {label}
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverTrigger onClick={(e) => e.stopPropagation()}>
        <div
          data-testid="tab-context-menu-trigger"
          className="h-[24px] rounded-[4px] w-[24px] hover:color-bg-secondary-hover min-w-[24px] flex items-center justify-center"
        >
          <LucideIcon name="EllipsisVertical" className="h-[16px] w-[16px]" />
        </div>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        alignOffset={0}
        elevation={2}
        side={popoverSide}
        sideOffset={4}
        className={cn('w-[160px] space-xsm', popoverClassName)}
      >
        {visibleSections.map((section, sectionIndex) => (
          <div key={`section-${sectionIndex}`}>
            {sectionIndex > 0 && (
              <hr className="border-t space-x-xsm color-border-default my-[4px] w-full" />
            )}
            {section.map(({ item }) => (
              <TabContextMenuAction key={item.id} item={item} />
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
};
