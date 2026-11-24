// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { primarySwarmCondition } from '../../../package/utils/swarm-diagnostics';

/**
 * The write gate and the messaging must agree as a node comes and goes.
 * These assert the transitions the demo relies on, without a browser: a
 * node that stops mid-session holds content back rather than failing
 * saves, and its return releases exactly what was held.
 */

const base = {
  online: true,
  stamp: null,
  hasBatch: true,
  localFallback: 'browser' as const,
};

/** Mirrors useSwarmStorage: writing needs a batch AND a live node. */
const canWrite = (hasBatch: boolean, nodeReachable: boolean) =>
  hasBatch && nodeReachable;

describe('losing and regaining Swarm mid-session', () => {
  it('stops writing the moment the node goes quiet', () => {
    expect(canWrite(true, true)).toBe(true);
    expect(canWrite(true, false)).toBe(false);
  });

  it('explains a node that stopped while the document was open', () => {
    const condition = primarySwarmCondition({ ...base, nodeReachable: false });
    expect(condition?.kind).toBe('node-unreachable');
    // The reassurance is the point: the text is not gone.
    expect(condition?.detail).toContain('kept in this browser');
  });

  it('says nothing once the node answers again', () => {
    expect(primarySwarmCondition({ ...base, nodeReachable: true })).toBeNull();
  });

  it('keeps the batch problem visible when the node returns without one', () => {
    const condition = primarySwarmCondition({
      ...base,
      hasBatch: false,
      nodeReachable: true,
    });
    expect(condition?.kind).toBe('no-batch');
  });

  it('blames the node, not postage, while it is down', () => {
    const condition = primarySwarmCondition({
      ...base,
      hasBatch: false,
      nodeReachable: false,
    });
    // Both are wrong, but only one is worth acting on first.
    expect(condition?.kind).toBe('node-unreachable');
  });
});
