/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/ban-ts-comment */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useLayoutEffect,
} from 'react';
import { useEditorMediaQuery } from '../../hooks/use-editor-media-query';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';
import { Editor, Extension } from '@tiptap/core';
import { getSuggestionItems, updateScrollView } from './slash-command-utils';
import { CommandItemProps } from './types';
import Suggestion from '@tiptap/suggestion';
import { cn } from '@fileverse/ui';
import { IpfsImageUploadResponse } from '../../types';

const notAllowedInsideCallout = [
  '2 Columns',
  '3 Columns',
  'Callout',
  'Quote',
  'Page breaker',
];

const notAllowedAIWriter = ['AI Writer'];

const isNodeType = (editor: Editor | null, type: string): boolean => {
  if (!editor) return false;

  const {
    selection: { $head },
  } = editor.state;

  for (let depth = $head.depth; depth >= 0; depth--) {
    const node = $head.node(depth);
    if (node?.type?.name === type) {
      return true;
    }
  }

  return false;
};

export const Command = Extension.create({
  name: 'slash-command',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: any;
        }) => {
          props.command({ editor, range });
        },
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
});

const CommandList = ({
  items: initialItems,
  command,
  editor,
}: {
  items: CommandItemProps[];
  command: any;
  editor: Editor;
  range: any;
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [items, setItems] = useState<CommandItemProps[]>(initialItems);
  const isMobile = useEditorMediaQuery('(max-width: 640px)');

  const isCalloutBlock = isNodeType(editor, 'callout');
  const isCodeBlock = isNodeType(editor, 'codeBlock');
  const isInColumn = isNodeType(editor, 'column');
  const isInTable = isNodeType(editor, 'table');

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) {
        if (item.title === 'Continue writing') {
          // we're using this for now until we can figure out a way to stream markdown text with proper formatting: https://github.com/steven-tey/novel/discussions/7
          //   complete(editor.getText())
          //   complete(editor.storage.markdown.getMarkdown())
        } else {
          command(item);
        }
      }
    },
    [command, editor, items],
  );

  useEffect(() => {
    if (isMobile) {
      const filteredItems = initialItems.filter(
        (item) =>
          !['2 Columns', '3 Columns', 'Twitter', 'Video Embed'].includes(
            item.title,
          ),
      );
      setItems(filteredItems);
    } else {
      if (isCalloutBlock) {
        const filteredItems = initialItems.filter(
          (item) => !notAllowedInsideCallout.includes(item.title),
        );
        setItems(filteredItems);
      } else if (isCodeBlock) {
        setItems([]); // Disable slash commands in code blocks
      } else if (isInColumn || isInTable) {
        setItems(
          initialItems.filter(
            (item) => !notAllowedAIWriter.includes(item.title),
          ),
        );
      } else {
        setItems(initialItems);
      }
    }
  }, [
    initialItems,
    isMobile,
    isCalloutBlock,
    isCodeBlock,
    isInColumn,
    isInTable,
  ]);

  useEffect(() => {
    const navigationKeys = ['ArrowUp', 'ArrowDown', 'Enter'];
    const onKeyDown = (e: KeyboardEvent) => {
      if (navigationKeys.includes(e.key)) {
        e.preventDefault();
        if (e.key === 'ArrowUp') {
          setSelectedIndex((selectedIndex + items.length - 1) % items.length);
          return true;
        }
        if (e.key === 'ArrowDown') {
          setSelectedIndex((selectedIndex + 1) % items.length);
          return true;
        }
        if (e.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }
        return false;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [items, selectedIndex, setSelectedIndex, selectItem]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const commandListContainer = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = commandListContainer?.current;

    const item = container?.children[selectedIndex] as HTMLElement;

    if (item && container) updateScrollView(container, item);
  }, [selectedIndex]);

  return items.length > 0 ? (
    <div
      id="slash-command"
      ref={commandListContainer}
      className="z-50 h-auto max-h-[330px] w-72 overflow-y-auto scroll-smooth rounded-lg border color-border-default color-bg-default p-2 shadow-elevation-3 transition-all"
    >
      {items.map((item: CommandItemProps, index: number) => {
        return (
          <button
            key={index}
            className={cn(
              'flex w-full items-center space-x-2 rounded-md px-2 py-1 text-left text-sm border border-transparent transition-all',
              index === selectedIndex && 'color-bg-default-hover',
              item.isDisabled
                ? 'cursor-not-allowed color-text-disabled'
                : 'hover:color-bg-default-hover cursor-pointer',
            )}
            onClick={() => !item.isDisabled && selectItem(index)}
            disabled={item.isDisabled}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-md border color-border-default color-bg-default">
              {item.icon}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{item.title}</p>
              <p
                className={cn(
                  'text-xs',
                  item.isDisabled && 'color-text-disabled',
                )}
              >
                {item.description}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  ) : null;
};

const renderItems = () => {
  let component: ReactRenderer | null = null;
  let popup: any | null = null;

  return {
    onStart: (props: { editor: Editor; clientRect: DOMRect }) => {
      component = new ReactRenderer(CommandList, {
        props,
        editor: props.editor,
      });

      // Signal that slash command is active
      window.dispatchEvent(
        new CustomEvent('slash-command-state', { detail: { isActive: true } }),
      );

      // @ts-ignore
      popup = tippy('body', {
        getReferenceClientRect: props.clientRect,
        appendTo: () => document.body,
        content: component.element,
        showOnCreate: true,
        interactive: true,
        trigger: 'manual',
        placement: 'bottom-start',
      });
    },
    onUpdate: (props: { editor: Editor; clientRect: DOMRect }) => {
      component?.updateProps(props);

      popup &&
        popup[0].setProps({
          getReferenceClientRect: props.clientRect,
        });
    },
    onKeyDown: (props: { event: KeyboardEvent }) => {
      if (props.event.key === 'Escape') {
        popup?.[0].hide();

        return true;
      }

      // @ts-ignore
      return component?.ref?.onKeyDown(props);
    },
    onExit: () => {
      // Signal that slash command is inactive
      window.dispatchEvent(
        new CustomEvent('slash-command-state', { detail: { isActive: false } }),
      );

      popup?.[0].destroy();
      component?.destroy();
    },
  };
};

export interface SlashCommandDynamicConfig {
  isConnected?: boolean;
  enableCollaboration?: boolean;
  disableInlineComment?: boolean;
}

const SlashCommand = (
  onError?: (errorString: string) => void,
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
  configRef?: { current: SlashCommandDynamicConfig },
) => {
  const items = ({ query, editor }: { query: string; editor: Editor }) => {
    const config = configRef?.current ?? {};
    return getSuggestionItems({
      query,
      onError,
      ipfsImageUploadFn,
      isConnected: config.isConnected,
      editor,
      enableCollaboration: config.enableCollaboration,
      disableInlineComment: config.disableInlineComment,
    });
  };
  return Command.configure({
    suggestion: {
      items,
      render: renderItems,
    },
  });
};

export default SlashCommand;
