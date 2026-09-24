import { expect } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { makeEditor, track, endOf, startOf } from '../caret-marks/test-helpers';
import {
  CommentDecorationExtension,
  commentDecorationPluginKey,
  createCommentAnchorFromEditor,
  triggerDecorationRebuild,
  type CommentAnchor,
} from '../comment/comment-decoration-plugin';

const SHORT: Record<string, string> = {
  paragraph: 'p',
  heading: 'h',
  bulletList: 'ul',
  orderedList: 'ol',
  taskList: 'tl',
  listItem: 'li',
  taskItem: 'ti',
  dBlock: 'D',
  blockquote: 'bq',
  columns: 'cols',
  column: 'col',
};
const SHOWN_ATTRS = [
  'textAlign',
  'lineHeight',
  'spaceBefore',
  'spaceAfter',
  'checked',
  'start',
  'caretMarks',
];

/** Attrs that differ from the node type's default, e.g. `{spaceAfter=7}`. */
const attrString = (node: ProseMirrorNode) => {
  const spec = node.type.spec.attrs ?? {};
  const parts = SHOWN_ATTRS.filter(
    (key) => key in spec && node.attrs[key] !== spec[key].default,
  ).map((key) => `${key}=${node.attrs[key]}`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

const outline = (node: ProseMirrorNode, flat: boolean): string => {
  if (node.isText) return JSON.stringify(node.text);
  const children: string[] = [];
  node.forEach((child) => children.push(outline(child, flat)));
  if (flat && node.type.name === 'dBlock') return children.join(' ');
  const name = SHORT[node.type.name] ?? node.type.name;
  return `${name}${attrString(node)}(${children.join(' ')})`;
};

/** `D(ul(li(p("aa"))))` style outline of the document, with dBlocks. */
export const shape = (editor: Editor) =>
  outline(editor.state.doc, false)
    .replace(/^doc\(/, '')
    .replace(/\)$/, '');

/** The same outline with v1 dBlock wrappers removed, so one expectation serves both schemas. */
export const flatShape = (editor: Editor) =>
  outline(editor.state.doc, true)
    .replace(/^doc\(/, '')
    .replace(/\)$/, '');

export const selectionText = (editor: Editor) => {
  const { from, to } = editor.state.selection;
  return editor.state.doc.textBetween(from, to, '|');
};

/** Caret at the end of `text`. */
export const caretIn = (editor: Editor, text: string) =>
  editor.commands.setTextSelection(endOf(editor, text));

/** Selection from inside `a` to inside `b` (one character in from each edge). */
export const rangeOver = (editor: Editor, a: string, b: string) =>
  editor.commands.setTextSelection({
    from: startOf(editor, a) + 1,
    to: endOf(editor, b) - 1,
  });

/** Sets attrs on the nearest `typeName` ancestor of `text`. */
export const setAttrs = (
  editor: Editor,
  typeName: string,
  text: string,
  attrs: Record<string, unknown>,
) => {
  const $pos = editor.state.doc.resolve(startOf(editor, text));
  for (let depth = $pos.depth; depth >= 1; depth--) {
    if ($pos.node(depth).type.name === typeName) {
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup($pos.before(depth), undefined, {
          ...$pos.node(depth).attrs,
          ...attrs,
        }),
      );
      return;
    }
  }
  throw new Error(`no ${typeName} around "${text}"`);
};

export type ListHarness = { editor: Editor; anchors: CommentAnchor[] };

/** Production extension set + the comment decoration plugin, content set. */
export const makeListEditor = (version: number, html: string): ListHarness => {
  const anchors: CommentAnchor[] = [];
  const editor = track(
    makeEditor(version, html, {
      extensions: [
        CommentDecorationExtension.configure({
          getAnchors: () => anchors,
          getActiveCommentId: () => null,
        }),
      ],
    }),
  );
  return { editor, anchors };
};

export const addComment = (
  { editor, anchors }: ListHarness,
  id: string,
  text: string,
  extra: Partial<CommentAnchor> = {},
) => {
  const from = startOf(editor, text);
  const relative = createCommentAnchorFromEditor(
    editor,
    from,
    from + text.length,
  );
  if (!relative) throw new Error(`could not anchor "${text}"`);
  anchors.push({ id, resolved: false, deleted: false, ...relative, ...extra });
  triggerDecorationRebuild(editor);
};

/** `id:text` per decorated comment, sorted, e.g. `ca:aa cb:bb`. */
export const decorated = (editor: Editor) => {
  const pluginState = commentDecorationPluginKey.getState(editor.state);
  if (!pluginState) return '';
  const ids = new Set<string>();
  pluginState.decorations.find(undefined, undefined, (spec) => {
    if (spec?.commentId) ids.add(spec.commentId);
    return false;
  });
  return [...ids]
    .sort()
    .map((id) => {
      const decos = pluginState.decorations.find(
        undefined,
        undefined,
        (spec) => spec?.commentId === id,
      );
      const from = Math.min(...decos.map((d) => d.from));
      const to = Math.max(...decos.map((d) => d.to));
      return `${id}:${editor.state.doc.textBetween(from, to, ' ')}`;
    })
    .join(' ');
};

/** Schema validity, and in v1 the "one block per dBlock" invariant. */
export const expectValid = (editor: Editor, version: number) => {
  expect(() => editor.state.doc.check()).not.toThrow();
  if (version === 1) {
    editor.state.doc.forEach((child) => {
      expect(child.type.name).toBe('dBlock');
      expect(child.childCount).toBe(1);
    });
  }
};
