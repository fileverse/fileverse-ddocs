import { FC, useRef, useState, useEffect } from 'react';
import { NodeViewContent, NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import Tippy from '@tippyjs/react';
import './styles.css';
import { useEditingContext } from '../../../hooks/use-editing-context';
import { Button, Divider, LucideIcon } from '@fileverse/ui';

interface CellButton {
  name: string;
  action: (editor: Editor) => boolean;
  icon: JSX.Element;
  group: string;
}

const cellButtonsConfig: CellButton[] = [
  {
    name: 'Add row above',
    action: (editor) => editor.chain().focus().addRowBefore().run(),
    icon: <LucideIcon name="AddRowAbove" size={'md'} />,
    group: 'row',
  },
  {
    name: 'Add row below',
    action: (editor) => editor.chain().focus().addRowAfter().run(),
    icon: <LucideIcon name="AddRowBelow" size={'md'} />,
    group: 'row',
  },
  {
    name: 'Remove row',
    action: (editor) => editor.chain().focus().deleteRow().run(),
    icon: <LucideIcon name="Trash2" size={'md'} />,
    group: 'row',
  },
  {
    name: 'Add left column',
    action: (editor) => editor.chain().focus().addColumnBefore().run(),
    icon: <LucideIcon name="AddLeftColumn" size={'md'} />,
    group: 'column',
  },
  {
    name: 'Add right column',
    action: (editor) => editor.chain().focus().addColumnAfter().run(),
    icon: <LucideIcon name="AddRightColumn" size={'md'} />,
    group: 'column',
  },
  {
    name: 'Remove column',
    action: (editor) => editor.chain().focus().deleteColumn().run(),
    icon: <LucideIcon name="Trash2" size={'md'} />,
    group: 'column',
  },
  // {
  //   name: 'Merge cells',
  //   action: (editor) => editor.chain().focus().mergeCells().run(),
  //   icon: <LucideIcon name="TableCellsMerge" size={'md'} />,
  //   group: 'table',
  // },
  // {
  //   name: 'Split cells',
  //   action: (editor) => editor.chain().focus().splitCell().run(),
  //   icon: <LucideIcon name="TableCellsSplit" size={'md'} />,
  //   group: 'table',
  // },
  {
    name: 'Toggle header row',
    action: (editor) => editor.chain().focus().toggleHeaderRow().run(),
    icon: <LucideIcon name="ToggleHeaderRow" size={'md'} />,
    group: 'table',
  },
  {
    name: 'Toggle header cell',
    action: (editor) => editor.chain().focus().toggleHeaderCell().run(),
    icon: <LucideIcon name="ToggleHeaderCell" size={'md'} />,
    group: 'table',
  },
  {
    name: 'Toggle header column',
    action: (editor) => editor.chain().focus().toggleHeaderColumn().run(),
    icon: <LucideIcon name="ToggleHeaderColumn" size={'md'} />,
    group: 'table',
  },
  {
    name: 'Remove table',
    action: (editor) => editor.chain().focus().deleteTable().run(),
    icon: <LucideIcon name="Trash2" size={'md'} />,
    group: 'other',
  },
];

export const TableCellNodeView: FC<NodeViewProps> = ({
  editor,
  selected,
  getPos,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const { isPreviewMode } = useEditingContext();
  const tableCellOptionsButtonRef = useRef<HTMLLabelElement>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );

  const handleMouseEnter = () => {
    if (hoverTimeoutRef.current !== null) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    // @ts-ignore
    hoverTimeoutRef.current = window.setTimeout(() => {
      setIsHovered(false);
      hoverTimeoutRef.current = null;
    }, 100);
  };

  const handleTriggerClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Focus the cell when clicking the trigger button
    if (typeof getPos === 'function') {
      const pos = getPos();
      if (pos === undefined) return;
      editor.commands.setTextSelection(pos);
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current !== null) {
        window.clearTimeout(hoverTimeoutRef.current);
        hoverTimeoutRef.current = null;
      }
    };
  }, []);

  const gimmeDropdownStyles = (): React.CSSProperties => {
    let top = tableCellOptionsButtonRef.current?.clientTop;
    if (top) top += 5;

    let left = tableCellOptionsButtonRef.current?.clientLeft;
    if (left) left += 5;

    return {
      top: `${top}px`,
      left: `${left}px`,
    };
  };

  return (
    <NodeViewWrapper
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <NodeViewContent as="div" />

      {!isPreviewMode && (isHovered || selected) && (
        <Tippy
          appendTo={document.body}
          trigger="click"
          interactive
          animation="shift-toward-subtle"
          placement="bottom-start"
          content={
            <article
              className="w-screen lg:w-full"
              contentEditable={false}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <div
                tabIndex={1}
                className="static z-50 top-8 right-1/2 translate-x-1/2 lg:-translate-x-full p-2 shadow-elevation-3 color-bg-default rounded-lg w-56 border color-border-default"
                style={gimmeDropdownStyles()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
              >
                {Object.entries(
                  cellButtonsConfig.reduce(
                    (acc, btn) => {
                      if (!acc[btn.group]) {
                        acc[btn.group] = [];
                      }
                      acc[btn.group].push(btn);
                      return acc;
                    },
                    {} as Record<string, CellButton[]>,
                  ),
                ).map(([group, buttons], groupIndex, groups) => (
                  <div key={group}>
                    {buttons.map((btn) => (
                      <div key={btn.name}>
                        <Button
                          variant="ghost"
                          className="!items-center w-full !justify-start text-body-sm-bold gap-3 !px-2"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            btn.action(editor);
                          }}
                        >
                          <span>{btn.icon}</span>
                          <span>{btn.name}</span>
                        </Button>
                      </div>
                    ))}
                    {groupIndex < groups.length - 1 && (
                      <Divider className="my-1 w-full border-t-[1px]" />
                    )}
                  </div>
                ))}
              </div>
            </article>
          }
        >
          <label
            ref={tableCellOptionsButtonRef}
            tabIndex={0}
            className="trigger-button"
            contentEditable={false}
            onClick={handleTriggerClick}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <LucideIcon
              name="Ellipsis"
              className="color-icon-secondary"
              size={'sm'}
            />
          </label>
        </Tippy>
      )}
    </NodeViewWrapper>
  );
};
