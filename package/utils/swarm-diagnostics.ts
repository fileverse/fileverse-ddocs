import { type StampHealth } from './swarm-stamps';

/**
 * Turns observable Swarm state into conditions a host app can explain.
 *
 * Storing on Swarm fails in ways a conventional backend does not: postage
 * runs out or fills up, the node is a separate process that can stop, and
 * retrieval crosses a network that may simply be slow. Each of those is
 * recoverable, but only if the person is told three things — what is wrong,
 * what it means for the text they just typed, and what to do about it.
 *
 * This is a pure function over inputs the host already has, so the
 * messaging lives in one place instead of being re-derived at every call
 * site, and can be unit-tested without a node.
 */

export type SwarmConditionKind =
  | 'offline'
  | 'node-unreachable'
  | 'no-batch'
  | 'batch-expired'
  | 'batch-expiring'
  | 'batch-full'
  | 'provider-not-connected'
  | 'provider-cannot-publish'
  | 'operation-failed';

export type SwarmRemedyKind =
  | 'retry'
  | 'grant-access'
  | 'buy-batch'
  | 'top-up-batch'
  | 'dilute-batch'
  | 'learn-more';

export interface SwarmRemedy {
  kind: SwarmRemedyKind;
  /** Button/link text, written as the action it performs. */
  label: string;
  /** Set for `learn-more`; the host renders it as a link. */
  href?: string;
  /** True when acting costs xBZZ — hosts should show the price first. */
  spendsFunds?: boolean;
}

export interface SwarmCondition {
  kind: SwarmConditionKind;
  /**
   * `blocked` — nothing can be written to Swarm right now; `warning` —
   * writing still works but will stop soon unless acted on.
   */
  severity: 'blocked' | 'warning';
  /** One line naming the problem. */
  title: string;
  /** What it means for the user's content — never just restate the title. */
  detail: string;
  remedies: SwarmRemedy[];
}

export interface SwarmDiagnosticsInput {
  /** Browser connectivity, e.g. `navigator.onLine`. */
  online: boolean;
  /** Whether the Bee node answered its last health check. */
  nodeReachable: boolean;
  /** Postage batch in use, if any. */
  stamp: StampHealth | null;
  /** Whether a postage batch is configured at all. */
  hasBatch: boolean;
  /** Message from the last failed Swarm operation, if it still stands. */
  lastError?: string | null;
  /** Where the content is kept while Swarm is unavailable. */
  localFallback?: 'browser' | 'none';
  /**
   * Set when Swarm is reached through an injected provider rather than a
   * node API. Postage then belongs to the provider, so postage remedies
   * are suppressed and its own reason codes are explained instead.
   */
  provider?:
    | {
        canWrite: boolean;
        /** Provider reason code, e.g. `not-connected`, `no-usable-stamps`. */
        reason?: string | undefined;
      }
    | undefined;
  /**
   * True when this document could not be written from here whatever the
   * node's state — a document opened from someone else's link, whose feed
   * only its owner can sign. Reporting a publishing obstacle then would
   * ask the reader to fix something that changes nothing for them.
   */
  documentReadOnly?: boolean;
}

const SEVERITY_ORDER: Record<SwarmCondition['severity'], number> = {
  blocked: 0,
  warning: 1,
};

const keptSafely = (input: SwarmDiagnosticsInput) =>
  input.localFallback === 'none'
    ? 'Changes are not being stored anywhere else.'
    : 'Your edits are kept in this browser meanwhile, and go out once this is fixed.';

const FUND_DOCS =
  'https://docs.ethswarm.org/docs/bee/installation/fund-your-node';
const POSTAGE_DOCS =
  'https://docs.ethswarm.org/docs/concepts/incentives/postage-stamps';

/**
 * Provider reason codes, in the user's terms. The provider owns postage
 * and node lifecycle here, so these describe rather than offer to fix —
 * except where the page itself can act, which is the consent prompt.
 */
const PROVIDER_REASONS: Record<
  string,
  { title: string; detail: string; canGrant?: boolean }
> = {
  'not-connected': {
    title: 'Your browser has not granted access to Swarm yet',
    detail:
      'This page needs your permission before it can publish through your browser\u2019s Swarm node.',
    canGrant: true,
  },
  'node-stopped': {
    title: 'Your browser\u2019s Swarm node is stopped',
    detail:
      'The node built into your browser is not running, so nothing can be published.',
  },
  'node-not-ready': {
    title: 'Your browser\u2019s Swarm node is still starting',
    detail:
      'The node is running but not yet ready to publish. This usually clears by itself.',
  },
  'ultra-light-mode': {
    title: 'Your browser\u2019s Swarm node is in browse-only mode',
    detail:
      'Ultra-light mode can read Swarm but not publish to it, so saving is ' +
      'disabled at the node, not by this page \u2014 no account or wallet ' +
      'setup will change that. Switch the node to light mode in your ' +
      'browser\u2019s Swarm settings to enable publishing.',
  },
  'no-usable-stamps': {
    title: 'Your browser\u2019s Swarm node has no storage credit left',
    detail:
      'Publishing is paid for with postage, and your browser manages that ' +
      'on its own \u2014 it reports none available. Look for postage or ' +
      'storage credit in your browser\u2019s Swarm settings; this page ' +
      'cannot buy any on your behalf.',
  },
};

/**
 * All conditions that currently apply, most severe first. An empty array
 * means Swarm is healthy and nothing needs saying.
 */
export const diagnoseSwarm = (
  input: SwarmDiagnosticsInput,
): SwarmCondition[] => {
  const conditions: SwarmCondition[] = [];

  // Connectivity first: a node that cannot be reached because the machine
  // is offline is not a node problem, and the remedy is different.
  if (!input.online) {
    conditions.push({
      kind: 'offline',
      severity: 'blocked',
      title: 'No internet connection',
      detail: `Swarm cannot be reached. ${keptSafely(input)}`,
      remedies: [{ kind: 'retry', label: 'Check again' }],
    });
  } else if (!input.nodeReachable) {
    conditions.push({
      kind: 'node-unreachable',
      severity: 'blocked',
      title: 'Your Bee node is not responding',
      detail: `Swarm is reached through a Bee node running on your machine, and it stopped answering. ${keptSafely(
        input,
      )}`,
      remedies: [
        { kind: 'retry', label: 'Check again' },
        {
          kind: 'learn-more',
          label: 'Running a Bee node',
          href: 'https://docs.ethswarm.org/docs/bee/installation/quick-start',
        },
      ],
    });
  }

  if (input.provider) {
    // Nothing to grant, buy or switch: this document is not writable from
    // here in any case, and reading needs no permission.
    if (!input.provider.canWrite && !input.documentReadOnly) {
      const reason = input.provider.reason ?? 'unknown';
      const known = PROVIDER_REASONS[reason];
      conditions.push({
        kind:
          reason === 'not-connected'
            ? 'provider-not-connected'
            : 'provider-cannot-publish',
        severity: 'blocked',
        title: known?.title ?? 'Your browser cannot publish to Swarm',
        detail: `${known?.detail ?? `The Swarm provider reported: ${reason}.`} ${keptSafely(
          input,
        )}`,
        // Postage, node lifecycle and permissions are the provider's to
        // manage; the only thing a page may ask for is consent.
        remedies: known?.canGrant
          ? [{ kind: 'grant-access', label: 'Grant access' }]
          : [{ kind: 'retry', label: 'Check again' }],
      });
    }
  } else if (!input.hasBatch) {
    conditions.push({
      kind: 'no-batch',
      severity: 'blocked',
      title: 'No postage batch',
      detail: `Uploads to Swarm are paid for with a postage batch, and this node has none. ${keptSafely(
        input,
      )} Reading stays free either way.`,
      remedies: [
        { kind: 'buy-batch', label: 'Get a postage batch', spendsFunds: true },
        { kind: 'learn-more', label: 'How postage works', href: POSTAGE_DOCS },
      ],
    });
  } else if (input.stamp) {
    const { status } = input.stamp;
    if (status === 'unusable' || input.stamp.ttlSeconds <= 0) {
      conditions.push({
        kind: 'batch-expired',
        severity: 'blocked',
        title: 'Your postage batch has expired',
        detail: `Postage is rented, not bought once: this batch ran out, so new uploads are refused. Content already stored stays retrievable while the network holds it. ${keptSafely(
          input,
        )}`,
        remedies: [
          {
            kind: 'top-up-batch',
            label: 'Top up this batch',
            spendsFunds: true,
          },
          { kind: 'buy-batch', label: 'Buy a new batch', spendsFunds: true },
          { kind: 'learn-more', label: 'Funding your node', href: FUND_DOCS },
        ],
      });
    } else if (status === 'expiring') {
      const days = Math.max(0, Math.floor(input.stamp.ttlSeconds / 86400));
      conditions.push({
        kind: 'batch-expiring',
        severity: 'warning',
        title: `Postage batch expires in ${days} day${days === 1 ? '' : 's'}`,
        detail:
          'Saving still works. When it expires, uploads stop and stored content is eventually forgotten by the network unless the batch is topped up.',
        remedies: [
          { kind: 'top-up-batch', label: 'Top up now', spendsFunds: true },
        ],
      });
    } else if (status === 'nearly-full') {
      const percent = Math.round(input.stamp.utilization * 100);
      conditions.push({
        kind: 'batch-full',
        severity: 'warning',
        title: `Postage batch is ${percent}% full`,
        detail:
          'A batch has a fixed capacity, and uploads start failing once it is used up. Diluting doubles its room, at the cost of a proportionally shorter lifetime.',
        remedies: [
          { kind: 'dilute-batch', label: 'Make room', spendsFunds: true },
          { kind: 'buy-batch', label: 'Buy another batch', spendsFunds: true },
        ],
      });
    }
  }

  // A failure that none of the above explains — surfaced verbatim rather
  // than swallowed, since the cause is by definition not one we modelled.
  if (input.lastError && !conditions.some((c) => c.severity === 'blocked')) {
    conditions.push({
      kind: 'operation-failed',
      severity: 'warning',
      title: 'The last Swarm operation did not complete',
      detail: `${input.lastError} ${keptSafely(input)}`,
      remedies: [{ kind: 'retry', label: 'Try again' }],
    });
  }

  return conditions.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
};

/** The one condition worth showing first, or null when all is well. */
export const primarySwarmCondition = (
  input: SwarmDiagnosticsInput,
): SwarmCondition | null => diagnoseSwarm(input)[0] ?? null;
