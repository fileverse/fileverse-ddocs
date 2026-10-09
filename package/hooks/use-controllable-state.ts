import {
  Dispatch,
  SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

const NONE = Symbol('no pending request');

export const useControllableState = <T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
  legacySetter?: (next: T) => void,
): [T, Dispatch<SetStateAction<T>>] => {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<T>(defaultValue);
  const [lastControlled, setLastControlled] = useState<T | undefined>(value);

  // Controlled -> uncontrolled: continue from the last prop value.
  if (isControlled && !Object.is(value, lastControlled)) {
    setLastControlled(value);
  } else if (!isControlled && lastControlled !== undefined) {
    setLastControlled(undefined);
    setInternal(lastControlled);
  }

  const current = isControlled ? (value as T) : internal;

  const stateRef = useRef({ isControlled, current, onChange, legacySetter });
  const pendingRef = useRef<T | typeof NONE>(NONE);

  // Every commit: the rendered value is the basis again, requests are dropped.
  useLayoutEffect(() => {
    stateRef.current = { isControlled, current, onChange, legacySetter };
    pendingRef.current = NONE;
  });

  const set = useCallback<Dispatch<SetStateAction<T>>>((action) => {
    const state = stateRef.current;
    const basis =
      pendingRef.current === NONE ? state.current : (pendingRef.current as T);
    const next =
      typeof action === 'function' ? (action as (prev: T) => T)(basis) : action;
    if (Object.is(next, basis)) return;

    if (pendingRef.current === NONE) {
      // A request lives for one synchronous task.
      queueMicrotask(() => {
        pendingRef.current = NONE;
      });
    }
    pendingRef.current = next;
    if (!state.isControlled) {
      // Internal state is always accepted, so it is the basis straight away.
      stateRef.current = { ...state, current: next };
      setInternal(next);
    }
    state.onChange?.(next);
    state.legacySetter?.(next);
  }, []);

  return [current, set];
};
