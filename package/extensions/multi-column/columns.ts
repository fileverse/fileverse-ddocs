/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  CommandProps,
  Node,
  Predicate,
  findParentNodeClosestToPos,
} from '@tiptap/core';
import { NodeSelection } from 'prosemirror-state';
import type { Node as ProseMirrorNode, NodeType } from 'prosemirror-model';
import { ColumnSelection } from './column-selection';
import {
  buildColumn,
  buildColumnBlock,
  buildDBlock,
  buildNColumns,
} from './utils';

export enum ColumnLayout {
  AlignLeft = 'align-left',
  AlignRight = 'align-right',
  AlignCenter = 'align-center',
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    columns: {
      unsetColumns: () => ReturnType;
      setColumns: (columns: number) => ReturnType;
      setLayout: (layout: ColumnLayout) => ReturnType;
    };
  }
}

export const Columns = Node.create({
  name: 'columns',

  group: 'columns',

  content: 'column{2,}',

  defining: true,

  draggable: true,

  isolating: true,

  addAttributes() {
    return {
      layout: {
        default: ColumnLayout.AlignCenter,
        // renderHTML emits layout only as a `layout-*` class; styles-mode
        // markdown carries it as data-layout (survives DOMPurify). Read both
        // so a Split View round-trip doesn't reset the layout.
        parseHTML: (element) =>
          element.getAttribute('data-layout') ||
          /layout-([\w-]+)/.exec(element.className || '')?.[1] ||
          ColumnLayout.AlignCenter,
      },
    };
  },

  addCommands() {
    return {
      unsetColumns:
        () =>
        ({ tr, dispatch }: CommandProps) => {
          try {
            if (!dispatch) {
              return;
            }

            // find the first ancestor
            const pos = tr.selection.$from;
            const where: Predicate = ({ node }: any) => {
              if (!this.options.nestedColumns && node.type == this.type) {
                return true;
              }
              return node.type == this.type;
            };
            const firstAncestor = findParentNodeClosestToPos(pos, where);
            if (firstAncestor === undefined) {
              return;
            }

            // find the content inside of all the columns
            let nodes: Array<ProseMirrorNode> = [];
            firstAncestor.node.descendants((node, _, parent) => {
              if (parent?.type.name === Columns.name) {
                nodes.push(node);
              }
            });
            nodes = nodes.reverse().filter((node) => node.content.size > 0);

            // resolve the position of the first ancestor
            const resolvedPos = tr.doc.resolve(firstAncestor.pos);
            const sel = new NodeSelection(resolvedPos);

            // insert the content inside of all the columns and remove the column layout
            tr = tr.setSelection(sel);
            nodes.forEach((node) => (tr = tr.insert(firstAncestor.pos, node)));
            tr = tr.deleteSelection();
            return dispatch(tr);
          } catch (error) {
            console.error(error);
          }
        },
      setColumns:
        (n: number, keepContent = false) =>
        ({ tr, dispatch }: CommandProps) => {
          try {
            const { doc, selection } = tr;
            if (!dispatch) {
              console.log('no dispatch');
              return;
            }

            const sel = new ColumnSelection(selection);
            sel.expandSelection(doc);

            const { openStart, openEnd } = sel.content();
            if (openStart !== openEnd) {
              console.warn('failed depth check');
              return;
            }

            // create columns and put old content in the first column
            let columnBlock;
            if (keepContent) {
              const content = sel.content().toJSON();
              const firstColumn = buildColumn(content);
              const otherColumns = buildNColumns(n - 1);
              columnBlock = buildColumnBlock({
                content: [firstColumn, ...otherColumns],
              });
            } else {
              const columns = buildNColumns(n);
              columnBlock = buildColumnBlock({ content: columns });
            }
            const newNode = doc.type.schema.nodeFromJSON(
              buildDBlock({ content: [columnBlock] }),
            );
            if (newNode === null) {
              return;
            }

            const parent = sel.$anchor.parent.type;
            const canAcceptColumnBlockChild = (par: NodeType) => {
              if (!par.contentMatch.matchType(this.type)) {
                return false;
              }

              if (!this.options.nestedColumns && par.name === Columns.name) {
                return false;
              }

              return true;
            };
            if (!canAcceptColumnBlockChild(parent)) {
              console.warn('content not allowed');
              return;
            }

            tr = tr.setSelection(sel);
            tr = tr.replaceSelectionWith(newNode, false);
            return dispatch(tr);
          } catch (error) {
            console.error(error);
          }
        },
      setLayout:
        (layout: ColumnLayout) =>
        ({ commands }) =>
          commands.updateAttributes('columns', { layout }),
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { 'data-type': 'columns', class: `layout-${HTMLAttributes.layout}` },
      0,
    ];
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="columns"]',
      },
    ];
  },
});

export default Columns;
