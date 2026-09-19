import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Plugin, Transaction } from '@tiptap/pm/state';
import * as Y from 'yjs';
import type { UndoManager } from 'yjs';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { CARET_MARKS_ATTR, serializeMarks } from './caret-style';

/**
 * Mounted, Collaboration-backed editor with the production extension set.
 * Collaboration owns the doc, so content is set after construction; pass
 * `null` to leave it to a Yjs sync.
 */
export const makeEditor = (
  schemaVersion: number,
  content: string | null = '<p></p>',
  options: { ydoc?: Y.Doc; extensions?: AnyExtension[] } = {},
) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      ...(getHeadlessExtensions({
        schemaVersion,
        ydoc: options.ydoc,
      }) as AnyExtension[]),
      ...(options.extensions ?? []),
    ],
    textDirection: 'auto',
  });
  if (content !== null) editor.commands.setContent(content);
  return editor;
};

const tracked: { editor: Editor; element: Element | null }[] = [];
export const track = (editor: Editor) => {
  const { element } = editor.options;
  tracked.push({
    editor,
    element: element instanceof Element ? element : null,
  });
  return editor;
};
export const destroyTracked = () => {
  tracked.splice(0).forEach(({ editor, element }) => {
    editor.destroy();
    element?.remove();
  });
};

/** Position just after the first occurrence of `text`. */
export const endOf = (editor: Editor, text: string) => {
  let end = -1;
  editor.state.doc.descendants((node, pos) => {
    if (end === -1 && node.isText && node.text?.includes(text)) {
      end = pos + node.text.indexOf(text) + text.length;
    }
  });
  if (end === -1) throw new Error(`"${text}" not found`);
  return end;
};
export const startOf = (editor: Editor, text: string) =>
  endOf(editor, text) - text.length;

export const selectText = (editor: Editor, text: string) =>
  editor.commands.setTextSelection({
    from: startOf(editor, text),
    to: endOf(editor, text),
  });

/** A click or arrow key: a selection change and nothing else. */
export const caretTo = (editor: Editor, pos: number) =>
  editor.commands.setTextSelection(pos);

/**
 * The real keydown path. `commands.keyboardShortcut('Enter')` replays only
 * the handler's steps and drops its selection and stored marks.
 */
export const pressKey = (editor: Editor, key: string) => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  return (
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
  );
};
export const pressEnter = (editor: Editor) => pressKey(editor, 'Enter');

/** The transaction the browser produces for typed text (uses storedMarks). */
export const type = (editor: Editor, text = 'x') =>
  editor.view.dispatch(editor.state.tr.insertText(text));

export const markNames = (marks: readonly Mark[] | null | undefined) =>
  (marks ?? []).map((mark) => mark.type.name).sort();

/** Types `x` and reports the marks it got — what the user sees. */
export const typedMarks = (editor: Editor) => {
  type(editor, 'x');
  const node = editor.state.doc.nodeAt(editor.state.selection.from - 1);
  return markNames(node?.marks);
};
export const typedTextStyle = (editor: Editor) => {
  type(editor, 'x');
  const node = editor.state.doc.nodeAt(editor.state.selection.from - 1);
  return node?.marks.find((m) => m.type.name === 'textStyle')?.attrs ?? null;
};

/**
 * jsdom has no DOM-change path; this is what prosemirror-view dispatches
 * for a native deletion: delete, then ensureMarks(marksAcross).
 */
export const nativeDelete = (editor: Editor, from: number, to: number) => {
  const { doc } = editor.state;
  const tr = editor.state.tr.delete(from, to);
  const marks = doc.resolve(from).marksAcross(doc.resolve(to));
  if (marks) tr.ensureMarks(marks);
  editor.view.dispatch(tr);
};
export const backspace = (editor: Editor) => {
  const { from } = editor.state.selection;
  nativeDelete(editor, from - 1, from);
};

/** Every textblock in document order, with its opening position. */
export const textblocks = (editor: Editor) => {
  const blocks: { node: ProseMirrorNode; pos: number }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.isTextblock) blocks.push({ node, pos });
  });
  return blocks;
};
/** The block Enter created: always the one after the original. */
export const createdBlock = (editor: Editor) => textblocks(editor)[1];

export const caretBlock = (editor: Editor) => {
  const { $from } = editor.state.selection;
  return { node: $from.parent, pos: $from.before() };
};

export const stampOf = (node: ProseMirrorNode | undefined) =>
  (node?.attrs[CARET_MARKS_ATTR] ?? null) as string | null;

export const storedMarkNames = (editor: Editor) =>
  editor.state.storedMarks === null
    ? null
    : markNames(editor.state.storedMarks);

/** Write a stamp by hand (test setup for stale / pre-existing stamps). */
export const stampBlock = (
  editor: Editor,
  pos: number,
  marks: readonly Mark[] | string,
) => {
  const node = editor.state.doc.nodeAt(pos)!;
  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      [CARET_MARKS_ATTR]:
        typeof marks === 'string' ? marks : serializeMarks(marks),
    }),
  );
};

/** The y-sync plugin Collaboration registered (its key name is 'y-sync$…'). */
export const ySyncPlugin = (editor: Editor) =>
  editor.state.plugins.find((plugin) =>
    String((plugin as unknown as { key: string }).key).startsWith('y-sync$'),
  ) as Plugin;

/** Dispatch a transaction tagged as a remote (y-sync) change. */
export const applyRemote = (
  editor: Editor,
  mutate: (tr: Transaction) => Transaction,
) => {
  editor.view.dispatch(
    mutate(editor.state.tr).setMeta(ySyncPlugin(editor), {
      isChangeOrigin: true,
    }),
  );
};

export const undoManager = (editor: Editor): UndoManager =>
  (editor.state as unknown as Record<string, { undoManager: UndoManager }>)[
    'y-undo$'
  ].undoManager;
