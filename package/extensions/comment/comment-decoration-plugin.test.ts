import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import {
  applyAcceptedSuggestion,
  CommentDecorationExtension,
  commentDecorationPluginKey,
  createCommentAnchorFromEditor,
  triggerDecorationRebuild,
  type CommentAnchor,
} from './comment-decoration-plugin';

const makeCommentEditor = () => {
  const ydoc = new Y.Doc();
  const anchors: CommentAnchor[] = [];
  const editor = new Editor({
    extensions: [
      ...getHeadlessExtensions({ ydoc }),
      CommentDecorationExtension.configure({
        getAnchors: () => anchors,
        getActiveCommentId: () => null,
      }),
    ],
    textDirection: 'auto',
  });
  return { editor, ydoc, anchors };
};

const findRange = (editor: Editor, needle: string) => {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const index = node.text.indexOf(needle);
    if (index === -1) return;
    found = { from: pos + index, to: pos + index + needle.length };
  });
  if (!found) throw new Error(`"${needle}" not found`);
  return found as { from: number; to: number };
};

const decoratedText = (editor: Editor, commentId: string): string | null => {
  const decorations =
    commentDecorationPluginKey
      .getState(editor.state)
      ?.decorations.find(
        undefined,
        undefined,
        (spec) => spec?.commentId === commentId,
      ) ?? [];

  if (decorations.length === 0) return null;

  const from = Math.min(...decorations.map((d) => d.from));
  const to = Math.max(...decorations.map((d) => d.to));
  return editor.state.doc.textBetween(from, to, ' ');
};

const applySuggestion = (
  editor: Editor,
  needle: string,
  suggestionType: 'delete' | 'replace',
  suggestedContent = '',
) => {
  const range = findRange(editor, needle);
  const relative = createCommentAnchorFromEditor(editor, range.from, range.to);
  if (!relative) throw new Error(`Could not anchor "${needle}"`);

  return applyAcceptedSuggestion(editor, {
    id: 'suggestion-1',
    ...relative,
    resolved: false,
    deleted: false,
    isSuggestion: true,
    suggestionType,
    originalContent: needle,
    suggestedContent,
  });
};

describe('comment decoration anchoring', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('keeps the highlight on the anchored text when text is inserted before it', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    expect(editor.state.doc.textBetween(target.from, target.to, ' ')).toBe(
      'foobar',
    );

    const relative = createCommentAnchorFromEditor(
      editor,
      target.from,
      target.to,
    );
    expect(relative).not.toBeNull();

    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...relative!,
    });
    triggerDecorationRebuild(editor);

    expect(decoratedText(editor, 'c1')).toBe('foobar');

    // Type two characters well before the anchor.
    const start = findRange(editor, 'Hello');
    editor.commands.insertContentAt(start.from, 'XX');

    expect(decoratedText(editor, 'c1')).toBe('foobar');
  });

  it('keeps the highlight on the anchored text when text is deleted before it', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    const relative = createCommentAnchorFromEditor(
      editor,
      target.from,
      target.to,
    );

    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...relative!,
    });
    triggerDecorationRebuild(editor);
    expect(decoratedText(editor, 'c1')).toBe('foobar');

    // Delete "Hello " before the anchor.
    const hello = findRange(editor, 'Hello ');
    editor.commands.deleteRange({ from: hello.from, to: hello.to });

    expect(decoratedText(editor, 'c1')).toBe('foobar');
  });

  it('grows the highlight when text is typed inside the anchored range', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...createCommentAnchorFromEditor(editor, target.from, target.to)!,
    });
    triggerDecorationRebuild(editor);

    // Insert inside "foo|bar".
    editor.commands.insertContentAt(target.from + 3, 'ZZ');

    expect(decoratedText(editor, 'c1')).toBe('fooZZbar');
  });

  it('keeps the highlight aligned when a remote peer edits before the anchor', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors, ydoc } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...createCommentAnchorFromEditor(editor, target.from, target.to)!,
    });
    triggerDecorationRebuild(editor);
    expect(decoratedText(editor, 'c1')).toBe('foobar');

    // Simulate a collaborator typing before the anchor. The edit is made in a
    // second editor bound to a peer Y.Doc and synced back, so it arrives
    // through the Yjs observer instead of a local ProseMirror transaction.
    const peerDoc = new Y.Doc();
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(ydoc));
    const peerEditor = new Editor({
      extensions: getHeadlessExtensions({ ydoc: peerDoc }),
      textDirection: 'auto',
    });
    peerEditor.commands.insertContentAt(
      findRange(peerEditor, 'Hello').from,
      'XX',
    );
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peerDoc));
    peerEditor.destroy();

    expect(editor.state.doc.textContent).toBe('XXHello world foobar');
    expect(decoratedText(editor, 'c1')).toBe('foobar');
  });

  it('drops the highlight when the anchored text is deleted', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...createCommentAnchorFromEditor(editor, target.from, target.to)!,
    });
    triggerDecorationRebuild(editor);

    editor.commands.deleteRange({ from: target.from, to: target.to });

    expect(decoratedText(editor, 'c1')).toBeNull();
  });
});

describe('accepted suggestions', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('removes one surrounding space when deleting a middle word', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red apples</p>');

    expect(applySuggestion(editor, 'red', 'delete')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like apples');
  });

  it('does not normalize a deletion next to punctuation', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red, apples</p>');

    expect(applySuggestion(editor, 'red', 'delete')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like , apples');
  });

  it('does not remove another character when the selection includes a space', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red apples</p>');

    expect(applySuggestion(editor, 'red ', 'delete')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like apples');
  });

  it('preserves surrounding spaces for replacement suggestions', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red apples</p>');

    expect(applySuggestion(editor, 'red', 'replace', 'green')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like green apples');
  });
});
