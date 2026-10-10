import {
  ImageFetchFn,
  ImageUploadFn,
  IpfsImageFetchPayload,
  IpfsImageUploadResponse,
} from '../types';

/**
 * Boundary adapters between the storage-agnostic public props
 * (`imageUploadFn` / `imageFetchFn`) and the IPFS-shaped interface the editor
 * internals still use. Internals are untouched: a storage-agnostic host
 * function is wrapped here, at the prop boundary, so that downstream code
 * keeps seeing the legacy `ipfsUrl` / `ipfsHash` field names regardless of
 * which backend the host actually stores on.
 */

type LegacyImageUploadFn = (file: File) => Promise<IpfsImageUploadResponse>;
type LegacyImageFetchFn = (
  _data: IpfsImageFetchPayload,
) => Promise<{ url: string; file: File }>;

/**
 * Resolve the upload function to use internally. The storage-agnostic
 * `imageUploadFn` wins over the deprecated `ipfsImageUploadFn`; its response
 * is mapped onto the legacy field names (`url` → `ipfsUrl`,
 * `contentRef` → `ipfsHash`).
 */
export const resolveImageUploadFn = (
  imageUploadFn?: ImageUploadFn,
  ipfsImageUploadFn?: LegacyImageUploadFn,
): LegacyImageUploadFn | undefined => {
  if (imageUploadFn) {
    return async (file: File) => {
      const { encryptionKey, nonce, authTag, url, contentRef } =
        await imageUploadFn(file);
      return {
        encryptionKey,
        nonce,
        authTag,
        ipfsUrl: url,
        ipfsHash: contentRef,
      };
    };
  }
  return ipfsImageUploadFn;
};

/**
 * Resolve the fetch function to use internally. The storage-agnostic
 * `imageFetchFn` wins over the deprecated `ipfsImageFetchFn`; the legacy
 * payload built by the internals is mapped onto the agnostic field names
 * (`ipfsUrl` → `url`, `ipfsHash` → `contentRef`).
 */
export const resolveImageFetchFn = (
  imageFetchFn?: ImageFetchFn,
  ipfsImageFetchFn?: LegacyImageFetchFn,
): LegacyImageFetchFn | undefined => {
  if (imageFetchFn) {
    return ({ encryptionKey, nonce, authTag, mimeType, ipfsUrl, ipfsHash }) =>
      imageFetchFn({
        encryptionKey,
        nonce,
        authTag,
        mimeType,
        url: ipfsUrl,
        contentRef: ipfsHash,
      });
  }
  return ipfsImageFetchFn;
};
