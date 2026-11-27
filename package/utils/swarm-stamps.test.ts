// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  type PostageStamp,
  checkStampHealth,
  estimateBatch,
  getChainState,
  getStamp,
  getWalletBalance,
  listStamps,
  stampUtilization,
} from './swarm-stamps';

const BEE_URL = process.env.BEE_API_URL || 'http://localhost:1633';

const beeAvailable = await (async () => {
  try {
    const res = await fetch(`${BEE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
})();

const baseStamp: PostageStamp = {
  batchID: 'ab'.repeat(32),
  utilization: 4,
  utilizationRatio: 0.5,
  usable: true,
  label: '',
  depth: 19,
  amount: '1000000',
  bucketDepth: 16,
  blockNumber: 1,
  immutableFlag: true,
  exists: true,
  batchTTL: 30 * 24 * 60 * 60,
};

describe('batch estimates', () => {
  // Live price from a Gnosis-chain node at the time of writing.
  const price = 71865;

  it('prices a batch the way the chain charges for it', () => {
    const estimate = estimateBatch({ depth: 17, days: 30, price });
    // amount = blocks in 30 days × price; cost = amount × 2^depth
    const blocks = (30 * 24 * 60 * 60) / 5;
    expect(estimate.amount).toBe(blocks * price);
    expect(estimate.costPlur).toBe(blocks * price * 2 ** 17);
    expect(estimate.costBzz).toBeCloseTo(estimate.costPlur / 10 ** 16, 6);
  });

  it('round-trips the requested lifetime', () => {
    const estimate = estimateBatch({ depth: 18, days: 30, price });
    expect(estimate.ttlSeconds / (24 * 60 * 60)).toBeCloseTo(30, 1);
  });

  it('reports capacity and a realistic usable share', () => {
    const estimate = estimateBatch({ depth: 17, days: 1, price });
    expect(estimate.capacityBytes).toBe(2 ** 17 * 4096);
    expect(estimate.usableCapacityBytes).toBe(estimate.capacityBytes / 2);
  });

  it('never proposes a batch shallower than Bee accepts', () => {
    expect(estimateBatch({ depth: 10, days: 1, price }).depth).toBe(17);
  });

  it('scales cost with depth, not lifetime alone', () => {
    const shallow = estimateBatch({ depth: 17, days: 30, price });
    const deep = estimateBatch({ depth: 19, days: 30, price });
    expect(deep.costPlur / shallow.costPlur).toBe(4);
    expect(deep.ttlSeconds).toBe(shallow.ttlSeconds);
  });
});

describe('stampUtilization', () => {
  it('prefers utilizationRatio when Bee provides it', () => {
    expect(stampUtilization(baseStamp)).toBe(0.5);
  });

  it('falls back to bucket math on older Bee', () => {
    const older = { ...baseStamp, utilizationRatio: undefined };
    // 4 of 2^(19-16)=8 buckets used
    expect(stampUtilization(older)).toBe(0.5);
  });
});

// Read-only against a live node; buy/top-up/dilute spend xBZZ and are
// deliberately not exercised here.
describe.skipIf(!beeAvailable)('stamp endpoints (live Bee node)', () => {
  it('lists batches and fetches one by id', async () => {
    const stamps = await listStamps({ beeUrl: BEE_URL });
    expect(Array.isArray(stamps)).toBe(true);
    if (stamps.length === 0) return;

    const stamp = await getStamp({ beeUrl: BEE_URL }, stamps[0]!.batchID);
    expect(stamp.batchID).toBe(stamps[0]!.batchID);
    expect(stamp.depth).toBeGreaterThan(0);
  });

  it('reads live pricing and wallet balance', async () => {
    const chain = await getChainState({ beeUrl: BEE_URL });
    expect(chain.currentPrice).toBeGreaterThan(0);

    const wallet = await getWalletBalance({ beeUrl: BEE_URL });
    expect(wallet.walletAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(wallet.bzzBalance).toBeGreaterThanOrEqual(0);

    // An estimate built from live pricing must be comparable to the balance.
    const estimate = estimateBatch({
      depth: 17,
      days: 30,
      price: chain.currentPrice,
    });
    expect(estimate.costPlur).toBeGreaterThan(0);
  });

  it('reports health with sensible fields', async () => {
    const stamps = await listStamps({ beeUrl: BEE_URL });
    if (stamps.length === 0) return;

    const health = await checkStampHealth(
      { beeUrl: BEE_URL },
      stamps[0]!.batchID,
    );
    expect(health.batchID).toBe(stamps[0]!.batchID);
    expect(health.utilization).toBeGreaterThanOrEqual(0);
    expect(health.utilization).toBeLessThanOrEqual(1);
    expect(['ok', 'expiring', 'nearly-full', 'unusable']).toContain(
      health.status,
    );
    expect(health.expiresAt.getTime()).toBeGreaterThan(0);
  });

  it('flags a healthy batch as expiring under a strict threshold', async () => {
    const stamps = await listStamps({ beeUrl: BEE_URL });
    const usable = stamps.find((s) => s.usable && s.batchTTL > 0);
    if (!usable) return;

    const health = await checkStampHealth({ beeUrl: BEE_URL }, usable.batchID, {
      minTtlSeconds: usable.batchTTL + 1000,
    });
    expect(health.status).toBe('expiring');
  });
});
