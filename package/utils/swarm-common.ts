/**
 * Shared plumbing for the Ethereum Swarm adapters: byte/hex helpers, a
 * `fetch` wrapper that always bounds how long a request may take, and a
 * streaming download that reports byte progress.
 *
 * Bounded requests matter more here than against a conventional API. A Bee
 * node resolves content across the network, so a request for data that is
 * slow to find (or not there at all) can stay open indefinitely — without a
 * deadline a host app has no way to tell "still fetching" from "hung", and
 * ends up showing a spinner forever.
 */

/** Progress of a single Swarm operation, for host-facing UI. */
export interface SwarmProgress {
  /**
   * `connect` — probing the Bee node; `stamp` — resolving a postage batch;
   * `feed-lookup` — resolving a feed's latest index (network-wide lookup,
   * typically the slowest step); `download` / `upload` — chunk transfer,
   * with `loaded`/`total` when the size is known; `decrypt` — local
   * crypto; `feed-update` — writing a feed's single-owner chunk.
   */
  stage:
    | 'connect'
    | 'stamp'
    | 'feed-lookup'
    | 'download'
    | 'upload'
    | 'decrypt'
    | 'feed-update';
  status: 'start' | 'progress' | 'done' | 'error';
  /** Bytes transferred so far (`download`/`upload` progress events). */
  loaded?: number;
  /** Total bytes, when the node reports a content length. */
  total?: number | undefined;
  /** Human-readable detail, e.g. an error message. */
  message?: string;
}

export type SwarmProgressHandler = (_progress: SwarmProgress) => void;

/** Common request options shared by every Swarm adapter config. */
export interface SwarmRequestConfig {
  /** Base URL of the Bee node / gateway API, e.g. `http://localhost:1633`. */
  beeUrl: string;
  /** Extra headers sent with every request (e.g. gateway auth). */
  headers?: Record<string, string>;
  /**
   * Deadline for a single Swarm request, in milliseconds (default 60000).
   * Retrieval of content that is far away in the network — or simply not
   * retrievable — can otherwise hang for as long as the host waits.
   */
  timeoutMs?: number;
  /** Optional progress sink for long-running operations. */
  onProgress?: SwarmProgressHandler | undefined;
}

export const DEFAULT_TIMEOUT_MS = 60_000;

export const stripTrailingSlash = (url: string): string =>
  url.replace(/\/+$/, '');

export const concatBytes = (
  ...arrays: Uint8Array[]
): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
};

export const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

export const hexToBytes = (hex: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array((hex.match(/../g) ?? []).map((b) => parseInt(b, 16)));

export const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
};

export const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

/** Thrown when a Swarm request exceeds its deadline. */
export class SwarmTimeoutError extends Error {
  constructor(url: string, timeoutMs: number) {
    super(
      `Swarm request timed out after ${Math.round(timeoutMs / 1000)}s: ${url}. ` +
        `The node may still be locating this content on the network.`,
    );
    this.name = 'SwarmTimeoutError';
  }
}

/**
 * `fetch` against a Bee node with a hard deadline and uniform errors.
 * A 404 is returned to the caller (many lookups treat "absent" as a normal
 * outcome); other non-OK statuses throw.
 */
export const swarmFetch = async (
  config: SwarmRequestConfig,
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> => {
  const url = `${stripTrailingSlash(config.beeUrl)}${path}`;
  const timeoutMs = init.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const requestInit: RequestInit = { ...init };
  delete (requestInit as { timeoutMs?: number }).timeoutMs;
  try {
    const response = await fetch(url, {
      ...requestInit,
      headers: { ...config.headers, ...requestInit.headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Swarm request failed (${response.status} ${response.statusText}): ${path}`,
      );
    }
    return response;
  } catch (error) {
    if ((error as Error).name === 'TimeoutError') {
      throw new SwarmTimeoutError(url, timeoutMs);
    }
    throw error;
  }
};

/**
 * Read a response body while reporting byte progress. Falls back to a
 * single `arrayBuffer()` read where streaming is unavailable.
 */
export const readWithProgress = async (
  response: Response,
  onProgress?: SwarmProgressHandler,
  stage: SwarmProgress['stage'] = 'download',
): Promise<Uint8Array<ArrayBuffer>> => {
  const header = response.headers.get('content-length');
  const total = header ? Number(header) : undefined;

  if (!response.body || !onProgress) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    onProgress?.({ stage, status: 'done', loaded: bytes.length, total });
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress({ stage, status: 'progress', loaded, total });
  }
  onProgress({ stage, status: 'done', loaded, total });
  return concatBytes(...chunks);
};
