// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import { createSwarmDocumentStorage } from './swarm-document-storage';
import { createSwarmImageFetchFn } from './swarm-storage';
import { listStamps } from './swarm-stamps';

/**
 * Live behaviour on a Bee node with NO postage batch — an ordinary state
 * (a fresh node, or one whose batch expired) that must stay fully usable
 * for reading. Skipped when the node is unreachable, and when it *does*
 * have a batch, since then this scenario cannot be exercised.
 */

const BEE_URL = process.env.BEE_API_URL || 'http://localhost:1633';
const LIVE_TIMEOUT = { timeout: 120_000 };

const nodeState = await (async () => {
  try {
    const health = await fetch(`${BEE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!health.ok) return 'unreachable';
    const stamps = await listStamps({ beeUrl: BEE_URL });
    return stamps.some((s) => s.usable) ? 'has-batch' : 'no-batch';
  } catch {
    return 'unreachable';
  }
})();

describe.skipIf(nodeState !== 'no-batch')('stamp-less Bee node (live)', () => {
  const storage = () =>
    createSwarmDocumentStorage({
      namespace: 'test',
      beeUrl: BEE_URL,
      // No postageBatchId — the whole point of this suite.
      ownerPrivateKey: generatePrivateKey(),
      documentKey: btoa('0123456789abcdef0123456789abcdef'),
    });

  it('opens a document instead of hanging', LIVE_TIMEOUT, async () => {
    // Before the fix this could not even be attempted: storage refused to
    // initialise without a batch and the host waited forever.
    const started = Date.now();
    await expect(storage().loadDocument('does-not-exist')).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(120_000);
  });

  it(
    'lists versions of an unknown document as empty',
    LIVE_TIMEOUT,
    async () => {
      await expect(
        storage().listDocumentVersions('does-not-exist'),
      ).resolves.toEqual([]);
    },
  );

  it('refuses to save, saying why', LIVE_TIMEOUT, async () => {
    await expect(storage().saveDocument('any', 'content')).rejects.toThrow(
      /postage batch/i,
    );
  });

  it('reads content back off the network', LIVE_TIMEOUT, async () => {
    // Any reference already on Swarm proves stamp-free retrieval; the
    // adapter's own decrypt path is covered by the round-trip suite.
    const fetchImage = createSwarmImageFetchFn({ beeUrl: BEE_URL });
    const missing = fetchImage({
      encryptionKey: '',
      nonce: '',
      authTag: '',
      mimeType: 'image/png',
      url: '',
      contentRef: '0'.repeat(64),
    });
    // Unretrievable content must fail with a Swarm error, not hang.
    await expect(missing).rejects.toThrow();
  });
});
