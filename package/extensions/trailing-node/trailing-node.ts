import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
function nodeEqualsType({ types, node }) {
  if (!node?.type) {
    return false;
  }

  return (
    (Array.isArray(types) && types.includes(node.type)) || node.type === types
  );
}

/**
 * Extension based on:
 * - https://github.com/ueberdosis/tiptap/blob/v1/packages/tiptap-extensions/src/extensions/TrailingNode.js
 * - https://github.com/remirror/remirror/blob/e0f1bec4a1e8073ce8f5500d62193e52321155b9/packages/prosemirror-trailing-node/src/trailing-node-plugin.ts
 */

export interface TrailingNodeOptions {
  node: string;
  notAfter: string[];
}

export const TrailingNode = Extension.create<TrailingNodeOptions>({
  name: 'trailingNode',

  addOptions() {
    return {
      node: 'paragraph',
      notAfter: ['paragraph'],
    };
  },

  addProseMirrorPlugins() {
    const plugin = new PluginKey(this.name);
    const disabledNodes = Object.entries(this.editor.schema.nodes)
      .map(([, value]) => value)
      .filter((node) => this.options.notAfter.includes(node.name));

    return [
      new Plugin({
        key: plugin,
        appendTransaction: (transactions, __, state) => {
          const { doc, tr, schema } = state;

          const shouldInsertNodeAtEnd = plugin.getState(state);

          // Path 1: trailing node doesn't exist yet — insert it with inherited line height
          if (shouldInsertNodeAtEnd) {
            const endPosition = doc.content.size;
            const type = schema.nodes[this.options.node];

            // Find the last paragraph in the last dBlock, traversing into
            // callouts, blockquotes, tables, etc.
            const lastChild = doc.lastChild;
            let lineHeight: string | null = null;
            if (lastChild?.type.name === 'dBlock') {
              lastChild.descendants((node) => {
                if (node.type.name === 'paragraph') {
                  lineHeight = node.attrs.lineHeight || null;
                }
              });
            }

            const styledNode = type.create({
              class: 'trailing-node',
              // Omit when absent so the schema default applies
              ...(lineHeight ? { lineHeight } : {}),
            });

            return tr.insert(endPosition, styledNode);
          }

          // Path 2: trailing node already exists — sync its line height from
          // the previous sibling when it changes inside callouts/blockquotes.
          // Guards: only on doc changes, only if trailing node exists, only if
          // previous sibling's line height actually changed, skip if cursor is inside
          // the trailing node (user manually changed it).
          const hasDocChange = transactions.some((t) => t.docChanged);
          if (!hasDocChange) return null;

          // Find the trailing node (last paragraph with class='trailing-node')
          const lastDBlock = doc.lastChild;
          if (lastDBlock?.type.name !== 'dBlock') return null;

          let trailingPara: typeof lastDBlock | null = null;
          let trailingParaPos = -1;
          const lastDBlockStart = doc.content.size - lastDBlock.nodeSize;
          lastDBlock.descendants((node, pos) => {
            if (node.type.name === 'paragraph') {
              trailingPara = node;
              // pos is relative to lastDBlock start; +1 for the dBlock's own token
              trailingParaPos = lastDBlockStart + 1 + pos;
            }
          });

          if (
            !trailingPara ||
            (trailingPara as typeof lastDBlock).attrs.class !== 'trailing-node'
          ) {
            return null;
          }

          // Skip if cursor is inside the trailing node (user is editing it)
          const cursorPos = state.selection.$from.pos;
          const trailingEnd =
            trailingParaPos + (trailingPara as typeof lastDBlock).nodeSize;
          if (cursorPos >= trailingParaPos && cursorPos <= trailingEnd)
            return null;

          // Read line height from the second-to-last dBlock's last paragraph
          if (doc.childCount < 2) return null;
          const prevDBlock = doc.child(doc.childCount - 2);
          let prevLineHeight: string | null = null;
          prevDBlock.descendants((node) => {
            if (node.type.name === 'paragraph') {
              prevLineHeight = node.attrs.lineHeight || null;
            }
          });

          // Skip if line height hasn't changed
          const currentAttrs = (trailingPara as typeof lastDBlock).attrs;
          const nextLineHeight = prevLineHeight ?? currentAttrs.lineHeight;
          if (nextLineHeight === currentAttrs.lineHeight) {
            return null;
          }

          // Update the trailing node's line height
          const updateTr = state.tr;
          updateTr.setNodeMarkup(trailingParaPos, undefined, {
            ...currentAttrs,
            lineHeight: nextLineHeight,
          });
          return updateTr;
        },
        state: {
          init: (_, state) => {
            const lastNode = state.tr.doc.lastChild;

            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          },
          apply: (tr, value) => {
            if (!tr.docChanged) return value;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const lastNode = (tr.doc.lastChild?.content as any)?.content?.[0];

            return !nodeEqualsType({ node: lastNode, types: disabledNodes });
          },
        },
      }),
    ];
  },
});
