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
        // A list marker is sized by its <li>, but the size lives on the mark
        // or paragraph inside it, so a resized item ended up with a marker
        // that no longer matched its own text. Carrying the size on the item
        // lets the native marker follow it. Nothing sets this during editing —
        // it defaults to null and is applied when building slides — so normal
        // document output is unchanged.
        types: ['listItem'],
        attributes: {
          fontSize: {
            default: null,
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
        } as Attributes,
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
        ({ chain, state, tr }) => {
          const existing = getExistingTextStyleAttrs(this.editor);
          // Sync to paragraph node attr directly for empty paragraphs
          const { selection } = state;
          const $pos = selection.$from;
          const node = $pos.node($pos.depth);
          if (node?.type.name === 'paragraph' && node.textContent === '') {
            tr.setNodeMarkup($pos.before($pos.depth), undefined, {
              ...node.attrs,
              fontSize,
            });
          }
          return chain()
            .setMark('textStyle', { ...existing, fontSize })
            .run();
        },
      unsetFontSize:
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
              fontSize: null,
            });
          }
          return chain()
            .setMark('textStyle', { ...existing, fontSize: null })
            .removeEmptyTextStyle()
            .run();
        },
      increaseFontSize:
        () =>
        ({ chain, state, tr }) => {
          const attrs = getExistingTextStyleAttrs(this.editor);
          let currentSizeNum = parseInt(attrs.fontSize || '16');
          if (isNaN(currentSizeNum)) currentSizeNum = 16;

          const nextSize = FONT_SIZES.find((size) => size > currentSizeNum);
          if (!nextSize) return false;

          const fontSize = `${nextSize}px`;
          const { selection } = state;
          const $pos = selection.$from;
          const node = $pos.node($pos.depth);
          if (node?.type.name === 'paragraph' && node.textContent === '') {
            tr.setNodeMarkup($pos.before($pos.depth), undefined, {
              ...node.attrs,
              fontSize,
            });
          }
          return chain()
            .setMark('textStyle', { ...attrs, fontSize })
            .run();
        },
      decreaseFontSize:
        () =>
        ({ chain, state, tr }) => {
          const attrs = getExistingTextStyleAttrs(this.editor);
          let currentSizeNum = parseInt(attrs.fontSize || '16');
          if (isNaN(currentSizeNum)) currentSizeNum = 16;

          const nextSize = [...FONT_SIZES]
            .reverse()
            .find((size) => size < currentSizeNum);
          if (!nextSize) return false;

          const fontSize = `${nextSize}px`;
          const { selection } = state;
          const $pos = selection.$from;
          const node = $pos.node($pos.depth);
          if (node?.type.name === 'paragraph' && node.textContent === '') {
            tr.setNodeMarkup($pos.before($pos.depth), undefined, {
              ...node.attrs,
              fontSize,
            });
          }
          return chain()
            .setMark('textStyle', { ...attrs, fontSize: `${nextSize}px` })
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
