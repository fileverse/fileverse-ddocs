import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { makeEditor } from './make-editor';
import { startImageUpload } from './upload-images';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import type { IpfsImageUploadResponse } from '../types';

const IPFS_RESULT = {
  ipfsUrl: 'https://ipfs.example/x',
  encryptionKey: 'k',
  nonce: 'n',
  ipfsHash: 'h',
  authTag: 't',
} as unknown as IpfsImageUploadResponse;

const makeDeferred = () => {
  let resolve!: (v: IpfsImageUploadResponse) => void;
  const promise = new Promise<IpfsImageUploadResponse>((r) => (resolve = r));
  return { promise, resolve };
};

const topLevelShapes = (editor: Editor) =>
  editor.state.doc.content.content.map((block) => ({
    type: block.firstChild?.type.name,
    text: block.textContent,
  }));

const makeCollabEditor = (content: string) => {
  const ydoc = new Y.Doc();
  const editor = new Editor({
    extensions: getHeadlessExtensions({ ydoc }),
    textDirection: 'auto',
  });
  editor.commands.setContent(content);
  return { editor, ydoc };
};

// A collaborator's edit, made on a peer doc and synced back so it arrives
// through the Yjs observer like a real remote update.
const remoteEdit = (ydoc: Y.Doc, edit: (peer: Editor) => void) => {
  const peerDoc = new Y.Doc();
  Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(ydoc));
  const peer = new Editor({
    extensions: getHeadlessExtensions({ ydoc: peerDoc }),
    textDirection: 'auto',
  });
  edit(peer);
  Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peerDoc));
  peer.destroy();
};

const textPos = (editor: Editor, text: string) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) {
      found = pos + node.text.indexOf(text);
    }
  });
  return found;
};

const hasPlaceholder = (editor: Editor) =>
  editor.view.dom.querySelector('.img-placeholder') !== null;

const IMAGE_FILE = new File(['x'], 'x.png', { type: 'image/png' });

describe('startImageUpload', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('replaces the empty host paragraph with the image (happy path)', async () => {
    editor = makeEditor('<p></p>');
    const pos = 2; // inside the empty paragraph of the only dBlock
    editor.commands.setTextSelection(pos);

    const deferred = makeDeferred();
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const uploading = startImageUpload(
      file,
      editor.view,
      pos,
      () => deferred.promise,
    );

    deferred.resolve(IPFS_RESULT);
    await uploading;

    const shapes = topLevelShapes(editor);
    expect(shapes.some((shape) => shape.type === 'resizableMedia')).toBe(true);
  });

  it('inserts at the MAPPED placeholder position after concurrent edits above', async () => {
    editor = makeEditor('<p></p>');
    const pos = 2;
    editor.commands.setTextSelection(pos);

    const deferred = makeDeferred();
    const file = new File(['x'], 'x.png', { type: 'image/png' });
    const uploading = startImageUpload(
      file,
      editor.view,
      pos,
      () => deferred.promise,
    );

    // Concurrent edit while the upload is in flight: a new block lands ABOVE
    // the placeholder, shifting every downstream position.
    editor.commands.insertContentAt(0, {
      type: 'dBlock',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'typed while uploading' }],
        },
      ],
    });

    deferred.resolve(IPFS_RESULT);
    await uploading;

    const shapes = topLevelShapes(editor);
    // The typed content must survive intact...
    expect(shapes[0]).toEqual({
      type: 'paragraph',
      text: 'typed while uploading',
    });
    // ...and the image must land where the placeholder was mapped to
    // (the original — now last — block), not at the stale pre-upload offset.
    expect(shapes.some((shape) => shape.type === 'resizableMedia')).toBe(true);
  });

  it('keeps the placeholder through a remote edit elsewhere and inserts there', async () => {
    const collab = makeCollabEditor('<p></p><p>hello world</p>');
    editor = collab.editor;
    editor.commands.setTextSelection(2);

    const deferred = makeDeferred();
    const uploading = startImageUpload(
      IMAGE_FILE,
      editor.view,
      2,
      () => deferred.promise,
    );

    // y-tiptap applies this as one replace of the whole doc.
    remoteEdit(collab.ydoc, (peer) =>
      peer.commands.insertContentAt(textPos(peer, 'hello'), 'remote '),
    );
    expect(hasPlaceholder(editor)).toBe(true);

    deferred.resolve(IPFS_RESULT);
    await uploading;

    expect(topLevelShapes(editor)).toEqual([
      { type: 'resizableMedia', text: '' },
      { type: 'paragraph', text: 'remote hello world' },
    ]);
  });

  it('inserts after the cursor block, unsplit, when a remote edit removes the placeholder', async () => {
    const collab = makeCollabEditor('<p></p><p>hello world</p>');
    editor = collab.editor;
    editor.commands.setTextSelection(2);

    const deferred = makeDeferred();
    const uploading = startImageUpload(
      IMAGE_FILE,
      editor.view,
      2,
      () => deferred.promise,
    );

    remoteEdit(collab.ydoc, (peer) =>
      peer.commands.deleteRange({
        from: 0,
        to: peer.state.doc.child(0).nodeSize,
      }),
    );
    expect(hasPlaceholder(editor)).toBe(false);
    editor.commands.setTextSelection(textPos(editor, 'world'));

    deferred.resolve(IPFS_RESULT);
    await uploading;

    // The editor's trailing node may follow; the paragraph stays whole.
    const shapes = topLevelShapes(editor);
    expect(shapes.slice(0, 2)).toEqual([
      { type: 'paragraph', text: 'hello world' },
      { type: 'resizableMedia', text: '' },
    ]);
    expect(shapes.map((shape) => shape.text).join('')).toBe('hello world');
  });

  it('drops the image when the user deleted its placeholder', async () => {
    editor = makeEditor('<p></p><p>hello world</p>');
    editor.commands.setTextSelection(2);

    const deferred = makeDeferred();
    const uploading = startImageUpload(
      IMAGE_FILE,
      editor.view,
      2,
      () => deferred.promise,
    );

    editor.commands.deleteRange({
      from: 0,
      to: editor.state.doc.child(0).nodeSize,
    });
    expect(hasPlaceholder(editor)).toBe(false);

    deferred.resolve(IPFS_RESULT);
    await uploading;

    expect(topLevelShapes(editor)).toEqual([
      { type: 'paragraph', text: 'hello world' },
    ]);
  });

  it('warns and inserts nothing when the editor is destroyed mid-upload', async () => {
    editor = makeEditor('<p></p>');
    editor.commands.setTextSelection(2);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const deferred = makeDeferred();
    const uploading = startImageUpload(
      IMAGE_FILE,
      editor.view,
      2,
      () => deferred.promise,
    );

    editor.destroy();
    deferred.resolve(IPFS_RESULT);
    await expect(uploading).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    expect(
      topLevelShapes(editor).some((shape) => shape.type === 'resizableMedia'),
    ).toBe(false);
    warn.mockRestore();
  });
});
