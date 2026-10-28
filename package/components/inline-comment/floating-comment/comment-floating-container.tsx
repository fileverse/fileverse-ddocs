import { cn } from '@fileverse/ui';
import { useCommentStore } from '../../../stores/comment-store';
import { useCommentListContainer } from '../use-comment-list-container';
import { DraftFloatingCard } from './draft-floating-card';
import { SuggestionDraftFloatingCard } from './suggestion-draft-floating-card';
import { SuggestionThreadFloatingCard } from './suggestion-thread-floating-card';
import { ThreadFloatingCard } from './thread-floating-card';
import type { CommentFloatingContainerProps } from './types';
import { FLOATING_CARD_WIDTH } from '../constants';
import { FLOATING_COMMENT_RIGHT_SPACE } from '../comment-floating-layout';

export const CommentFloatingContainer = ({
  editor,
  editorWrapperRef,
  scrollContainerRef,
  tabName,
  isHidden,
}: CommentFloatingContainerProps) => {
  const comments = useCommentStore((s) => s.tabComments);
  const {
    floatingCardListContainerRef,
    mountedFloatingCards,
    registerCardNode,
    shouldRender,
  } = useCommentListContainer({
    editor,
    editorWrapperRef,
    scrollContainerRef,
    isHidden,
  });

  if (!shouldRender) {
    return null;
  }

  return (
    <div
      ref={floatingCardListContainerRef}
      className={cn(
        'comment-floating-comments relative shrink-0',
        isHidden && 'pointer-events-none',
      )}
      data-floating-comment-hidden={isHidden ? 'true' : 'false'}
      style={{
        width: FLOATING_CARD_WIDTH,
        boxSizing: 'content-box',
        minHeight: 'var(--floating-comment-container-min-height, 100%)',
        paddingRight: isHidden ? 0 : FLOATING_COMMENT_RIGHT_SPACE,
      }}
    >
      {mountedFloatingCards.map((floatingCard) => {
        if (floatingCard.type === 'draft') {
          return (
            <DraftFloatingCard
              key={floatingCard.floatingCardId}
              draft={floatingCard}
              isHidden={isHidden}
              registerCardNode={registerCardNode}
            />
          );
        }

        if (floatingCard.type === 'suggestion-draft') {
          return (
            <SuggestionDraftFloatingCard
              key={floatingCard.floatingCardId}
              card={floatingCard}
              isHidden={isHidden}
              registerCardNode={registerCardNode}
            />
          );
        }

        const comment = comments.find(
          (entry) => entry.id === floatingCard.commentId,
        );

        // Suggestions render a distinct thread card — diff summary +
        // accept/reject/withdraw actions — per the product spec.
        if (comment?.isSuggestion) {
          return (
            <SuggestionThreadFloatingCard
              key={floatingCard.floatingCardId}
              thread={floatingCard}
              comment={comment}
              tabName={tabName}
              isHidden={isHidden}
              registerCardNode={registerCardNode}
            />
          );
        }

        return (
          <ThreadFloatingCard
            key={floatingCard.floatingCardId}
            thread={floatingCard}
            comment={comment}
            tabName={tabName}
            isHidden={isHidden}
            registerCardNode={registerCardNode}
          />
        );
      })}
    </div>
  );
};
