// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type SwarmProvider,
  createBeeHttpTransport,
  createSwarmProviderTransport,
  detectSwarmTransport,
  probeLatestFeedIndex,
} from './swarm-transport';
import { makeFeedTopic } from './swarm-feeds';
import { toBase64 } from './swarm-common';

const OWNER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const OTHER_OWNER = '2f55cd47d91c30c46bba107215e10d96d41ec1df';

afterEach(() => vi.unstubAllGlobals());

/**
 * A `window.swarm` stand-in implementing enough of the Swarm Provider API
 * to exercise the transport: capabilities, an origin-scoped signing
 * identity, single-blob publishing and SOC read/write.
 */
const fakeProvider = (
  over: {
    canPublish?: boolean;
    reason?: string | null;
    socs?: Map<string, string>;
  } = {},
) => {
  const socs = over.socs ?? new Map<string, string>();
  const calls: string[] = [];
  const provider: SwarmProvider & { calls: string[]; socs: typeof socs } = {
    calls,
    socs,
    async request({ method, params }) {
      calls.push(method);
      const p = (params ?? {}) as Record<string, string>;
      switch (method) {
        case 'swarm_getCapabilities':
          return {
            specVersion: '1.0',
            canPublish: over.canPublish ?? true,
            reason: over.reason ?? null,
            limits: { maxDataBytes: 1_000_000, maxChunkPayloadBytes: 4096 },
          };
        case 'swarm_requestAccess':
          return { connected: true, origin: 'https://app.invalid' };
        case 'swarm_getSigningIdentity':
          return {
            owner: '0xAbC0000000000000000000000000000000000001',
            identityMode: 'app-scoped',
          };
        case 'swarm_publishData':
          return { reference: 'ab'.repeat(32) };
        case 'swarm_writeSingleOwnerChunk': {
          const key = `${p.identifier}`;
          socs.set(
            key,
            toBase64(
              typeof p.data === 'string'
                ? new TextEncoder().encode(p.data)
                : (p.data as unknown as Uint8Array),
            ),
          );
          return { reference: 'cd'.repeat(32), identifier: p.identifier };
        }
        case 'swarm_readSingleOwnerChunk': {
          const stored = socs.get(`${p.identifier}`);
          if (!stored) {
            throw Object.assign(new Error('not found'), {
              data: { reason: 'chunk_not_found' },
            });
          }
          return { data: stored, encoding: 'base64' };
        }
        case 'swarm_readChunk':
          return {
            data: toBase64(new Uint8Array([1, 2, 3])),
            encoding: 'base64',
          };
        default:
          throw new Error(`unexpected method ${method}`);
      }
    },
  };
  return provider;
};

describe('transport detection', () => {
  it('prefers an injected provider, as web3 libraries do', () => {
    vi.stubGlobal('swarm', fakeProvider());
    expect(detectSwarmTransport({ beeUrl: 'http://bee.invalid' }).kind).toBe(
      'swarm-provider',
    );
  });

  it('falls back to the node API when no provider is injected', () => {
    expect(detectSwarmTransport({ beeUrl: 'http://bee.invalid' }).kind).toBe(
      'bee-http',
    );
  });

  it('can be forced to the node API even where a provider exists', () => {
    vi.stubGlobal('swarm', fakeProvider());
    expect(
      detectSwarmTransport({ beeUrl: 'http://bee.invalid', provider: null })
        .kind,
    ).toBe('bee-http');
  });
});

describe('provider transport', () => {
  it('reports postage as managed, so hosts hide stamp controls', () => {
    expect(createSwarmProviderTransport(fakeProvider()).managesPostage).toBe(
      true,
    );
    expect(
      createBeeHttpTransport({ beeUrl: 'http://bee.invalid' }).managesPostage,
    ).toBe(false);
  });

  it('translates capabilities into a usable status', async () => {
    const ready = await createSwarmProviderTransport(fakeProvider()).status();
    expect(ready).toMatchObject({
      kind: 'swarm-provider',
      canWrite: true,
      managesPostage: true,
      maxDataBytes: 1_000_000,
    });

    const blocked = await createSwarmProviderTransport(
      fakeProvider({ canPublish: false, reason: 'no-usable-stamps' }),
    ).status();
    expect(blocked.canWrite).toBe(false);
    // The provider's own vocabulary passes through untranslated.
    expect(blocked.reason).toBe('no-usable-stamps');
  });

  it('takes its feed owner from the provider identity, not a local key', async () => {
    const provider = fakeProvider();
    const transport = createSwarmProviderTransport(provider);
    expect(await transport.feedOwner()).toBe(
      'abc0000000000000000000000000000000000001',
    );
    // Cached: the identity is stable for the grant's lifetime.
    await transport.feedOwner();
    expect(
      provider.calls.filter((c) => c === 'swarm_getSigningIdentity'),
    ).toHaveLength(1);
  });

  it('round-trips a feed update through single-owner chunks', async () => {
    const transport = createSwarmProviderTransport(fakeProvider());
    const topic = makeFeedTopic('test/v1/doc-1');
    const owner = await transport.feedOwner();
    const payload = new Uint8Array([9, 8, 7]);

    await transport.writeFeedUpdate(topic, 0, payload);
    expect(await transport.readFeedUpdate(owner, topic, 0)).toEqual(payload);
  });

  it('reports an absent update as null rather than throwing', async () => {
    const transport = createSwarmProviderTransport(fakeProvider());
    const topic = makeFeedTopic('test/v1/nothing-here');
    expect(await transport.readFeedUpdate(OTHER_OWNER, topic, 3)).toBeNull();
  });

  it('asks for access explicitly', async () => {
    const provider = fakeProvider();
    await createSwarmProviderTransport(provider).connect();
    expect(provider.calls).toContain('swarm_requestAccess');
  });
});

// The provider API reads feeds by exact index — there is no "latest"
// lookup as Bee's /feeds offers — so the transport has to find the head.
describe('finding the head of a feed without a lookup', () => {
  const feedOf = (length: number) => async (index: number) =>
    index < length ? new Uint8Array([index]) : null;

  it('returns null for a feed that was never written', async () => {
    expect(await probeLatestFeedIndex(feedOf(0))).toBeNull();
  });

  it.each([1, 2, 3, 5, 8, 17, 64, 129])(
    'finds the head of a feed with %i updates',
    async (length) => {
      expect(await probeLatestFeedIndex(feedOf(length))).toEqual({
        index: length - 1,
        nextIndex: length,
      });
    },
  );

  it('costs far fewer reads than the feed is long', async () => {
    let reads = 0;
    const read = async (index: number) => {
      reads++;
      return index < 500 ? new Uint8Array([1]) : null;
    };
    const head = await probeLatestFeedIndex(read);
    expect(head?.index).toBe(499);
    expect(reads).toBeLessThan(100);
  });
});

describe('bee http transport', () => {
  it('says why it cannot write, without a node round trip', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"status":"ok"}'));
    const status = await createBeeHttpTransport({
      beeUrl: 'http://bee.invalid',
      ownerPrivateKey: OWNER_KEY,
    }).status();
    expect(status).toMatchObject({
      kind: 'bee-http',
      canWrite: false,
      reason: 'no-usable-stamps',
    });
  });

  it('reports an unreachable node distinctly from a missing stamp', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connection refused');
    });
    const status = await createBeeHttpTransport({
      beeUrl: 'http://bee.invalid',
      postageBatchId: 'ab12',
    }).status();
    expect(status).toMatchObject({
      canWrite: false,
      reason: 'node-unreachable',
    });
  });

  it('derives the feed owner from the configured key', async () => {
    const transport = createBeeHttpTransport({
      beeUrl: 'http://bee.invalid',
      ownerPrivateKey: OWNER_KEY,
    });
    expect(await transport.feedOwner()).toMatch(/^[0-9a-f]{40}$/);
  });

  it('reads a feed update by the length its span states', async () => {
    // A single-owner chunk as Bee returns it: identifier(32) ||
    // signature(65) || span(8, little-endian) || payload. The payload ends
    // where the span says, whatever follows it.
    const payload = new TextEncoder().encode('feed update payload');
    const span = new Uint8Array(8);
    new DataView(span.buffer).setBigUint64(0, BigInt(payload.length), true);
    const payloadStart = 32 + 65 + 8;
    const chunk = new Uint8Array(payloadStart + payload.length + 16).fill(0xff);
    chunk.set(span, 32 + 65);
    chunk.set(payload, payloadStart);
    vi.stubGlobal('fetch', async () => new Response(chunk));
    const transport = createBeeHttpTransport({ beeUrl: 'http://bee.invalid' });
    expect(
      await transport.readFeedUpdate(OTHER_OWNER, makeFeedTopic('any'), 0),
    ).toEqual(payload);
  });

  it('refuses to upload without postage, explaining why', async () => {
    const transport = createBeeHttpTransport({ beeUrl: 'http://bee.invalid' });
    await expect(transport.uploadData(new Uint8Array([1]))).rejects.toThrow(
      /postage batch/i,
    );
  });
});
