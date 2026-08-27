import { Avatar, Button, IconButton, TextAreaFieldV2, cn } from '@fileverse/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useCommentStore } from '../../../stores/comment-store';
import EnsLogo from '../../../assets/ens.svg';
import verifiedMark from '../../../assets/ens-check.svg';
import { dateFormatter, nameFormatter } from '../../../utils/helpers';
import { CommentRepliesThread } from '../comment-card';
import { useCommentCard } from '../use-comment-card';
import { useEnsStatus } from '../use-ens-status';
import { resizeInlineCommentTextarea } from '../resize-inline-comment-textarea';
import { SuggestionDiffSummary } from '../suggestion-diff-summary';
import { FloatingAuthPrompt } from './floating-auth-prompt';
import { FloatingCardShell } from './floating-card-shell';
import type { ThreadFloatingCardProps } from './types';

/**
 * SuggestionThreadFloatingCard
 *
 * Shown in place of the generic ThreadFloatingCard for submitted suggestions
 * (comments with `isSuggestion: true`). Renders the Figma-specified layout:
 * author + timestamp header, Accept/Reject (owner) or Withdraw (author)
 * actions, a one-line diff summary (Add/Delete/Replace), and a reply input.
 *
 * Renders from the underlying IComment — the same source ThreadFloatingCard
 * uses — so once a draft is submitted, nothing else in the pipeline needs
 * to change to show the suggestion here.
 */
export const SuggestionThreadFloatingCard = ({
  thread,
  comment,
  isHidden,
  registerCardNode,
}: ThreadFloatingCardProps) => {
  const focusFloatingCard = useCommentStore((s) => s.focusFloatingCard);
  const focusCommentInEditor = useCommentStore((s) => s.focusCommentInEditor);
  const isDDocOwner = useCommentStore((s) => s.isDDocOwner);
  const currentUsername = useCommentStore((s) => s.username);
  const acceptSuggestion = useCommentStore((s) => s.acceptSuggestion);
  const deleteComment = useCommentStore((s) => s.deleteComment);
  const handleCardNode = useCallback(
    (node: HTMLDivElement | null) => {
      registerCardNode(thread.floatingCardId, node);
    },
    [registerCardNode, thread.floatingCardId],
  );

  if (!comment) return null;

  const handleFocus = () => {
    focusFloatingCard(thread.floatingCardId);

    if (!thread.isFocused && thread.commentId) {
      focusCommentInEditor(thread.commentId);
    }
  };

  // Same author check used by regular comments (comment-card.tsx). Consumer
  // persists the username (incl. random-account names from FloatingAuthPrompt)
  // in localStorage and restores it on reload, so this carries across reloads.
  const isAuthor = Boolean(
    currentUsername && comment.username && comment.username === currentUsername,
  );
  const canAcceptReject = isDDocOwner;
  const canWithdraw = !isDDocOwner && isAuthor;

  const handleAccept = () => {
    if (!thread.commentId) return;
    acceptSuggestion(thread.commentId);
  };

  const handleReject = () => {
    if (!thread.commentId) return;
    deleteComment(thread.commentId);
  };

  return (
    <FloatingCardShell
      ref={handleCardNode}
      floatingCardId={thread.floatingCardId}
      isHidden={isHidden}
      isFocused={thread.isFocused}
      onFocus={handleFocus}
    >
      <div className="flex group flex-col gap-2 p-3 pb-0">
        <Header
          username={comment.username}
          createdAt={comment.createdAt}
          canAcceptReject={canAcceptReject}
          canWithdraw={canWithdraw}
          isFocused={thread.isFocused}
          onAccept={handleAccept}
          onReject={handleReject}
        />
        <div className="ml-[32px]">
          <SuggestionDiffSummary
            suggestionType={comment.suggestionType}
            originalContent={comment.originalContent}
            suggestedContent={comment.suggestedContent}
          />
        </div>

        <RepliesThread
          thread={thread}
          comment={comment}
          onFocusRequest={handleFocus}
        />

        <ReplyField thread={thread} comment={comment} />
      </div>
    </FloatingCardShell>
  );
};

// ---------------------------------------------------------------------------
// Header — avatar + username + timestamp + Accept/Reject/Withdraw icons
// ---------------------------------------------------------------------------

interface HeaderProps {
  username: string | undefined;
  createdAt: Date | undefined;
  canAcceptReject: boolean;
  canWithdraw: boolean;
  isFocused: boolean;
  onAccept: () => void;
  onReject: () => void;
}

const Header = ({
  username,
  createdAt,
  canAcceptReject,
  canWithdraw,
  isFocused,
  onAccept,
  onReject,
}: HeaderProps) => {
  const ensStatus = useEnsStatus(username);

  return (
    <div className="flex items-center gap-2">
      <Avatar
        src={
          ensStatus.isEns
            ? EnsLogo
            : `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(
                ensStatus.name,
              )}`
        }
        size="sm"
        className="min-w-6"
      />
      <span className="text-body-sm-bold inline-flex items-center gap-1 whitespace-nowrap">
        <p className="truncate max-w-[86px]">{nameFormatter(ensStatus.name)}</p>
        {ensStatus.isEns && (
          <img src={verifiedMark} alt="verified" className="w-3.5 h-3.5" />
        )}
      </span>
      <span className="text-helper-text-sm color-text-secondary whitespace-nowrap">
        {createdAt && dateFormatter(createdAt)}
      </span>
      <div
        className={cn(
          'ml-auto flex items-center gap-1',
          isFocused && canAcceptReject
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100',
        )}
      >
        {canAcceptReject && (
          <>
            <IconButton
              icon="Check"
              variant="ghost"
              size="sm"
              onClick={onAccept}
              title="Accept suggestion"
            />
            <IconButton
              icon="X"
              variant="ghost"
              size="sm"
              onClick={onReject}
              title="Reject suggestion"
            />
          </>
        )}
        {canWithdraw && (
          <IconButton
            icon="X"
            variant="ghost"
            size="sm"
            onClick={onReject}
            title="Withdraw suggestion"
          />
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// RepliesThread — reuses the same collapse/toggle rendering as CommentCard so
// floating suggestion threads stay aligned with regular thread cards.
// ---------------------------------------------------------------------------

const RepliesThread = ({
  thread,
  comment,
  onFocusRequest,
}: {
  thread: ThreadFloatingCardProps['thread'];
  comment: NonNullable<ThreadFloatingCardProps['comment']>;
  onFocusRequest: () => void;
}) => {
  const {
    commentsContainerRef,
    displayedReplies,
    ensStatus,
    handleReplyToggleClick,
    replyToggleLabel,
    shouldShowReplyThread,
    shouldShowReplyToggle,
    shouldShowResolvedMobileReplyCount,
    showAllReplies,
    visibleReplies,
  } = useCommentCard({
    id: comment.id,
    username: comment.username,
    comment: comment.content,
    replies: comment.replies,
    isResolved: comment.resolved,
    isDropdown: true,
    isFocused: thread.isFocused,
    onFocusRequest,
  });

  if (visibleReplies.length === 0) {
    return null;
  }

  return (
    <div ref={commentsContainerRef}>
      <CommentRepliesThread
        id={comment.id}
        displayedReplies={displayedReplies}
        ensStatus={ensStatus}
        handleReplyToggleClick={handleReplyToggleClick}
        isResolved={comment.resolved}
        replyToggleLabel={replyToggleLabel}
        shouldShowReplyThread={shouldShowReplyThread}
        shouldShowReplyToggle={shouldShowReplyToggle}
        shouldShowResolvedMobileReplyCount={shouldShowResolvedMobileReplyCount}
        showAllReplies={showAllReplies}
        visibleReplies={visibleReplies}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// ReplyField — same behavior as ThreadFloatingCard's reply input, scoped here
// ---------------------------------------------------------------------------

const ReplyField = ({
  thread,
  comment,
}: {
  thread: ThreadFloatingCardProps['thread'];
  comment: NonNullable<ThreadFloatingCardProps['comment']>;
}) => {
  const username = useCommentStore((s) => s.username);
  const isConnected = useCommentStore((s) => s.isConnected);
  const handleAddReply = useCommentStore((s) => s.handleAddReply);
  const setCommentDrawerOpen = useCommentStore((s) => s.setCommentDrawerOpen);
  const [replyText, setReplyText] = useState('');
  const [isReplyInputFocused, setIsReplyInputFocused] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canReply = !comment.resolved && !comment.deleted;
  const hasUnsentReply = Boolean(replyText.trim());
  const shouldShowReplyField =
    isConnected && (thread.isFocused || hasUnsentReply);
  const ensStatus = useEnsStatus(username);

  useEffect(() => {
    if (replyTextareaRef.current) {
      resizeInlineCommentTextarea(replyTextareaRef.current);
    }
  }, [replyText]);

  const handleSubmit = () => {
    if (!thread.commentId || !replyText.trim()) return;
    if (!isConnected) {
      setCommentDrawerOpen?.(true);
      return;
    }
    handleAddReply(thread.commentId, replyText);
    setReplyText('');
    setIsReplyInputFocused(false);
  };

  if (!canReply) return null;

  if (thread.isFocused && !isConnected) {
    return <FloatingAuthPrompt />;
  }

  if (!shouldShowReplyField) return null;

  return (
    <div className="group">
      <div
        className={cn(
          'border flex px-[12px] py-[8px] gap-[8px] rounded-[4px]',
          'color-bg-default',
        )}
      >
        <Avatar
          src={
            ensStatus.isEns
              ? EnsLogo
              : `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(
                  ensStatus.name || '',
                )}`
          }
          className="w-[16px] h-[16px]"
        />
        <TextAreaFieldV2
          ref={replyTextareaRef}
          value={replyText}
          onChange={(event) => {
            setReplyText(event.target.value);
            resizeInlineCommentTextarea(event.currentTarget);
          }}
          onFocus={() => setIsReplyInputFocused(true)}
          onBlur={() => setIsReplyInputFocused(false)}
          onInput={(event) => resizeInlineCommentTextarea(event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (!event.shiftKey || event.metaKey)) {
              event.preventDefault();
              handleSubmit();
            }
          }}
          className="color-bg-default w-full text-body-sm color-text-default !p-0 !border-none h-[20px] max-h-[296px] overflow-y-auto no-scrollbar whitespace-pre-wrap"
          placeholder={canReply ? 'Add a reply' : 'Thread resolved'}
          disabled={!canReply}
        />
      </div>
      <div
        className={cn(
          'items-center justify-end gap-2 pt-2',
          hasUnsentReply || isReplyInputFocused ? 'flex' : 'hidden',
        )}
      >
        <Button
          variant="ghost"
          className="w-20 min-w-20"
          onClick={(event) => {
            event.stopPropagation();
            setReplyText('');
            setIsReplyInputFocused(false);
          }}
        >
          <p className="text-body-sm-bold">Cancel</p>
        </Button>
        <Button
          className="w-20 min-w-20"
          disabled={!replyText.trim()}
          onClick={handleSubmit}
        >
          Send
        </Button>
      </div>
    </div>
  );
};
