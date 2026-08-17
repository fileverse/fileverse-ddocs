import { Extension, type CommandProps } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

export type ParagraphSpacingAttrs = {
  /** Space above the block, in pt. `null` unsets it; omit to leave as-is. */
  spaceBefore?: number | null;
  /** Space below the block, in pt. `null` unsets it; omit to leave as-is. */
  spaceAfter?: number | null;
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphSpacing: {
      /**
       * Set space before/after on the blocks in the current selection.
       */
      setParagraphSpacing: (attrs: ParagraphSpacingAttrs) => ReturnType;
      /**
       * Clear both space before and space after on the current selection.
       */
      unsetParagraphSpacing: () => ReturnType;
    };
  }
}

/**
 * `spaceBefore` / `spaceAfter` as inline margins, in pt.
 *
 * Unlike `lineHeight`, the default is `null` — an untouched block renders no
 * inline margin at all, so the stylesheet in editor.css (including its
 * responsive overrides and :first-child resets) stays in charge. `0` is a
 * distinct, explicit value: it renders `margin-*: 0` and overrides that CSS.
 */
export const ParagraphSpacing = Extension.create({
  name: 'paragraphSpacing',

  addOptions() {
    return {
      types: ['paragraph', 'heading', 'listItem'],
    };
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          spaceBefore: {
            default: null,
            parseHTML: (element) => parsePt(element.style.marginTop),
            renderHTML: (attributes) =>
              renderPt('margin-top', attributes.spaceBefore),
          },
          spaceAfter: {
            default: null,
            parseHTML: (element) => parsePt(element.style.marginBottom),
            renderHTML: (attributes) =>
              renderPt('margin-bottom', attributes.spaceAfter),
          },
        },
      },
    ];
  },

  addCommands() {
    const apply =
      (patch: ParagraphSpacingAttrs) =>
      ({ tr, state, dispatch }: CommandProps) => {
        const { from, to } = state.selection;

        state.doc.nodesBetween(from, to, (node, pos, parent) => {
          if (!this.options.types.includes(node.type.name)) return;
          // A list item and the paragraph inside it both match, which would
          // put two gaps on one bullet. The item owns the spacing.
          if (
            node.type.name === 'paragraph' &&
            parent?.type.name === 'listItem'
          ) {
            return;
          }
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch });
        });

        if (dispatch) dispatch(tr);
        return true;
      };

    return {
      setParagraphSpacing: (attrs: ParagraphSpacingAttrs) => {
        // Only the keys actually passed are written, so the dialog can set one
        // field and leave the other alone.
        const patch: ParagraphSpacingAttrs = {};
        if ('spaceBefore' in attrs) patch.spaceBefore = attrs.spaceBefore;
        if ('spaceAfter' in attrs) patch.spaceAfter = attrs.spaceAfter;
        return apply(patch);
      },
      unsetParagraphSpacing: () =>
        apply({ spaceBefore: null, spaceAfter: null }),
    };
  },

  addProseMirrorPlugins() {
    return [
      // Splitting a block copies its attrs onto the new one, which is what we
      // want for paragraph → paragraph. It is wrong across a heading boundary:
      // a heading's section gap would land on the body text below it, on every
      // Enter, forever. (v1's dBlock Enter continues the heading type instead,
      // so this only fires on the flat v2 schema — but the rule is written
      // against the node types, not the schema version.)
      new Plugin({
        key: new PluginKey('paragraphSpacingHeadingBoundary'),
        appendTransaction: (transactions, _oldState, newState) => {
          const insertions: [number, number][] = [];
          transactions.forEach((transaction) => {
            if (!transaction.docChanged) return;
            transaction.steps.forEach((step) => {
              step.getMap().forEach((oldStart, oldEnd, newStart, newEnd) => {
                // Attribute-only edits leave sizes untouched, so a deliberate
                // spaceBefore on a paragraph under a heading is never caught.
                if (newEnd - newStart > oldEnd - oldStart) {
                  insertions.push([newStart, newEnd]);
                }
              });
            });
          });
          if (!insertions.length) return null;

          const tr = newState.tr;
          const docSize = newState.doc.content.size;
          let modified = false;

          insertions.forEach(([start, end]) => {
            const from = Math.max(0, Math.min(start, docSize));
            const to = Math.max(0, Math.min(end, docSize));
            if (to <= from) return;

            newState.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name !== 'paragraph') return;
              if (node.attrs.spaceBefore === null) return;
              // A block just split off the end of a heading is empty; anything
              // with content was pasted or typed and is left alone.
              if (node.content.size !== 0) return;

              const $pos = newState.doc.resolve(pos);
              const index = $pos.index($pos.depth);
              if (index === 0) return;
              const previous = $pos.node($pos.depth).child(index - 1);
              if (previous?.type.name !== 'heading') return;

              tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                spaceBefore: null,
              });
              modified = true;
            });
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

const parsePt = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const match = /^(-?\d*\.?\d+)pt$/.exec(value.trim());
  return match ? Number.parseFloat(match[1]) : null;
};

const renderPt = (property: string, value: unknown) =>
  typeof value === 'number' ? { style: `${property}: ${value}pt` } : {};
