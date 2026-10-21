// Keep this function pure so the comment floating container can run it again safely.
// Only recalculate what changed and stop once the remaining cards stay the same.

export const FLOATING_COMMENT_CARD_GAP = 8;
export const FLOATING_COMMENT_BOTTOM_SPACE = 48;
export const FLOATING_COMMENT_RIGHT_SPACE = 48;

export const enum FloatingLayoutInvalidationFlag {
  None = 0,
  Anchor = 1 << 0,
  Viewport = 1 << 1,
  Height = 1 << 2,
  Visibility = 1 << 3,
}

export interface FloatingCardLayoutInput {
  floatingCardId: string;
  anchorTop: number | null;
  height: number;
  isVisible: boolean;
  isMeasured: boolean;
  lastCommittedTranslateY: number | null;
  invalidationFlags: FloatingLayoutInvalidationFlag;
}

export interface FloatingLayoutResult {
  placements: Map<
    string,
    {
      translateY: number | null;
      isVisible: boolean;
    }
  >;
  stopIndex: number;
  usedFocusedLayout: boolean;
}

const NO_INVALIDATED_INDEX = Number.POSITIVE_INFINITY;

type PlaceableFloatingCardLayoutInput = FloatingCardLayoutInput & {
  anchorTop: number;
};

const canPlaceFloatingCard = (
  floatingCard: FloatingCardLayoutInput,
): floatingCard is PlaceableFloatingCardLayoutInput => {
  return (
    floatingCard.isVisible &&
    floatingCard.isMeasured &&
    floatingCard.anchorTop !== null &&
    floatingCard.height > 0
  );
};

// Round before compare, save, and write so tiny pixel shifts do not cause extra work.
export const roundFloatingTranslateY = (translateY: number | null) => {
  return translateY === null ? null : Math.round(translateY);
};

const getLastCommittedTranslateY = (floatingCard: FloatingCardLayoutInput) => {
  return floatingCard.lastCommittedTranslateY ?? floatingCard.anchorTop ?? null;
};

const hasFloatingCardInvalidation = (floatingCard: FloatingCardLayoutInput) => {
  return floatingCard.invalidationFlags !== FloatingLayoutInvalidationFlag.None;
};

const didTranslateYChange = (
  floatingCard: FloatingCardLayoutInput,
  translateY: number,
) => {
  return (
    roundFloatingTranslateY(translateY) !== floatingCard.lastCommittedTranslateY
  );
};

const setHiddenPlacement = (
  placements: FloatingLayoutResult['placements'],
  floatingCard: FloatingCardLayoutInput,
) => {
  placements.set(floatingCard.floatingCardId, {
    translateY: getLastCommittedTranslateY(floatingCard),
    isVisible: false,
  });
};

const getReservedHiddenCardRange = (floatingCard: FloatingCardLayoutInput) => {
  if (!floatingCard.isMeasured || floatingCard.height <= 0) {
    return null;
  }

  const translateY = getLastCommittedTranslateY(floatingCard);

  if (translateY === null) {
    return null;
  }

  return {
    top: translateY,
    bottom: translateY + floatingCard.height,
  };
};

const reserveHiddenCardBottom = (
  previousBottom: number | null,
  floatingCard: FloatingCardLayoutInput,
) => {
  const reservedRange = getReservedHiddenCardRange(floatingCard);

  if (!reservedRange) {
    return previousBottom;
  }

  return previousBottom === null
    ? reservedRange.bottom
    : Math.max(previousBottom, reservedRange.bottom);
};

const computeFocusedFloatingCommentLayout = ({
  floatingCards,
  focusedFloatingCardId,
  firstInvalidatedIndex,
  lastInvalidatedIndex,
  gap,
}: {
  floatingCards: FloatingCardLayoutInput[];
  focusedFloatingCardId: string;
  firstInvalidatedIndex: number;
  lastInvalidatedIndex: number;
  gap: number;
}): FloatingLayoutResult | null => {
  const focusedIndex = floatingCards.findIndex(
    (floatingCard) => floatingCard.floatingCardId === focusedFloatingCardId,
  );
  const focusedFloatingCard =
    focusedIndex >= 0 ? floatingCards[focusedIndex] : null;

  if (!focusedFloatingCard || !canPlaceFloatingCard(focusedFloatingCard)) {
    return null;
  }

  const placements: FloatingLayoutResult['placements'] = new Map();
  const focusedTranslateY = focusedFloatingCard.anchorTop;

  placements.set(focusedFloatingCard.floatingCardId, {
    translateY: focusedTranslateY,
    isVisible: true,
  });

  // Keep the active card fixed at its anchor. Resolve away from that focus,
  // and only stop a side after both conditions hold: the local placement is
  // stable and every invalidated card on that side has been visited.
  let nextTop = focusedTranslateY;

  for (let index = focusedIndex - 1; index >= 0; index -= 1) {
    const floatingCard = floatingCards[index];

    if (!canPlaceFloatingCard(floatingCard)) {
      setHiddenPlacement(placements, floatingCard);
      const reservedRange = getReservedHiddenCardRange(floatingCard);

      if (reservedRange) {
        nextTop = Math.min(nextTop, reservedRange.top);
      }

      continue;
    }

    const translateY = Math.min(
      floatingCard.anchorTop,
      nextTop - gap - floatingCard.height,
    );

    placements.set(floatingCard.floatingCardId, {
      translateY,
      isVisible: true,
    });
    nextTop = translateY;

    if (
      index <= firstInvalidatedIndex &&
      !hasFloatingCardInvalidation(floatingCard) &&
      !didTranslateYChange(floatingCard, translateY)
    ) {
      break;
    }
  }

  let previousBottom = focusedTranslateY + focusedFloatingCard.height;
  let stopIndex = focusedIndex;

  for (let index = focusedIndex + 1; index < floatingCards.length; index += 1) {
    const floatingCard = floatingCards[index];
    stopIndex = index;

    if (!canPlaceFloatingCard(floatingCard)) {
      setHiddenPlacement(placements, floatingCard);
      previousBottom =
        reserveHiddenCardBottom(previousBottom, floatingCard) ?? previousBottom;
      continue;
    }

    const translateY = Math.max(floatingCard.anchorTop, previousBottom + gap);

    placements.set(floatingCard.floatingCardId, {
      translateY,
      isVisible: true,
    });
    previousBottom = translateY + floatingCard.height;

    if (
      index >= lastInvalidatedIndex &&
      !hasFloatingCardInvalidation(floatingCard) &&
      !didTranslateYChange(floatingCard, translateY)
    ) {
      break;
    }
  }

  // If cards share the focused anchor near the top, keep earlier cards visible.
  const firstVisibleTop = Math.min(
    0,
    ...Array.from(placements.values(), (placement) =>
      placement.isVisible ? (placement.translateY ?? 0) : 0,
    ),
  );
  const hasSameAnchorBeforeFocus = floatingCards
    .slice(0, focusedIndex)
    .some((card) => card.anchorTop === focusedFloatingCard.anchorTop);
  if (
    hasSameAnchorBeforeFocus &&
    focusedFloatingCard.anchorTop >= 0 &&
    firstVisibleTop < 0
  ) {
    placements.forEach((placement) => {
      if (placement.isVisible && placement.translateY !== null) {
        placement.translateY -= firstVisibleTop;
      }
    });
  }

  return {
    placements,
    stopIndex,
    usedFocusedLayout: true,
  };
};

// Start placing cards from the first changed card.
// Stop once a card matches its saved position because the cards after it will match too.
export const computeFloatingCommentLayout = ({
  floatingCards,
  recomputeStartIndex,
  firstInvalidatedIndex = NO_INVALIDATED_INDEX,
  lastInvalidatedIndex,
  gap = FLOATING_COMMENT_CARD_GAP,
  focusedFloatingCardId,
}: {
  floatingCards: FloatingCardLayoutInput[];
  recomputeStartIndex: number;
  firstInvalidatedIndex?: number;
  lastInvalidatedIndex: number;
  gap?: number;
  focusedFloatingCardId?: string | null;
}): FloatingLayoutResult => {
  if (focusedFloatingCardId) {
    const focusedLayout = computeFocusedFloatingCommentLayout({
      floatingCards,
      focusedFloatingCardId,
      firstInvalidatedIndex,
      lastInvalidatedIndex,
      gap,
    });

    if (focusedLayout) {
      return focusedLayout;
    }
  }

  const placements = new Map<
    string,
    {
      translateY: number | null;
      isVisible: boolean;
    }
  >();
  // Keep the bottom edge of the previous card so the next one stacks under it.
  let previousBottom: number | null = null;

  for (let index = 0; index < floatingCards.length; index += 1) {
    const floatingCard = floatingCards[index];
    // If the card cannot be shown, keep its last position but hide it.
    if (!canPlaceFloatingCard(floatingCard)) {
      setHiddenPlacement(placements, floatingCard);
      previousBottom = reserveHiddenCardBottom(previousBottom, floatingCard);
      continue;
    }
    // Before the restart point, keep the saved position.
    if (index < recomputeStartIndex) {
      const settledTranslateY =
        getLastCommittedTranslateY(floatingCard) ?? floatingCard.anchorTop;

      placements.set(floatingCard.floatingCardId, {
        translateY: settledTranslateY,
        isVisible: true,
      });
      previousBottom = settledTranslateY + floatingCard.height;
      continue;
    }
    // Put the card at its anchor or below the previous card, whichever is lower.
    const translateY = Math.max(
      floatingCard.anchorTop,
      previousBottom === null ? floatingCard.anchorTop : previousBottom + gap,
    );

    placements.set(floatingCard.floatingCardId, {
      translateY,
      isVisible: true,
    });

    const hasOwnInvalidation = hasFloatingCardInvalidation(floatingCard);
    const placementChanged = didTranslateYChange(floatingCard, translateY);

    previousBottom = translateY + floatingCard.height;

    // Stop once this card already matches its saved position.
    // The container will keep using the saved positions for the cards after it.
    if (
      index >= recomputeStartIndex &&
      index >= lastInvalidatedIndex &&
      !hasOwnInvalidation &&
      !placementChanged
    ) {
      return {
        placements,
        stopIndex: index,
        usedFocusedLayout: false,
      };
    }
  }

  return {
    placements,
    stopIndex: floatingCards.length - 1,
    usedFocusedLayout: false,
  };
};
