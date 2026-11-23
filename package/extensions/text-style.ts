import { TextStyle } from '@tiptap/extension-text-style';

export const ExtendedTextStyle = TextStyle.extend({
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
