import { useCallback, useRef } from 'react';
import type { MutableRefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { FloatingLayoutInvalidationFlag } from './comment-floating-layout';
import type { CommentFloatingCard } from './context/types';
import {
  areAnchorElementsEqual,
  getAnchorElements,
  getAnchorIdentity,
  getAnchorStartPos,
  getSharedThreadAnchorElement,
  type AnchorRecord,
  type FloatingCardRuntimeState,
} from './floating-comment-layout-utils';

interface SyncAnchorsArgs {
  currentCycle: number;
  currentDocVersion: number;
  editor: Editor;
  editorRoot: HTMLElement;
  editorWrapperNode: HTMLDivElement | null;
  floatingCards: CommentFloatingCard[];
  getFloatingCardRuntimeState: (
    floatingCardId: string,
  ) => FloatingCardRuntimeState;
  markFloatingCardInvalidated: (
    floatingCardId: string,
    flag: FloatingLayoutInvalidationFlag,
  ) => void;
  markFloatingCardOrderDirty: () => void;
  markRecomputeFromIndex: (recomputeFromIndex: number) => void;
  getOrderedFloatingCardIndex: (floatingCardId: string) => number | null;
}

interface SyncAnchorsResult {
  activeFloatingCards: CommentFloatingCard[];
  activeFloatingCardMap: Map<string, CommentFloatingCard>;
  floatingCardIdsToClose: Set<string>;
  shouldScheduleFollowUp: boolean;
}

export interface UseAnchorRegistryResult {
  anchorRegistryRef: MutableRefObject<Map<string, AnchorRecord>>;
  queueAnchorRefresh: (floatingCardId: string) => void;
  queueAnchorRefreshForCards: (floatingCards: CommentFloatingCard[]) => void;
  resetAnchorRegistry: () => void;
  syncAnchors: (args: SyncAnchorsArgs) => SyncAnchorsResult;
}

export const useAnchorRegistry = (): UseAnchorRegistryResult => {
  // This hook answers one question for the layout engine:
  // where in the editor does each floating card belong right now?
  const anchorRegistryRef = useRef<Map<string, AnchorRecord>>(new Map());
  const anchorRefreshQueueRef = useRef<Set<string>>(new Set());
  const lastEditorRootRef = useRef<HTMLElement | null>(null);
  const lastWrapperNodeRef = useRef<HTMLDivElement | null>(null);

  const queueAnchorRefresh = useCallback((floatingCardId: string) => {
    anchorRefreshQueueRef.current.add(floatingCardId);
  }, []);

  const queueAnchorRefreshForCards = useCallback(
    (floatingCards: CommentFloatingCard[]) => {
      floatingCards.forEach((floatingCard) => {
        anchorRefreshQueueRef.current.add(floatingCard.floatingCardId);
      });
    },
    [],
  );

  const resetAnchorRegistry = useCallback(() => {
    anchorRegistryRef.current.clear();
    anchorRefreshQueueRef.current.clear();
    lastEditorRootRef.current = null;
    lastWrapperNodeRef.current = null;
  }, []);

  const syncAnchors = useCallback(
    ({
      currentCycle,
      currentDocVersion,
      editor,
      editorRoot,
      editorWrapperNode,
      floatingCards,
      getFloatingCardRuntimeState,
      markFloatingCardInvalidated,
      markFloatingCardOrderDirty,
      markRecomputeFromIndex,
      getOrderedFloatingCardIndex,
    }: SyncAnchorsArgs): SyncAnchorsResult => {
      let shouldScheduleFollowUp = false;
      // Build the next anchor picture first, then replace the old one at the end.
      const nextRegistry = new Map(anchorRegistryRef.current);

      const editorRootChanged =
        lastEditorRootRef.current !== editorRoot ||
        lastWrapperNodeRef.current !== editorWrapperNode;

      if (editorRootChanged) {
        // If the editor root changed, all saved anchor lookups should be refreshed.
        lastEditorRootRef.current = editorRoot;
        lastWrapperNodeRef.current = editorWrapperNode;
        queueAnchorRefreshForCards(floatingCards);
      }

      const floatingCardIdsNeedingAnchorRefresh = new Set(
        anchorRefreshQueueRef.current,
      );
      const floatingCardIdSet = new Set(
        floatingCards.map((floatingCard) => floatingCard.floatingCardId),
      );

      Array.from(nextRegistry.entries()).forEach(([anchorId, entry]) => {
        if (!floatingCardIdSet.has(entry.floatingCardId)) {
          nextRegistry.delete(anchorId);
        }
      });

      const floatingCardIdsToClose = new Set<string>();

      floatingCards.forEach((floatingCard) => {
        const floatingCardRuntimeState = getFloatingCardRuntimeState(
          floatingCard.floatingCardId,
        );
        const { anchorId, anchorType } = getAnchorIdentity(floatingCard);
        const previousEntry = nextRegistry.get(anchorId);
        const shouldRefresh =
          floatingCardIdsNeedingAnchorRefresh.has(
            floatingCard.floatingCardId,
          ) || !previousEntry;

        if (!shouldRefresh) {
          floatingCardRuntimeState.anchorPosition =
            previousEntry?.pmPos ?? floatingCardRuntimeState.anchorPosition;
          return;
        }

        const elements = getAnchorElements({
          editorRoot,
          anchorId,
          anchorType,
        });
        if (!elements.length && anchorType === 'thread') {
          const sharedElement = getSharedThreadAnchorElement({
            editor,
            editorRoot,
            anchorId,
          });
          if (sharedElement) elements.push(sharedElement);
        }

        if (!elements.length) {
          // Give missing anchors a short grace period before closing the card.
          // This avoids closing during brief editor DOM swaps.
          const missingSinceDocVersion =
            previousEntry?.missingSinceDocVersion ?? currentDocVersion;
          const missingSinceCycle =
            previousEntry?.missingSinceCycle ?? currentCycle;
          const shouldClose =
            previousEntry !== undefined &&
            ((previousEntry.missingSinceCycle !== null &&
              previousEntry.missingSinceCycle < currentCycle) ||
              (previousEntry.missingSinceDocVersion !== null &&
                previousEntry.missingSinceDocVersion < currentDocVersion));

          if (shouldClose) {
            floatingCardIdsToClose.add(floatingCard.floatingCardId);
            nextRegistry.delete(anchorId);
            return;
          }

          nextRegistry.set(anchorId, {
            floatingCardId: floatingCard.floatingCardId,
            anchorId,
            anchorType,
            elements: previousEntry?.elements ?? [],
            pmPos: previousEntry?.pmPos ?? null,
            anchorVersion: previousEntry?.anchorVersion ?? 0,
            cachedRect: previousEntry?.cachedRect ?? null,
            lastSeenEditorRoot: editorRoot,
            missingSinceDocVersion,
            missingSinceCycle,
          });
          shouldScheduleFollowUp = true;
          floatingCardRuntimeState.anchorPosition =
            previousEntry?.pmPos ?? floatingCardRuntimeState.anchorPosition;
          return;
        }

        const pmPos = getAnchorStartPos(editor, elements);
        const didChange =
          !previousEntry ||
          previousEntry.anchorType !== anchorType ||
          previousEntry.pmPos !== pmPos ||
          previousEntry.lastSeenEditorRoot !== editorRoot ||
          !areAnchorElementsEqual(previousEntry.elements, elements);
        const nextEntry: AnchorRecord = {
          floatingCardId: floatingCard.floatingCardId,
          anchorId,
          anchorType,
          elements,
          pmPos,
          anchorVersion: previousEntry
            ? didChange
              ? previousEntry.anchorVersion + 1
              : previousEntry.anchorVersion
            : 0,
          cachedRect:
            previousEntry && !didChange ? previousEntry.cachedRect : null,
          lastSeenEditorRoot: editorRoot,
          missingSinceDocVersion: null,
          missingSinceCycle: null,
        };

        nextRegistry.set(anchorId, nextEntry);
        floatingCardRuntimeState.anchorPosition = pmPos;

        if (
          didChange ||
          floatingCardRuntimeState.anchorVersion !== nextEntry.anchorVersion
        ) {
          if (!previousEntry || previousEntry.pmPos !== pmPos) {
            // Only position changes can affect stacking order, so this is the
            // narrowest place to dirty ordering for the layout engine.
            markFloatingCardOrderDirty();
          }
          const currentIndex = getOrderedFloatingCardIndex(
            floatingCard.floatingCardId,
          );
          markFloatingCardInvalidated(
            floatingCard.floatingCardId,
            FloatingLayoutInvalidationFlag.Anchor,
          );
          markRecomputeFromIndex(currentIndex ?? 0);
        }
      });

      anchorRefreshQueueRef.current.clear();

      const activeFloatingCards = floatingCards.filter(
        (floatingCard) =>
          !floatingCardIdsToClose.has(floatingCard.floatingCardId),
      );
      const activeFloatingCardMap = new Map(
        activeFloatingCards.map((floatingCard) => [
          floatingCard.floatingCardId,
          floatingCard,
        ]),
      );
      const activeAnchorIds = new Set(
        activeFloatingCards.map(
          (floatingCard) => getAnchorIdentity(floatingCard).anchorId,
        ),
      );

      Array.from(nextRegistry.keys()).forEach((anchorId) => {
        if (!activeAnchorIds.has(anchorId)) {
          nextRegistry.delete(anchorId);
        }
      });

      anchorRegistryRef.current = nextRegistry;

      return {
        activeFloatingCards,
        activeFloatingCardMap,
        floatingCardIdsToClose,
        shouldScheduleFollowUp,
      };
    },
    [queueAnchorRefreshForCards],
  );

  return {
    anchorRegistryRef,
    queueAnchorRefresh,
    queueAnchorRefreshForCards,
    resetAnchorRegistry,
    syncAnchors,
  };
};
