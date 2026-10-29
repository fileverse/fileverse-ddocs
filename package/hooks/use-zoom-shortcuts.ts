import { useEffect, useRef } from 'react';

type ShortcutKeys = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'
>;

// Mod+= / Mod+- step editor zoom; Shift variants and Mod+0 stay with the browser.
export const getZoomShortcutDirection = (
  event: ShortcutKeys,
  isApple: boolean,
): 1 | -1 | null => {
  const mod = isApple ? event.metaKey : event.ctrlKey;
  const otherMod = isApple ? event.ctrlKey : event.metaKey;
  if (!mod || otherMod || event.shiftKey || event.altKey) return null;
  if (event.key === '=') return 1;
  if (event.key === '-') return -1;
  return null;
};

export const useZoomShortcuts = ({
  enabled,
  onStep,
}: {
  enabled: boolean;
  onStep: (direction: 1 | -1) => void;
}) => {
  const onStepRef = useRef(onStep);
  onStepRef.current = onStep;

  useEffect(() => {
    if (!enabled) return;
    const isApple = /Mac|iPhone|iPad/.test(navigator.platform);
    const handleKeyDown = (event: KeyboardEvent) => {
      const direction = getZoomShortcutDirection(event, isApple);
      if (direction === null) return;
      event.preventDefault();
      onStepRef.current(direction);
    };
    // Capture, so editor keymaps cannot swallow the shortcut first.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [enabled]);
};
