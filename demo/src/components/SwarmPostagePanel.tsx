import { useEffect, useState } from 'react';
import {
  BatchEstimate,
  MIN_BATCH_DEPTH,
  PLUR_PER_BZZ,
  WalletBalance,
  amountForDuration,
  buyStamp,
  diluteStamp,
  estimateBatch,
  getChainState,
  getStamp,
  getWalletBalance,
  topUpStamp,
} from '../../../package/utils/swarm-stamps';
import { SwarmRemedyKind } from '../../../package/utils/swarm-diagnostics';

/**
 * The three postage actions that cost money — buy a batch, extend one,
 * enlarge one — behind one panel.
 *
 * Every one of them spends xBZZ from the node's own wallet and settles
 * on-chain, so each shows the exact amount first, puts it on the button,
 * and does nothing until clicked. Where the wallet cannot cover it, the
 * panel says so and explains how to fund the node instead of offering a
 * purchase that would fail.
 */

export interface SwarmPostagePanelProps {
  mode: SwarmRemedyKind;
  beeUrl: string;
  batchId?: string;
  onClose: () => void;
  onBatchReady: (_batchId: string) => void;
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'working' }
  | { kind: 'waiting'; batchId: string }
  | { kind: 'error'; message: string };

const DURATIONS = [
  { days: 30, label: '30 days' },
  { days: 90, label: '3 months' },
  { days: 365, label: '1 year' },
];

const formatBzz = (plur: number) => (plur / PLUR_PER_BZZ).toFixed(4);
const formatSize = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(bytes / 1024 ** 2)} MB`;

const TITLES: Partial<Record<SwarmRemedyKind, string>> = {
  'buy-batch': 'Get a postage batch',
  'top-up-batch': 'Top up this batch',
  'dilute-batch': 'Make room in this batch',
};

const BLURBS: Partial<Record<SwarmRemedyKind, string>> = {
  'buy-batch':
    'Storing data on Swarm is paid up front with a postage batch: prepaid storage that expires unless topped up. Reading is always free.',
  'top-up-batch':
    'Topping up buys more time on the batch you already have, at the price postage costs today.',
  'dilute-batch':
    'Diluting doubles the batch capacity by increasing its depth. The prepaid balance then covers twice as much data, so the remaining lifetime halves — top up as well to keep it.',
};

export const SwarmPostagePanel = ({
  mode,
  beeUrl,
  batchId,
  onClose,
  onBatchReady,
}: SwarmPostagePanelProps) => {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [price, setPrice] = useState<number | null>(null);
  const [wallet, setWallet] = useState<WalletBalance | null>(null);
  const [days, setDays] = useState(30);
  const [depth, setDepth] = useState(MIN_BATCH_DEPTH);
  const [currentDepth, setCurrentDepth] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [chain, balance] = await Promise.all([
          getChainState({ beeUrl }),
          getWalletBalance({ beeUrl }),
        ]);
        if (cancelled) return;
        setPrice(chain.currentPrice);
        setWallet(balance);
        if (batchId && mode !== 'buy-batch') {
          const stamp = await getStamp({ beeUrl }, batchId);
          if (cancelled) return;
          setCurrentDepth(stamp.depth);
        }
        setPhase({ kind: 'ready' });
      } catch (error) {
        if (!cancelled) {
          setPhase({ kind: 'error', message: (error as Error).message });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [beeUrl, batchId, mode]);

  // Cost model per action: a purchase pays amount × 2^depth; a top-up pays
  // the added amount across the existing capacity; a dilution pays nothing
  // up front but spends the remaining balance twice as fast.
  const estimate: BatchEstimate | null =
    price === null ? null : estimateBatch({ depth, days, price });
  const topUpAmount = price === null ? 0 : amountForDuration(days, price);
  const topUpCost =
    currentDepth === null ? null : topUpAmount * 2 ** currentDepth;
  const cost =
    mode === 'buy-batch'
      ? (estimate?.costPlur ?? null)
      : mode === 'top-up-batch'
        ? topUpCost
        : 0;
  const affordable =
    wallet && cost !== null ? wallet.bzzBalance >= cost : false;
  const hasGas = wallet ? wallet.nativeTokenBalance > 0 : false;

  const act = async () => {
    setPhase({ kind: 'working' });
    try {
      if (mode === 'buy-batch' && estimate) {
        const id = await buyStamp(
          { beeUrl },
          {
            amount: String(estimate.amount),
            depth: estimate.depth,
            label: 'ddoc-demo',
          },
        );
        setPhase({ kind: 'waiting', batchId: id });
      } else if (mode === 'top-up-batch' && batchId) {
        await topUpStamp({ beeUrl }, batchId, String(topUpAmount));
        setPhase({ kind: 'waiting', batchId });
      } else if (mode === 'dilute-batch' && batchId && currentDepth !== null) {
        await diluteStamp({ beeUrl }, batchId, currentDepth + 1);
        setPhase({ kind: 'waiting', batchId });
      }
    } catch (error) {
      setPhase({ kind: 'error', message: (error as Error).message });
    }
  };

  // A change to postage is not effective until it has settled on-chain.
  useEffect(() => {
    if (phase.kind !== 'waiting') return;
    let cancelled = false;
    const id = setInterval(async () => {
      try {
        const stamp = await getStamp({ beeUrl }, phase.batchId);
        if (!cancelled && stamp.usable) {
          clearInterval(id);
          onBatchReady(phase.batchId);
        }
      } catch {
        // Not visible yet — keep polling.
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [phase, beeUrl, onBatchReady]);

  const actionLabel =
    mode === 'dilute-batch'
      ? 'Double the capacity'
      : cost === null
        ? 'Confirm'
        : `${mode === 'buy-batch' ? 'Buy' : 'Top up'} for ${formatBzz(cost)} xBZZ`;

  return (
    <div className="px-4 pb-3 border-t color-border-default">
      <div className="max-w-2xl flex flex-col gap-2 pt-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-[14px] font-medium">{TITLES[mode]}</h2>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto color-text-secondary"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <p className="color-text-secondary">{BLURBS[mode]}</p>

        {phase.kind === 'loading' && <p>Reading pricing from your node…</p>}
        {phase.kind === 'error' && (
          <p role="alert">Could not complete this: {phase.message}</p>
        )}
        {phase.kind === 'waiting' && (
          <p>
            Sent — waiting for it to settle on-chain. This takes a few blocks;
            saving resumes by itself.
          </p>
        )}

        {(phase.kind === 'ready' || phase.kind === 'working') && (
          <>
            <div className="flex flex-wrap items-end gap-4">
              {mode !== 'dilute-batch' && (
                <label className="flex flex-col gap-1">
                  <span className="color-text-secondary text-[12px]">
                    {mode === 'buy-batch' ? 'Keep it for' : 'Add'}
                  </span>
                  <select
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                    className="h-8 px-2 rounded border color-border-default color-bg-default"
                  >
                    {DURATIONS.map((d) => (
                      <option key={d.days} value={d.days}>
                        {d.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {mode === 'buy-batch' && price !== null && (
                <label className="flex flex-col gap-1">
                  <span className="color-text-secondary text-[12px]">
                    Room for
                  </span>
                  <select
                    value={depth}
                    onChange={(e) => setDepth(Number(e.target.value))}
                    className="h-8 px-2 rounded border color-border-default color-bg-default"
                  >
                    {[MIN_BATCH_DEPTH, 18, 19, 20].map((d) => (
                      <option key={d} value={d}>
                        {formatSize(
                          estimateBatch({ depth: d, days, price })
                            .usableCapacityBytes,
                        )}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {mode === 'dilute-batch' && currentDepth !== null && (
                <p>
                  Depth {currentDepth} → {currentDepth + 1}, and the remaining
                  lifetime halves.
                </p>
              )}

              {cost !== null && cost > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="color-text-secondary text-[12px]">Cost</span>
                  <span className="h-8 flex items-center font-medium tabular-nums">
                    {formatBzz(cost)} xBZZ
                  </span>
                </div>
              )}
            </div>

            {wallet && (
              <p className="color-text-secondary">
                Your node holds {formatBzz(wallet.bzzBalance)} xBZZ
                {hasGas ? '' : ' and no xDAI for gas'}.
              </p>
            )}

            {affordable && hasGas ? (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={act}
                  disabled={phase.kind === 'working'}
                  className="h-8 px-3 rounded border color-border-default font-medium"
                >
                  {phase.kind === 'working' ? 'Working…' : actionLabel}
                </button>
                <span className="color-text-secondary">
                  Spends real funds from your node&apos;s wallet.
                </span>
              </div>
            ) : (
              <p>
                Your node cannot cover this yet. Fund its wallet (
                <code className="text-[12px]">
                  {wallet?.walletAddress ?? 'address unavailable'}
                </code>
                ) with xBZZ{hasGas ? '' : ' and a little xDAI for gas'} on
                Gnosis Chain, or choose a smaller or shorter option.{' '}
                <a
                  href="https://docs.ethswarm.org/docs/bee/installation/fund-your-node"
                  target="_blank"
                  rel="noreferrer"
                >
                  How to fund a Bee node
                </a>
                .
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
