/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import React, { useState, useEffect, useRef } from 'react';
import {
  Button,
  cn,
  DynamicDropdown,
  IconButton,
  LucideIcon,
  TextAreaFieldV2,
  Tooltip,
} from '@fileverse/ui';
import { CommentCard } from './comment-card';
import { CommentDropdownProps } from './types';
import { useCommentStore } from '../../stores/comment-store';
import { useCommentRefs } from '../../stores/comment-store-provider';
import { useCommentDraftAutoSubmitCountdown } from './use-comment-draft-auto-submit-countdown';

export const CommentDropdown = ({
  activeCommentId,
  isBubbleMenu = false,
  isDisabled,
  isCommentOwner,
}: CommentDropdownProps) => {
  const [reply, setReply] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(true);
  const commentsContainerRef = useRef<HTMLDivElement>(null);

  const activeDraftId = useCommentStore((s) => s.activeDraftId);
  const activeDraft = useCommentStore((s) =>
    s.activeDraftId ? (s.inlineDrafts[s.activeDraftId] ?? null) : null,
  );
  const activeComments = useCommentStore((s) => s.activeComments);
  const activeComment = useCommentStore((s) => s.activeComment);
  const selectedText = useCommentStore((s) => s.selectedText);
  const isCommentActive = useCommentStore((s) => s.isCommentActive);
  const handleAddReply = useCommentStore((s) => s.handleAddReply);
  const editRequest = useCommentStore((s) => s.editRequest);
  const clearEditRequest = useCommentStore((s) => s.clearEditRequest);
  const replyEditTarget = useCommentStore((s) => s.replyEditTarget);
  const setReplyEditTarget = useCommentStore((s) => s.setReplyEditTarget);
  const cancelReplyEdit = useCommentStore((s) => s.cancelReplyEdit);
  const editCompletion = useCommentStore((s) => s.editCompletion);
  const editCommentContent = useCommentStore((s) => s.editCommentContent);
  const editReplyContent = useCommentStore((s) => s.editReplyContent);
  const resolveComment = useCommentStore((s) => s.resolveComment);
  const unresolveComment = useCommentStore((s) => s.unresolveComment);
  const deleteComment = useCommentStore((s) => s.deleteComment);
  const isDDocOwner = useCommentStore((s) => s.isDDocOwner);
  const isConnected = useCommentStore((s) => s.isConnected);
  const setCommentDrawerOpen = useCommentStore((s) => s.setCommentDrawerOpen);
  const submitInlineDraft = useCommentStore((s) => s.submitInlineDraft);
  const updateInlineDraftText = useCommentStore((s) => s.updateInlineDraftText);
  const { dropdownRef } = useCommentRefs();

  const emptyComment =
    !activeComment?.content &&
    !activeComment?.username &&
    !activeComment?.createdAt;
  const isEditingThisThread = replyEditTarget?.commentId === activeCommentId;
  const isSendDisabled = Boolean(
    isDisabled ||
      activeComment?.resolved ||
      !reply.trim() ||
      (isEditingThisThread &&
        reply.trim() === (replyEditTarget?.originalText ?? '').trim()),
  );

  const handleReplyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setReply(value);
  };

  // Reuse the existing outside-close handlers.
  const handleCancel = () => {
    if (typeof document === 'undefined') {
      return;
    }

    // Run after the button click, then fire the same outside events.
    window.setTimeout(() => {
      // The popover layer closes on pointerdown outside.
      document.body.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true }),
      );
      // Our outside-click hooks listen for mousedown.
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
    }, 0);
  };

  const handleClick = () => {
    if (!activeDraftId || !activeDraft?.text.trim()) {
      return;
    }

    // Bubble-menu submit should reuse the same draft path as the drawer and
    // the floating comments.
    submitInlineDraft(activeDraftId);
    handleCancel();
  };
  const { handleDraftBlur, handleDraftFocus, submitLabel } =
    useCommentDraftAutoSubmitCountdown({
      draftId: activeDraftId,
      canAutoSubmit:
        isConnected &&
        Boolean(activeDraftId) &&
        Boolean(activeDraft?.text.trim()),
      onSubmit: handleClick,
    });

  const handleReplySubmit = () => {
    if (!isConnected) {
      setCommentDrawerOpen(true);
      return;
    }

    if (reply.trim() && activeCommentId) {
      if (replyEditTarget?.commentId === activeCommentId) {
        if (replyEditTarget.kind === 'comment') {
          editCommentContent(replyEditTarget.commentId, reply);
        } else if (replyEditTarget.replyId) {
          editReplyContent(
            replyEditTarget.commentId,
            replyEditTarget.replyId,
            reply,
          );
        }

        setReply('');
        cancelReplyEdit();
        return;
      }

      handleAddReply(activeCommentId, reply);
      setReply('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (Boolean(activeCommentId) && isBubbleMenu) {
        handleReplySubmit();
      } else {
        handleClick();
      }
    }
  };

  const handleEllipsisClick = () => {
    setIsDropdownOpen((prev) => !prev);
  };

  const handleDeleteThread = () => {
    deleteComment(activeCommentId as string);
  };

  useEffect(() => {
    if (commentsContainerRef.current && activeComment?.replies) {
      commentsContainerRef.current.scrollTo({
        top: commentsContainerRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [activeComment?.replies]);

  useEffect(() => {
    setReply('');
    cancelReplyEdit();
  }, [activeCommentId, cancelReplyEdit]);

  useEffect(() => {
    if (!editRequest || !activeCommentId) {
      return;
    }

    if (editRequest.commentId !== activeCommentId) {
      return;
    }

    setReply(editRequest.text);
    setReplyEditTarget({
      kind: editRequest.kind,
      commentId: editRequest.commentId,
      replyId: editRequest.replyId,
      originalText: editRequest.text,
    });
    clearEditRequest(editRequest.requestId);
  }, [activeCommentId, clearEditRequest, editRequest, setReplyEditTarget]);

  useEffect(() => {
    if (!editCompletion || !activeCommentId) {
      return;
    }

    if (editCompletion.commentId !== activeCommentId) {
      return;
    }

    setReply('');
    cancelReplyEdit();
  }, [activeCommentId, cancelReplyEdit, editCompletion]);

  const renderInitialView = () => (
    <div className="p-3 flex flex-col gap-2 color-bg-secondary rounded-md">
      <TextAreaFieldV2
        data-testid="comment-dropdown-input"
        value={activeDraft?.text || ''}
        onChange={(event) => {
          if (activeDraftId) {
            // Keep draft text in the shared store so auth handoff and location
            // changes do not lose inline new-comment state.
            updateInlineDraftText(activeDraftId, event.target.value);
          }
        }}
        onFocus={handleDraftFocus}
        onBlur={handleDraftBlur}
        onKeyDown={handleKeyDown}
        className="color-bg-default w-full text-body-sm color-text-default min-h-[40px] overflow-y-auto no-scrollbar px-3 py-2 whitespace-pre-wrap"
        placeholder="Type your comment"
        autoFocus
      />

      <div className="h-full flex items-center gap-[20px] justify-end">
        <Button
          onClick={handleCancel}
          className="!w-[80px] !min-w-[80px]"
          variant={'ghost'}
        >
          Cancel
        </Button>
        <Button
          data-testid="comment-dropdown-send"
          onClick={handleClick}
          className="px-4 py-2 min-w-[96px] h-9 font-medium text-sm"
          disabled={!activeDraft?.text.trim()}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );

  const renderReplyView = () => (
    <>
      <div className="flex justify-between items-center px-3 py-2 border-b color-border-default">
        <p className="text-sm font-medium color-text-default">
          Highlighted Comments ({activeComments.length})
        </p>
        <div className="relative flex items-center gap-1">
          {(isDDocOwner || isCommentOwner) && !emptyComment && (
            <Tooltip
              text={isDisabled ? 'Available in a moment' : ''}
              sideOffset={0}
              position="top"
            >
              <DynamicDropdown
                key="more-actions"
                align="end"
                sideOffset={4}
                anchorTrigger={
                  <IconButton
                    onClick={handleEllipsisClick}
                    icon={'Ellipsis'}
                    variant="ghost"
                    disabled={isDisabled}
                    className={cn({
                      '!bg-transparent': isDisabled,
                    })}
                  />
                }
                content={
                  isDropdownOpen ? (
                    <div
                      className="flex flex-col gap-1 p-2 w-40 shadow-elevation-3"
                      data-inline-comment-actions-menu
                    >
                      <button
                        data-testid="comment-delete-btn"
                        className="flex items-center color-text-danger text-sm font-medium gap-2 rounded p-2 transition-all hover:color-bg-default-hover w-full"
                        onClick={handleDeleteThread}
                        onTouchEnd={handleDeleteThread}
                      >
                        <LucideIcon name="Trash2" size="sm" />
                        Delete thread
                      </button>
                    </div>
                  ) : null
                }
              />

              <Tooltip
                text={
                  !isDisabled
                    ? activeComment?.resolved
                      ? 'Unresolve'
                      : 'Resolve'
                    : ''
                }
                sideOffset={5}
                position="bottom"
              >
                <IconButton
                  data-testid={
                    activeComment?.resolved
                      ? 'comment-unresolve-btn'
                      : 'comment-resolve-btn'
                  }
                  icon={
                    activeComment?.resolved ? 'CircleCheck2' : 'CircleCheck'
                  }
                  variant="ghost"
                  disabled={isDisabled}
                  className={cn({
                    '!bg-transparent': isDisabled,
                  })}
                  onClick={() =>
                    activeComment?.resolved
                      ? unresolveComment(activeCommentId as string)
                      : resolveComment(activeCommentId as string)
                  }
                />
              </Tooltip>
            </Tooltip>
          )}
        </div>
      </div>

      <div
        ref={commentsContainerRef}
        className="max-h-[calc(100vh-350px)] overflow-y-auto no-scrollbar"
      >
        <CommentCard
          username={activeComment?.username}
          selectedContent={activeComment?.selectedContent || selectedText}
          comment={activeComment?.content}
          createdAt={activeComment?.createdAt}
          replies={activeComment?.replies}
          isResolved={activeComment?.resolved}
          isDropdown
          isDisabled={
            activeComment && !Object.hasOwn(activeComment, 'commentIndex')
          }
          version={activeComment?.version}
          emptyComment={emptyComment}
        />
      </div>

      <div className="color-bg-secondary border-t color-border-default p-3 rounded-b">
        <TextAreaFieldV2
          value={reply}
          onChange={handleReplyChange}
          onKeyDown={handleKeyDown}
          className="color-bg-default text-body-sm color-text-default min-h-[40px] overflow-y-auto no-scrollbar px-3 py-2 whitespace-pre-wrap"
          placeholder={isDisabled ? 'Available in a moment' : 'Reply'}
          autoFocus
          disabled={activeComment?.resolved || isDisabled || emptyComment}
        />

        <div className="h-full flex justify-end pt-2">
          <Button
            onClick={handleCancel}
            className="!w-[80px] !min-w-[80px]"
            variant={'ghost'}
          >
            Cancel
          </Button>
          <Button
            onClick={handleReplySubmit}
            className="px-4 py-2 w-20 min-w-20 h-9"
            disabled={isSendDisabled}
          >
            Send
          </Button>
        </div>
      </div>
    </>
  );

  const renderDropdownWrapper = (children: React.ReactNode) => (
    <div
      ref={dropdownRef}
      data-testid="comment-dropdown"
      className="w-[300px] color-bg-default shadow-elevation-4 ddoc-md:shadow-none rounded-md select-text"
    >
      {children}
    </div>
  );

  if (isBubbleMenu) {
    return isCommentActive ? renderDropdownWrapper(renderReplyView()) : null;
  }

  return !isCommentActive ? renderDropdownWrapper(renderInitialView()) : null;
};
