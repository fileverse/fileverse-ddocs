import { Attributes, Extension } from '@tiptap/core';
import { FONT_SIZES } from '../../components/editor-utils';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    customFontSize: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
      increaseFontSize: () => ReturnType;
      decreaseFontSize: () => ReturnType;
    };
  }
}

export const FontSize = Extension.create({
  name: 'fontSize',

  addOptions() {
    return {
      types: ['textStyle'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          class: {},
          fontSize: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) =>
              element.style.fontSize?.replace(/['"]+/g, '') || null,
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return {
                style: `font-size: ${attributes.fontSize}`,
              };
            },
          },
        },
      },
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element) => {
              return element.style.fontSize?.replace(/['"]+/g, '') || null;
            },
            renderHTML: (attributes) => {
              if (!attributes.fontSize) {
                return {};
              }
              return {
                style: `font-size: ${attributes.fontSize}`,
              };
            },
          },
        } as Attributes,
      },
    ];
  },

  addCommands() {
    // Only a cursor needs these carried over. Over a range setMark merges each
    // run's own attrs; spreading one run's attrs would overwrite every colour.
    const getExistingTextStyleAttrs = (editor: typeof this.editor) => {
      const attrs = editor.getAttributes('textStyle');
      // Read paragraph node directly — storedMarks can be cleared by blur,
      // but node attrs persist reliably
      const { selection } = editor.state;
      const $pos = selection.$from;
      const node = $pos.node($pos.depth);
      if (node?.type.name === 'paragraph') {
        if (!attrs.fontFamily && node.attrs.fontFamily) {
          attrs.fontFamily = node.attrs.fontFamily;
        }
        if (!attrs.fontSize && node.attrs.fontSize) {
          attrs.fontSize = node.attrs.fontSize;
        }
      }
      return attrs;
    };

    return {
      setFontSize:
        (fontSize: string) =>
        ({ chain, state }) => {
          const existing = getExistingTextStyleAttrs(this.editor);
          const { selection } = state;
          return chain()
            .setMark(
              'textStyle',
              selection.empty ? { ...existing, fontSize } : { fontSize },
            )
            .run();
        },
      unsetFontSize:
        () =>
        ({ chain, state, tr }) => {
          const existing = getExistingTextStyleAttrs(this.editor);
          const { selection } = state;
          const $pos = selection.$from;
          const node = $pos.node($pos.depth);
          if (
            node?.type.name === 'paragraph' &&
            node.textContent === '' &&
            node.attrs.fontSize !== null
          ) {
            // setNodeMarkup is a step, and a step nulls tr.storedMarks; put
            // the pending marks back so the chain's setMark merges into them.
            const pending = state.storedMarks;
            tr.setNodeMarkup($pos.before($pos.depth), undefined, {
              ...node.attrs,
              fontSize: null,
            });
            if (pending) tr.setStoredMarks(pending);
          }
          return chain()
            .setMark(
              'textStyle',
              selection.empty
                ? { ...existing, fontSize: null }
                : { fontSize: null },
            )
            .removeEmptyTextStyle()
            .run();
        },
      increaseFontSize:
        () =>
        ({ chain, state }) => {
          const attrs = getExistingTextStyleAttrs(this.editor);
          let currentSizeNum = parseInt(attrs.fontSize || '16');
          if (isNaN(currentSizeNum)) currentSizeNum = 16;

          const nextSize = FONT_SIZES.find((size) => size > currentSizeNum);
          if (!nextSize) return false;

          const fontSize = `${nextSize}px`;
          const { selection } = state;
          return chain()
            .setMark(
              'textStyle',
              selection.empty ? { ...attrs, fontSize } : { fontSize },
            )
            .run();
        },
      decreaseFontSize:
        () =>
        ({ chain, state }) => {
          const attrs = getExistingTextStyleAttrs(this.editor);
          let currentSizeNum = parseInt(attrs.fontSize || '16');
          if (isNaN(currentSizeNum)) currentSizeNum = 16;

          const nextSize = [...FONT_SIZES]
            .reverse()
            .find((size) => size < currentSizeNum);
          if (!nextSize) return false;

          const fontSize = `${nextSize}px`;
          const { selection } = state;
          return chain()
            .setMark(
              'textStyle',
              selection.empty ? { ...attrs, fontSize } : { fontSize },
            )
            .run();
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-.': () => this.editor.commands.increaseFontSize(),
      'Mod-Shift-,': () => this.editor.commands.decreaseFontSize(),
    };
  },
});
