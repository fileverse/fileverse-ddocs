import { mergeAttributes, Node } from '@tiptap/core';
import { CoverSelectionNodeViewRenderer } from '../../cover-selection-node-view';

import { TableCellNodeView } from '../extension-table-cell/table-cell-node-view';

export interface TableHeaderOptions {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  HTMLAttributes: Record<string, any>;
}
export const TableHeader = Node.create<TableHeaderOptions>({
  name: 'tableHeader',

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  content: 'block+',

  addAttributes() {
    return {
      colspan: {
        default: 1,
      },
      rowspan: {
        default: 1,
      },
      colwidth: {
        default: null,
        parseHTML: (element) => {
          const colwidth = element.getAttribute('colwidth');
          const value = colwidth ? [parseInt(colwidth, 10)] : null;

          return value;
        },
      },
    };
  },

  tableRole: 'header_cell',

  isolating: true,

  parseHTML() {
    return [{ tag: 'th' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'th',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addNodeView() {
    return CoverSelectionNodeViewRenderer(TableCellNodeView, {
      as: 'th',
      className: 'relative',
    });
  },
});
