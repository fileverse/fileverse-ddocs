/* eslint-disable @typescript-eslint/no-explicit-any */
import { Node, mergeAttributes } from '@tiptap/core';
import { replaceSelectionWithBlockNode } from '../../utils/block-insert';
import { getActionButtonView } from './action-button-node-view';
import { ReactNodeViewRenderer } from '@tiptap/react';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    actionButton: {
      /**
       * Toggle a actionButton
       */
      setActionButton: (option?: string) => ReturnType;
    };
  }
}

export interface ActionButtonOptions {
  HTMLAttributes: Record<string, any>;
  onError?: (error: string) => void;
}

export const actionButton = Node.create<ActionButtonOptions>({
  name: 'actionButton',

  group: 'block',

  content: 'block*',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
      onError: () => {},
    };
  },

  addAttributes() {
    return {
      data: {
        default: null,
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(getActionButtonView(this.options.onError));
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-action-node]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-action-node': '' }),
      0,
    ];
  },

  addCommands() {
    return {
      setActionButton:
        (option) =>
        ({ state, tr, dispatch }) => {
          const node = state.schema.nodes[this.name].create({ data: option });
          if (dispatch) {
            // Operates on `tr` (not `state`): callers chain this after
            // deleteRange (slash menu), and `state` predates the chain.
            replaceSelectionWithBlockNode(tr, node);
          }
          return true;
        },
    };
  },
});
