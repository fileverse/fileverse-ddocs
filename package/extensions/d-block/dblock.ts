/* eslint-disable @typescript-eslint/no-explicit-any */
import { Dispatch, Node, mergeAttributes } from '@tiptap/core';
import { DBlockNodeView } from './dblock-node-view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Transaction } from '@tiptap/pm/state';
import {
  CARET_MARKS_ATTR,
  caretStyle,
  filterSplittable,
  stampAttrs,
} from '../caret-marks/caret-style';
import { IpfsImageUploadResponse } from '../../types';
import { Plugin, PluginKey } from 'prosemirror-state';
import type { DBlockRuntimeState } from './dblock-runtime';
import { createDBlockCollapsePlugin } from './dblock-collapse';
import { createDBlockMediaConversionPlugin } from './dblock-media-plugin';
import { createDBlockPasteNormalizerPlugin } from './dblock-paste-normalizer';

export interface DBlockOptions {
  HTMLAttributes: Record<string, any>;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  hasAvailableModels: boolean;
  getRuntimeState?: () => DBlockRuntimeState;
  // Consumed by the node view's read-only-preview heading chrome; the
  // editing-mode equivalent lives in the floating drag-handle cluster.
  onCopyHeadingLink?: (link: string) => void;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dBlock: {
      setDBlock: (position?: number) => ReturnType;
    };
  }
}

// Block attrs a hand-built v1 block carries from the block being left;
// spaceBefore is dropped when leaving a heading, whose section gap would
// otherwise repeat on the body text below on every Enter (TEC-2701).
const carriedBlockAttrs = (
  node: ProseMirrorNode,
  spacingOwner: ProseMirrorNode = node,
) => {
  const isLeavingHeading = node.type.name === 'heading';
  const spaceBefore = spacingOwner.attrs.spaceBefore ?? null;
  const spaceAfter = spacingOwner.attrs.spaceAfter ?? null;
  return {
    ...(node.attrs.lineHeight ? { lineHeight: node.attrs.lineHeight } : {}),
    ...(spaceBefore !== null && !isLeavingHeading ? { spaceBefore } : {}),
    ...(spaceAfter !== null ? { spaceAfter } : {}),
    ...(node.attrs.textAlign ? { textAlign: node.attrs.textAlign } : {}),
  };
};

// The emptied left line is what is left of the block that was split: it keeps
// that block's own attrs (no heading carve-out — that is for the new block),
// which insertContentAt's fitter would otherwise reset to defaults.
const ownBlockAttrs = (node: ProseMirrorNode) => ({
  lineHeight: node.attrs.lineHeight,
  spaceBefore: node.attrs.spaceBefore,
  spaceAfter: node.attrs.spaceAfter,
  textAlign: node.attrs.textAlign,
});

export const DBlock = Node.create<DBlockOptions>({
  name: 'dBlock',

  priority: 1000,

  group: 'dBlock',

  content: '(block|columns)',

  draggable: true,

  selectable: false,

  inline: false,

  addOptions() {
    return {
      HTMLAttributes: {},
      hasAvailableModels: false,
      getRuntimeState: undefined,
      onCopyHeadingLink: undefined,
    };
  },

  addAttributes() {
    return {
      isCorrupted: {
        default: false,
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="d-block"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: any }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'd-block' }),
      0,
    ];
  },

  addCommands() {
    return {
      setDBlock:
        (position) =>
        ({ state, chain }) => {
          const {
            selection: { from },
          } = state;

          const pos =
            position !== undefined || position !== null ? from : position;

          return chain()
            .insertContentAt(pos, {
              type: this.name,
              content: [
                {
                  type: 'paragraph',
                },
              ],
            })
            .focus(pos + 2)
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-0': () => this.editor.commands.setDBlock(),
      Enter: ({ editor }) => {
        const { state } = editor;
        const {
          selection: { $head, from, to },
          doc,
        } = state;

        const currentNode = $head.node($head.depth);
        const parent = $head.node($head.depth - 1);
        if (!currentNode.isTextblock) return false;

        // The style the new line inherits (docs/FORMATTING_INHERITANCE.md 3.4):
        // captured before anything is built, declared last in every chain.
        const style = filterSplittable(caretStyle(state, currentNode), editor);
        const sourceWasEmpty = currentNode.content.size === 0;
        const declare = ({ tr }: { tr: Transaction }) => {
          tr.setStoredMarks(style);
          return true;
        };

        const headString = $head.toString();
        const nodePaths = headString.split('/');
        const isAtEndOfTheNode = $head.end() === from;
        const isAtStartOfTheNode = $head.start() === from;
        const isInsideTable = nodePaths.some((path) => path.includes('table'));

        if (
          parent?.type.name === 'listItem' ||
          parent?.type.name === 'taskItem'
        ) {
          if (isInsideTable) return false;

          const isCurrentItemEmpty = currentNode.textContent === '';
          const grandParent = $head.node($head.depth - 2);
          const currentIndex = $head.index($head.depth - 2);
          const isLastItem = currentIndex === grandParent.childCount - 1;

          let listDepth = 0;
          for (let d = $head.depth - 1; d >= 0; d--) {
            const node = $head.node(d);
            if (
              node?.type.name === 'listItem' ||
              node?.type.name === 'taskItem'
            ) {
              listDepth++;
            }
          }
          const isTopLevelList = listDepth === 1;

          if (isCurrentItemEmpty && isTopLevelList) {
            const listNode = $head.node($head.depth - 2);
            const currentItem = listNode.child(currentIndex);
            const currentItemStart = $head.before($head.depth - 1);
            const currentItemEnd = currentItemStart + currentItem.nodeSize;

            let hasNestedContent = false;
            currentItem.forEach((node) => {
              if (
                node.type.name === 'bulletList' ||
                node.type.name === 'orderedList'
              ) {
                hasNestedContent = true;
              }
            });
            if (hasNestedContent) return false;

            if (isLastItem) {
              // setParagraphSpacing writes a bullet's spacing on the listItem
              // and skips its paragraph; a task item has no spacing attrs, so
              // its paragraph owns them.
              const spacingOwner =
                parent.type.name === 'listItem' ? parent : currentNode;
              editor
                .chain()
                .deleteRange({ from: currentItemStart, to: currentItemEnd })
                .insertContentAt(currentItemStart, {
                  type: 'dBlock',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: carriedBlockAttrs(currentNode, spacingOwner),
                    },
                  ],
                })
                .focus()
                .command(declare)
                .run();
              return true;
            }

            editor
              .chain()
              .deleteRange({ from: currentItemStart, to: currentItemEnd })
              .run();
            return true;
          }
          if (isCurrentItemEmpty && !isTopLevelList) {
            // Only an item that is just this empty line moves; with other
            // content, ListToggle splits the line off (LIST_TOGGLE.md §3.10).
            if (parent.childCount > 1) return false;
            // The block is moved, not created: it keeps its own stamp.
            const itemType = parent.type.name as 'listItem' | 'taskItem';
            if (!editor.can().liftListItem(itemType)) return false;
            editor.chain().liftListItem(itemType).run();
            return true;
          }
        }

        if (
          parent?.type.name === 'blockquote' &&
          currentNode.type.name === 'paragraph' &&
          currentNode.textContent === ''
        ) {
          // insertContentAt replaces the empty line and leaves the caret in the
          // new paragraph. A focus(from + 2) here aimed past it, the chain
          // failed, and the keymap fell through to core Enter (root cause 5).
          editor
            .chain()
            .insertContentAt(from, {
              type: 'dBlock',
              content: [
                { type: 'paragraph', attrs: carriedBlockAttrs(currentNode) },
              ],
            })
            .focus()
            .command(declare)
            .run();
          return true;
        }

        if (parent?.type.name !== 'dBlock') {
          if (isInsideTable) return false;
        }

        if (parent?.type.name === 'dBlock') {
          let currentActiveNodeTo = -1;
          let currentActiveNodeType = '';

          doc.descendants((node, pos) => {
            if (currentActiveNodeTo !== -1) return false;
            if (node.type.name === this.name) return;

            const [nodeFrom, nodeTo] = [pos, pos + node.nodeSize];

            if (nodeFrom <= from && to <= nodeTo) {
              currentActiveNodeTo = nodeTo;
              currentActiveNodeType = node.type.name;
            }
            return false;
          });

          const content = doc
            .slice(from, currentActiveNodeTo)
            ?.toJSON().content;

          try {
            if (currentActiveNodeType === 'codeBlock') {
              // Defer to CustomCodeBlockLowlight's Enter handler, which
              // implements single-newline insertion and triple-Enter exit.
              return false;
            }

            if (
              ['columns', 'heading'].includes(currentActiveNodeType) &&
              isAtEndOfTheNode
            ) {
              editor
                .chain()
                .insertContent({
                  type: 'dBlock',
                  content: [
                    {
                      type: 'paragraph',
                      attrs: carriedBlockAttrs(currentNode),
                    },
                  ],
                })
                .focus(from + 4)
                .command(declare)
                .run();
              return true;
            } else if (
              currentActiveNodeType === 'columns' ||
              (currentActiveNodeType === 'heading' && !isAtStartOfTheNode)
            ) {
              editor
                .chain()
                .command(
                  ({
                    tr,
                    dispatch,
                  }: {
                    tr: Transaction;
                    dispatch: Dispatch;
                  }) => {
                    if (dispatch) {
                      tr.insertText('\n');
                    }
                    return true;
                  },
                )
                .focus(from)
                .run();
              return true;
            }

            const finalContent =
              content && content.length > 0 && !isAtEndOfTheNode
                ? content
                : [
                    {
                      type: 'paragraph',
                      attrs: carriedBlockAttrs(currentNode),
                    },
                  ];
            const originalPos = $head.before();

            editor
              .chain()
              .insertContentAt(
                { from, to: currentActiveNodeTo },
                {
                  type: this.name,
                  content: finalContent,
                },
              )
              .command(({ tr }) => {
                // Enter at offset 0 moves the text on and leaves this line
                // empty behind the caret, where no rule reaches it (spec 3.2).
                if (isAtStartOfTheNode && !sourceWasEmpty) {
                  const left = tr.doc.nodeAt(originalPos);
                  if (
                    left?.isTextblock &&
                    left.content.size === 0 &&
                    CARET_MARKS_ATTR in left.attrs
                  ) {
                    tr.setNodeMarkup(
                      originalPos,
                      undefined,
                      stampAttrs(
                        { ...left.attrs, ...ownBlockAttrs(currentNode) },
                        style,
                      ),
                    );
                  }
                }
                return true;
              })
              .focus(from + 4)
              .command(declare)
              .run();
            return true;
          } catch (error) {
            console.error(`Error inserting content into dBlock node: ${error}`);
            return false;
          }
        }

        return false;
      },
      Backspace: ({ editor }) => {
        const {
          selection: { $head, from, to },
          doc,
        } = editor.state;

        // Handle selection deletion first
        if (from !== to) {
          if (from <= 2) {
            return false;
          }
          return editor.chain().deleteSelection().focus().run();
        }

        const parent = $head.node($head.depth - 1);
        const node = $head.node($head.depth);
        const isNodeEmpty = node?.textContent === '';

        // If not in a dBlock, handle special cases
        if (parent?.type.name !== 'dBlock') {
          // Handle page break
          let isPrevNodePageBreak = false;
          let currentNodePos = -1;

          doc.descendants((node, pos) => {
            if (currentNodePos !== -1) return false;
            if (node.type.name === 'pageBreak' && pos < from) {
              isPrevNodePageBreak = true;
              currentNodePos = pos;
            }
          });

          if (
            isPrevNodePageBreak &&
            isNodeEmpty &&
            from === currentNodePos + 2
          ) {
            return true;
          }
        }

        return false;
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos, decorations, HTMLAttributes }) =>
      new DBlockNodeView({
        node,
        editor,
        getPos: getPos as () => number,
        decorations,
        HTMLAttributes,
        getRuntimeState: this.options.getRuntimeState,
        onCopyHeadingLink: this.options.onCopyHeadingLink,
      });
  },

  addProseMirrorPlugins() {
    const plugins = [
      createDBlockCollapsePlugin(),
      createDBlockMediaConversionPlugin(this.options.getRuntimeState),
      createDBlockPasteNormalizerPlugin(),
    ];

    if (!this.options.hasAvailableModels) {
      return plugins;
    }

    return [
      ...plugins,
      new Plugin({
        key: new PluginKey('dblock-aiwriter-space'),
        props: {
          handleTextInput: (view, from, _to, text) => {
            // Only interested in single space
            if (text !== ' ') return false;

            const { state, dispatch } = view;
            const { $from } = state.selection;
            const parent = $from.node($from.depth - 1);
            const node = $from.node($from.depth);

            // Cheap checks first — bail early before any doc traversal.
            // Only trigger in dBlock > paragraph, and only if paragraph is empty
            if (
              parent?.type?.name !== 'dBlock' ||
              node?.type?.name !== 'paragraph' ||
              node.textContent !== ''
            ) {
              return false;
            }

            // Check if previous char is also a space (double space)
            const prevChar = state.doc.textBetween(from - 1, from, '\0');
            if (prevChar === ' ') {
              return false;
            }

            // Only now do the expensive check — we're about to insert aiWriter
            let hasActiveAIWriter = false;
            view.state.doc.descendants((node) => {
              if (node.type.name === 'aiWriter') {
                hasActiveAIWriter = true;
                return false;
              }
              return true;
            });

            if (hasActiveAIWriter) {
              return false;
            }

            // Replace the empty paragraph with aiWriter node
            const aiWriterNode = state.schema.nodes.aiWriter.create({
              prompt: '',
              content: '',
              tone: 'neutral',
            });
            const tr = state.tr.replaceRangeWith(
              $from.before(),
              $from.after(),
              aiWriterNode,
            );
            dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

export const createDBlockExtension = (options: Partial<DBlockOptions> = {}) =>
  DBlock.configure(options);
