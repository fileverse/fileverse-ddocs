import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwarmRestoreProgress } from './SwarmRestoreProgress';

const noop = () => {};

describe('SwarmRestoreProgress', () => {
  it('names every stage so a long wait is legible', () => {
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'connecting' }}
        progress={null}
        onSkip={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText(/Reaching the Swarm node/)).toBeTruthy();
    expect(screen.getByText(/Finding the latest version/)).toBeTruthy();
    expect(screen.getByText(/Downloading the document/)).toBeTruthy();
  });

  it('shows transfer percentage once the download reports sizes', () => {
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'ready', batchId: 'ab12' }}
        progress={{
          stage: 'download',
          status: 'progress',
          loaded: 512,
          total: 1024,
        }}
        onSkip={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it('always offers a way out of a stalled restore', () => {
    const onSkip = vi.fn();
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'read-only', reason: 'no batch' }}
        progress={{ stage: 'feed-lookup', status: 'start' }}
        onSkip={onSkip}
        onRetry={noop}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /without restoring/i }),
    );
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('surfaces the failure reason and a retry when the restore errors', () => {
    const onRetry = vi.fn();
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'unreachable', reason: 'connection refused' }}
        progress={null}
        error="Swarm request timed out after 60s"
        onSkip={noop}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('timed out');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

// Through a provider the browser owns postage, so naming that step would
// describe work this app never does — and while the feed lookup ran with no
// progress events, the display sat on "Checking postage batch" for half a
// minute, blaming the wrong step.
describe('SwarmRestoreProgress under a provider', () => {
  it('omits the postage step', () => {
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'read-only', reason: 'ultra-light-mode' }}
        progress={null}
        managesPostage
        onSkip={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByText(/Checking postage batch/)).toBeNull();
    expect(screen.getByText(/Finding the latest version/)).toBeTruthy();
  });

  it('treats an unreported stage as the feed lookup, not postage', () => {
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'read-only', reason: 'ultra-light-mode' }}
        progress={null}
        managesPostage
        onSkip={noop}
        onRetry={noop}
      />,
    );
    const active = screen
      .getByText(/Finding the latest version/)
      .className.includes('font-medium');
    expect(active).toBe(true);
  });
});

// A freshly started browser hits a node that cannot serve yet, so the
// restore retries; the reader should see that rather than a silent stall.
describe('SwarmRestoreProgress while retrying', () => {
  it('says which attempt is running and why', () => {
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'read-only', reason: 'ultra-light-mode' }}
        progress={null}
        managesPostage
        attempt={3}
        maxAttempts={5}
        onSkip={noop}
        onRetry={noop}
      />,
    );
    expect(screen.getByText(/attempt 3 of 5/i)).toBeTruthy();
    expect(screen.getByText(/has just started cannot serve/i)).toBeTruthy();
  });

  it('says nothing about attempts on the first one', () => {
    render(
      <SwarmRestoreProgress
        nodeState={{ kind: 'read-only', reason: 'ultra-light-mode' }}
        progress={null}
        managesPostage
        attempt={1}
        maxAttempts={5}
        onSkip={noop}
        onRetry={noop}
      />,
    );
    expect(screen.queryByText(/attempt 1 of 5/i)).toBeNull();
  });
});
