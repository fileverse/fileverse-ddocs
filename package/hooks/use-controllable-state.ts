import {
  Dispatch,
  SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

export const useControllableState = <T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
  legacySetter?: (next: T) => void,
): [T, Dispatch<SetStateAction<T>>] => {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<T>(defaultValue);
  const current = isControlled ? (value as T) : internal;

  // Read through a ref so `set` keeps one identity, like a useState setter.
  const stateRef = useRef({ isControlled, current, onChange, legacySetter });
  useLayoutEffect(() => {
    stateRef.current = { isControlled, current, onChange, legacySetter };
  });

  const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const state = stateRef.current;
    const next =
      typeof action === 'function'
        ? (action as (prev: T) => T)(state.current)
        : action;
    if (Object.is(next, state.current)) return;

    if (!state.isControlled) {
      // Internal state is always accepted, so a later call builds on it.
      stateRef.current = { ...state, current: next };
      setInternal(next);
    }
    state.onChange?.(next);
    state.legacySetter?.(next);
  }, []);

  return [current, set];
};
