import { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  SwarmCondition,
  SwarmRemedyKind,
} from '../../../package/utils/swarm-diagnostics';
import { SwarmPostagePanel } from './SwarmPostagePanel';

/**
 * One bar for every way Swarm can be unavailable —
 * offline, node down, no postage, batch expiring, batch full, or an
 * operation that failed. The wording and the offered remedies come from
 * `diagnoseSwarm`, so this component stays a renderer: new conditions
 * appear here without changing it.
 *
 * Editing continues in every one of these states — edits persist locally
 * and go out once Swarm is writable again — so the bar informs rather than
 * blocks.
 *
 * Rendered through a portal, pinned to the bottom of the viewport: clear
 * of the editor's own chrome, and visible without scrolling.
 */

export interface SwarmNoticeProps {
  condition: SwarmCondition;
  beeUrl: string;
  /** Batch in use, needed to top up or dilute it. */
  batchId?: string;
  onRetry: () => void;
  /** A batch became usable: adopt it and resume saving. */
  onBatchReady: (_batchId: string) => void;
  /** Ask a provider for publishing consent. */
  onGrantAccess?: () => void;
}

export const SwarmNotice = ({
  condition,
  beeUrl,
  batchId,
  onRetry,
  onBatchReady,
  onGrantAccess,
}: SwarmNoticeProps) => {
  const [dismissed, setDismissed] = useState(false);
  const [panel, setPanel] = useState<SwarmRemedyKind | null>(null);

  if (dismissed) return null;

  const isBlocked = condition.severity === 'blocked';

  return createPortal(
    <div
      data-swarm-notice=""
      className="fixed left-0 right-0 bottom-0 border-t color-border-default text-[13px] shadow-elevation-3 max-h-[70vh] overflow-y-auto"
      style={{
        backgroundColor: 'hsl(var(--color-bg-secondary))',
        zIndex: 99999,
      }}
    >
      <div
        className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2"
        role={isBlocked ? 'alert' : 'status'}
      >
        <span>
          <strong className="font-medium">{condition.title}.</strong>{' '}
          {condition.detail}
        </span>
        <span className="flex items-center gap-2 ml-auto">
          {condition.remedies.map((remedy) =>
            remedy.kind === 'learn-more' ? (
              <a
                key={remedy.kind + remedy.label}
                href={remedy.href}
                target="_blank"
                rel="noreferrer"
                className="h-7 px-2 flex items-center"
              >
                {remedy.label}
              </a>
            ) : (
              <button
                key={remedy.kind + remedy.label}
                type="button"
                onClick={() =>
                  remedy.kind === 'retry'
                    ? onRetry()
                    : remedy.kind === 'grant-access'
                      ? onGrantAccess?.()
                      : setPanel(panel === remedy.kind ? null : remedy.kind)
                }
                className="h-7 px-3 rounded border color-border-default font-medium whitespace-nowrap"
              >
                {remedy.label}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="h-7 px-2 rounded color-text-secondary"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </span>
      </div>

      {panel && (
        <SwarmPostagePanel
          mode={panel}
          beeUrl={beeUrl}
          batchId={batchId}
          onClose={() => setPanel(null)}
          onBatchReady={(id) => {
            setPanel(null);
            onBatchReady(id);
          }}
        />
      )}
    </div>,
    document.body,
  );
};
