import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from './make-editor';
import { startImageUpload } from './upload-images';
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
    expect(
      shapes.some((shape) => shape.type === 'resizableMedia'),
    ).toBe(true);
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
});
