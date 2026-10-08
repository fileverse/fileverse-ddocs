import { act, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useFocusMode } from './use-focus-mode';

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as typeof window.matchMedia;
  }
});

const press = (init: KeyboardEventInit) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', init));
  });

describe('useFocusMode', () => {
  it('fires onFocusModeChange when uncontrolled', async () => {
    const onFocusModeChange = vi.fn();
    const onFocusMode = vi.fn();
    const { result } = renderHook(() =>
      useFocusMode({ onFocusModeChange, onFocusMode }),
    );
    await act(() => result.current.toggleFocusMode());
    expect(result.current.isFocusMode).toBe(true);
    expect(onFocusModeChange.mock.calls).toEqual([[true]]);
    expect(onFocusMode.mock.calls).toEqual([[true]]);
  });

  it('keeps the value when the prop is withdrawn', () => {
    const { result, rerender } = renderHook(
      ({ value }: { value?: boolean }) => useFocusMode({ isFocusMode: value }),
      { initialProps: { value: true } as { value?: boolean } },
    );
    rerender({ value: undefined });
    expect(result.current.isFocusMode).toBe(true);
  });

  it('toggles on Cmd+Shift+F and leaves on Escape', () => {
    const { result } = renderHook(() => useFocusMode());
    press({ key: 'f', metaKey: true, shiftKey: true });
    expect(result.current.isFocusMode).toBe(true);
    press({ key: 'Escape' });
    expect(result.current.isFocusMode).toBe(false);
  });
});
