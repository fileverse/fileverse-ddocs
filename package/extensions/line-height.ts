import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    lineHeight: {
      /**
       * Set the line height
       */
      setLineHeight: (lineHeight: string) => ReturnType;
      /**
       * Unset the line height
       */
      unsetLineHeight: () => ReturnType;
    };
  }
}

/**
 * Carrying the current line-height onto the next block is handled by the
 * dBlock `Enter` handler (extensions/d-block/dblock.ts), alongside the
 * fontFamily/fontSize persistence — not by an inheritance plugin here.
 *
 * Scope is selection-based, like textAlign: a collapsed cursor styles the block
 * it sits in, and whole-document is Cmd+A. It used to restyle the entire
 * document on a collapsed cursor, which stopped being defensible once the
 * selection-scoped "Custom spacing" item joined these presets in one dropdown.
 */
/** 1.15 in the UI. Exported so serializers can tell "default" from "authored". */
export const DEFAULT_LINE_HEIGHT = '138%';

export const LineHeight = Extension.create({
  name: 'lineHeight',

  addOptions() {
    return {
      types: ['paragraph', 'heading', 'listItem'],
      defaultLineHeight: DEFAULT_LINE_HEIGHT,
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: this.options.defaultLineHeight,
            parseHTML: (element) =>
              element.style.lineHeight?.replace(/['"]+/g, '') ||
              this.options.defaultLineHeight,
            renderHTML: (attributes) => {
              const lineHeight =
                attributes.lineHeight || this.options.defaultLineHeight;
              return {
                style: `line-height: ${lineHeight}`,
              };
            },
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                lineHeight,
              });
            }
          });

          if (dispatch) dispatch(tr);
          return true;
        },
      unsetLineHeight:
        () =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;

          state.doc.nodesBetween(from, to, (node, pos) => {
            if (this.options.types.includes(node.type.name)) {
              const newAttrs = { ...node.attrs };
              delete newAttrs.lineHeight;
              tr.setNodeMarkup(pos, undefined, newAttrs);
            }
          });

          if (dispatch) dispatch(tr);
          return true;
        },
    };
  },
});
