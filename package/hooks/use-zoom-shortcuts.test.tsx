import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getZoomShortcutDirection,
  useZoomShortcuts,
} from './use-zoom-shortcuts';

const key = (init: Partial<KeyboardEvent>) => ({
  key: '',
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...init,
});

describe('getZoomShortcutDirection', () => {
  it.each([
    [{ key: '=', metaKey: true }, true, 1],
    [{ key: '-', ctrlKey: true }, false, -1],
    [{ key: '-', metaKey: true }, true, -1],
    [{ key: '+', metaKey: true, shiftKey: true }, true, null],
    [{ key: '_', metaKey: true, shiftKey: true }, true, null],
    [{ key: '0', metaKey: true }, true, null],
    [{ key: '=', ctrlKey: true }, true, null],
    [{ key: '=', metaKey: true }, false, null],
    [{ key: '=', metaKey: true, altKey: true }, true, null],
    [{ key: '=', metaKey: true, ctrlKey: true }, true, null],
    [{ key: '=' }, true, null],
  ])('%o on apple=%s -> %s', (init, isApple, expected) => {
    expect(getZoomShortcutDirection(key(init), isApple)).toBe(expected);
  });
});

const Harness = ({
  enabled,
  onStep,
}: {
  enabled: boolean;
  onStep: (direction: 1 | -1) => void;
}) => {
  useZoomShortcuts({ enabled, onStep });
  return null;
};

const mod = /Mac|iPhone|iPad/.test(navigator.platform)
  ? { metaKey: true }
  : { ctrlKey: true };

const press = (target: EventTarget, init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('useZoomShortcuts', () => {
  it('zooms from any focus and blocks the browser', () => {
    const onStep = vi.fn();
    render(<Harness enabled onStep={onStep} />);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    const event = press(input, { key: '=', ...mod });
    expect(onStep).toHaveBeenCalledWith(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('leaves Shift variants to the browser', () => {
    const onStep = vi.fn();
    render(<Harness enabled onStep={onStep} />);
    const event = press(document.body, { key: '+', shiftKey: true, ...mod });
    expect(onStep).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('unbinds when disabled', () => {
    const onStep = vi.fn();
    const { rerender } = render(<Harness enabled onStep={onStep} />);
    rerender(<Harness enabled={false} onStep={onStep} />);
    const event = press(document.body, { key: '-', ...mod });
    expect(onStep).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
