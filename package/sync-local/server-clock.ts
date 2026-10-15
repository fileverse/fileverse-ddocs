import type * as ucans from '@ucans/ucans';

const NOT_BEFORE_GRACE_SECONDS = 60;
const UCAN_LIFETIME_SECONDS = 3600;
const REUSE_MARGIN_SECONDS = 60;
// Outside this range the stamp is not a millisecond epoch (seconds or microseconds sent by mistake).
const MIN_PLAUSIBLE_MS = 1e12;
const MAX_PLAUSIBLE_MS = 1e14;

const isPlausibleMs = (value: unknown): value is number =>
  typeof value === 'number' &&
  value >= MIN_PLAUSIBLE_MS &&
  value < MAX_PLAUSIBLE_MS;

const monotonicNow =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : null;

/**
 * The collab server's clock, learned from its handshake. The server checks auth UCAN nbf/exp
 * against its own clock, so tokens built from a skewed device clock get a 401.
 */
export class ServerClock {
  private anchor: { serverMs: number; localMs: number } | null = null;

  constructor(
    private readonly wallNow: () => number = () => Date.now(),
    private readonly monoNow: (() => number) | null = monotonicNow,
  ) {}

  /**
   * Time since the handshake is measured on the monotonic clock, so a device clock change
   * mid-session cannot skew it. A missing or implausible stamp (older server) falls back to the
   * device clock. Delivery delay and sleep only make the estimate trail the server, which the
   * token window absorbs.
   */
  sync(serverTimeMs: unknown): void {
    this.anchor = isPlausibleMs(serverTimeMs)
      ? { serverMs: serverTimeMs, localMs: this.elapsedBase() }
      : null;
  }

  nowSeconds(): number {
    const ms = this.anchor
      ? this.anchor.serverMs + (this.elapsedBase() - this.anchor.localMs)
      : this.wallNow();
    return Math.floor(ms / 1000);
  }

  ucanWindow(): { notBefore: number; expiration: number } {
    const now = this.nowSeconds();
    return {
      notBefore: now - NOT_BEFORE_GRACE_SECONDS,
      expiration: now + UCAN_LIFETIME_SECONDS,
    };
  }

  /** Whether a cached UCAN can still be presented: active, and not expiring within the margin. */
  isUsable(ucan: ucans.Ucan): boolean {
    const { nbf, exp } = ucan.payload;
    const now = this.nowSeconds();
    return (!nbf || nbf <= now) && (!exp || exp > now + REUSE_MARGIN_SECONDS);
  }

  private elapsedBase(): number {
    return this.monoNow ? this.monoNow() : this.wallNow();
  }
}
