import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { BLOCK_ID_ATTR } from './index';

// Undo here is Yjs's UndoManager (StarterKit's undoRedo is off and
// Collaboration is always registered), so these have to run against a real
// Y.Doc-backed editor — a plain schema-only editor would not exercise the bug.
const makeV2Editor = (ydoc: Y.Doc = new Y.Doc()) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({
      ydoc,
      schemaVersion: 2,
    }) as AnyExtension[],
    textDirection: 'auto',
  });
  return { editor, ydoc };
};

// The UndoManager merges everything inside its 500ms capture window into one
// stack item; each step needs its own item for undo to be meaningful.
const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

const topLevelIds = (editor: Editor) => {
  const ids: (string | null)[] = [];
  editor.state.doc.forEach((node) => ids.push(node.attrs[BLOCK_ID_ATTR]));
  return ids;
};

const text = (editor: Editor) => editor.getText().replace(/\s+/g, ' ').trim();

describe('blockId (flat v2 schema)', () => {
  const editors: Editor[] = [];
  const track = <T extends { editor: Editor }>(made: T): T => {
    editors.push(made.editor);
    return made;
  };

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('gives every top-level block an id', async () => {
    const { editor } = track(makeV2Editor());
    editor.commands.setContent('<p>one</p><h2>two</h2><p>three</p>');
    await settle();

    const ids = topLevelIds(editor);
    expect(ids).toHaveLength(3);
    expect(ids.every((id) => typeof id === 'string' && id.length > 0)).toBe(
      true,
    );
    expect(new Set(ids).size).toBe(3);
  });

  it('re-ids duplicates so a pasted copy never shares an id', async () => {
    const { editor } = track(makeV2Editor());
    editor.commands.setContent('<p>one</p>');
    await settle();
    const [original] = topLevelIds(editor);

    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'paragraph',
      attrs: { [BLOCK_ID_ATTR]: original },
      content: [{ type: 'text', text: 'copy' }],
    });
    await settle();

    const ids = topLevelIds(editor);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(original);
    expect(ids[1]).not.toBe(original);
  });

  // The regression: id assignment used to mark its appendTransaction
  // `addToHistory: false`, and the y-sync binding stamps the whole batched Yjs
  // transaction with the LAST transaction's meta — so the user's edit went
  // unrecorded whenever it also created a block that needed an id.
  it('keeps a select-all delete undoable', async () => {
    const { editor } = track(makeV2Editor());
    editor.commands.setContent('<p>One</p><p>Two</p><p>Three</p>');
    await settle();
    const before = text(editor);

    editor.chain().focus().selectAll().deleteSelection().run();
    await settle();
    expect(text(editor)).toBe('');

    editor.commands.undo();
    await settle(100);
    expect(text(editor)).toBe(before);
  });

  it('keeps a block split undoable without losing the first half', async () => {
    const { editor } = track(makeV2Editor());
    editor.commands.setContent('<p>AlphaBeta</p>');
    await settle();
    expect(editor.state.doc.childCount).toBe(1);

    // caret between "Alpha" and "Beta"
    editor.chain().focus().setTextSelection(6).splitBlock().run();
    await settle();
    expect(editor.state.doc.childCount).toBe(2);

    editor.commands.undo();
    await settle(100);
    expect(editor.state.doc.childCount).toBe(1);
    expect(text(editor)).toBe('AlphaBeta');
  });

  it('leaves ids from a remote peer alone', async () => {
    const { editor: author, ydoc: authorDoc } = track(makeV2Editor());
    author.commands.setContent('<p>one</p><p>two</p>');
    await settle();
    const authored = topLevelIds(author);

    const { editor: peer, ydoc: peerDoc } = track(makeV2Editor());
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(authorDoc));
    await settle();

    expect(topLevelIds(peer)).toEqual(authored);
  });
});
