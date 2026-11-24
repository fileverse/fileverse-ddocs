// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { generatePrivateKey } from 'viem/accounts';
import {
  createSwarmDocumentStorage,
  generateDocumentKey,
  makeDocumentFeedTopic,
} from './swarm-document-storage';
import { chunkAddress } from './swarm-feeds';
import type { SwarmTransport } from './swarm-transport';

const BEE_URL = process.env.BEE_API_URL || 'http://localhost:1633';

// Documents the dDoc and dSheets demos already saved live under these
// topics (keccak256 of `ddoc/v1/<id>` and `dsheet/v1/<id>`, the format of
// the copies this module replaces). A change here strands them.
describe('document feed topics', () => {
  it('keeps the topics existing documents were saved under', () => {
    expect(bytesToHex(makeDocumentFeedTopic('ddoc', 'doc-1'))).toBe(
      '650d2b07d7b37e07b2c4fe4206b7e1e3dbbbf390aef1211236ada67a41ccb8ef',
    );
    expect(bytesToHex(makeDocumentFeedTopic('dsheet', 'doc-1'))).toBe(
      '2831ff8377535842864f0f518241721db73a61325e787204de7806162f250c90',
    );
  });
});

// A provider (a browser's `window.swarm`) names the identity that signs this
// app's feeds only when the user allows it. Stand in for one that refuses
// the first time it is asked.
const reluctantProvider = () => {
  const calls = { feedOwner: 0, uploadData: 0 };
  const transport: SwarmTransport = {
    kind: 'swarm-provider',
    managesPostage: true,
    status: async () => ({
      kind: 'swarm-provider',
      canWrite: true,
      managesPostage: true,
    }),
    connect: async () => {},
    feedOwner: async () => {
      calls.feedOwner += 1;
      if (calls.feedOwner === 1) {
        throw Object.assign(new Error('User rejected the request'), {
          code: 4001,
        });
      }
      return 'ab'.repeat(20);
    },
    uploadData: async () => {
      calls.uploadData += 1;
      return '0'.repeat(64);
    },
    downloadData: async () => new Uint8Array(),
    writeFeedUpdate: async () => '0'.repeat(64),
    readFeedUpdate: async () => null,
    latestFeedIndex: async () => null,
  };
  return { transport, calls };
};

describe('a provider that withholds its identity', () => {
  it('is asked again by the next operation, not remembered as refused', async () => {
    const { transport, calls } = reluctantProvider();
    const storage = createSwarmDocumentStorage({
      namespace: 'test',
      beeUrl: '',
      transport,
    });
    await expect(storage.loadDocument('doc')).rejects.toThrow(/rejected/);
    await expect(storage.loadDocument('doc')).resolves.toBeNull();
    expect(calls.feedOwner).toBe(2);
  });

  it('uploads nothing for a save that cannot be signed', async () => {
    const { transport, calls } = reluctantProvider();
    const storage = createSwarmDocumentStorage({
      namespace: 'test',
      beeUrl: '',
      transport,
    });
    await expect(storage.saveDocument('doc', 'content')).rejects.toThrow(
      /rejected/,
    );
    expect(calls.uploadData).toBe(0);
    await expect(storage.saveDocument('doc', 'content')).resolves.toMatchObject(
      { index: 0 },
    );
    expect(calls.uploadData).toBe(1);
  });
});

// These tests need a running Bee node with a usable postage batch; they
// are skipped otherwise so the suite stays green without Swarm.
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

// Live-network feed lookups (especially for not-yet-existing feeds) resolve
// across the swarm and routinely take tens of seconds.
const LIVE_TIMEOUT = { timeout: 120_000 };
const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

describe('chunkAddress', () => {
  it.skipIf(!postageBatchId)(
    'matches the reference Bee computes for /bytes uploads',
    async () => {
      const payload = crypto.getRandomValues(new Uint8Array(1024));
      const res = await fetch(`${BEE_URL}/bytes`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'swarm-postage-batch-id': postageBatchId!,
        },
        body: payload,
      });
      const { reference } = (await res.json()) as { reference: string };
      expect(bytesToHex(chunkAddress(payload))).toBe(reference);
    },
  );

  it('rejects payloads larger than one chunk', () => {
    expect(() => chunkAddress(new Uint8Array(4097))).toThrow();
  });
});

describe.skipIf(!postageBatchId)(
  'swarm document storage (live Bee node)',
  () => {
    const makeStorage = (documentKey?: string) =>
      createSwarmDocumentStorage({
        namespace: 'test',
        beeUrl: BEE_URL,
        postageBatchId: postageBatchId!,
        ownerPrivateKey: generatePrivateKey(),
        documentKey,
      });

    it(
      'returns null for a document that was never saved',
      LIVE_TIMEOUT,
      async () => {
        const storage = makeStorage(generateDocumentKey());
        expect(await storage.loadDocument('no-such-doc')).toBeNull();
        expect(await storage.listDocumentVersions('no-such-doc')).toEqual([]);
      },
    );

    it(
      'saves, loads and versions an encrypted document',
      LIVE_TIMEOUT,
      async () => {
        const storage = makeStorage(generateDocumentKey());
        const documentId = `test-${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;

        const v0 = await storage.saveDocument(documentId, 'version zero');
        const v1 = await storage.saveDocument(documentId, 'version one');
        const v2 = await storage.saveDocument(
          documentId,
          'version two — latest',
        );
        expect([v0.index, v1.index, v2.index]).toEqual([0, 1, 2]);

        const latest = await storage.loadDocument(documentId);
        expect(latest?.text).toBe('version two — latest');
        expect(latest?.feedIndex).toBe(2);
        expect(latest?.reference).toBe(v2.reference);

        const historical = await storage.loadDocumentVersion(documentId, 1);
        expect(historical?.text).toBe('version one');

        const versions = await storage.listDocumentVersions(documentId);
        expect(versions.map((v) => v.index)).toEqual([0, 1, 2]);
        expect(versions.map((v) => v.reference)).toEqual([
          v0.reference,
          v1.reference,
          v2.reference,
        ]);
      },
    );

    it(
      'stores only ciphertext when a documentKey is set',
      LIVE_TIMEOUT,
      async () => {
        const storage = makeStorage(generateDocumentKey());
        const documentId = `test-${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
        const { reference } = await storage.saveDocument(
          documentId,
          'MARKER-doc-plaintext-must-not-leak',
        );
        const raw = new Uint8Array(
          await (await fetch(`${BEE_URL}/bzz/${reference}/`)).arrayBuffer(),
        );
        expect(new TextDecoder().decode(raw)).not.toContain('MARKER-doc');
      },
    );

    it(
      'cannot decrypt with a different documentKey',
      LIVE_TIMEOUT,
      async () => {
        const documentId = `test-${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
        const ownerPrivateKey = generatePrivateKey();
        const write = createSwarmDocumentStorage({
          namespace: 'test',
          beeUrl: BEE_URL,
          postageBatchId: postageBatchId!,
          ownerPrivateKey,
          documentKey: generateDocumentKey(),
        });
        await write.saveDocument(documentId, 'secret');

        const wrongKey = createSwarmDocumentStorage({
          namespace: 'test',
          beeUrl: BEE_URL,
          ownerPrivateKey,
          documentKey: generateDocumentKey(),
        });
        await expect(wrongKey.loadDocument(documentId)).rejects.toThrow();
      },
    );

    it(
      'supports plaintext storage when no documentKey is given',
      LIVE_TIMEOUT,
      async () => {
        const storage = makeStorage(undefined);
        const documentId = `test-${bytesToHex(crypto.getRandomValues(new Uint8Array(8)))}`;
        await storage.saveDocument(documentId, 'public content');
        const loaded = await storage.loadDocument(documentId);
        expect(loaded?.text).toBe('public content');
      },
    );
  },
);
