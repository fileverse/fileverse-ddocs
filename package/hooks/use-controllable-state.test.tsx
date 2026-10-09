import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useControllableState } from './use-controllable-state';

type Props = {
  value?: boolean;
  onChange?: (next: boolean) => void;
  legacy?: (next: boolean) => void;
};

const setup = (initialProps: Props = {}, strict = false) =>
  renderHook(
    ({ value, onChange, legacy }: Props) =>
      useControllableState(value, false, onChange, legacy),
    { initialProps, wrapper: strict ? StrictMode : undefined },
  );

const endTask = () => act(async () => {});

describe('useControllableState, uncontrolled', () => {
  it('starts at the default and updates itself', () => {
    const { result } = setup();
    expect(result.current[0]).toBe(false);
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('notifies the callback and the legacy setter once, with the plain value', () => {
    const onChange = vi.fn();
    const legacy = vi.fn();
    const { result } = setup({ onChange, legacy });
    act(() => result.current[1]((prev) => !prev));
    expect(onChange.mock.calls).toEqual([[true]]);
    expect(legacy.mock.calls).toEqual([[true]]);
  });

  it('composes several functional updates before a render', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useControllableState<number>(undefined, 0, onChange),
    );
    act(() => {
      result.current[1]((n) => n + 1);
      result.current[1]((n) => n + 1);
    });
    expect(result.current[0]).toBe(2);
    expect(onChange.mock.calls).toEqual([[1], [2]]);
  });

  it('does nothing when the value does not change', () => {
    const onChange = vi.fn();
    const { result } = setup({ onChange });
    act(() => result.current[1](false));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('notifies once per change under Strict Mode', () => {
    const onChange = vi.fn();
    const { result } = setup({ onChange }, true);
    act(() => result.current[1](true));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('useControllableState, controlled', () => {
  it('shows the prop and only asks the host to change it', () => {
    const onChange = vi.fn();
    const { result, rerender } = setup({ value: false, onChange });
    act(() => result.current[1](true));
    expect(result.current[0]).toBe(false);
    expect(onChange.mock.calls).toEqual([[true]]);
    rerender({ value: true, onChange });
    expect(result.current[0]).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('composes functional updates inside one handler', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useControllableState<number>(0, 0, onChange),
    );
    act(() => {
      result.current[1]((n) => n + 1);
      result.current[1]((n) => n + 1);
    });
    expect(onChange.mock.calls).toEqual([[1], [2]]);
  });

  it('derives a later toggle from the prop when the host declined without re-rendering', async () => {
    const onChange = vi.fn();
    const { result } = setup({ value: false, onChange });
    act(() => result.current[1]((prev) => !prev));
    await endTask();
    act(() => result.current[1]((prev) => !prev));
    expect(onChange.mock.calls).toEqual([[true], [true]]);
  });

  it('derives a later toggle from the prop when the host re-rendered with the same value', () => {
    const onChange = vi.fn();
    const { result, rerender } = setup({ value: false, onChange });
    act(() => result.current[1]((prev) => !prev));
    rerender({ value: false, onChange });
    act(() => result.current[1]((prev) => !prev));
    expect(onChange.mock.calls).toEqual([[true], [true]]);
  });

  it('notifies nobody when the host accepts later', async () => {
    const onChange = vi.fn();
    const { result, rerender } = setup({ value: false, onChange });
    act(() => result.current[1](true));
    await endTask();
    rerender({ value: true, onChange });
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => result.current[1]((prev) => !prev));
    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps a fixed value when there is no callback', () => {
    const { result } = setup({ value: false });
    expect(() => act(() => result.current[1](true))).not.toThrow();
    expect(result.current[0]).toBe(false);
  });

  it('hands off to internal state with the last prop value', () => {
    const { result, rerender } = setup({ value: true });
    rerender({ value: undefined });
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
  });

  it('hands off the prop value, not a declined request', async () => {
    const { result, rerender } = setup({ value: true, onChange: vi.fn() });
    act(() => result.current[1](false));
    await endTask();
    rerender({ value: undefined });
    expect(result.current[0]).toBe(true);
  });
});
