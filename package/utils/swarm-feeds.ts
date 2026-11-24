import { keccak256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  type SwarmRequestConfig,
  bytesToHex,
  concatBytes,
  hexToBytes,
  swarmFetch,
} from './swarm-common';

/**
 * Minimal Ethereum Swarm sequence-feed client over the Bee HTTP API.
 *
 * A feed is a mutable pointer built from single-owner chunks (SOCs): update
 * N of feed `(owner, topic)` is a chunk whose identifier is derived from the
 * topic and index, signed by the owner's key. Writing needs only
 * `POST /soc` and reading `GET /feeds` / `GET /chunks`, so — with `viem`
 * (already a peer dependency) supplying keccak256 and signing — no extra
 * dependency is required.
 *
 * Wire format compatibility: identifiers, chunk addressing (BMT) and the
 * Ethereum-personal-sign SOC signature follow the Swarm specs, so feeds
 * written here are readable by bee-js and vice versa.
 */

export interface SwarmFeedConfig extends SwarmRequestConfig {
  /**
   * Postage batch ID paying for feed updates. Required to write; reads
   * need no stamp, so a node without one can still follow feeds.
   */
  postageBatchId?: string;
  /**
   * `false` makes writes synchronous: the call returns only once the chunk
   * has been pushed to the network. Bee's default (deferred) stores locally
   * and syncs in the background — fine for private data, wrong for content
   * another node must find promptly: a viewer's node fetching from the
   * network cannot see a feed update that still sits on the writer's node.
   */
  deferredUpload?: boolean;
}

const SEGMENT_SIZE = 32;
const CHUNK_SIZE = 4096;
const SOC_SIGNATURE_SIZE = 65;
const SOC_IDENTIFIER_SIZE = 32;
const SPAN_SIZE = 8;

const utf8 = (value: string) => new TextEncoder().encode(value);

/** Chunk span: content length as uint64 little-endian. */
const spanBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(SPAN_SIZE);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(length), true);
  return bytes;
};

/** Feed index / timestamp: uint64 big-endian. */
export const uint64BigEndian = (value: number): Uint8Array => {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
};

/** Read a chunk span (see {@link spanBytes}): uint64 little-endian. */
const readSpan = (bytes: Uint8Array): number =>
  Number(new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true));

/** Binary Merkle Tree root over one zero-padded 4096-byte chunk. */
const bmtRoot = (payload: Uint8Array): Uint8Array => {
  if (payload.length > CHUNK_SIZE) {
    throw new Error(
      `Payload exceeds single chunk capacity (${payload.length} > ${CHUNK_SIZE})`,
    );
  }
  let level = new Uint8Array(CHUNK_SIZE);
  level.set(payload);
  while (level.length > SEGMENT_SIZE) {
    const next = new Uint8Array(level.length / 2);
    for (let i = 0; i < next.length; i += SEGMENT_SIZE) {
      next.set(
        keccak256(level.slice(i * 2, i * 2 + SEGMENT_SIZE * 2), 'bytes'),
        i,
      );
    }
    level = next;
  }
  return level;
};

/** Content address of a single chunk: keccak256(span || bmtRoot). */
export const chunkAddress = (payload: Uint8Array): Uint8Array =>
  keccak256(concatBytes(spanBytes(payload.length), bmtRoot(payload)), 'bytes');

/** Derive a 32-byte feed topic from a human-readable name. */
export const makeFeedTopic = (name: string): Uint8Array =>
  keccak256(utf8(name), 'bytes');

/** Sequence-feed SOC identifier: keccak256(topic || index_be64). */
export const feedIdentifier = (topic: Uint8Array, index: number): Uint8Array =>
  keccak256(concatBytes(topic, uint64BigEndian(index)), 'bytes');

/** Ethereum address (lowercase, no 0x) owning feeds signed with this key. */
export const feedOwnerAddress = (privateKey: `0x${string}`): string =>
  privateKeyToAccount(privateKey).address.slice(2).toLowerCase();

/**
 * Sign and upload one sequence-feed update. Returns the SOC reference.
 * The payload must fit a single chunk (≤ 4096 bytes minus headers); larger
 * content should live on `/bytes` with only its reference in the feed.
 */
export const writeFeedUpdate = async (
  config: SwarmFeedConfig,
  ownerPrivateKey: `0x${string}`,
  topic: Uint8Array,
  index: number,
  payload: Uint8Array,
): Promise<string> => {
  const account = privateKeyToAccount(ownerPrivateKey);
  const owner = account.address.slice(2).toLowerCase();

  const identifier = feedIdentifier(topic, index);
  const address = chunkAddress(payload);
  // SOC digest is signed with the Ethereum personal-message prefix so
  // ordinary wallet keys (and hardware signers) can own feeds.
  const digest = keccak256(concatBytes(identifier, address), 'bytes');
  const signature = await account.signMessage({ message: { raw: digest } });

  config.onProgress?.({ stage: 'feed-update', status: 'start' });
  const response = await swarmFetch(
    config,
    `/soc/${owner}/${bytesToHex(identifier)}?sig=${signature.slice(2)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        ...(config.postageBatchId
          ? { 'swarm-postage-batch-id': config.postageBatchId }
          : {}),
        ...(config.deferredUpload === false
          ? { 'swarm-deferred-upload': 'false' }
          : {}),
      },
      body: concatBytes(spanBytes(payload.length), payload),
    },
  );
  if (response.status === 404) {
    throw new Error('Feed update failed: node rejected the chunk (404)');
  }
  const { reference } = (await response.json()) as { reference: string };
  config.onProgress?.({ stage: 'feed-update', status: 'done' });
  return reference;
};

/**
 * Look up the latest update index of a feed via `GET /feeds`.
 * Returns `null` when the feed has no updates yet.
 */
export const readLatestFeedIndex = async (
  config: SwarmFeedConfig,
  owner: string,
  topic: Uint8Array,
): Promise<{ index: number; nextIndex: number } | null> => {
  config.onProgress?.({ stage: 'feed-lookup', status: 'start' });
  const response = await swarmFetch(
    config,
    `/feeds/${owner}/${bytesToHex(topic)}?type=sequence`,
  );
  if (response.status === 404) {
    config.onProgress?.({ stage: 'feed-lookup', status: 'done' });
    return null;
  }
  const indexHex = response.headers.get('swarm-feed-index');
  const nextHex = response.headers.get('swarm-feed-index-next');
  if (!indexHex) {
    throw new Error('Feed lookup response missing swarm-feed-index header');
  }
  const index = parseInt(indexHex, 16);
  config.onProgress?.({ stage: 'feed-lookup', status: 'done' });
  return { index, nextIndex: nextHex ? parseInt(nextHex, 16) : index + 1 };
};

/**
 * Read the payload of a specific feed update by index, fetching the SOC
 * directly by its address via `GET /chunks` (works for any historical
 * index, which `GET /feeds` does not expose). Returns `null` when that
 * update does not exist.
 */
export const readFeedUpdate = async (
  config: SwarmFeedConfig,
  owner: string,
  topic: Uint8Array,
  index: number,
): Promise<Uint8Array | null> => {
  const identifier = feedIdentifier(topic, index);
  const socAddress = keccak256(
    concatBytes(identifier, hexToBytes(owner)),
    'bytes',
  );

  const response = await swarmFetch(
    config,
    `/chunks/${bytesToHex(socAddress)}`,
  );
  if (response.status === 404) return null;
  // SOC chunk layout: identifier(32) || signature(65) || span(8) || payload.
  const data = new Uint8Array(await response.arrayBuffer());
  const payloadStart = SOC_IDENTIFIER_SIZE + SOC_SIGNATURE_SIZE + SPAN_SIZE;
  const spanStart = SOC_IDENTIFIER_SIZE + SOC_SIGNATURE_SIZE;
  const length = readSpan(data.slice(spanStart, payloadStart));
  return data.slice(payloadStart, payloadStart + length);
};
