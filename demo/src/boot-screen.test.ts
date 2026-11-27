// Throwaway check of the boot screen's retry state machine in index.html:
// several retries with widening gaps, a watchdog when the reload navigation
// hangs, a manual button in every failure state, and a failed panel only
// after the budget is spent.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const html = readFileSync(resolve(process.cwd(), 'demo/index.html'), 'utf8');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const script = body.slice(
  body.indexOf('<script>') + 8,
  body.indexOf('</script>'),
);

const scriptError = () => {
  const event = new Event('error');
  Object.defineProperty(event, 'target', {
    value: document.createElement('script'),
  });
  window.dispatchEvent(event);
};

const visible = (id: string) =>
  !(document.getElementById(id) as HTMLElement).hidden;

describe('boot screen retry machine', () => {
  let reload: ReturnType<typeof vi.fn>;
  let detachListeners: () => void;

  beforeEach(() => {
    detachListeners?.();
    vi.useRealTimers(); // discard the previous machine's pending timers
    vi.useFakeTimers();
    sessionStorage.clear();
    document.body.innerHTML = body.replace(/<script>[\s\S]*<\/script>/, '');
    reload = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload },
      writable: true,
      configurable: true,
    });
    // The script attaches window listeners; a shared jsdom window would keep
    // the previous test's machine alive, so record and detach them.
    const realAdd = window.addEventListener.bind(window);
    const added: Parameters<typeof window.addEventListener>[] = [];
    window.addEventListener = ((...args) => {
      added.push(args as Parameters<typeof window.addEventListener>);
      realAdd(...(args as Parameters<typeof window.addEventListener>));
    }) as typeof window.addEventListener;
    (0, eval)(script);
    window.addEventListener = realAdd;
    detachListeners = () =>
      added.forEach((args) => window.removeEventListener(...args));
  });

  it('retries with a widening gap and shows the attempt count', () => {
    scriptError();
    expect(visible('boot-retrying')).toBe(true);
    expect(document.getElementById('boot-attempt')!.textContent).toBe(
      'attempt 1 of 4',
    );
    expect(sessionStorage.getItem('ddoc-boot-retries')).toBe('1');
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('goes again via the watchdog when the reload navigation hangs', () => {
    scriptError();
    vi.advanceTimersByTime(3000); // attempt 1 issued, navigation "hangs"
    vi.advanceTimersByTime(10000); // watchdog: schedule attempt 2
    expect(document.getElementById('boot-attempt')!.textContent).toBe(
      'attempt 2 of 4',
    );
    vi.advanceTimersByTime(6000);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('shows the failed panel only after the retry budget is spent', () => {
    scriptError();
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(24000 + 10000); // delay + watchdog per round
    }
    expect(visible('boot-failed')).toBe(true);
    expect(visible('boot-retrying')).toBe(false);
    expect(reload).toHaveBeenCalledTimes(4);
  });

  it('keeps the elapsed clock running while retrying', () => {
    scriptError();
    vi.advanceTimersByTime(2000);
    expect(
      document.getElementById('boot-elapsed')!.textContent,
    ).not.toBe('');
    expect(document.getElementById('boot-elapsed')!.textContent).toBe('2s');
  });

  it('both buttons reset the budget and reload immediately', () => {
    scriptError();
    (document.getElementById('boot-reload-now') as HTMLElement).click();
    expect(sessionStorage.getItem('ddoc-boot-retries')).toBe('0');
    expect(reload).toHaveBeenCalledOnce();
  });

  it('clears the budget once the app mounts', () => {
    scriptError();
    document.getElementById('boot')!.remove();
    vi.advanceTimersByTime(1000);
    expect(sessionStorage.getItem('ddoc-boot-retries')).toBeNull();
  });
});
