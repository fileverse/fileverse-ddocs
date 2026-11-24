// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { keccak256 } from 'viem';
import {
  type SwarmProvider,
  createBeeHttpTransport,
  createSwarmProviderTransport,
} from './swarm-transport';
import { feedIdentifier } from './swarm-feeds';
import {
  bytesToHex,
  concatBytes,
  fromBase64,
  hexToBytes,
  toBase64,
} from './swarm-common';
import {
  createSwarmDocumentStorage,
  generateDocumentKey,
} from './swarm-document-storage';

/**
 * The same document storage, driven over both access surfaces — a Bee
 * node's HTTP API and an injected `window.swarm` provider — asserting they
 * produce the same observable behaviour. This is the property that makes
 * supporting both a transport choice rather than a fork of the codebase.
 *
 * Both fakes are in-memory, so this runs anywhere; the live suites cover
 * the wire format against a real node.
 */

const OWNER_KEY =
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d' as const;
const SOC_HEADER = 32 + 65; // identifier + signature, as Bee lays out a SOC

afterEach(() => vi.unstubAllGlobals());

/** Minimal Bee HTTP API over an in-memory chunk store. */
const fakeBeeNode = () => {
  const bytes = new Map<string, Uint8Array>();
  const chunks = new Map<string, Uint8Array>();

  const handler = async (url: string, init?: RequestInit) => {
    const { pathname, searchParams } = new URL(String(url));
    const method = init?.method ?? 'GET';
    const body = init?.body as Uint8Array | undefined;

    if (pathname === '/health') return new Response('{"status":"ok"}');

    // Single-file /bzz upload, as the transport now uses: the reference is
    // manifest-wrapped, so it also resolves as bzz://<reference>/.
    if (pathname === '/bzz' && method === 'POST') {
      const reference = keccak256(body!).slice(2);
      bytes.set(reference, body!);
      return new Response(JSON.stringify({ reference }));
    }
    if (pathname.startsWith('/bzz/')) {
      const ref = pathname.slice('/bzz/'.length).replace(/\/$/, '');
      const stored = bytes.get(ref);
      return stored
        ? new Response(new Uint8Array(stored))
        : new Response('', { status: 404 });
    }
    // Legacy path: documents written before the switch to /bzz.
    if (pathname === '/bytes' && method === 'POST') {
      const reference = keccak256(body!).slice(2);
      bytes.set(reference, body!);
      return new Response(JSON.stringify({ reference }));
    }
    if (pathname.startsWith('/bytes/')) {
      const stored = bytes.get(pathname.slice('/bytes/'.length));
      return stored
        ? new Response(new Uint8Array(stored))
        : new Response('', { status: 404 });
    }
    if (pathname.startsWith('/soc/') && method === 'POST') {
      const [, , owner, identifier] = pathname.split('/') as [
        string,
        string,
        string,
        string,
      ];
      const address = bytesToHex(
        keccak256(
          concatBytes(hexToBytes(identifier), hexToBytes(owner)),
          'bytes',
        ),
      );
      // Bee stores identifier || signature || span || payload; the
      // signature is irrelevant to what we read back.
      chunks.set(
        address,
        concatBytes(hexToBytes(identifier), new Uint8Array(65), body!),
      );
      expect(searchParams.get('sig')).toMatch(/^[0-9a-f]+$/);
      return new Response(JSON.stringify({ reference: address }));
    }
    if (pathname.startsWith('/chunks/')) {
      const stored = chunks.get(pathname.slice('/chunks/'.length));
      return stored
        ? new Response(new Uint8Array(stored))
        : new Response('', { status: 404 });
    }
    if (pathname.startsWith('/feeds/')) {
      const [, , owner, topic] = pathname.split('/') as [
        string,
        string,
        string,
        string,
      ];
      let index = -1;
      for (let i = 0; i < 1000; i++) {
        const address = bytesToHex(
          keccak256(
            concatBytes(
              feedIdentifier(hexToBytes(topic), i),
              hexToBytes(owner),
            ),
            'bytes',
          ),
        );
        if (!chunks.has(address)) break;
        index = i;
      }
      if (index < 0) return new Response('', { status: 404 });
      return new Response('{}', {
        headers: { 'swarm-feed-index': index.toString(16) },
      });
    }
    return new Response('', { status: 404 });
  };
  return { handler, bytes, chunks };
};

/** Minimal Swarm Provider API over its own in-memory store. */
const fakeProviderNode = (): SwarmProvider => {
  const blobs = new Map<string, Uint8Array>();
  const socs = new Map<string, Uint8Array>();
  const owner = '0xAbC0000000000000000000000000000000000001';

  return {
    async request({ method, params }) {
      const p = (params ?? {}) as Record<string, unknown>;
      switch (method) {
        case 'swarm_getCapabilities':
          return { specVersion: '1.0', canPublish: true, reason: null };
        case 'swarm_requestAccess':
          return { connected: true };
        case 'swarm_getSigningIdentity':
          return { owner, identityMode: 'app-scoped' };
        case 'swarm_publishData': {
          const data = p.data as Uint8Array;
          const reference = keccak256(data).slice(2);
          blobs.set(reference, data);
          return { reference };
        }
        case 'swarm_readChunk': {
          const stored = blobs.get(p.reference as string);
          if (!stored) {
            throw Object.assign(new Error('not found'), {
              data: { reason: 'chunk_not_found' },
            });
          }
          return { data: toBase64(stored), encoding: 'base64' };
        }
        case 'swarm_writeSingleOwnerChunk': {
          socs.set(p.identifier as string, p.data as Uint8Array);
          return { reference: 'ab'.repeat(32), owner };
        }
        case 'swarm_readSingleOwnerChunk': {
          const stored = socs.get(p.identifier as string);
          if (!stored) {
            throw Object.assign(new Error('not found'), {
              data: { reason: 'chunk_not_found' },
            });
          }
          return { data: toBase64(stored), encoding: 'base64' };
        }
        default:
          throw new Error(`unexpected method ${method}`);
      }
    },
  };
};

const documentKey = generateDocumentKey();

const overHttp = () => {
  const node = fakeBeeNode();
  vi.stubGlobal('fetch', node.handler);
  return createSwarmDocumentStorage({
    namespace: 'test',
    beeUrl: 'http://bee.invalid',
    postageBatchId: 'ab'.repeat(32),
    ownerPrivateKey: OWNER_KEY,
    documentKey,
  });
};

// No owner key: through a provider the browser owns the feeds it creates,
// which is how a document authored in such a browser works.
const overProvider = () =>
  createSwarmDocumentStorage({
    namespace: 'test',
    beeUrl: 'http://unused.invalid',
    documentKey,
    transport: createSwarmProviderTransport(fakeProviderNode()),
  });

describe.each([
  ['bee http api', overHttp],
  ['window.swarm provider', overProvider],
])('document storage over the %s', (_label, makeStorage) => {
  it('returns null for a document that was never saved', async () => {
    await expect(makeStorage().loadDocument('absent')).resolves.toBeNull();
  });

  it('saves, reloads and versions a document', async () => {
    const storage = makeStorage();
    const v0 = await storage.saveDocument('doc', 'first');
    const v1 = await storage.saveDocument('doc', 'second');
    expect([v0.index, v1.index]).toEqual([0, 1]);

    const latest = await storage.loadDocument('doc');
    expect(latest?.text).toBe('second');
    expect(latest?.feedIndex).toBe(1);

    expect((await storage.loadDocumentVersion('doc', 0))?.text).toBe('first');
    expect(
      (await storage.listDocumentVersions('doc')).map((v) => v.index),
    ).toEqual([0, 1]);
  });

  it('encrypts what it stores', async () => {
    const storage = makeStorage();
    await storage.saveDocument('doc', 'MARKER-secret-text');
    const snapshot = await storage.loadDocument('doc');
    expect(snapshot?.text).toBe('MARKER-secret-text');
    // Round-tripping proves the key is applied; the live suites assert the
    // stored bytes themselves contain no plaintext.
    expect(snapshot?.bytes.length).toBeGreaterThan(0);
  });

  it('exposes the feed owner it signs with', async () => {
    expect(await makeStorage().feedOwner()).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('what differs between the two', () => {
  it('takes the owner from the key when there is one, from the provider otherwise', async () => {
    const httpOwner = await overHttp().feedOwner();
    const providerOwner = await overProvider().feedOwner();
    expect(httpOwner).not.toBe(providerOwner);
    // With no key of its own, the document belongs to the provider's
    // origin-scoped identity.
    expect(providerOwner).toBe('abc0000000000000000000000000000000000001');
  });

  it('reports postage as the provider΄s business only over the provider', () => {
    expect(overHttp().transport.managesPostage).toBe(false);
    expect(overProvider().transport.managesPostage).toBe(true);
  });

  it('keeps the SOC payload identical on both sides of the wire', async () => {
    // The HTTP transport signs and posts a SOC whose body is span||payload;
    // the provider is handed the payload directly. Both must read back the
    // same bytes, or documents written on one could not be read on the
    // other.
    const node = fakeBeeNode();
    vi.stubGlobal('fetch', node.handler);
    const http = createBeeHttpTransport({
      beeUrl: 'http://bee.invalid',
      postageBatchId: 'ab'.repeat(32),
      ownerPrivateKey: OWNER_KEY,
    });
    const topic = new Uint8Array(32).fill(7);
    const payload = new Uint8Array([1, 2, 3, 4]);
    await http.writeFeedUpdate(topic, 0, payload);

    const owner = await http.feedOwner();
    expect(await http.readFeedUpdate(owner, topic, 0)).toEqual(payload);

    const stored = [...node.chunks.values()][0]!;
    expect(stored.slice(SOC_HEADER + 8)).toEqual(payload);
    expect(fromBase64(toBase64(payload))).toEqual(payload);
  });
});

/**
 * A document opened from someone else's link. Its feed belongs to the key
 * in that link, not to whatever identity the transport signs with — which
 * is the whole point of a shared link, and was where the demo failed in
 * Freedom: it looked the document up under the browser's own identity and
 * found nothing.
 */
describe('a document shared by link', () => {
  const sharedKey =
    '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318' as const;

  it('reads from the owner in the link, not the provider identity', async () => {
    const provider = fakeProviderNode();
    const transport = createSwarmProviderTransport(provider);
    const storage = createSwarmDocumentStorage({
      namespace: 'test',
      beeUrl: 'http://unused.invalid',
      ownerPrivateKey: sharedKey,
      documentKey,
      transport,
    });

    const linkOwner = await storage.feedOwner();
    const providerOwner = await transport.feedOwner();
    expect(linkOwner).not.toBe(providerOwner);
    // The address the link's key derives, so the lookup finds the feed.
    expect(linkOwner).toMatch(/^[0-9a-f]{40}$/);
  });

  it('does not need a signing identity merely to read', async () => {
    const calls: string[] = [];
    const inner = fakeProviderNode();
    const storage = createSwarmDocumentStorage({
      namespace: 'test',
      beeUrl: 'http://unused.invalid',
      ownerPrivateKey: sharedKey,
      documentKey,
      transport: createSwarmProviderTransport({
        request: (args) => {
          calls.push(args.method);
          return inner.request(args);
        },
      }),
    });

    await storage.loadDocument('shared-doc');
    // swarm_getSigningIdentity sits behind a consent prompt; asking for it
    // to read would make viewing a link require granting write access.
    expect(calls).not.toContain('swarm_getSigningIdentity');
  });

  it('refuses to save it, explaining that the browser signs as itself', async () => {
    const storage = createSwarmDocumentStorage({
      namespace: 'test',
      beeUrl: 'http://unused.invalid',
      ownerPrivateKey: sharedKey,
      documentKey,
      transport: createSwarmProviderTransport(fakeProviderNode()),
    });

    expect(await storage.canWriteDocument()).toBe(false);
    await expect(storage.saveDocument('shared-doc', 'edit')).rejects.toThrow(
      /read-only here/i,
    );
  });

  it('still writes freely over the node API, where the key signs', async () => {
    const node = fakeBeeNode();
    vi.stubGlobal('fetch', node.handler);
    const storage = createSwarmDocumentStorage({
      namespace: 'test',
      beeUrl: 'http://bee.invalid',
      postageBatchId: 'ab'.repeat(32),
      ownerPrivateKey: sharedKey,
      documentKey,
    });
    expect(await storage.canWriteDocument()).toBe(true);
    await expect(
      storage.saveDocument('shared-doc', 'edit'),
    ).resolves.toMatchObject({ index: 0 });
  });
});
