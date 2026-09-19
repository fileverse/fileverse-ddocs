import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontFamilyPersistence: {
      setFontFamily: (fontFamily: string) => ReturnType;
      unsetFontFamily: () => ReturnType;
    };
  }
}

export const FontFamilyPersistence = Extension.create({
  name: 'fontFamilyPersistence',

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
      setFontFamily:
        (fontFamily: string) =>
        ({ chain, state, tr }) => {
          const existing = getExistingTextStyleAttrs(this.editor);
          // Sync to paragraph node attr directly for empty paragraphs
          const { selection } = state;
          const $pos = selection.$from;
          const node = $pos.node($pos.depth);
          if (node?.type.name === 'paragraph' && node.textContent === '') {
            tr.setNodeMarkup($pos.before($pos.depth), undefined, {
              ...node.attrs,
              fontFamily,
            });
          }
          return chain()
            .setMark(
              'textStyle',
              selection.empty ? { ...existing, fontFamily } : { fontFamily },
            )
            .run();
        },
      unsetFontFamily:
        () =>
        ({ chain, state, tr }) => {
          const existing = getExistingTextStyleAttrs(this.editor);
          // Clear the paragraph node attr directly so Plugin 3 doesn't need to
          const { selection } = state;
          const $pos = selection.$from;
          const node = $pos.node($pos.depth);
          if (node?.type.name === 'paragraph' && node.textContent === '') {
            tr.setNodeMarkup($pos.before($pos.depth), undefined, {
              ...node.attrs,
              fontFamily: null,
            });
          }
          return chain()
            .setMark(
              'textStyle',
              selection.empty
                ? { ...existing, fontFamily: null }
                : { fontFamily: null },
            )
            .removeEmptyTextStyle()
            .run();
        },
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          fontFamily: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) =>
              element.style.fontFamily?.replace(/['"]+/g, '') || null,
            renderHTML: (attributes) => {
              if (!attributes.fontFamily) {
                return {};
              }
              return {
                style: `font-family: ${attributes.fontFamily}`,
              };
            },
          },
        },
      },
    ];
  },
});
