import { Node, mergeAttributes } from '@tiptap/core';

export const Column = Node.create({
  name: 'column',

  content: 'dBlock+',

  isolating: true,

  addAttributes() {
    return {
      position: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-position'),
        renderHTML: (attributes) => ({ 'data-position': attributes.position }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'column' }),
      0,
    ];
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="column"]',
      },
    ];
  },
});

// Schema v2 variant: columns hold bare blocks, no dBlock wrapper.
export const FlatColumn = Column.extend({
  content: 'block+',
});

export default Column;
