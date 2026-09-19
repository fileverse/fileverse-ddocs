import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { CARET_MARKS_ATTR, parseMarks } from './caret-style';
import type { DispatchContext } from './dispatch-context';

export const caretMarksPluginKey = new PluginKey<DispatchContext>('caretMarks');
export const caretMarksDecorationKey = new PluginKey<DecorationSet>(
  'caretMarksDecoration',
);

/** Inline style an empty stamped line renders so its caret has the stamp's font. */
const emptyLineStyle = (schema: Schema, attr: unknown): string | null => {
  if (typeof attr !== 'string' || attr === '[]') return null;
  const textStyle = parseMarks(schema, attr).find(
    (mark) => mark.type.name === 'textStyle',
  );
  if (!textStyle) return null;
  const parts: string[] = [];
  if (textStyle.attrs.fontFamily)
    parts.push(`font-family: ${textStyle.attrs.fontFamily}`);
  if (textStyle.attrs.fontSize)
    parts.push(`font-size: ${textStyle.attrs.fontSize}`);
  return parts.length ? parts.join('; ') : null;
};

const decorationsBetween = (doc: ProseMirrorNode, from: number, to: number) => {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isTextblock) return true;
    if (node.content.size === 0) {
      const style = emptyLineStyle(
        doc.type.schema,
        node.attrs[CARET_MARKS_ATTR],
      );
      if (style)
        decorations.push(Decoration.node(pos, pos + node.nodeSize, { style }));
    }
    return false;
  });
  return decorations;
};

// A decoration, not renderHTML: ProseMirror reuses a <p> whose attrs are
// unchanged, so markup could not follow the block as it gains or loses text.
// Only the top-level blocks a transaction touched are re-scanned (TEC-3008).
const decorationPlugin = () =>
  new Plugin<DecorationSet>({
    key: caretMarksDecorationKey,
    state: {
      init: (_, state) =>
        DecorationSet.create(
          state.doc,
          decorationsBetween(state.doc, 0, state.doc.content.size),
        ),
      apply: (tr, set) => {
        if (!tr.docChanged) return set;
        let next = set.map(tr.mapping, tr.doc);
        const ranges: [number, number][] = [];
        tr.mapping.maps.forEach((map, i) => {
          const rest = tr.mapping.slice(i + 1);
          map.forEach((_oldStart, _oldEnd, newStart, newEnd) => {
            ranges.push([rest.map(newStart, -1), rest.map(newEnd, 1)]);
          });
        });
        const size = tr.doc.content.size;
        ranges.forEach(([start, end]) => {
          const $start = tr.doc.resolve(Math.max(0, Math.min(start, size)));
          const $end = tr.doc.resolve(Math.max(0, Math.min(end, size)));
          const from = $start.depth ? $start.before(1) : $start.pos;
          const to = $end.depth ? $end.after(1) : $end.pos;
          next = next.remove(
            next.find(from, to).filter((d) => d.from >= from && d.to <= to),
          );
          next = next.add(tr.doc, decorationsBetween(tr.doc, from, to));
        });
        return next;
      },
    },
    props: {
      decorations: (state) => caretMarksDecorationKey.getState(state),
    },
  });

/**
 * Google-Docs paragraph mark: an empty block remembers its caret style in
 * `caretMarks` (JSON marks; '[]' = explicitly cleared, null = never stamped).
 * See docs/FORMATTING_INHERITANCE.md.
 */
export const CaretMarks = Extension.create({
  name: 'caretMarks',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading'],
        attributes: {
          [CARET_MARKS_ATTR]: {
            default: null,
            keepOnSplit: false,
            rendered: false,
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    return [decorationPlugin()];
  },
});
