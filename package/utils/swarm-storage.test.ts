// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  createSwarmImageFetchFn,
  createSwarmImageUploadFn,
} from './swarm-storage';

const BEE_URL = process.env.BEE_API_URL || 'http://localhost:1633';

// Probe once at collection time: these tests need a running Bee node with a
// usable postage batch, and are skipped otherwise so the suite stays green
// in environments without Swarm access.
const probeBee = async (): Promise<string | null> => {
  try {
    const health = await fetch(`${BEE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!health.ok) return null;
    const res = await fetch(`${BEE_URL}/stamps`, {
      signal: AbortSignal.timeout(2000),
    });
    const { stamps } = (await res.json()) as {
      stamps: { batchID: string; usable: boolean }[];
    };
    return stamps.find((s) => s.usable)?.batchID ?? null;
  } catch {
    return null;
  }
};

const postageBatchId = await probeBee();

describe.skipIf(!postageBatchId)(
  'swarm storage adapter (live Bee node)',
  () => {
    const config = { beeUrl: BEE_URL, postageBatchId: postageBatchId! };

    it('round-trips an encrypted image through Swarm', async () => {
      const payload = crypto.getRandomValues(new Uint8Array(1024 * 64));
      const file = new File([payload], 'test.png', { type: 'image/png' });

      const upload = createSwarmImageUploadFn(config);
      const result = await upload(file);

      // Swarm reference: 64-hex chars; crypto params present and distinct.
      expect(result.contentRef).toMatch(/^[0-9a-f]{64}$/);
      // Manifest-wrapped, so the same reference resolves as bzz:// too.
      expect(result.url).toBe(`${BEE_URL}/bzz/${result.contentRef}/`);
      expect(result.encryptionKey).toBeTruthy();
      expect(result.nonce).toBeTruthy();
      expect(result.authTag).toBeTruthy();

      const fetchImage = createSwarmImageFetchFn(config);
      const fetched = await fetchImage({
        encryptionKey: result.encryptionKey,
        nonce: result.nonce,
        authTag: result.authTag,
        mimeType: 'image/png',
        url: result.url,
        contentRef: result.contentRef,
      });

      expect(fetched.file.type).toBe('image/png');
      const roundTripped = new Uint8Array(await fetched.file.arrayBuffer());
      expect(roundTripped).toEqual(payload);
    });

    it('stores only ciphertext on Swarm', async () => {
      const payload = new TextEncoder().encode(
        'MARKER-plaintext-should-never-be-stored',
      );
      const file = new File([payload], 'secret.txt', { type: 'text/plain' });

      const upload = createSwarmImageUploadFn(config);
      const { contentRef } = await upload(file);

      const raw = new Uint8Array(
        await (await fetch(`${BEE_URL}/bzz/${contentRef}/`)).arrayBuffer(),
      );
      expect(new TextDecoder().decode(raw)).not.toContain('MARKER-plaintext');
    });

    it('rejects tampered ciphertext (GCM auth)', async () => {
      const file = new File([new Uint8Array(256)], 'x.png', {
        type: 'image/png',
      });
      const upload = createSwarmImageUploadFn(config);
      const result = await upload(file);

      const fetchImage = createSwarmImageFetchFn(config);
      // Wrong auth tag → decrypt must throw, not return garbage.
      await expect(
        fetchImage({
          ...result,
          mimeType: 'image/png',
          authTag: btoa(String.fromCharCode(...new Uint8Array(16))),
        }),
      ).rejects.toThrow();
    });
  },
);
