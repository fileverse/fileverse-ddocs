import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SwarmPostagePanel } from './SwarmPostagePanel';

/** Bee responses the panel reads before it can offer anything. */
const stubNode = (bzzBalance: string, nativeTokenBalance = '1000000000') =>
  vi.stubGlobal('fetch', async (url: string) => {
    const target = String(url);
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
          bzzBalance,
          nativeTokenBalance,
          walletAddress: '0x2f55cd47d91c30c46bba107215e10d96d41ec1df',
          chainID: 100,
        }),
      );
    }
    if (target.includes('/stamps/')) {
      return new Response(
        JSON.stringify({
          batchID: 'ab'.repeat(32),
          depth: 19,
          bucketDepth: 16,
          amount: '1000',
          utilization: 6,
          utilizationRatio: 0.75,
          usable: true,
          label: '',
          blockNumber: 1,
          immutableFlag: true,
          exists: true,
          batchTTL: 100000,
        }),
      );
    }
    throw new Error(`unexpected request: ${target}`);
  });

const noop = () => {};
afterEach(() => vi.unstubAllGlobals());

describe('SwarmPostagePanel', () => {
  it('quotes the purchase price before spending anything', async () => {
    stubNode('100000000000000000'); // 10 xBZZ
    render(
      <SwarmPostagePanel
        mode="buy-batch"
        beeUrl="http://bee.invalid"
        onClose={noop}
        onBatchReady={noop}
      />,
    );
    // 30 days at depth 17 and the stubbed price is about 0.4884 xBZZ.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /buy for 0\.488\d? xBZZ/i }),
      ).toBeTruthy(),
    );
  });

  it('explains how to fund the node rather than offering an impossible purchase', async () => {
    stubNode('1000');
    render(
      <SwarmPostagePanel
        mode="buy-batch"
        beeUrl="http://bee.invalid"
        onClose={noop}
        onBatchReady={noop}
      />,
    );
    await waitFor(() => screen.getByText(/cannot cover this yet/i));
    expect(screen.queryByRole('button', { name: /^buy for/i })).toBeNull();
    expect(
      screen.getByRole('link', { name: /how to fund a bee node/i }),
    ).toBeTruthy();
  });

  it('prices a top-up over the existing capacity', async () => {
    stubNode('100000000000000000000');
    render(
      <SwarmPostagePanel
        mode="top-up-batch"
        beeUrl="http://bee.invalid"
        batchId={'ab'.repeat(32)}
        onClose={noop}
        onBatchReady={noop}
      />,
    );
    // 30 days over a depth-19 batch: amount x 2^19, about 1.95 xBZZ.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /top up for 1\.95\d* xBZZ/i }),
      ).toBeTruthy(),
    );
  });

  it('spells out the trade-off before diluting', async () => {
    stubNode('100000000000000000000');
    render(
      <SwarmPostagePanel
        mode="dilute-batch"
        beeUrl="http://bee.invalid"
        batchId={'ab'.repeat(32)}
        onClose={noop}
        onBatchReady={noop}
      />,
    );
    await waitFor(() => screen.getByText(/Depth 19 . 20/));
    // Stated twice on purpose: in the explanation and next to the control.
    expect(screen.getAllByText(/remaining lifetime halves/i).length).toBe(2);
    expect(
      screen.getByRole('button', { name: /double the capacity/i }),
    ).toBeTruthy();
  });

  it('mentions gas when the node has no xDAI', async () => {
    stubNode('100000000000000000', '0');
    render(
      <SwarmPostagePanel
        mode="buy-batch"
        beeUrl="http://bee.invalid"
        onClose={noop}
        onBatchReady={noop}
      />,
    );
    await waitFor(() => expect(screen.getByText(/no xDAI for gas/i)).toBeTruthy());
  });

  it('can be closed', async () => {
    stubNode('100000000000000000');
    const onClose = vi.fn();
    render(
      <SwarmPostagePanel
        mode="buy-batch"
        beeUrl="http://bee.invalid"
        onClose={onClose}
        onBatchReady={noop}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
