/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */
import cn from 'classnames';
import { DynamicDropdown, LucideIcon } from '@fileverse/ui';
import { BubbleMenuItem, NodeSelectorProps } from './types';
import { EditorState, Transaction } from 'prosemirror-state';
import { Dispatch } from '@tiptap/react';
import { Node, ResolvedPos } from 'prosemirror-model';
import { checkActiveListsAndDBlocks } from '../editor-utils';

// Types
interface ListConfig {
  type: 'bulletList' | 'orderedList' | 'taskList';
  itemType: 'listItem' | 'taskItem';
  hasAttrs?: boolean;
}

type ListConversionProps = {
  tr: Transaction;
  dispatch: Dispatch;
  state: EditorState;
  from: number;
  to: number;
  listConfig?: ListConfig;
};

type ListProcessingOptions = {
  wrapInDBlock?: boolean;
  includeIndent?: boolean;
};

// Utility functions
const TABLE_CELL_TYPES = new Set(['tableCell', 'tableHeader']);

const findTableCellDepth = ($pos: ResolvedPos) => {
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (TABLE_CELL_TYPES.has($pos.node(depth).type.name)) {
      return depth;
    }
  }

  return null;
};

const isSelectionInsideTable = (state: EditorState) => {
  const { $from, $to } = state.selection;

  return findTableCellDepth($from) !== null || findTableCellDepth($to) !== null;
};

const getTableCellSelectionRange = (state: EditorState) => {
  const { $from, $to } = state.selection;
  const fromDepth = findTableCellDepth($from);
  const toDepth = findTableCellDepth($to);

  if (fromDepth === null || toDepth === null) {
    return null;
  }

  const fromPos = $from.before(fromDepth);
  const toPos = $to.before(toDepth);

  // If selection spans multiple cells, refuse to transform to avoid destroying table structure.
  if (fromPos !== toPos) {
    return null;
  }

  return {
    from: $from.start(fromDepth),
    to: $from.end(fromDepth),
  };
};

const processListContent = (
  node: any,
  { wrapInDBlock = true, includeIndent = true }: ListProcessingOptions = {},
): any[] => {
  // Base case: if node has no content or is not a list item
  if (!node.content || !Array.isArray(node.content)) {
    return [];
  }

  const createIndentedParagraph = (content: any, level: number) => {
    const paragraphNode = {
      type: 'paragraph',
      ...(includeIndent ? { attrs: { indent: level } } : {}),
      content: content,
    };

    if (!wrapInDBlock) {
      return paragraphNode;
    }

    return {
      type: 'dBlock',
      content: [paragraphNode],
    };
  };

  // Helper function to process list items recursively
  const processListItem = (item: any, level: number = 0): any[] => {
    const result = [];

    // Process the main paragraph content with indentation
    if (item.content?.[0]?.content) {
      result.push(createIndentedParagraph(item.content[0].content, level));
    }

    // Process nested lists recursively with increased indentation
    item.content?.slice(1)?.forEach((nestedNode: any) => {
      if (['bulletList', 'orderedList', 'taskList'].includes(nestedNode.type)) {
        nestedNode.content.forEach((nestedItem: any) => {
          result.push(...processListItem(nestedItem, level + 1));
        });
      }
    });

    return result;
  };

  // Process each list item with initial indentation level
  return node.content.flatMap((item: any) => processListItem(item, 0));
};

export const convertListToParagraphs = ({
  tr,
  dispatch,
  state,
  from,
  to,
}: ListConversionProps) => {
  if (!dispatch) return true;

  const tableCellRange = getTableCellSelectionRange(state);
  const isInsideTable = isSelectionInsideTable(state);

  // Do nothing if the selection spans multiple cells.
  if (isInsideTable && !tableCellRange) {
    return false;
  }

  let calloutPos = -1;
  let calloutNode: Node | null = null as unknown as Node;
  let listContent: Node | null = null as unknown as Node;
  let listPos = -1;
  let isInsideCallout = false;

  // Traverse to find list node and its container
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'callout') {
      isInsideCallout = true;
      calloutPos = pos;
      calloutNode = node;
    }

    if (
      node.type.name === 'bulletList' ||
      node.type.name === 'orderedList' ||
      node.type.name === 'taskList'
    ) {
      listContent = node;
      listPos = pos;
      return false; // stop further traversal
    }
  });

  if (!listContent || listPos === -1) return false;

  const hasDBlock = Boolean(state.schema.nodes.dBlock);

  // Avoid dBlocks inside tables and skip indent attrs inside callouts.
  const newContent = processListContent(listContent.toJSON(), {
    wrapInDBlock: hasDBlock && !isInsideCallout && !tableCellRange,
    includeIndent: !isInsideCallout,
  });

  // Replace only the content inside the active cell to keep the table node intact.
  const paragraphNodes = newContent.map((json) =>
    state.schema.nodeFromJSON(json),
  );

  if (tableCellRange) {
    // Replace the list node inside the active cell.
    tr.replaceWith(listPos, listPos + listContent.nodeSize, paragraphNodes);

    return true;
  }

  if (isInsideCallout && calloutNode && calloutPos !== -1) {
    // Replace only the list node inside the callout
    const paragraphNodes = newContent.map((json) =>
      state.schema.nodeFromJSON(json),
    );

    tr.replaceWith(listPos, listPos + listContent.nodeSize, paragraphNodes);
  } else if (!hasDBlock) {
    // Flat schema: the list is a top-level node, swap it for the paragraphs.
    tr.replaceWith(listPos, listPos + listContent.nodeSize, paragraphNodes);
  } else {
    // Replace the whole dBlock with paragraphs
    const dBlockPos = listPos;
    const dBlockNode = state.doc.nodeAt(dBlockPos);
    if (!dBlockNode) return false;

    const fragment = state.schema.nodeFromJSON({
      type: 'doc',
      content: newContent,
    }).content;

    tr.replaceWith(dBlockPos - 1, dBlockPos + dBlockNode.nodeSize, fragment);
  }

  return true;
};

export const convertToList = ({
  tr,
  dispatch,
  state,
  from,
  to,
  listConfig,
}: ListConversionProps) => {
  if (!dispatch) return true;
  if (!listConfig?.type || !listConfig?.itemType) return false;

  const tableCellRange = getTableCellSelectionRange(state);
  const isInsideTable = isSelectionInsideTable(state);

  // Do nothing if the selection spans multiple cells.
  if (isInsideTable && !tableCellRange) {
    return false;
  }

  let isInsideCallout = false;
  let calloutNode: Node | null = null as unknown as Node;
  let calloutPos = -1;

  let firstDBlockPos = -1;
  let lastDBlockPos = -1;
  let firstBlockPos = -1;
  let lastBlockPos = -1;
  let listContent: Node | null = null as unknown as Node;
  let listContentPos = -1;
  const paragraphs: Node[] = [];

  // Step 1: Gather data from selection
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name === 'callout') {
      isInsideCallout = true;
      calloutPos = pos;
      calloutNode = node;
    }

    if (!isInsideCallout && node.type.name === 'dBlock') {
      if (firstDBlockPos === -1) firstDBlockPos = pos;
      lastDBlockPos = pos + node.nodeSize;
    }

    if (
      node.type.name === 'bulletList' ||
      node.type.name === 'orderedList' ||
      node.type.name === 'taskList'
    ) {
      listContent = node;
      listContentPos = pos;
      return false; // stop traversal
    }

    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      if (firstBlockPos === -1) firstBlockPos = pos;
      lastBlockPos = pos + node.nodeSize;

      const para =
        node.type.name === 'heading'
          ? state.schema.nodes.paragraph.create(null, node.content)
          : node;
      paragraphs.push(para);
    }
  });

  let newListContent;

  if (listContent) {
    const listJSON = listContent.toJSON();
    const convertListItems = (items: any[]): any[] =>
      items.map((item) => {
        const newItem: {
          type: string;
          attrs?: { checked: boolean };
          content: any[];
        } = {
          type: listConfig.itemType,
          ...(listConfig.hasAttrs ? { attrs: { checked: false } } : {}),
          content: [],
        };

        item.content.forEach((contentItem: any) => {
          if (contentItem.type === 'paragraph') {
            newItem.content.push(contentItem);
          } else if (
            ['bulletList', 'orderedList', 'taskList'].includes(contentItem.type)
          ) {
            newItem.content.push({
              type: listConfig.type,
              content: convertListItems(contentItem.content),
            });
          } else {
            newItem.content.push(contentItem);
          }
        });

        return newItem;
      });

    newListContent = {
      type: listConfig.type,
      content: convertListItems(listJSON.content),
    };
  } else if (paragraphs.length > 0) {
    newListContent = {
      type: listConfig.type,
      content: paragraphs.map((para) => ({
        type: listConfig.itemType,
        ...(listConfig.hasAttrs ? { attrs: { checked: false } } : {}),
        content: [para.toJSON()],
      })),
    };
  } else {
    return false;
  }

  // Replace content inside the active cell and keep the table node intact.
  if (tableCellRange) {
    const selectionFrom = Math.max(from, tableCellRange.from);
    const selectionTo = Math.min(to, tableCellRange.to);

    const listNode = state.schema.nodeFromJSON(newListContent);
    // replace the list node directly when a list already exists.
    if (listContent && listContentPos !== -1) {
      tr.replaceWith(
        listContentPos,
        listContentPos + listContent.nodeSize,
        listNode,
      );
      // replace the block(s) in the cell when no list node is present.
    } else if (firstBlockPos !== -1 && lastBlockPos !== -1) {
      tr.replaceWith(firstBlockPos, lastBlockPos, listNode);
    } else {
      // fall back to replacing the raw selection range in the cell.
      tr.replaceRangeWith(selectionFrom, selectionTo, listNode);
    }

    return true;
  }

  // ✅ Case 1: INSIDE CALLOUT (partial replacement)
  if (isInsideCallout && calloutNode && calloutPos !== -1) {
    const calloutStart = calloutPos + 1;
    const calloutEnd = calloutPos + calloutNode.nodeSize - 1;

    // Replace full list node if found
    if (listContent && listContentPos !== -1) {
      tr.replaceWith(
        listContentPos,
        listContentPos + listContent.nodeSize,
        state.schema.nodeFromJSON(newListContent),
      );
    } else {
      const selectionFrom = Math.max(from, calloutStart);
      const selectionTo = Math.min(to, calloutEnd);

      tr.replaceRangeWith(
        selectionFrom,
        selectionTo,
        state.schema.nodeFromJSON(newListContent),
      );
    }
  }

  // ✅ Case 2: NORMAL DBLOCK
  else if (firstDBlockPos !== -1 && lastDBlockPos !== -1) {
    const newDblock = state.schema.nodes.dBlock.create(null, [
      state.schema.nodeFromJSON(newListContent),
    ]);

    tr.replaceWith(firstDBlockPos, lastDBlockPos, newDblock);
  }

  // ✅ Case 3: FLAT SCHEMA (no dBlock in the doc) — replace the top-level
  // blocks in the selection with the list directly.
  else if (firstBlockPos !== -1 && lastBlockPos !== -1) {
    tr.replaceWith(
      firstBlockPos,
      lastBlockPos,
      state.schema.nodeFromJSON(newListContent),
    );
  }

  return true;
};

export const NodeSelector = ({ editor, elementRef }: NodeSelectorProps) => {
  const items: BubbleMenuItem[] = [
    {
      name: 'Text',
      icon: 'Type',
      command: () => {
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        // If it's already a list type, convert to paragraphs
        if (
          editor.isActive('bulletList') ||
          editor.isActive('orderedList') ||
          editor.isActive('taskList')
        ) {
          return editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();
        }

        // Otherwise use the default paragraph toggle
        return editor
          .chain()
          .focus()
          .toggleNode('paragraph', 'paragraph')
          .setTextSelection({ from, to })
          .focus()
          .run();
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
      command: () => {
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('taskList')) {
          return editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();
        }

        return editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'taskList',
                itemType: 'taskItem',
                hasAttrs: true,
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();
      },
      isActive: () => editor.isActive('taskItem'),
    },
    {
      name: 'Bullet List',
      icon: 'ListOrdered',
      command: () => {
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('bulletList')) {
          return editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();
        }

        return editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'bulletList',
                itemType: 'listItem',
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();
      },
      isActive: () => editor.isActive('bulletList'),
    },
    {
      name: 'Numbered List',
      icon: 'ListOrdered',
      command: () => {
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('orderedList')) {
          return editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();
        }

        return editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'orderedList',
                itemType: 'listItem',
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();
      },
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
