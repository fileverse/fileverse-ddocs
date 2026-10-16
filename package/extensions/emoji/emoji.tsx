/* eslint-disable @typescript-eslint/no-explicit-any */
import { Node } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import tippy from 'tippy.js';

import { EmojiList } from './components/emoji-list';
import { emojiSearch } from './components/emoji-utils';

export const EXTENSION_PRIORITY_HIGHEST = 200;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    emoji: {
      setEmoji: (emoji: { name: string; emoji: string }) => ReturnType;
    };
  }
}

export const EmojiPluginKey = new PluginKey('emoji');

export const Emoji = Node.create({
  name: 'emoji',
  content: 'text*',
  priority: EXTENSION_PRIORITY_HIGHEST,

  addOptions() {
    return {
      ...this.parent?.(),
      HTMLAttributes: {},
      suggestion: {
        char: '::',
        pluginKey: EmojiPluginKey,
        command: ({ editor, range, props }: any) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, `${props.emoji} `)
            .run();
        },
      },
    };
  },

  addCommands() {
    return {
      setEmoji:
        (emojiObject) =>
        ({ commands }) => {
          return commands.insertContent(`${emojiObject.emoji} `);
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
}).configure({
  suggestion: {
    items: ({ query }: any) => {
      return emojiSearch(query);
    },
    render: () => {
      let component: any;
      let popup: any;
      let isEditable: any;

      return {
        onStart: (props: any) => {
          // Results load lazily: the suggestion may have closed meanwhile.
          if (!EmojiPluginKey.getState(props.editor.state)?.active) return;
          isEditable = props.editor.isEditable;
          if (!isEditable) return;
          popup?.[0].destroy();
          component?.destroy();

          component = new ReactRenderer(EmojiList, {
            props,
            editor: props.editor,
          });

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

        onUpdate(props: any) {
          if (!isEditable || !popup) return;

          component.updateProps(props);
          popup[0].setProps({
            getReferenceClientRect: props.clientRect,
          });
        },

        onKeyDown(props: any) {
          if (!isEditable || !popup) return;

          if (props.event.key === 'Escape') {
            popup[0].hide();
            return true;
          }
          return component.ref?.onKeyDown?.(props);
        },

        onExit() {
          if (!isEditable) return;

          popup?.[0].destroy();
          component?.destroy();
          popup = component = undefined;
        },
      };
    },
  },
});
