// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  MAX_RESTORE_ATTEMPTS,
  restoreRetryDelayMs as retryDelayMs,
} from './restore-retry';

/**
 * The retry policy the demo applies when restoring a document.
 *
 * A browser that embeds a Swarm node opens the page while that node is
 * still finding peers, so the first attempt frequently fails — observed
 * repeatedly in Freedom, where the same link succeeded a minute later. The
 * policy has to cover that window without becoming an endless loop, and
 * without hiding a genuine failure behind silent retries.
 */

/** Attempts, and the cumulative wait before each, for a run that never succeeds. */
const schedule = () => {
  const delays: number[] = [];
  for (let attempt = 0; attempt + 1 < MAX_RESTORE_ATTEMPTS; attempt++) {
    delays.push(retryDelayMs(attempt));
  }
  return delays;
};

describe('restore retry policy', () => {
  it('retries a bounded number of times', () => {
    // Four waits between five attempts, then it stops and reports.
    expect(schedule()).toHaveLength(MAX_RESTORE_ATTEMPTS - 1);
  });

  it('widens the gap between attempts', () => {
    const delays = schedule();
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1]);
    }
  });

  it('starts quickly enough to catch a short warm-up', () => {
    // A node was measured serving ~2s after start; the first retry must
    // land in that region rather than minutes later.
    expect(retryDelayMs(0)).toBeLessThanOrEqual(2000);
  });

  it('keeps trying long enough to cover a slow start', () => {
    const total = schedule().reduce((sum, d) => sum + d, 0);
    // Node starts measured between 2s and beyond 17s; cover that range.
    expect(total).toBeGreaterThanOrEqual(25_000);
    // But not so long that a genuinely missing document hides for minutes.
    expect(total).toBeLessThanOrEqual(60_000);
  });

  it('never returns a zero or negative delay', () => {
    for (let i = 0; i < 10; i++) expect(retryDelayMs(i)).toBeGreaterThan(0);
  });
});
