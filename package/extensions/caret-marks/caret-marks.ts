// The core commands come from the `commands` namespace: @tiptap/core's bundle
// exports them only there, although its .d.ts also advertises top-level names.
import { Extension, commands as coreCommands } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import {
  Plugin,
  PluginKey,
  TextSelection,
  type EditorState,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  CARET_MARKS_ATTR,
  fillLegacyFont,
  parseMarks,
  serializeMarks,
  stampAttrs,
} from './caret-style';
import {
  EMPTY_CONTEXT,
  applyDispatchContext,
  type DispatchContext,
} from './dispatch-context';
import { captureSplit, declareSplit } from './split-declaration';

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

const caretInEmptyBlock = (state: EditorState) => {
  const { selection } = state;
  const block = selection.$from.parent;
  if (
    !selection.empty ||
    !block.isTextblock ||
    block.content.size !== 0 ||
    !(CARET_MARKS_ATTR in block.attrs)
  ) {
    return null;
  }
  return { block, pos: selection.$from.before() };
};

/** Marks at the end of the nearest text block before `pos` (Rule B's last fallback). */
const previousBlockEndMarks = (
  doc: ProseMirrorNode,
  pos: number,
): readonly Mark[] => {
  let end = -1;
  doc.nodesBetween(0, pos, (node, nodePos) => {
    if (nodePos + node.nodeSize > pos) return true;
    if (node.isTextblock) {
      end = nodePos + node.nodeSize - 1;
      return false;
    }
    return true;
  });
  return end < 0 ? [] : doc.resolve(end).marks();
};

/** Rules A1 and A3 — the only document writes; both need `local`. */
const stampRule = (
  ctx: DispatchContext,
  state: EditorState,
  key: PluginKey<DispatchContext>,
): Transaction | null => {
  if (!ctx.local) return null;
  const caret = caretInEmptyBlock(state);
  if (!caret) return null;

  let style: Mark[] | null = null;
  if (ctx.pending?.explicit) {
    style = fillLegacyFont(state.schema, ctx.pending.marks ?? [], caret.block);
  } else if (
    ctx.pending === null &&
    ctx.docChanged &&
    ctx.oldCaret &&
    !ctx.oldCaret.wasEmpty &&
    ctx.oldCaret.pos === caret.pos &&
    ctx.oldCaret.deletedMarks !== null
  ) {
    // The deleted text's own marks, an empty set included — the case
    // ensureMarks cannot signal (spec 3.2, Rule A3).
    style = fillLegacyFont(
      state.schema,
      ctx.oldCaret.deletedMarks,
      caret.block,
    );
  }
  if (!style) return null;

  if (caret.block.attrs[CARET_MARKS_ATTR] === serializeMarks(style))
    return null;
  return state.tr
    .setNodeMarkup(caret.pos, undefined, stampAttrs(caret.block.attrs, style))
    .setStoredMarks(style)
    .setMeta(key, true);
};

/** Rules C and B — stored-marks only, tagged so a restore is never read as explicit. */
const restoreRule = (
  ctx: DispatchContext,
  state: EditorState,
  key: PluginKey<DispatchContext>,
): Transaction | null => {
  const { selection } = state;
  if (
    state.storedMarks !== null ||
    !(selection instanceof TextSelection) ||
    !selection.$cursor
  ) {
    return null;
  }
  // A pending with null marks is A1's to stamp ('[]'); C has nothing to
  // re-set, so B may run.
  if (ctx.pending && ctx.pending.marks !== null) {
    return state.tr.setStoredMarks(ctx.pending.marks).setMeta(key, true);
  }
  const caret = caretInEmptyBlock(state);
  if (!caret) return null;
  const attr = caret.block.attrs[CARET_MARKS_ATTR];
  let marks: readonly Mark[];
  if (typeof attr === 'string') {
    marks = parseMarks(state.schema, attr);
  } else {
    marks = fillLegacyFont(state.schema, [], caret.block);
    if (!marks.length) marks = previousBlockEndMarks(state.doc, caret.pos);
  }
  if (!marks.length) return null;
  return state.tr.setStoredMarks(marks).setMeta(key, true);
};

const rulesPlugin = () =>
  new Plugin<DispatchContext>({
    key: caretMarksPluginKey,
    state: {
      init: () => EMPTY_CONTEXT,
      apply: (tr, prev, oldState) =>
        applyDispatchContext(tr, prev, oldState, caretMarksPluginKey),
    },
    appendTransaction: (_transactions, _oldState, newState) => {
      const ctx = caretMarksPluginKey.getState(newState) ?? EMPTY_CONTEXT;
      return (
        stampRule(ctx, newState, caretMarksPluginKey) ??
        restoreRule(ctx, newState, caretMarksPluginKey)
      );
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
            // Tiptap's fallback parse would read a `caretmarks="…"` attribute
            // off pasted HTML; the stamp has no HTML form in either direction.
            parseHTML: () => null,
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      // A `can()` probe has no dispatch and never declares, so it needs no capture.
      splitBlock: (options) => (props) => {
        const capture =
          props.dispatch && options?.keepMarks !== false
            ? captureSplit(props.tr, props.editor)
            : null;
        const ok = coreCommands.splitBlock(options)(props);
        if (ok && capture) declareSplit(props.tr, capture);
        return ok;
      },
      splitListItem: (typeOrName, overrideAttrs) => (props) => {
        const capture = props.dispatch
          ? captureSplit(props.tr, props.editor)
          : null;
        const ok = coreCommands.splitListItem(typeOrName, overrideAttrs)(props);
        if (ok && capture) declareSplit(props.tr, capture);
        return ok;
      },
    };
  },

  addProseMirrorPlugins() {
    return [rulesPlugin(), decorationPlugin()];
  },
});
