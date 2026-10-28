import { useEffect, useState, type MutableRefObject } from 'react';
import type { createCommentStore } from '../stores/comment-store';

type CommentStoreApi = ReturnType<typeof createCommentStore>;

// DdocEditor sits above CommentStoreProvider, so it reads the store through
// the ref the provider fills (set in the provider's effect, which runs first).
export const useHasFloatingComments = (
  storeApiRef: MutableRefObject<CommentStoreApi | null>,
) => {
  const [hasFloatingComments, setHasFloatingComments] = useState(false);

  useEffect(() => {
    const store = storeApiRef.current;
    if (!store) return;
    const read = () => {
      const { isDesktopFloatingEnabled, floatingCards } = store.getState();
      setHasFloatingComments(
        isDesktopFloatingEnabled && floatingCards.length > 0,
      );
    };
    read();
    return store.subscribe(read);
  }, [storeApiRef]);

  return hasFloatingComments;
};
