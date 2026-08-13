/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { IMG_UPLOAD_SETTINGS } from '../components/editor-utils';
import { arrayBufferToBase64, decryptImage, fetchImage } from './security';
import { toByteArray } from 'base64-js';
import { IpfsImageUploadResponse } from '../types';

const uploadKey = new PluginKey('upload-image');

const UploadImagesPlugin = () =>
  new Plugin({
    key: uploadKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, set) {
        set = set.map(tr.mapping, tr.doc);
        // See if the transaction adds or removes any placeholders
        // @ts-ignore
        const action = tr.getMeta(this);
        if (action && action.add) {
          const { id, pos, content } = action.add;

          const placeholder = document.createElement('div');
          placeholder.setAttribute('class', 'img-placeholder');
          placeholder.textContent = content;

          const deco = Decoration.widget(pos + 1, placeholder, {
            id,
          });
          set = set.add(tr.doc, [deco]);
        } else if (action && action.remove) {
          set = set.remove(
            set.find(
              undefined,
              undefined,
              (spec: any) => spec.id == action.remove.id,
            ),
          );
        }
        return set;
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
  });

export default UploadImagesPlugin;

function findPlaceholder(state: EditorState, id: any) {
  const decos = uploadKey.getState(state);
  const found = decos.find(null, null, (spec: any) => spec.id == id);
  return found.length ? found[0].from : null;
}

/**
 * Insert the finished media node at the placeholder's CURRENT (mapped)
 * position and drop the placeholder, in one transaction. The decoration set
 * maps the placeholder through every edit made while the upload was in
 * flight, so this stays correct under concurrent typing — unlike the
 * pre-upload `pos`, which goes stale the moment the doc changes above it.
 * Returns false if the placeholder no longer exists (host content deleted
 * during upload) — the upload result is dropped in that case.
 */
function replacePlaceholderWithMedia(
  view: EditorView,
  id: object,
  node: ProseMirrorNode,
): boolean {
  const placeholderPos = findPlaceholder(view.state, id);
  if (placeholderPos == null) return false;

  const tr = view.state.tr;
  const $pos = view.state.doc.resolve(placeholderPos);
  const host = $pos.parent;

  if (host.isTextblock && host.content.size === 0) {
    // Typical flow: the upload was started from an (already emptied)
    // paragraph — the media takes the paragraph's place inside its block.
    tr.replaceWith($pos.before(), $pos.after(), node);
  } else {
    // Host gained content while uploading — fit the media in at the
    // placeholder without destroying anything (replaceRange* applies
    // schema-aware structure fitting).
    tr.replaceRangeWith(placeholderPos, placeholderPos, node);
  }

  tr.setMeta(uploadKey, { remove: { id } });
  view.dispatch(tr);
  return true;
}

export async function startImageUpload(
  file: File,
  view: EditorView,
  pos: number,
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
) {
  // check if the file is an image
  if (!file.type.includes('image/')) {
    console.log('file is not an image');
    return;
  }

  // A fresh object to act as the ID for this upload - defined outside try so catch can access it
  const id = {};

  try {
    // Replace the selection with a placeholder
    const tr = view.state.tr;
    if (!tr.selection.empty) tr.deleteSelection();

    tr.setMeta(uploadKey, {
      add: {
        id,
        pos: pos - 1,
        content: 'Uploading image...',
      },
    });
    view.dispatch(tr);

    const { schema } = view.state;
    const placeholder = findPlaceholder(view.state, id);
    if (placeholder == null) return;

    if (ipfsImageUploadFn) {
      const { ipfsUrl, encryptionKey, nonce, ipfsHash, authTag } =
        await ipfsImageUploadFn(file);

      const node = schema.nodes.resizableMedia.create({
        encryptionKey,
        ipfsUrl,
        nonce,
        mimeType: file.type,
        version: '2',
        ipfsHash,
        authTag,
        'media-type': 'secure-img',
        width: '100%',
        height: 'auto',
      });

      replacePlaceholderWithMedia(view, id, node);
    } else {
      const fileReader = new FileReader();
      fileReader.readAsDataURL(file);
      fileReader.onloadend = () => {
        const { schema } = view.state;
        const src = fileReader.result as string;
        const node = schema.nodes.resizableMedia.create({
          src: src,
          'media-type': 'img',
        });
        replacePlaceholderWithMedia(view, id, node);
      };
    }
  } catch (error) {
    console.error('Error during image upload: ', error);
    // Remove the placeholder on error (e.g., offline, upload failed)
    const transaction = view.state.tr.setMeta(uploadKey, { remove: { id } });
    view.dispatch(transaction);
  }
}

export const uploadFn = async (image: File) => {
  // Read image data and create a File object, then return the string URL of the uploaded image
  const reader = new FileReader();
  reader.readAsDataURL(image);
  const imgConfig = IMG_UPLOAD_SETTINGS.Extended;
  // check if image is too large for upload (> 1 MB), then throw error
  if (image.size > imgConfig.maxSize) {
    reader.abort();
    throw new Error(imgConfig.errorMsg);
  }

  // convert image to base64
  const base64Image = await new Promise((resolve) => {
    reader.onload = () => {
      resolve(reader.result as string);
    };
  });
  return base64Image as string;
};

export const uploadSecureImage = async (
  url: string,
  image: File,
  publicKey: ArrayBuffer,
) => {
  try {
    const publicKeyBase64 = arrayBufferToBase64(publicKey);
    const formData = new FormData();

    formData.append('file', image);
    formData.append('publicKey', publicKeyBase64);

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!response?.ok) {
      console.error('Failed to upload file', response.statusText);
    }

    return await response.json();
  } catch (error) {
    console.error('Error during image upload: ', error);
  }
};

export const handleDecryptImage = async (
  url: string,
  encryptedKey: string,
  privateKey: string,
  iv: string,
) => {
  try {
    const imageBuffer = await fetchImage(url);

    if (!imageBuffer) {
      return;
    }

    const result = await decryptImage({
      encryptedKey,
      privateKey: toByteArray(privateKey) as BufferSource,
      iv,
      imageBuffer,
    });
    const src = `data:image/jpeg;base64,${arrayBufferToBase64(
      result as ArrayBuffer,
    )}`;

    return src;
  } catch (error) {
    console.error('Error decrypting image:', error);
  }
};
