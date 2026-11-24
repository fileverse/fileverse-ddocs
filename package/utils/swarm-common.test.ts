// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SwarmTimeoutError,
  readWithProgress,
  swarmFetch,
  type SwarmProgress,
} from './swarm-common';
import {
  canSaveToSwarm,
  createSwarmDocumentStorage,
} from './swarm-document-storage';

const OWNER =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
/** Fixed 32-byte AES key, so these tests need no WebCrypto. */
const DOC_KEY = btoa('0123456789abcdef0123456789abcdef');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('swarmFetch deadlines', () => {
  /** Never settles on its own — resolves only when the signal aborts. */
  const stubHangingFetch = () =>
    vi.stubGlobal(
      'fetch',
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject((init.signal as AbortSignal).reason),
          );
        }),
    );

  it('gives up on a hanging node instead of waiting forever', async () => {
    stubHangingFetch();
    await expect(
      swarmFetch({ beeUrl: 'http://bee.invalid' }, '/bytes/abc', {
        timeoutMs: 50,
      }),
    ).rejects.toBeInstanceOf(SwarmTimeoutError);
  });

  it('names the endpoint and the deadline in the error', async () => {
    stubHangingFetch();
    const error = (await swarmFetch(
      { beeUrl: 'http://bee.invalid' },
      '/feeds/x/y',
      { timeoutMs: 50 },
    ).catch((e) => e)) as Error;
    expect(error.message).toContain('http://bee.invalid/feeds/x/y');
    expect(error.message).toMatch(/timed out/i);
  });

  it('returns 404 responses rather than throwing (absence is normal)', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const response = await swarmFetch(
      { beeUrl: 'http://bee.invalid' },
      '/chunks/abc',
    );
    expect(response.status).toBe(404);
  });

  it('throws on other error statuses', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('boom', { status: 500, statusText: 'Oops' }),
    );
    await expect(
      swarmFetch({ beeUrl: 'http://bee.invalid' }, '/bytes/abc'),
    ).rejects.toThrow(/500/);
  });
});

describe('readWithProgress', () => {
  it('reports byte progress and returns the full body', async () => {
    const payload = new Uint8Array(1024).fill(7);
    const response = new Response(payload, {
      headers: { 'content-length': String(payload.length) },
    });
    const events: SwarmProgress[] = [];

    const bytes = await readWithProgress(response, (p) => events.push(p));

    expect(bytes).toEqual(payload);
    expect(events.at(-1)).toMatchObject({
      stage: 'download',
      status: 'done',
      loaded: payload.length,
      total: payload.length,
    });
    expect(events.every((e) => (e.loaded ?? 0) <= payload.length)).toBe(true);
  });

  it('works without a progress handler', async () => {
    const payload = new Uint8Array([1, 2, 3]);
    expect(await readWithProgress(new Response(payload))).toEqual(payload);
  });
});

// Reading from Swarm costs nothing; only uploads are stamped. A node
// without a usable batch must therefore still open documents — the demo
// previously hung forever on such a node.
describe('read-only nodes (no postage batch)', () => {
  const storageConfig = {
    namespace: 'test',
    beeUrl: 'http://bee.invalid',
    ownerPrivateKey: OWNER,
    documentKey: DOC_KEY,
  };

  it('reports write capability from the postage batch', () => {
    expect(canSaveToSwarm(storageConfig)).toBe(false);
    expect(canSaveToSwarm({ ...storageConfig, postageBatchId: 'ab12' })).toBe(
      true,
    );
  });

  it('constructs storage without a batch', () => {
    const storage = createSwarmDocumentStorage(storageConfig);
    expect(storage.ownerAddress).toMatch(/^[0-9a-f]{40}$/);
  });

  it('still reads: a missing feed resolves to null, it does not throw', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const storage = createSwarmDocumentStorage(storageConfig);
    await expect(storage.loadDocument('some-doc')).resolves.toBeNull();
  });

  it('explains that saving needs a stamp', async () => {
    const storage = createSwarmDocumentStorage(storageConfig);
    await expect(storage.saveDocument('some-doc', 'hi')).rejects.toThrow(
      /postage batch/i,
    );
  });
});
