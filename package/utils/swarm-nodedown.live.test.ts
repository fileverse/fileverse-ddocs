// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { swarmFetch } from './swarm-common';
import { primarySwarmCondition } from './swarm-diagnostics';

/**
 * A Bee node is a separate process that can stop while a document is open.
 * Runs only when nothing answers at the configured address — the state a
 * host must survive, and the one that used to leave the app waiting.
 */

const BEE_URL = process.env.BEE_API_URL || 'http://localhost:1633';

const nodeIsDown = await (async () => {
  try {
    const res = await fetch(`${BEE_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return !res.ok;
  } catch {
    return true;
  }
})();

describe.skipIf(!nodeIsDown)('Bee node not running (live)', () => {
  it('fails fast rather than waiting out the deadline', async () => {
    const started = Date.now();
    await expect(
      swarmFetch({ beeUrl: BEE_URL }, '/health', { timeoutMs: 30_000 }),
    ).rejects.toThrow();
    // A refused connection is known immediately; only an unreachable host
    // should ever consume the full deadline.
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('is reported as the node being down, not as the user being offline', async () => {
    let reachable = true;
    try {
      await swarmFetch({ beeUrl: BEE_URL }, '/health', { timeoutMs: 5_000 });
    } catch {
      reachable = false;
    }
    expect(reachable).toBe(false);

    const condition = primarySwarmCondition({
      online: true,
      nodeReachable: reachable,
      stamp: null,
      hasBatch: false,
      localFallback: 'browser',
    });
    expect(condition?.kind).toBe('node-unreachable');
    expect(condition?.severity).toBe('blocked');
    expect(condition?.detail).toContain('kept in this browser');
    expect(condition?.remedies.map((r) => r.kind)).toContain('retry');
  });
});
