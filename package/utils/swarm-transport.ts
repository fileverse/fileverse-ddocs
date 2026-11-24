import { keccak256 } from 'viem';
import {
  type SwarmProgressHandler,
  bytesToHex,
  concatBytes,
  fromBase64,
  hexToBytes,
  readWithProgress,
  swarmFetch,
  toBase64,
} from './swarm-common';
import {
  type SwarmFeedConfig,
  chunkAddress,
  feedIdentifier,
  feedOwnerAddress,
  readFeedUpdate as readFeedUpdateHttp,
  readLatestFeedIndex as readLatestFeedIndexHttp,
  writeFeedUpdate as writeFeedUpdateHttp,
} from './swarm-feeds';

/**
 * How the editor reaches Swarm.
 *
 * There are two ways for a page to talk to a Swarm node, and they are not
 * competing standards — they are the same data model behind different
 * access surfaces:
 *
 * - A **Bee node's HTTP API** (`http://localhost:1633`). Full node
 *   authority, including postage, staking and wallet. Right for servers,
 *   scripts and desktop apps that legitimately hold that authority.
 * - A **provider injected at `window.swarm`** (Swarm Provider API, the
 *   `window.ethereum` pattern applied to Swarm). Origin-scoped and
 *   permissioned; browsers such as Freedom expose this and deliberately
 *   block raw access to 1633, because that port is an administrative API
 *   rather than a content transport.
 *
 * Applications should not have to choose. This module defines one narrow
 * interface over both and prefers the provider when a page is running in a
 * browser that has one, exactly as web3 libraries prefer an injected
 * provider over a hardcoded RPC URL.
 *
 * Two differences are inherent rather than incidental, and callers can see
 * them through {@link SwarmTransportStatus}:
 *
 * - **Postage.** A provider manages stamps itself and (in v1 of the spec)
 *   exposes no way to buy or inspect them, so postage UI must be hidden
 *   rather than shown as broken.
 * - **Who owns a feed.** Over HTTP the caller holds the signing key. A
 *   provider signs with an origin-scoped identity and never exposes key
 *   material, so a page can only write feeds it owns — it cannot adopt a
 *   key handed to it in a link. Reading anyone's feed works either way.
 */

/** The `window.swarm` object, per the Swarm Provider API. */
export interface SwarmProvider {
  request(_args: { method: string; params?: unknown }): Promise<unknown>;
  on?(_event: string, _handler: (..._args: unknown[]) => void): unknown;
  removeListener?(
    _event: string,
    _handler: (..._args: unknown[]) => void,
  ): unknown;
}

export interface SwarmTransportStatus {
  /** Which access surface is in use. */
  kind: 'bee-http' | 'swarm-provider';
  /** Whether uploads are currently possible. */
  canWrite: boolean;
  /**
   * Why not, when `canWrite` is false. Provider reason codes pass through
   * verbatim (`not-connected`, `node-stopped`, `no-usable-stamps`,
   * `ultra-light-mode`, `node-not-ready`); the HTTP transport reports
   * `node-unreachable` or `no-usable-stamps`.
   */
  reason?: string | undefined;
  /**
   * True when postage is the provider's business and the host should not
   * offer to buy, top up or inspect batches.
   */
  managesPostage: boolean;
  /** Largest single upload the transport accepts, when it advertises one. */
  maxDataBytes?: number | undefined;
}

export interface SwarmTransport {
  readonly kind: SwarmTransportStatus['kind'];
  /** True when postage is handled for us and must not be surfaced. */
  readonly managesPostage: boolean;
  /** Current usability, cheap enough to poll. */
  status(): Promise<SwarmTransportStatus>;
  /** Ask for write permission. No-op where permission is not a concept. */
  connect(): Promise<void>;
  /** Address that signs this app's feed updates. */
  feedOwner(): Promise<string>;
  uploadData(
    _data: Uint8Array,
    _options?: {
      contentType?: string | undefined;
      onProgress?: SwarmProgressHandler | undefined;
    },
  ): Promise<string>;
  downloadData(
    _reference: string,
    _options?: { onProgress?: SwarmProgressHandler | undefined },
  ): Promise<Uint8Array>;
  writeFeedUpdate(
    _topic: Uint8Array,
    _index: number,
    _payload: Uint8Array,
  ): Promise<string>;
  readFeedUpdate(
    _owner: string,
    _topic: Uint8Array,
    _index: number,
  ): Promise<Uint8Array | null>;
  /** Latest index of a feed, or null when it has no updates yet. */
  latestFeedIndex(
    _owner: string,
    _topic: Uint8Array,
  ): Promise<{ index: number; nextIndex: number } | null>;
}

// ─── Bee HTTP transport ───

export interface BeeHttpTransportConfig extends SwarmFeedConfig {
  /** Key signing feed updates. Reads work without it. */
  ownerPrivateKey?: `0x${string}` | undefined;
  /**
   * Set `false` to wait until an upload has been pushed to the network
   * before it resolves. Bee's default defers that to a background sync,
   * which leaves content unretrievable if the node stops first.
   */
  deferredUpload?: boolean;
  /**
   * File name uploads carry in their manifest (`/bzz?name=`). Document
   * storage passes its `namespace`. Defaults to `'document'`.
   */
  uploadName?: string;
}

export const createBeeHttpTransport = (
  config: BeeHttpTransportConfig,
): SwarmTransport => ({
  kind: 'bee-http',
  managesPostage: false,

  async status() {
    try {
      await swarmFetch(config, '/health', { timeoutMs: 10_000 });
    } catch {
      return {
        kind: 'bee-http' as const,
        canWrite: false,
        reason: 'node-unreachable',
        managesPostage: false,
      };
    }
    return {
      kind: 'bee-http' as const,
      canWrite: Boolean(config.postageBatchId),
      reason: config.postageBatchId ? undefined : 'no-usable-stamps',
      managesPostage: false,
    };
  },

  async connect() {
    // Holding the node's address is the whole permission model here.
  },

  async feedOwner() {
    if (!config.ownerPrivateKey) {
      throw new Error('No signing key configured for feed updates');
    }
    return feedOwnerAddress(config.ownerPrivateKey);
  },

  async uploadData(data: Uint8Array<ArrayBuffer>, options) {
    if (!config.postageBatchId) {
      throw new Error(
        'Uploading to Swarm needs a postage batch. This node has none, so ' +
          'content is read-only here (reading never needs a stamp).',
      );
    }
    options?.onProgress?.({
      stage: 'upload',
      status: 'start',
      total: data.length,
    });
    // Uploaded through /bzz as a single file rather than /bytes, so the
    // reference is manifest-wrapped and therefore resolvable as
    // `bzz://<reference>/` too. A raw /bytes reference is only readable
    // through a node's own API: `bzz://` resolves manifests, and the
    // provider API offers no way to reassemble a bare chunk tree — so a
    // document stored that way cannot be opened in a Swarm-aware browser
    // at all. Same content, same addressing, one more level of indirection.
    const name = encodeURIComponent(config.uploadName ?? 'document');
    const response = await swarmFetch(config, `/bzz?name=${name}`, {
      method: 'POST',
      headers: {
        'content-type': options?.contentType ?? 'application/octet-stream',
        'swarm-postage-batch-id': config.postageBatchId,
        'swarm-collection': 'false',
        ...(config.deferredUpload === false
          ? { 'swarm-deferred-upload': 'false' }
          : {}),
      },
      body: data,
    });
    if (response.status === 404) {
      throw new Error('Swarm upload failed: node rejected the upload');
    }
    const { reference } = (await response.json()) as { reference: string };
    options?.onProgress?.({
      stage: 'upload',
      status: 'done',
      loaded: data.length,
      total: data.length,
    });
    return reference;
  },

  async downloadData(reference, options) {
    options?.onProgress?.({ stage: 'download', status: 'start' });
    // Trailing slash: the bare path 308-redirects to it.
    let response = await swarmFetch(config, `/bzz/${reference}/`);
    if (response.status === 404) {
      // Written by an earlier version, straight to /bytes.
      response = await swarmFetch(config, `/bytes/${reference}`);
    }
    if (response.status === 404) {
      throw new Error(`Content not found on Swarm: ${reference}`);
    }
    return readWithProgress(response, options?.onProgress);
  },

  async writeFeedUpdate(topic, index, payload) {
    if (!config.ownerPrivateKey) {
      throw new Error('No signing key configured for feed updates');
    }
    return writeFeedUpdateHttp(
      config,
      config.ownerPrivateKey,
      topic,
      index,
      payload,
    );
  },

  readFeedUpdate: (owner, topic, index) =>
    readFeedUpdateHttp(config, owner, topic, index),

  latestFeedIndex: (owner, topic) =>
    readLatestFeedIndexHttp(config, owner, topic),
});

// ─── window.swarm provider transport ───

const SPAN_SIZE = 8;

/** Chunk span: content length as uint64 little-endian. */
const spanBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(SPAN_SIZE);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(length), true);
  return bytes;
};

const asBytes = (data: string, encoding?: string): Uint8Array =>
  encoding === 'base64' ? fromBase64(data) : new TextEncoder().encode(data);

/** JSON-RPC error codes the provider raises for absent content. */
const isNotFound = (error: unknown): boolean => {
  const reason = (error as { data?: { reason?: string } })?.data?.reason;
  return reason === 'chunk_not_found' || reason === 'feed_entry_not_found';
};

export const createSwarmProviderTransport = (
  provider: SwarmProvider,
  options: { onProgress?: SwarmProgressHandler | undefined } = {},
): SwarmTransport => {
  const call = <T>(method: string, params?: unknown): Promise<T> =>
    provider.request({ method, params }) as Promise<T>;

  let ownerAddress: string | null = null;

  return {
    kind: 'swarm-provider',
    // Postage is the provider's business; the v1 spec exposes no stamp
    // management, so hosts must not offer any.
    managesPostage: true,

    async status() {
      try {
        const caps = await call<{
          canPublish: boolean;
          reason: string | null;
          limits?: { maxDataBytes?: number };
        }>('swarm_getCapabilities');
        return {
          kind: 'swarm-provider' as const,
          canWrite: caps.canPublish,
          reason: caps.reason ?? undefined,
          managesPostage: true,
          maxDataBytes: caps.limits?.maxDataBytes,
        };
      } catch (error) {
        return {
          kind: 'swarm-provider' as const,
          canWrite: false,
          reason: (error as Error).message || 'provider-unavailable',
          managesPostage: true,
        };
      }
    },

    async connect() {
      await call('swarm_requestAccess');
    },

    async feedOwner() {
      if (ownerAddress) return ownerAddress;
      const { owner } = await call<{ owner: string }>(
        'swarm_getSigningIdentity',
      );
      // Compared against feed owners elsewhere, which are lower-case hex
      // without the 0x prefix.
      ownerAddress = owner.replace(/^0x/, '').toLowerCase();
      return ownerAddress;
    },

    async uploadData(data, options) {
      options?.onProgress?.({
        stage: 'upload',
        status: 'start',
        total: data.length,
      });
      const { reference } = await call<{ reference: string }>(
        'swarm_publishData',
        {
          data,
          contentType: options?.contentType ?? 'application/octet-stream',
        },
      );
      options?.onProgress?.({
        stage: 'upload',
        status: 'done',
        loaded: data.length,
        total: data.length,
      });
      return reference;
    },

    async downloadData(reference, options) {
      options?.onProgress?.({ stage: 'download', status: 'start' });
      // Content larger than one chunk is a BMT tree, which the chunk
      // methods cannot reassemble; a provider environment resolves bzz://
      // natively, so that is the path for bulk reads. Single-chunk content
      // (our document snapshots) still works if bzz:// is unavailable.
      try {
        const response = await fetch(`bzz://${reference}/`);
        if (response.ok) {
          return readWithProgress(response, options?.onProgress);
        }
      } catch {
        // No bzz:// handler here — fall through to the chunk read.
      }
      const chunk = await call<{ data: string; encoding?: string }>(
        'swarm_readChunk',
        { reference },
      );
      const bytes = asBytes(chunk.data, chunk.encoding);
      options?.onProgress?.({
        stage: 'download',
        status: 'done',
        loaded: bytes.length,
        total: bytes.length,
      });
      return bytes;
    },

    async writeFeedUpdate(topic, index, payload) {
      const { reference } = await call<{ reference: string }>(
        'swarm_writeSingleOwnerChunk',
        {
          identifier: bytesToHex(feedIdentifier(topic, index)),
          data: payload,
        },
      );
      return reference;
    },

    async readFeedUpdate(owner, topic, index) {
      try {
        const soc = await call<{ data: string; encoding?: string }>(
          'swarm_readSingleOwnerChunk',
          {
            owner: `0x${owner.replace(/^0x/, '')}`,
            identifier: bytesToHex(feedIdentifier(topic, index)),
          },
        );
        return asBytes(soc.data, soc.encoding);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },

    async latestFeedIndex(owner, topic) {
      // The provider API reads feed entries by exact index; there is no
      // "give me the latest" lookup as Bee's /feeds offers. Probing costs
      // O(log n) reads, which is acceptable for the update counts a
      // document accumulates.
      //
      // Reported as feed-lookup so a host's progress display names the step
      // it is actually on. Several network round trips happen here, and
      // saying nothing makes the *previous* step look stuck — which is
      // exactly how this read in a browser: "Checking postage batch" for
      // half a minute, while the real work was here.
      options.onProgress?.({ stage: 'feed-lookup', status: 'start' });
      const head = await probeLatestFeedIndex((index) =>
        this.readFeedUpdate(owner, topic, index),
      );
      options.onProgress?.({ stage: 'feed-lookup', status: 'done' });
      return head;
    },
  };
};

/**
 * Find the highest existing feed index by doubling until a gap appears,
 * then bisecting. Sequence feeds are contiguous from 0, which is what makes
 * this sound.
 */
export const probeLatestFeedIndex = async (
  read: (_index: number) => Promise<Uint8Array | null>,
): Promise<{ index: number; nextIndex: number } | null> => {
  if (!(await read(0))) return null;

  let known = 0;
  let step = 1;
  for (;;) {
    const candidate = known + step;
    if (await read(candidate)) {
      known = candidate;
      step *= 2;
      continue;
    }
    if (step === 1) break;
    step = 1;
  }
  return { index: known, nextIndex: known + 1 };
};

// ─── Detection ───

export interface TransportDetectionConfig extends BeeHttpTransportConfig {
  /**
   * Explicit provider, mainly for tests. Defaults to `window.swarm`.
   * Pass `null` to force the Bee HTTP transport.
   */
  provider?: SwarmProvider | null;
}

/**
 * Prefer an injected provider, fall back to the Bee HTTP API — the same
 * shape as `window.ethereum ?? new JsonRpcProvider(url)`. A page in a
 * Swarm-aware browser then works without configuration, while servers,
 * scripts and plain browsers keep talking to a node directly.
 */
export const detectSwarmTransport = (
  config: TransportDetectionConfig,
): SwarmTransport => {
  const injected =
    config.provider === undefined
      ? (globalThis as { swarm?: SwarmProvider }).swarm
      : config.provider;
  return injected
    ? createSwarmProviderTransport(injected, { onProgress: config.onProgress })
    : createBeeHttpTransport(config);
};

/** SOC address for a feed update, useful for pre-computing references. */
export const feedUpdateAddress = (
  owner: string,
  topic: Uint8Array,
  index: number,
): string =>
  bytesToHex(
    keccak256(
      concatBytes(feedIdentifier(topic, index), hexToBytes(owner)),
      'bytes',
    ),
  );

export { chunkAddress, spanBytes, toBase64 };
