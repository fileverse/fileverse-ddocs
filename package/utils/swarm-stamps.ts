/**
 * Postage stamp management for the Swarm storage adapters.
 *
 * Swarm uploads are paid for with postage batches ("stamps") that have both
 * a capacity (depth) and a lifetime (TTL, refillable). Unlike IPFS pinning,
 * a batch that fills up or expires makes uploads fail — hosts should watch
 * batch health and top up / dilute in time. These helpers wrap the Bee API's
 * stamp endpoints so hosts can do exactly that.
 *
 * Note: `buyStamp`, `topUpStamp` and `diluteStamp` spend xBZZ from the Bee
 * node's wallet and settle on-chain — they can take a while and are not
 * idempotent. The read-only helpers are free.
 *
 * Stamps pay for *uploads only*. A node with no batch can still read
 * everything on Swarm, so hosts should treat a missing batch as "read-only
 * here", not as "Swarm unavailable".
 */
import { type SwarmRequestConfig, swarmFetch } from './swarm-common';

export type SwarmNodeConfig = SwarmRequestConfig;

/** A postage batch as reported by `GET /stamps`. */
export interface PostageStamp {
  batchID: string;
  utilization: number;
  /** Fraction of capacity used (0..1). Present on Bee ≥ 2.6. */
  utilizationRatio?: number | undefined;
  usable: boolean;
  label: string;
  depth: number;
  amount: string;
  bucketDepth: number;
  blockNumber: number;
  immutableFlag: boolean;
  exists: boolean;
  /** Remaining lifetime in seconds. */
  batchTTL: number;
}

export interface StampHealthThresholds {
  /** Warn when remaining TTL drops below this many seconds. Default 7 days. */
  minTtlSeconds?: number;
  /** Warn when utilization exceeds this fraction. Default 0.9. */
  maxUtilization?: number;
}

export interface StampHealth {
  batchID: string;
  usable: boolean;
  /** Fraction of capacity used (0..1). */
  utilization: number;
  /** Remaining lifetime in seconds. */
  ttlSeconds: number;
  expiresAt: Date;
  /**
   * `ok` — healthy; `expiring` — TTL below threshold (top up!);
   * `nearly-full` — utilization above threshold (dilute or buy a new
   * batch); `unusable` — Bee reports the batch as not usable (still
   * propagating, expired, or unknown).
   */
  status: 'ok' | 'expiring' | 'nearly-full' | 'unusable';
}

/** Bee rejects batches shallower than this. */
export const MIN_BATCH_DEPTH = 17;
/** Swarm chunk payload size. */
export const CHUNK_SIZE_BYTES = 4096;
/** PLUR per BZZ (BZZ has 16 decimals). */
export const PLUR_PER_BZZ = 10 ** 16;
/** Gnosis Chain block time — postage is charged per block. */
export const BLOCK_TIME_SECONDS = 5;

/** Live postage pricing, from `GET /chainstate`. */
export interface ChainState {
  /** PLUR charged per chunk per block. */
  currentPrice: number;
  block: number;
  minimumValidityBlocks: number;
}

/** The node's own funds, from `GET /wallet`. */
export interface WalletBalance {
  /** xBZZ in PLUR — this pays for postage. */
  bzzBalance: number;
  /** xDAI in wei — this pays gas for the purchase transaction. */
  nativeTokenBalance: number;
  walletAddress: string;
  chainID: number;
}

/** What a prospective batch would cost and provide. */
export interface BatchEstimate {
  depth: number;
  /** Per-chunk balance, the `amount` a purchase takes. */
  amount: number;
  /** 2^depth chunks — the theoretical ceiling. */
  capacityBytes: number;
  /**
   * Realistic capacity. Chunks land in 2^16 buckets by address and a batch
   * is full once any bucket is, so the usable share is well below the
   * ceiling — Swarm's own guidance is to assume roughly half.
   */
  usableCapacityBytes: number;
  ttlSeconds: number;
  costPlur: number;
  costBzz: number;
}

const DEFAULT_MIN_TTL_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_MAX_UTILIZATION = 0.9;
/** Stamp endpoints answer from local node state — no network lookup. */
const STAMP_TIMEOUT_MS = 10_000;

const request = async (
  config: SwarmNodeConfig,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' = 'GET',
) => {
  const response = await swarmFetch(config, path, {
    method,
    // Buying/topping up settles on-chain and legitimately takes longer.
    timeoutMs:
      method === 'GET' ? STAMP_TIMEOUT_MS : (config.timeoutMs ?? 120_000),
  });
  if (response.status === 404) {
    throw new Error(`Bee stamp request ${method} ${path} failed: not found`);
  }
  return response.json();
};

/** All postage batches owned by this Bee node. */
export const listStamps = async (
  config: SwarmNodeConfig,
): Promise<PostageStamp[]> => {
  const { stamps } = (await request(config, '/stamps')) as {
    stamps: PostageStamp[] | null;
  };
  return stamps ?? [];
};

/** One postage batch by ID. */
export const getStamp = (
  config: SwarmNodeConfig,
  batchId: string,
): Promise<PostageStamp> =>
  request(config, `/stamps/${batchId}`) as Promise<PostageStamp>;

/** Utilization fraction, falling back to bucket math on older Bee. */
export const stampUtilization = (stamp: PostageStamp): number =>
  stamp.utilizationRatio ??
  stamp.utilization / 2 ** (stamp.depth - stamp.bucketDepth);

/**
 * Assess a batch against expiry/capacity thresholds so hosts can surface
 * "top up your stamp" warnings before uploads start failing.
 */
export const checkStampHealth = async (
  config: SwarmNodeConfig,
  batchId: string,
  thresholds: StampHealthThresholds = {},
): Promise<StampHealth> => {
  const stamp = await getStamp(config, batchId);
  const minTtl = thresholds.minTtlSeconds ?? DEFAULT_MIN_TTL_SECONDS;
  const maxUtilization = thresholds.maxUtilization ?? DEFAULT_MAX_UTILIZATION;
  const utilization = stampUtilization(stamp);

  let status: StampHealth['status'] = 'ok';
  if (!stamp.usable) status = 'unusable';
  else if (stamp.batchTTL >= 0 && stamp.batchTTL < minTtl) status = 'expiring';
  else if (utilization > maxUtilization) status = 'nearly-full';

  return {
    batchID: stamp.batchID,
    usable: stamp.usable,
    utilization,
    ttlSeconds: stamp.batchTTL,
    expiresAt: new Date(Date.now() + stamp.batchTTL * 1000),
    status,
  };
};

/** Current postage price and chain position. */
export const getChainState = async (
  config: SwarmNodeConfig,
): Promise<ChainState> => {
  const state = (await request(config, '/chainstate')) as {
    currentPrice: string;
    block: number;
    minimumValidityBlocks: number;
  };
  return {
    currentPrice: Number(state.currentPrice),
    block: state.block,
    minimumValidityBlocks: state.minimumValidityBlocks,
  };
};

/** The node's wallet — what a purchase would be paid from. */
export const getWalletBalance = async (
  config: SwarmNodeConfig,
): Promise<WalletBalance> => {
  const wallet = (await request(config, '/wallet')) as {
    bzzBalance: string;
    nativeTokenBalance: string;
    walletAddress: string;
    chainID: number;
  };
  return {
    bzzBalance: Number(wallet.bzzBalance),
    nativeTokenBalance: Number(wallet.nativeTokenBalance),
    walletAddress: wallet.walletAddress,
    chainID: wallet.chainID,
  };
};

/** Per-chunk balance that keeps a batch alive for `days` at `price`. */
export const amountForDuration = (days: number, price: number): number =>
  Math.ceil((days * 24 * 60 * 60) / BLOCK_TIME_SECONDS) * price;

/**
 * Cost and yield of a batch, so a host can show the price before spending
 * anything. Purely local arithmetic over the live `currentPrice`.
 */
export const estimateBatch = (options: {
  depth: number;
  days: number;
  price: number;
}): BatchEstimate => {
  const depth = Math.max(MIN_BATCH_DEPTH, Math.floor(options.depth));
  const amount = amountForDuration(options.days, options.price);
  const chunks = 2 ** depth;
  const capacityBytes = chunks * CHUNK_SIZE_BYTES;
  const costPlur = amount * chunks;
  return {
    depth,
    amount,
    capacityBytes,
    usableCapacityBytes: Math.floor(capacityBytes / 2),
    ttlSeconds: Math.floor((amount / options.price) * BLOCK_TIME_SECONDS),
    costPlur,
    costBzz: costPlur / PLUR_PER_BZZ,
  };
};

/**
 * Buy a new postage batch (spends xBZZ, settles on-chain). `amount` is the
 * per-chunk balance in PLUR (drives TTL), `depth` the capacity (2^depth
 * chunks of 4KB) — {@link estimateBatch} turns a wanted size and duration
 * into both. Returns the new batch ID; the batch may need a few blocks
 * before `usable` turns true.
 */
export const buyStamp = async (
  config: SwarmNodeConfig,
  options: { amount: string; depth: number; label?: string },
): Promise<string> => {
  const label = options.label
    ? `?label=${encodeURIComponent(options.label)}`
    : '';
  const { batchID } = (await request(
    config,
    `/stamps/${options.amount}/${options.depth}${label}`,
    'POST',
  )) as { batchID: string };
  return batchID;
};

/** Extend a batch's TTL by adding `amount` PLUR per chunk (spends xBZZ). */
export const topUpStamp = async (
  config: SwarmNodeConfig,
  batchId: string,
  amount: string,
): Promise<string> => {
  const { batchID } = (await request(
    config,
    `/stamps/topup/${batchId}/${amount}`,
    'PATCH',
  )) as { batchID: string };
  return batchID;
};

/**
 * Increase a batch's capacity by raising its depth (this also shortens its
 * TTL proportionally — consider a top-up alongside).
 */
export const diluteStamp = async (
  config: SwarmNodeConfig,
  batchId: string,
  depth: number,
): Promise<string> => {
  const { batchID } = (await request(
    config,
    `/stamps/dilute/${batchId}/${depth}`,
    'PATCH',
  )) as { batchID: string };
  return batchID;
};
