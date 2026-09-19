import type { Editor } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { Selection } from '@tiptap/pm/state';

export const CARET_MARKS_ATTR = 'caretMarks';

/** Both EditorState and Transaction have this shape. */
export type CaretSource = {
  storedMarks: readonly Mark[] | null;
  selection: Selection;
  doc: ProseMirrorNode;
};

export const serializeMarks = (marks: readonly Mark[]): string =>
  JSON.stringify(marks.map((mark) => mark.toJSON()));

export const parseMarks = (schema: Schema, value: unknown): Mark[] => {
  if (typeof value !== 'string') return [];
  let json: unknown;
  try {
    json = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(json)) return [];
  const marks: Mark[] = [];
  json.forEach((item: { type?: string; attrs?: Record<string, unknown> }) => {
    const type =
      item && typeof item === 'object'
        ? schema.marks[item.type ?? '']
        : undefined;
    if (type) marks.push(type.create(item.attrs ?? null));
  });
  return marks;
};

/**
 * Fill the font properties the marks leave unset from a legacy paragraph's
 * fontFamily / fontSize attrs (old docs). Explicit marks win.
 */
export const fillLegacyFont = (
  schema: Schema,
  marks: readonly Mark[],
  legacyBlock: ProseMirrorNode | null,
): Mark[] => {
  const textStyle = schema.marks.textStyle;
  const family = legacyBlock?.attrs.fontFamily ?? null;
  const size = legacyBlock?.attrs.fontSize ?? null;
  if (!textStyle || (!family && !size)) return [...marks];

  const existing = marks.find((mark) => mark.type === textStyle);
  const attrs: Record<string, unknown> = { ...(existing?.attrs ?? {}) };
  let changed = false;
  if (family && !attrs.fontFamily) {
    attrs.fontFamily = family;
    changed = true;
  }
  if (size && !attrs.fontSize) {
    attrs.fontSize = size;
    changed = true;
  }
  if (!changed) return [...marks];
  return [...textStyle.create(attrs).addToSet(marks)];
};

/** What typing a character would produce right now, legacy font filled in. */
export const caretStyle = (
  source: CaretSource,
  legacyBlock: ProseMirrorNode | null,
): Mark[] =>
  fillLegacyFont(
    source.doc.type.schema,
    source.storedMarks ?? source.selection.$from.marks(),
    legacyBlock,
  );

/** Marks Tiptap lets cross a split (everything but link). */
export const filterSplittable = (
  marks: readonly Mark[],
  editor: Editor,
): Mark[] =>
  marks.filter((mark) =>
    editor.extensionManager.splittableMarks.includes(mark.type.name),
  );

/** A stamp carries the font; a block never holds both the stamp and the legacy attrs. */
export const stampAttrs = (
  attrs: Record<string, unknown>,
  style: readonly Mark[],
): Record<string, unknown> => ({
  ...attrs,
  [CARET_MARKS_ATTR]: serializeMarks(style),
  ...('fontFamily' in attrs ? { fontFamily: null } : {}),
  ...('fontSize' in attrs ? { fontSize: null } : {}),
});
