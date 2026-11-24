/**
 * The retry policy the demo applies when restoring a document from Swarm.
 *
 * A browser that embeds a Swarm node opens the page while that node is
 * still finding peers, so the first attempt often fails. The policy covers
 * that window without becoming an endless loop.
 */
export const MAX_RESTORE_ATTEMPTS = 5;

/** Delay before the attempt after `attempt` (0-based) failed. */
export const restoreRetryDelayMs = (attempt: number): number =>
  [2000, 4000, 8000, 12000][attempt] ?? 16000;
