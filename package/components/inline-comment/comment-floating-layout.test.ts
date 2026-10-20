import { describe, expect, it } from 'vitest';
import {
  computeFloatingCommentLayout,
  FloatingLayoutInvalidationFlag,
  type FloatingCardLayoutInput,
} from './comment-floating-layout';
import type { CommentFloatingCard } from './context/types';
import { reconcileOrderedFloatingCardIds } from './floating-comment-layout-utils';

const card = (id: string, height = 110): FloatingCardLayoutInput => ({
  floatingCardId: id,
  anchorTop: 20,
  height,
  isVisible: true,
  isMeasured: true,
  lastCommittedTranslateY: null,
  invalidationFlags: FloatingLayoutInvalidationFlag.Anchor,
});

const layout = (cards: FloatingCardLayoutInput[], focusedId: string) =>
  computeFloatingCommentLayout({
    floatingCards: cards,
    focusedFloatingCardId: focusedId,
    recomputeStartIndex: 0,
    lastInvalidatedIndex: cards.length - 1,
  });

describe('same-text floating comment cards', () => {
  it('restores creation order when an older thread reopens', () => {
    const cards: CommentFloatingCard[] = [
      {
        type: 'thread',
        floatingCardId: 'newer',
        commentId: 'newer',
        selectedText: 'same text',
        isFocused: true,
        createdAt: new Date('2026-10-20T12:00:00Z'),
      },
      {
        type: 'thread',
        floatingCardId: 'older',
        commentId: 'older',
        selectedText: 'same text',
        isFocused: false,
        createdAt: new Date('2026-10-19T12:00:00Z'),
      },
    ];
    const ordered = reconcileOrderedFloatingCardIds({
      previousOrderedFloatingCardIds: ['newer'],
      nextFloatingCards: cards,
      getPos: () => 20,
    }).orderedFloatingCardIds;
    expect(ordered).toEqual(['older', 'newer']);

    const placed = layout(
      ordered.map((id) => card(id)),
      'newer',
    ).placements;
    const olderTop = placed.get('older')!.translateY!;
    const newerTop = placed.get('newer')!.translateY!;
    expect(olderTop).toBeGreaterThanOrEqual(0);
    expect(newerTop).toBeGreaterThanOrEqual(olderTop + 118);
  });

  it('keeps separate positions in document order', () => {
    const cards: CommentFloatingCard[] = [
      {
        type: 'thread',
        floatingCardId: 'later',
        commentId: 'later',
        selectedText: 'later text',
        isFocused: false,
        createdAt: new Date('2026-10-19T12:00:00Z'),
      },
      {
        type: 'thread',
        floatingCardId: 'earlier',
        commentId: 'earlier',
        selectedText: 'earlier text',
        isFocused: true,
        createdAt: new Date('2026-10-20T12:00:00Z'),
      },
    ];
    expect(
      reconcileOrderedFloatingCardIds({
        previousOrderedFloatingCardIds: [],
        nextFloatingCards: cards,
        getPos: (id) => (id === 'earlier' ? 5 : 50),
      }).orderedFloatingCardIds,
    ).toEqual(['earlier', 'later']);
  });

  it('reflows both cards after a reply expands the older card', () => {
    const cards = [card('older'), card('newer')];
    cards[0].height = 250;
    const placed = layout(cards, 'newer').placements;
    const olderTop = placed.get('older')!.translateY!;
    const newerTop = placed.get('newer')!.translateY!;
    expect(olderTop).toBeGreaterThanOrEqual(0);
    expect(newerTop).toBeGreaterThanOrEqual(olderTop + 258);
  });
});
