import { useEffect, useState } from 'react';
import { SwarmProgress } from '../../../package/utils/swarm-common';
import { SwarmNodeState } from '../storage/swarm-store';

/**
 * Loading screen for a document being restored from Swarm.
 *
 * Retrieval crosses the network chunk by chunk, so on a cold node or a slow
 * link this legitimately takes a while. Rather than an opaque spinner, show
 * which step is running, how far the transfer got, how long it has taken —
 * and always offer a way out, since a step can stall on content the network
 * is slow to locate.
 */

export interface SwarmRestoreProgressProps {
  nodeState: SwarmNodeState;
  progress: SwarmProgress | null;
  /** Hides the postage step where the browser, not this app, manages it. */
  managesPostage?: boolean;
  /** 1-based attempt number, shown once retrying has begun. */
  attempt?: number;
  maxAttempts?: number;
  error?: string | null;
  onSkip: () => void;
  onRetry: () => void;
}

type StepKey = 'connect' | 'stamp' | 'feed-lookup' | 'download' | 'decrypt';

const STEPS: { key: StepKey; label: string; hint: string }[] = [
  {
    key: 'connect',
    label: 'Reaching the Swarm node',
    hint: 'Local — should be instant',
  },
  {
    key: 'stamp',
    label: 'Checking postage batch',
    hint: 'Needed to save; reading works without one',
  },
  {
    key: 'feed-lookup',
    label: 'Finding the latest version',
    hint: 'Network lookup — usually the slowest step',
  },
  {
    key: 'download',
    label: 'Downloading the document',
    hint: 'Fetching chunks from the network',
  },
  { key: 'decrypt', label: 'Decrypting', hint: 'Local — instant' },
];

const formatBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

const formatElapsed = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};

export const SwarmRestoreProgress = ({
  nodeState,
  progress,
  managesPostage,
  attempt = 1,
  maxAttempts,
  error,
  onSkip,
  onRetry,
}: SwarmRestoreProgressProps) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 500);
    return () => clearInterval(id);
  }, []);

  // Which step is live follows from node state plus the last progress event.
  const activeStep: StepKey =
    nodeState.kind === 'connecting'
      ? 'connect'
      : progress?.stage === 'download' || progress?.stage === 'decrypt'
        ? progress.stage
        : progress?.stage === 'feed-lookup'
          ? 'feed-lookup'
          : managesPostage
            ? 'feed-lookup'
            : 'stamp';

  // A provider manages postage itself, so naming that step would describe
  // work this app never does.
  const steps = managesPostage
    ? STEPS.filter((s) => s.key !== 'stamp')
    : STEPS;
  const stepIndex = (key: StepKey) => steps.findIndex((s) => s.key === key);
  const activeIndex = stepIndex(activeStep);

  const downloadPct =
    progress?.stage === 'download' && progress.total && progress.loaded
      ? Math.min(100, Math.round((progress.loaded / progress.total) * 100))
      : null;

  // Long waits are normal here; say so before the user assumes a hang.
  const slow = elapsed > 20_000;

  return (
    <div className="flex justify-center px-4 py-16">
      <div className="w-full max-w-md">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="text-[15px] font-medium">Restoring from Swarm</h2>
          <span className="text-[12px] color-text-secondary tabular-nums">
            {maxAttempts && attempt > 1 && !error
              ? `attempt ${attempt} of ${maxAttempts} · `
              : ''}
            {formatElapsed(elapsed)}
          </span>
        </div>

        <ol className="flex flex-col gap-2 mb-5">
          {steps.map((step, i) => {
            const done = error ? false : i < activeIndex;
            const active = !error && i === activeIndex;
            return (
              <li
                key={step.key}
                className="flex items-start gap-2.5 text-[13px]"
                style={{ opacity: done || active ? 1 : 0.45 }}
              >
                <span
                  className="mt-[3px] w-3.5 h-3.5 flex-none rounded-full border flex items-center justify-center text-[9px]"
                  style={{
                    borderColor: active
                      ? 'currentColor'
                      : 'hsl(var(--color-border-default))',
                  }}
                  aria-hidden="true"
                >
                  {done ? '✓' : active ? '•' : ''}
                </span>
                <span className="flex-1">
                  <span className={active ? 'font-medium' : undefined}>
                    {step.label}
                  </span>
                  {active && downloadPct !== null && (
                    <span className="tabular-nums"> — {downloadPct}%</span>
                  )}
                  {active &&
                    downloadPct === null &&
                    progress?.loaded !== undefined &&
                    progress.stage === 'download' && (
                      <span className="tabular-nums">
                        {' '}
                        — {formatBytes(progress.loaded)}
                      </span>
                    )}
                  <span className="block text-[11px] color-text-secondary">
                    {step.hint}
                  </span>
                  {active && downloadPct !== null && (
                    <span
                      className="block mt-1 h-1 rounded overflow-hidden"
                      style={{
                        backgroundColor: 'hsl(var(--color-bg-secondary))',
                      }}
                    >
                      <span
                        className="block h-full"
                        style={{
                          width: `${downloadPct}%`,
                          backgroundColor: 'currentColor',
                          transition: 'width 200ms linear',
                        }}
                      />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        {error ? (
          <p className="text-[12px] mb-3" role="alert">
            Could not restore this document: {error}
          </p>
        ) : attempt > 1 ? (
          <p className="text-[12px] color-text-secondary mb-3">
            A Swarm node that has just started cannot serve anything until it
            has found peers, so the first attempt often fails. Trying again.
          </p>
        ) : slow ? (
          <p className="text-[12px] color-text-secondary mb-3">
            Still working. Content the network has to locate from scratch can
            take minutes on a slow connection — or the document may simply not
            be on Swarm yet.
          </p>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="h-8 px-3 rounded border color-border-default text-[13px]"
            style={{ backgroundColor: 'hsl(var(--color-bg-secondary))' }}
          >
            Continue without restoring
          </button>
          {error && (
            <button
              type="button"
              onClick={onRetry}
              className="h-8 px-3 rounded border color-border-default text-[13px]"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
