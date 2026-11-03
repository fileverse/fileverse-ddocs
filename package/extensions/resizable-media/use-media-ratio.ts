import { type RefObject, useEffect, useSyncExternalStore } from 'react';
import type { Editor } from '@tiptap/core';
import { MEDIA_RATIO_VAR, publishMediaRatios } from './media-ratio';

const noSubscribe = () => () => {};

// Publishes the media ratio on the node view's box only while Pages is on,
// so Pageless DOM is untouched (docs/PAGES_MODE.md §13.5).
export const useMediaRatio = (
  editor: Editor,
  boxRef: RefObject<HTMLElement>,
  deps: unknown[],
) => {
  const store = editor.storage.pagination?.store;
  const isPages = useSyncExternalStore(
    store?.subscribe ?? noSubscribe,
    () => store?.get().enabled ?? false,
  );
  useEffect(() => {
    const box = boxRef.current;
    if (!box || !isPages) return;
    const stop = publishMediaRatios(box, box);
    return () => {
      stop();
      box.style.removeProperty(MEDIA_RATIO_VAR);
      if (!box.getAttribute('style')) box.removeAttribute('style');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPages, ...deps]);
};
