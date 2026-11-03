/* eslint-disable @typescript-eslint/no-explicit-any */
import { mergeAttributes, Node } from '@tiptap/core';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from 'prosemirror-state';
import { wrapBlockNode } from '../../utils/block-schema';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { PageBreakNodeView } from './page-break-node-view';

export interface PageBreakRuleOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /**
       * Add a page break
       */
      setPageBreak: () => ReturnType;
      /**
       * Page break for the keyboard shortcut: at the caret in a top-level
       * paragraph or heading, otherwise after the enclosing top-level block
       * (or the selected block). False in a code block or with nothing to
       * anchor to (AllSelection, top-level gap cursor)
       */
      insertPageBreakAtCaret: () => ReturnType;
      /**
       * Remove a page break
       */
      unsetPageBreak: () => ReturnType;
    };
  }
}

export const PageBreak = Node.create<PageBreakRuleOptions>({
  name: 'pageBreak',

  addOptions() {
    return {
      HTMLAttributes: {
        style: 'page-break-after: always',
        'data-page-break': 'true',
      },
    };
  },

  group: 'pageBreak',

  parseHTML() {
    return [
      {
        tag: 'br[data-type="page-break"]',
      },
      {
        tag: 'div[data-type="page-break"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['br', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)];
  },

  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ chain, state }) => {
          const pos = state.selection.from;
          const { $head } = state.selection;
          const currentNode = $head.node($head.depth);
          const isCurrentNodeEmpty =
            currentNode?.textContent === '' &&
            currentNode?.type.name === 'paragraph';

          return chain()
            .insertContentAt(
              {
                from: pos - (isCurrentNodeEmpty ? 2 : 0),
                to: pos,
              },
              {
                type: this.name,
              },
            )
            .focus()
            .run();
        },

      insertPageBreakAtCaret:
        () =>
        ({ state, tr, dispatch, commands }) => {
          const { selection } = state;
          const { $head } = selection;
          const parent = $head.parent;
          if (parent.type.name === 'codeBlock') return false;

          // A selected block: the break goes after its top-level block.
          let afterBlock: number | null = null;
          if (selection instanceof NodeSelection && selection.node.isBlock) {
            afterBlock =
              selection.$from.depth === 0
                ? selection.to
                : selection.$from.after(1);
          } else {
            const topDepth = state.schema.nodes.dBlock ? 2 : 1;
            const isDirect =
              $head.depth === topDepth &&
              (parent.type.name === 'paragraph' ||
                parent.type.name === 'heading');
            if (isDirect) return commands.setPageBreak();
            // AllSelection or a gap cursor at the top level.
            if ($head.depth < 1) return false;
            afterBlock = $head.after(1);
          }

          if (dispatch) {
            const breakNode = state.schema.nodes[this.name].create();
            tr.insert(afterBlock, breakNode);
            const next = afterBlock + breakNode.nodeSize;
            if (next >= tr.doc.content.size) {
              const empty = state.schema.nodeFromJSON(
                wrapBlockNode(state.schema, { type: 'paragraph' }),
              );
              tr.insert(next, empty);
            }
            tr.setSelection(TextSelection.near(tr.doc.resolve(next), 1));
            dispatch(tr.scrollIntoView());
          }
          return true;
        },

      unsetPageBreak:
        () =>
        ({ chain }) => {
          return chain().deleteSelection().deleteCurrentNode().run();
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pageBreakPlugin'),
        props: {
          handleClick: (view, pos, event) => {
            const target = event.target as HTMLElement;

            if (target.classList.contains('remove-page-break-icon')) {
              const { state, dispatch } = view;

              const node = state.doc.nodeAt(pos);

              if (node?.type.name === 'pageBreak') {
                const tr = state.tr;
                const nodeSize = node.nodeSize;

                tr.delete(pos, pos + nodeSize);

                dispatch(tr.scrollIntoView());

                return true;
              }
            }
            return false;
          },
          handleTextInput: (view, from) => {
            const { state } = view;
            const node = state.doc.nodeAt(from);

            // Prevent text input if it would replace a page break
            if (node?.type.name === 'pageBreak') {
              return true;
            }

            // Check if text input would affect a previous page break. At the
            // start of the document there is no previous position to inspect.
            const nodeAtPos = from > 0 ? state.doc.nodeAt(from - 1) : null;
            if (nodeAtPos?.type.name === 'pageBreak') {
              return true;
            }

            return false;
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PageBreakNodeView);
  },
});
