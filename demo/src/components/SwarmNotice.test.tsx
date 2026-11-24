import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SwarmNotice } from './SwarmNotice';
import { SwarmCondition } from '../../../package/utils/swarm-diagnostics';

/**
 * The first version of this bar rendered in normal flow, directly above the
 * editor — and was invisible in a browser, because the editor's navbar and
 * toolbar are `fixed` and painted over it. It was in the DOM the whole
 * time, so DOM-presence assertions passed while nobody could read it.
 * These tests check placement, not just presence.
 */

const condition: SwarmCondition = {
  kind: 'node-unreachable',
  severity: 'blocked',
  title: 'Your Bee node is not responding',
  detail: 'Swarm is reached through a Bee node, and it stopped answering.',
  remedies: [
    { kind: 'retry', label: 'Check again' },
    {
      kind: 'learn-more',
      label: 'Running a Bee node',
      href: 'https://docs.ethswarm.org/',
    },
  ],
};

const renderNotice = (over: Partial<SwarmCondition> = {}) =>
  render(
    <SwarmNotice
      condition={{ ...condition, ...over }}
      beeUrl="http://bee.invalid"
      onRetry={vi.fn()}
      onBatchReady={vi.fn()}
    />,
  );

const bar = () =>
  document.querySelector('[data-swarm-notice]') as HTMLElement;

describe('SwarmNotice', () => {
  it('escapes the editor chrome by rendering into document.body', () => {
    const { container } = renderNotice();
    // Nothing in the component's own container: it all went to the portal.
    expect(container.firstChild).toBeNull();
    expect(document.body.contains(bar())).toBe(true);
  });

  it('is pinned to the viewport, above everything else', () => {
    renderNotice();
    const style = bar().style;
    expect(style.zIndex).toBe('99999');
    expect(bar().className).toContain('fixed');
    expect(bar().className).toContain('bottom-0');
  });

  it('states the problem and what it means, not just a status word', () => {
    renderNotice();
    expect(screen.getByRole('alert').textContent).toContain(condition.title);
    expect(screen.getByRole('alert').textContent).toContain(condition.detail);
  });

  it('marks a blocking condition as an alert and a warning as a status', () => {
    const { unmount } = renderNotice();
    expect(screen.getByRole('alert')).toBeTruthy();
    unmount();
    renderNotice({ severity: 'warning' });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('runs the retry remedy and links the reading one', () => {
    const onRetry = vi.fn();
    render(
      <SwarmNotice
        condition={condition}
        beeUrl="http://bee.invalid"
        onRetry={onRetry}
        onBatchReady={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /check again/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('link', { name: /running a bee node/i }),
    ).toHaveProperty('href', 'https://docs.ethswarm.org/');
  });

  it('can be dismissed', () => {
    renderNotice();
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(bar()).toBeNull();
  });
});
