import cn from 'classnames';
import { DynamicDropdown, LucideIcon } from '@fileverse/ui';
import { BubbleMenuItem, NodeSelectorProps } from './types';
import { listAtSelection } from '../../extensions/list-toggle';

export const NodeSelector = ({ editor, elementRef }: NodeSelectorProps) => {
  const items: BubbleMenuItem[] = [
    {
      name: 'Text',
      icon: 'Type',
      command: () => {
        const list = listAtSelection(editor.state);
        const chain = editor.chain().focus();
        (list
          ? chain.toggleList(list.listType, list.itemType)
          : chain.toggleNode('paragraph', 'paragraph')
        ).run();
      },
      isActive: () =>
        editor.isActive('paragraph') &&
        !editor.isActive('bulletList') &&
        !editor.isActive('orderedList') &&
        !editor.isActive('taskList'),
    },
    {
      name: 'Heading 1',
      icon: 'Heading1',
      command: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
      isActive: () => editor.isActive('heading', { level: 1 }),
    },
    {
      name: 'Heading 2',
      icon: 'Heading2',
      command: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
      isActive: () => editor.isActive('heading', { level: 2 }),
    },
    {
      name: 'Heading 3',
      icon: 'Heading3',
      command: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
      isActive: () => editor.isActive('heading', { level: 3 }),
    },
    {
      name: 'To-do List',
      icon: 'ListChecks',
      command: () => editor.chain().focus().toggleTaskList().run(),
      isActive: () => editor.isActive('taskItem'),
    },
    {
      name: 'Bullet List',
      icon: 'ListOrdered',
      command: () => editor.chain().focus().toggleBulletList().run(),
      isActive: () => editor.isActive('bulletList'),
    },
    {
      name: 'Numbered List',
      icon: 'ListOrdered',
      command: () => editor.chain().focus().toggleOrderedList().run(),
      isActive: () => editor.isActive('orderedList'),
    },
    {
      name: 'Quote',
      icon: 'TextQuote',
      command: () =>
        editor
          .chain()
          .focus()
          .toggleNode('paragraph', 'paragraph')
          .toggleBlockquote()
          .run(),
      isActive: () => editor.isActive('blockquote'),
    },
    {
      name: 'Code Block',
      icon: 'Braces',
      command: () => editor.chain().focus().toggleCodeBlock().run(),
      isActive: () => editor.isActive('codeBlock'),
    },
  ];

  const activeItem = items.filter((item) => item.isActive()).pop() ?? {
    name: 'Multiple',
  };

  return (
    <DynamicDropdown
      key="NodeSelector"
      sideOffset={15}
      anchorTrigger={
        <button
          className="bg-transparent hover:!color-bg-default-hover color-text-default rounded p-1 flex items-center justify-between gap-2 w-fit max-w-36"
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="text-body-sm truncate">{activeItem.name}</span>
          <LucideIcon name="ChevronDown" size="sm" className="mt-1" />
        </button>
      }
      className="shadow-elevation-3"
      content={
        <div
          ref={elementRef}
          className="h-auto flex w-48 flex-col gap-1 overflow-hidden rounded color-bg-default p-1 color-text-default transition-all"
        >
          {items.map((item, index) => (
            <button
              key={index}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                item.command();
              }}
              className={cn(
                'flex items-center justify-between rounded-sm px-2 py-1 text-body-sm hover:color-bg-default-hover transition-all',
                {
                  'color-bg-brand hover:color-bg-brand-hover color-text-on-brand':
                    item.isActive(),
                },
              )}
            >
              <div className="flex items-center space-x-2">
                <div className="rounded color-bg-default color-text-default p-1">
                  <LucideIcon name={item.icon} size="sm" />
                </div>
                <span>{item.name}</span>
              </div>
              {activeItem.name === item.name && (
                <LucideIcon name="Check" size="sm" />
              )}
            </button>
          ))}
        </div>
      }
    />
  );
};
