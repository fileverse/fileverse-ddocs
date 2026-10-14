import { Node as TiptapNode, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { EditorView } from '@tiptap/pm/view';
import { Slice, Fragment, Node as ProseMirrorNode } from 'prosemirror-model';

export const Callout = TiptapNode.create({
  name: 'callout',

  group: 'block',

  // Allow formatted content
  content: '(paragraph | bulletList | orderedList | taskList | block)+',

  defining: true,
  draggable: true,
  isolating: true,

  addOptions() {
    return {
      HTMLAttributes: {
        class:
          'color-bg-secondary border-l-4 color-border-default p-4 rounded-md',
      },
    };
  },

  addProseMirrorPlugins() {
    const pluginKey = new PluginKey('callout-block');

    return [
      new Plugin({
        key: pluginKey,
        props: {
          transformPasted(this: Plugin, slice: Slice, view: EditorView): Slice {
            const { selection } = view.state;
            const $from = selection.$from;

            let isInsideCallout = false;
            for (let depth = $from.depth; depth >= 0; depth--) {
              const node = $from.node(depth);
              if (node.type.name === 'callout') {
                isInsideCallout = true;
                break;
              }
            }

            if (!isInsideCallout) return slice;

            const isWrapper = (node: ProseMirrorNode) =>
              node.type.name === 'callout' || node.type.name === 'dBlock';

            const flattenContent = (fragment: Fragment): ProseMirrorNode[] => {
              const result: ProseMirrorNode[] = [];
              fragment.forEach((node) => {
                if (isWrapper(node)) {
                  result.push(...flattenContent(node.content));
                } else {
                  result.push(node);
                }
              });
              return result;
            };

            const flattenedNodes = flattenContent(slice.content);
            const fragment = Fragment.fromArray(flattenedNodes);

            // Only subtract wrapper levels that were removed. Partial text
            // must keep its open paragraph edges so it merges at the caret;
            // a whole copied block must keep its closed edges.
            const flattenedOpenDepth = (
              node: ProseMirrorNode | null,
              depth: number,
              edge: 'firstChild' | 'lastChild',
            ) => {
              while (node && depth > 0 && isWrapper(node)) {
                depth--;
                node = node[edge];
              }
              return depth;
            };

            return new Slice(
              fragment,
              flattenedOpenDepth(
                slice.content.firstChild,
                slice.openStart,
                'firstChild',
              ),
              flattenedOpenDepth(
                slice.content.lastChild,
                slice.openEnd,
                'lastChild',
              ),
            );
          },
        },
      }),
    ];
  },

  addAttributes() {
    return {
      dataType: {
        default: 'callout',
        parseHTML: (element) => element.getAttribute('data-type'),
        renderHTML: (attributes) => ({
          'data-type': attributes.dataType,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'aside[data-type="callout"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'aside',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});
