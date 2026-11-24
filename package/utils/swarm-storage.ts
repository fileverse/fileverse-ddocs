import {
  type SwarmRequestConfig,
  concatBytes,
  fromBase64,
  stripTrailingSlash,
  toBase64,
} from './swarm-common';
import { type SwarmTransport, createBeeHttpTransport } from './swarm-transport';

// The shapes of dDoc's storage-agnostic image props (`@fileverse-dev/ddoc`
// 5.1.14 and later), declared here so this module has no dependency on the
// editor. They are structurally identical, so these functions can be passed
// straight to `imageUploadFn` and `imageFetchFn`.

/** What `imageUploadFn` resolves to; stored in the document. */
export interface StorageImageUploadResponse {
  encryptionKey: string;
  nonce: string;
  authTag: string;
  url: string;
  contentRef: string;
}

/** What `imageFetchFn` receives: the upload response plus the MIME type. */
export interface StorageImageFetchPayload {
  encryptionKey: string;
  nonce: string;
  authTag: string;
  mimeType: string;
  url: string;
  contentRef: string;
}

export type ImageUploadFn = (file: File) => Promise<StorageImageUploadResponse>;
export type ImageFetchFn = (
  data: StorageImageFetchPayload,
) => Promise<{ url: string; file: File }>;

/**
 * Ethereum Swarm storage adapter for the storage-agnostic image props.
 *
 * Produces `imageUploadFn` / `imageFetchFn` implementations backed by a Bee
 * node's HTTP API (`POST /bzz`, `GET /bzz/{reference}/`), using plain
 * `fetch` and WebCrypto — no extra dependencies. Images are AES-256-GCM
 * encrypted client-side before upload, matching the editor's contract that
 * only ciphertext leaves the client; the Bee node never sees plaintext or
 * keys. `contentRef` is the Swarm reference (64-hex), `url` the node's
 * `/bzz` location of the ciphertext.
 *
 * Usage:
 * ```ts
 * const swarm = { beeUrl: 'http://localhost:1633', postageBatchId: '...' };
 * <DdocEditor
 *   imageUploadFn={createSwarmImageUploadFn(swarm)}
 *   imageFetchFn={createSwarmImageFetchFn(swarm)}
 * />
 * ```
 */

export interface SwarmStorageConfig extends SwarmRequestConfig {
  /**
   * Postage batch ID used to pay for uploads. Required for
   * `createSwarmImageUploadFn`; unused by fetch — reading needs no stamp.
   * When uploading through a stamping gateway that attaches its own stamp,
   * pass an empty string and the header is omitted.
   */
  postageBatchId?: string;
  /**
   * Defer chunk propagation to the node (`swarm-deferred-upload: true`,
   * Bee's default). Set `false` to wait until data is fully synced to the
   * network before the upload resolves.
   */
  deferred?: boolean;
  /**
   * How to reach Swarm. Defaults to this config's Bee node; pass a
   * provider transport to run in a browser exposing `window.swarm`.
   */
  transport?: SwarmTransport;
}

const GCM_TAG_BYTES = 16;
const GCM_NONCE_BYTES = 12;

/** The configured transport, or this config's Bee node. */
const transport = (config: SwarmStorageConfig): SwarmTransport =>
  config.transport ?? createBeeHttpTransport(config);

/**
 * Create an `imageUploadFn` that AES-256-GCM encrypts the file and uploads
 * the ciphertext to Swarm.
 */
export const createSwarmImageUploadFn = (
  config: SwarmStorageConfig,
): ImageUploadFn => {
  const beeUrl = stripTrailingSlash(config.beeUrl);
  return async (file: File) => {
    const plaintext = await file.arrayBuffer();

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt'],
    );
    const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES));
    // WebCrypto appends the GCM auth tag to the ciphertext; split it off so
    // the tag travels as the editor's separate `authTag` parameter.
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: nonce },
        key,
        plaintext,
      ),
    );
    const ciphertext = sealed.slice(0, sealed.length - GCM_TAG_BYTES);
    const authTag = sealed.slice(sealed.length - GCM_TAG_BYTES);

    const reference = await transport(config).uploadData(ciphertext, {
      onProgress: config.onProgress,
    });

    const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    return {
      encryptionKey: toBase64(rawKey),
      nonce: toBase64(nonce),
      authTag: toBase64(authTag),
      url: `${beeUrl}/bzz/${reference}/`,
      contentRef: reference,
    };
  };
};

/**
 * Create an `imageFetchFn` that downloads ciphertext from Swarm and decrypts
 * it back into the image. Counterpart of {@link createSwarmImageUploadFn}.
 */
export const createSwarmImageFetchFn = (
  config: SwarmStorageConfig,
): ImageFetchFn => {
  return async ({
    encryptionKey,
    nonce,
    authTag,
    mimeType,
    url,
    contentRef,
  }) => {
    // Prefer re-deriving the location from this config so documents render
    // even when the uploading host used a different Bee node. Reads need no
    // postage stamp, so this works on any reachable node.
    // Without a `contentRef`, the reference is taken from the URL, in either
    // shape: `/bzz/<ref>/` or `/bytes/<ref>`.
    const reference =
      contentRef ||
      url
        .slice(stripTrailingSlash(config.beeUrl).length)
        .replace(/^\/(bytes|bzz)\//, '')
        .replace(/\/$/, '');
    const ciphertext = await transport(config).downloadData(reference, {
      onProgress: config.onProgress,
    });

    const sealed = concatBytes(ciphertext, fromBase64(authTag));

    const key = await crypto.subtle.importKey(
      'raw',
      fromBase64(encryptionKey),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
    config.onProgress?.({ stage: 'decrypt', status: 'start' });
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(nonce) },
      key,
      sealed,
    );
    config.onProgress?.({ stage: 'decrypt', status: 'done' });

    const file = new File([plaintext], contentRef || 'image', {
      type: mimeType,
    });
    // jsdom/Node lack URL.createObjectURL; fall back to a data URL there.
    const objectUrl =
      typeof URL.createObjectURL === 'function'
        ? URL.createObjectURL(file)
        : `data:${mimeType};base64,${toBase64(new Uint8Array(plaintext))}`;
    return { url: objectUrl, file };
  };
};
