/* eslint-disable @typescript-eslint/no-explicit-any */
import { Node, mergeAttributes } from '@tiptap/react';
import { CoverSelectionNodeViewRenderer } from '../cover-selection-node-view';
import { AIWriterNodeView } from './ai-writer-node-view';

export interface AIWriterOptions {
  HTMLAttributes: Record<string, any>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    aiWriter: {
      /**
       * Add a prompt card
       */
      insertAIWriter: (options: {
        prompt: string;
        content: string;
        tone: string;
      }) => ReturnType;
    };
  }
}

export const AIWriter = Node.create<AIWriterOptions>({
  name: 'aiWriter',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'ai-writer',
      },
    };
  },

  addAttributes() {
    return {
      prompt: {
        default: '',
      },
      content: {
        default: '',
      },
      tone: {
        default: 'Conversational',
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="ai-writer"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(
        this.options.HTMLAttributes,
        { 'data-type': 'ai-writer' },
        HTMLAttributes,
      ),
    ];
  },

  addNodeView() {
    return CoverSelectionNodeViewRenderer(AIWriterNodeView);
  },

  addCommands() {
    return {
      insertAIWriter:
        (options) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              prompt: options.prompt,
              content: options.content,
              tone: options.tone,
            },
          });
        },
    };
  },
});
