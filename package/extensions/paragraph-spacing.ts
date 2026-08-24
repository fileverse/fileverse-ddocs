import { Extension, type CommandProps } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isChangeOrigin } from '@tiptap/extension-collaboration';

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
          // `return`, never `return false`: a container we skip still has to
          // be descended into to reach the item the cursor is really in.
          if (!ownsSpacingAt(node, pos, from, to)) return;
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

      // Wrapping a block into a list (toggleBulletList, the `- ` input rule,
      // a slash command, paste) keeps the paragraph's attributes and gives the
      // new listItem none. The paragraph then renders a margin that nothing
      // can reach: setParagraphSpacing skips a paragraph inside a listItem,
      // and so do readSpacingSelection/readEffectiveSpacing — so the dialog
      // never shows the value, the toggles never see it, and setting spacing
      // on the item adds a SECOND gap on top of it.
      //
      // The item owns the gap, so move it there. Ranges come from the step
      // maps like the plugin above, which keeps this off the hot path.
      //
      // Local edits only, matching blockId's plugin: a peer running this same
      // extension normalised its own edit before sending it, so re-doing the
      // work here would only race that peer and put a write triggered by
      // someone else's edit on OUR undo stack. Every way the bad shape is
      // produced — wrapping a block into a list, pasting, importing — is a
      // local transaction, so the guard costs nothing real.
      new Plugin({
        key: new PluginKey('paragraphSpacingListOwnership'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (transactions.some(isChangeOrigin)) return null;

          const ranges: [number, number][] = [];
          transactions.forEach((transaction) => {
            if (!transaction.docChanged) return;
            transaction.steps.forEach((step) => {
              step.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
                ranges.push([newStart, newEnd]);
              });
            });
          });
          if (!ranges.length) return null;

          const tr = newState.tr;
          const docSize = newState.doc.content.size;
          const seen = new Set<number>();
          let modified = false;

          ranges.forEach(([start, end]) => {
            const from = Math.max(0, Math.min(start, docSize));
            const to = Math.max(0, Math.min(end, docSize));

            newState.doc.nodesBetween(from, to, (item, itemPos) => {
              if (item.type.name !== 'listItem') return;
              // Overlapping step ranges can visit one item twice.
              if (seen.has(itemPos)) return;
              seen.add(itemPos);

              // Only the gaps at the item's OWN edges belong to the item:
              // the first child's top margin and the last child's bottom one.
              // An interior gap — between two paragraphs inside one item — is
              // something a listItem cannot express, so it stays where it is.
              // Clearing it too would silently destroy authored spacing on
              // every open, since this runs over the whole document on load.
              //
              // Both guards also check the child is a paragraph AND is the
              // item's first/last child: an item ending in a nested list would
              // otherwise move that paragraph's gap below the whole sublist.
              let firstChild: [number, ProseMirrorNode] | null = null;
              let lastChild: [number, ProseMirrorNode] | null = null;
              item.forEach((child, offset, index) => {
                const entry: [number, ProseMirrorNode] = [
                  itemPos + 1 + offset,
                  child,
                ];
                if (index === 0) firstChild = entry;
                if (index === item.childCount - 1) lastChild = entry;
              });

              const lifted: Record<string, number> = {};
              // pos -> the attributes to null out there. A single-paragraph
              // item is its own first AND last child, so both edges have to
              // merge into one setNodeMarkup rather than overwrite each other.
              const cleared = new Map<number, Set<string>>();

              const takeEdge = (
                entry: [number, ProseMirrorNode] | null,
                attribute: 'spaceBefore' | 'spaceAfter',
              ) => {
                if (!entry) return;
                const [childPos, child] = entry;
                if (child.type.name !== 'paragraph') return;
                if (child.attrs[attribute] === null) return;
                // An attribute the item already carries wins: that is the one
                // the dialog and the toggles read back.
                if (item.attrs[attribute] === null) {
                  lifted[attribute] = child.attrs[attribute];
                }
                const attributes = cleared.get(childPos) ?? new Set<string>();
                attributes.add(attribute);
                cleared.set(childPos, attributes);
              };

              takeEdge(firstChild, 'spaceBefore');
              takeEdge(lastChild, 'spaceAfter');
              if (!cleared.size) return;

              cleared.forEach((attributes, childPos) => {
                const child = newState.doc.nodeAt(childPos);
                if (!child) return;
                const patch: Record<string, null> = {};
                attributes.forEach((attribute) => (patch[attribute] = null));
                tr.setNodeMarkup(childPos, undefined, {
                  ...child.attrs,
                  ...patch,
                });
              });
              if (Object.keys(lifted).length) {
                tr.setNodeMarkup(itemPos, undefined, {
                  ...item.attrs,
                  ...lifted,
                });
              }
              modified = true;
            });
          });

          return modified ? tr : null;
        },
      }),
    ];
  },
});

/**
 * Whether a block the selection passes through is one the selection is really
 * IN, rather than a container wrapped around it.
 *
 * nodesBetween reports every ancestor spanning the range. That is harmless for
 * paragraphs and headings, which cannot nest — but a list item holds its
 * sublist inside it, so a cursor in a sub-bullet also reports the parent item,
 * the grandparent item, and so on to the top of the list. Left unchecked, one
 * "add space" puts a gap on every bullet up the chain, and reading back drags
 * the dialog to 'mixed' and flips the Add/Remove toggle using an ancestor's
 * value.
 *
 * An item owns the selection only where the range touches its OWN content — a
 * direct textblock child. A range that merely passes through a non-textblock
 * child (the nested list) belongs to the item inside it, not to this one.
 *
 * Written against node shape rather than node names so it holds for any
 * nesting container, in either schema version.
 */
export const ownsSpacingAt = (
  node: ProseMirrorNode,
  pos: number,
  from: number,
  to: number,
): boolean => {
  // A textblock's content is inline: a range inside it is inside the block.
  if (node.isTextblock) return true;

  let owns = false;
  node.forEach((child, offset) => {
    if (owns || !child.isTextblock) return;
    const start = pos + 1 + offset;
    if (from <= start + child.nodeSize && to >= start) owns = true;
  });
  return owns;
};

const parsePt = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const match = /^(-?\d*\.?\d+)pt$/.exec(value.trim());
  return match ? Number.parseFloat(match[1]) : null;
};

const renderPt = (property: string, value: unknown) =>
  typeof value === 'number' ? { style: `${property}: ${value}pt` } : {};
