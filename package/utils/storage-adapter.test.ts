import { describe, expect, it, vi } from 'vitest';
import { resolveImageFetchFn, resolveImageUploadFn } from './storage-adapter';
import type {
  ImageFetchFn,
  ImageUploadFn,
  IpfsImageFetchPayload,
  IpfsImageUploadResponse,
} from '../types';

const file = new File(['pixels'], 'photo.png', { type: 'image/png' });

const agnosticUploadResult = {
  encryptionKey: 'key',
  nonce: 'nonce',
  authTag: 'tag',
  url: 'https://gateway.example/content/abc123',
  contentRef: 'abc123',
};

const legacyFetchPayload: IpfsImageFetchPayload = {
  encryptionKey: 'key',
  nonce: 'nonce',
  authTag: 'tag',
  mimeType: 'image/png',
  ipfsUrl: 'https://gateway.example/content/abc123',
  ipfsHash: 'abc123',
};

describe('resolveImageUploadFn', () => {
  it('maps a storage-agnostic response onto the legacy field names', async () => {
    const imageUploadFn: ImageUploadFn = vi
      .fn()
      .mockResolvedValue(agnosticUploadResult);

    const resolved = resolveImageUploadFn(imageUploadFn, undefined);
    const response = await resolved!(file);

    expect(imageUploadFn).toHaveBeenCalledWith(file);
    expect(response).toEqual({
      encryptionKey: 'key',
      nonce: 'nonce',
      authTag: 'tag',
      ipfsUrl: agnosticUploadResult.url,
      ipfsHash: agnosticUploadResult.contentRef,
    });
  });

  it('prefers the storage-agnostic fn when both are given', async () => {
    const imageUploadFn: ImageUploadFn = vi
      .fn()
      .mockResolvedValue(agnosticUploadResult);
    const ipfsImageUploadFn = vi.fn();

    const resolved = resolveImageUploadFn(imageUploadFn, ipfsImageUploadFn);
    await resolved!(file);

    expect(imageUploadFn).toHaveBeenCalledOnce();
    expect(ipfsImageUploadFn).not.toHaveBeenCalled();
  });

  it('falls back to the deprecated fn, unwrapped', () => {
    const ipfsImageUploadFn = vi.fn<[File], Promise<IpfsImageUploadResponse>>();
    expect(resolveImageUploadFn(undefined, ipfsImageUploadFn)).toBe(
      ipfsImageUploadFn,
    );
  });

  it('resolves to undefined when neither is given', () => {
    expect(resolveImageUploadFn(undefined, undefined)).toBeUndefined();
  });
});

describe('resolveImageFetchFn', () => {
  it('maps the legacy payload onto the storage-agnostic field names', async () => {
    const fetched = { url: 'blob:decrypted', file };
    const imageFetchFn: ImageFetchFn = vi.fn().mockResolvedValue(fetched);

    const resolved = resolveImageFetchFn(imageFetchFn, undefined);
    await expect(resolved!(legacyFetchPayload)).resolves.toBe(fetched);

    expect(imageFetchFn).toHaveBeenCalledWith({
      encryptionKey: 'key',
      nonce: 'nonce',
      authTag: 'tag',
      mimeType: 'image/png',
      url: legacyFetchPayload.ipfsUrl,
      contentRef: legacyFetchPayload.ipfsHash,
    });
  });

  it('prefers the storage-agnostic fn when both are given', async () => {
    const imageFetchFn: ImageFetchFn = vi
      .fn()
      .mockResolvedValue({ url: 'blob:decrypted', file });
    const ipfsImageFetchFn = vi.fn();

    const resolved = resolveImageFetchFn(imageFetchFn, ipfsImageFetchFn);
    await resolved!(legacyFetchPayload);

    expect(imageFetchFn).toHaveBeenCalledOnce();
    expect(ipfsImageFetchFn).not.toHaveBeenCalled();
  });

  it('falls back to the deprecated fn, unwrapped', () => {
    const ipfsImageFetchFn = vi.fn<
      [IpfsImageFetchPayload],
      Promise<{ url: string; file: File }>
    >();
    expect(resolveImageFetchFn(undefined, ipfsImageFetchFn)).toBe(
      ipfsImageFetchFn,
    );
  });

  it('resolves to undefined when neither is given', () => {
    expect(resolveImageFetchFn(undefined, undefined)).toBeUndefined();
  });
});
