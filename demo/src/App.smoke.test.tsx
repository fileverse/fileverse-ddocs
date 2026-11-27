import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
// Defines indexedDB and the IDB* globals, which jsdom lacks.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

/**
 * Mounts the whole demo app.
 *
 * Narrow unit tests and a passing type-check both missed a crash that made
 * the deployed page blank: an effect named a `const` callback in its
 * dependency array before that `const` was initialised, which throws while
 * rendering. Nothing short of actually rendering the app catches that
 * class of mistake.
 */

// jsdom implements neither the CSS Font Loading API nor object URLs, both
// of which the editor uses on mount. Browsers have both.
const stubBrowserApis = () => {
  vi.stubGlobal(
    'FontFace',
    class {
      load() {
        return Promise.resolve(this);
      }
    },
  );
  if (!document.fonts) {
    Object.defineProperty(document, 'fonts', {
      value: { add: () => {}, load: () => Promise.resolve([]) },
      configurable: true,
    });
  }
  if (!URL.createObjectURL) {
    Object.defineProperty(URL, 'createObjectURL', {
      value: () => 'blob:stub',
      configurable: true,
    });
  }
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  // The editor is not built until the store has been read, so the store
  // must answer: give each test an empty one.
  vi.stubGlobal('indexedDB', new IDBFactory());
};

// The app talks to a Bee node on mount; answer as a reachable node with no
// postage batch, which is also the most eventful path through the UI.
const stubBee = () =>
  vi.stubGlobal('fetch', async (url: string) => {
    const target = String(url);
    if (target.includes('/health')) {
      return new Response(JSON.stringify({ status: 'ok' }));
    }
    if (target.includes('/stamps')) {
      return new Response(JSON.stringify({ stamps: [] }));
    }
    if (target.includes('/chainstate')) {
      return new Response(
        JSON.stringify({
          currentPrice: '71865',
          block: 1,
          minimumValidityBlocks: 17280,
        }),
      );
    }
    if (target.includes('/wallet')) {
      return new Response(
        JSON.stringify({
          bzzBalance: '0',
          nativeTokenBalance: '0',
          walletAddress: '0x' + '11'.repeat(20),
          chainID: 100,
        }),
      );
    }
    return new Response('', { status: 404 });
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  localStorage.clear();
});

describe('demo app', () => {
  it('renders without crashing', async () => {
    stubBrowserApis();
    stubBee();
    const { default: App } = await import('./App');
    render(<App />);
    // The toolbar is part of the editor shell: reaching it means the whole
    // component tree rendered rather than throwing.
    await waitFor(() => expect(screen.getByText('File')).toBeTruthy(), {
      timeout: 60_000,
    });
  }, 90_000);

  // A Swarm-aware browser (Freedom and similar) injects window.swarm and
  // blocks raw node access, so the app must work with no node URL at all.
  it('runs on an injected provider with no Bee URL configured', async () => {
    stubBrowserApis();
    vi.stubGlobal('fetch', async () => {
      throw new Error('raw node access is blocked in this browser');
    });
    vi.stubGlobal('swarm', {
      request: async ({ method }: { method: string }) => {
        if (method === 'swarm_getCapabilities') {
          return { specVersion: '1.0', canPublish: false, reason: 'not-connected' };
        }
        if (method === 'swarm_requestAccess') return { connected: true };
        if (method === 'swarm_getSigningIdentity') {
          // Before consent a provider refuses to name the app's identity.
          throw Object.assign(new Error('unauthorized'), { code: 4100 });
        }
        throw Object.assign(new Error('not found'), {
          data: { reason: 'chunk_not_found' },
        });
      },
    });
    vi.resetModules();
    const { default: App } = await import('./App');
    render(<App />);
    // Consent is the one thing the page may ask for; postage is not its
    // business here, so it must not offer to buy any.
    await waitFor(
      () => expect(screen.getByRole('button', { name: /grant access/i })).toBeTruthy(),
      { timeout: 60_000 },
    );
    expect(
      screen.queryByRole('button', { name: /postage batch/i }),
    ).toBeNull();
  }, 90_000);

  it('surfaces the Swarm condition when the node has no postage batch', async () => {
    stubBrowserApis();
    stubBee();
    // swarm-store reads VITE_BEE_API_URL when the module is first
    // evaluated, so the env has to be in place before the import.
    vi.resetModules();
    vi.stubEnv('VITE_BEE_API_URL', 'http://bee.invalid');
    const { default: App } = await import('./App');
    render(<App />);
    await waitFor(
      () => expect(screen.getByText(/No postage batch/i)).toBeTruthy(),
      { timeout: 60_000 },
    );
  }, 90_000);
});
