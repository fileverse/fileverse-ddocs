/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ComponentProps,
  HTMLAttributes,
  MouseEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import cn from 'classnames';
import {
  LucideIcon,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
  TextField,
  Tooltip,
} from '@fileverse/ui';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TabEmojiPicker } from './tab-emoji-picker';

export interface TabItemProps {
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
}

interface SortableTabItemProps
  extends Omit<TabItemProps, 'dragHandleProps' | 'isEditing' | 'setIsEditing'> {
  id: string;
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
}

interface TabContextMenuProps {
  sections: TabContextMenuItem[][];
  popoverSide?: 'top' | 'bottom';
  popoverClassName?: string;
}

const menuItemClassName =
  'space-xsm gap-xsm hover:color-bg-default-hover cursor-pointer h-[30px] border-radius-sm flex items-center w-full';

export const SortableTabItem = (props: SortableTabItemProps) => {
  const [isEditing, setIsEditing] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: props.id, disabled: isEditing });

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
        dragHandleProps={{
          ...dragHandleAttributes,
          ...listeners,
        }}
      />
    </div>
  );
};

export const TabItem = ({
  isEditing,
  setIsEditing,
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
}: TabItemProps) => {
  const [isHovered, setIsHovered] = useState(false);
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

  const editMenuSections: TabContextMenuItem[][] = [
    [
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
  const shouldShowContextMenu = alwaysShowMenu || isActive || isHovered;

  return (
    <div
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
        isActive && 'color-bg-default-hover',
      )}
    >
      <div className="flex items-center gap-[8px] min-w-0 flex-1">
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
}: TabContextMenuProps) => {
  const visibleSections = sections
    .map((section) => section.filter((item) => item.visible !== false))
    .filter((section) => section.length > 0);

  return (
    <Popover>
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
            {section.map((item) => (
              <TabContextMenuAction key={item.id} item={item} />
            ))}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
};
