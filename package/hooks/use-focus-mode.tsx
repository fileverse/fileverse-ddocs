import { useCallback, useEffect } from 'react';
import { useMediaQuery } from 'usehooks-ts';
import { useEscapeKey } from './useEscapeKey';
import { useControllableState } from './use-controllable-state';

type UseFocusModeOptions = {
  /** @deprecated Use onFocusModeChange. Still fires on every change. */
  onFocusMode?: (isFocusMode: boolean) => void;
  isFocusMode?: boolean;
  onFocusModeChange?: (isFocusMode: boolean) => void;
};

export const useFocusMode = ({
  onFocusMode,
  isFocusMode: controlledValue,
  onFocusModeChange,
}: UseFocusModeOptions = {}) => {
  const [isFocusMode, setFocusMode] = useControllableState(
    controlledValue,
    false,
    onFocusModeChange,
    onFocusMode,
  );
  const isMobile = useMediaQuery('(max-width: 1024px)');

  // async to preserve the () => Promise<void> signature
  const toggleFocusMode = useCallback(async () => {
    setFocusMode((prev) => !prev);
  }, [setFocusMode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        toggleFocusMode();
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isMobile, toggleFocusMode]);

  useEscapeKey(() => {
    if (isFocusMode) {
      toggleFocusMode();
    }
  });

  return { isFocusMode, toggleFocusMode };
};
