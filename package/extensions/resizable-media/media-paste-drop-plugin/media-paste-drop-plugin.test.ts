import { Editor } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getHeadlessExtensions } from '../../../hooks/use-headless-editor';
import { wrapBlockNode } from '../../../utils/block-schema';
import type { IpfsImageUploadResponse } from '../../../types';

const NOTE = 'These are my nine favorite games.';
const IPFS_RESULT = {
  ipfsUrl: 'https://ipfs.example/9games',
  encryptionKey: 'k',
  nonce: 'n',
  ipfsHash: 'h',
  authTag: 't',
} as IpfsImageUploadResponse;

describe.each([1, 2])('image paste and drop in schema v%i', (schemaVersion) => {
  let editor: Editor;
  let finishUpload: (result: IpfsImageUploadResponse) => void;

  afterEach(() => {
    editor?.destroy();
    vi.restoreAllMocks();
  });

  const mount = (content: string) => {
    const uploading = new Promise<IpfsImageUploadResponse>((resolve) => {
      finishUpload = resolve;
    });
    editor = new Editor({
      extensions: getHeadlessExtensions({ schemaVersion }).map((extension) =>
        extension.name === 'resizableMedia'
          ? extension.configure({ ipfsImageUploadFn: () => uploading })
          : extension,
      ),
    });
    editor.commands.setContent(content);
    let notePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === NOTE) notePos = pos;
    });
    expect(notePos).toBeGreaterThan(-1);
    editor.commands.setTextSelection({
      from: notePos,
      to: notePos + NOTE.length,
    });
  };

  const blocks = () =>
    editor.state.doc.content.content.map((node) =>
      node.type.name === 'dBlock' ? node.firstChild! : node,
    );

  const dropImage = () => {
    let dropPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (
        dropPos === -1 &&
        node.type.name === 'paragraph' &&
        !node.content.size
      ) {
        dropPos = pos + 1;
      }
    });
    expect(dropPos).toBeGreaterThan(-1);
    // jsdom has no hit testing; only the drop coordinates are stubbed.
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({
      pos: dropPos,
      inside: -1,
    });
    const event = {
      dataTransfer: {
        files: [new File(['image'], '9games.jpeg', { type: 'image/jpeg' })],
      },
      clientX: 20,
      clientY: 20,
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
    const handled = editor.view.someProp('handleDrop', (handleDrop) =>
      handleDrop(editor.view, event, Slice.empty, false),
    );
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
  };

  const completeUpload = async () => {
    finishUpload(IPFS_RESULT);
    await vi.waitFor(() => {
      expect(
        blocks().filter((node) => node.type.name === 'resizableMedia'),
      ).toHaveLength(1);
    });
  };

  it.each(['before', 'after'] as const)(
    'preserves selected text when dropping an image %s it',
    async (placement) => {
      mount(
        placement === 'before'
          ? `<p></p><p>${NOTE}</p>`
          : `<p>${NOTE}</p><p></p>`,
      );
      const beforeDrop = editor.getJSON();
      dropImage();
      // Upload placeholders must not delete content, even before completion.
      expect(editor.getJSON()).toEqual(beforeDrop);

      await completeUpload();

      expect(editor.state.doc.textContent).toBe(NOTE);
      const imageIndex = blocks().findIndex(
        (node) => node.type.name === 'resizableMedia',
      );
      const noteIndex = blocks().findIndex((node) => node.textContent === NOTE);
      expect(
        placement === 'before'
          ? imageIndex < noteIndex
          : imageIndex > noteIndex,
      ).toBe(true);
    },
  );

  it('keeps the drop location mapped through edits during upload', async () => {
    mount(`<p></p><p>${NOTE}</p>`);
    dropImage();
    editor.commands.insertContentAt(
      0,
      wrapBlockNode(editor.schema, {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Added during upload.' }],
      }),
    );

    await completeUpload();

    expect(blocks()[0].textContent).toBe('Added during upload.');
    expect(blocks()[1].type.name).toBe('resizableMedia');
    expect(blocks()[2].textContent).toBe(NOTE);
  });

  it('still replaces selected text when pasting an image', async () => {
    mount(`<p>${NOTE}</p>`);
    const event = {
      clipboardData: {
        files: [new File(['image'], '9games.jpeg', { type: 'image/jpeg' })],
        items: [],
        getData: () => '',
      },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    const handled = editor.view.someProp('handlePaste', (handlePaste) =>
      handlePaste(editor.view, event, Slice.empty),
    );
    expect(handled).toBe(true);

    await completeUpload();

    expect(editor.state.doc.textContent).toBe('');
  });
});
