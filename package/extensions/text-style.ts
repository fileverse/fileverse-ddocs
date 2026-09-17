import { TextStyle } from '@tiptap/extension-text-style';

export const ExtendedTextStyle = TextStyle.extend({
  addCommands() {
    return {
      ...this.parent?.(),
      // Backport of Tiptap 3.30.3: older versions strip textStyle from every run
      // inside a dBlock/list/blockquote wrapper. Drop once Tiptap is upgraded.
      removeEmptyTextStyle:
        () =>
        ({ tr }) => {
          const { from, to } = tr.selection;
          tr.doc.nodesBetween(from, to, (node, pos) => {
            if (!node.isInline) return;
            const hasStyle = node.marks.some(
              (mark) =>
                mark.type === this.type &&
                Object.values(mark.attrs).some((value) => !!value),
            );
            if (!hasStyle) tr.removeMark(pos, pos + node.nodeSize, this.type);
          });
          return true;
        },
    };
  },
  addAttributes() {
    return {
      // ...this.parent?.(),
      // color: {
      //   default: null,
      //   parseHTML: (element) => element.style.color,
      //   renderHTML: (attributes) => {
      //     if (!attributes.color) {
      //       return {};
      //     }
      //     return {
      //       style: `color: ${attributes.color}`,
      //     };
      //   },
      // },
      'data-original-color': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original-color'),
        renderHTML: (attributes) => {
          if (!attributes['data-original-color']) {
            return {};
          }
          return {
            'data-original-color': attributes['data-original-color'],
          };
        },
      },
    };
  },
});
