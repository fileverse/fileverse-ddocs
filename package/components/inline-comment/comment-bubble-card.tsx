/* eslint-disable @typescript-eslint/ban-ts-comment */
import { cn } from '@fileverse/ui';
import { BubbleMenu } from '@tiptap/react/menus';
import { Editor } from '@tiptap/core';
import { useCommentStore } from '../../stores/comment-store';
import { useCommentRefs } from '../../stores/comment-store-provider';
import { CommentDropdown } from './comment-dropdown';
import { useRef, useEffect, useMemo, useState } from 'react';
import { useOnClickOutside } from 'usehooks-ts';

export const CommentBubbleCard = ({
  editor,
  activeCommentId,
  commentDrawerOpen,
  isCollabDocumentPublished,
  disableInlineComment,
}: {
  editor: Editor;
  activeCommentId: string | null;
  commentDrawerOpen: boolean;
  isCollabDocumentPublished: boolean | undefined;
  disableInlineComment?: boolean;
}) => {
  const comments = useCommentStore((s) => s.tabComments);
  const username = useCommentStore((s) => s.username);
  const setIsBubbleMenuSuppressed = useCommentStore(
    (s) => s.setIsBubbleMenuSuppressed,
  );
  const { dropdownRef } = useCommentRefs();
  const disableInlineCommentRef = useRef(disableInlineComment || false);
  const [isReplyViewDismissed, setIsReplyViewDismissed] = useState(false);

  useEffect(() => {
    disableInlineCommentRef.current = disableInlineComment || false;
  }, [disableInlineComment]);

  useOnClickOutside(dropdownRef, (event) => {
    const target = event.target as HTMLElement | null;
    if (target && editor.view.dom.contains(target)) {
      return;
    }

    if (target?.closest('[data-inline-comment-actions-menu]')) {
      return;
    }

    if (!editor.isActive('comment') || isReplyViewDismissed) {
      return;
    }

    setIsReplyViewDismissed(true);
    setIsBubbleMenuSuppressed(true);
  });

  useEffect(() => {
    const handleSelectionUpdate = () => {
      if (isReplyViewDismissed) {
        setIsReplyViewDismissed(false);
      }
    };

    editor.on('selectionUpdate', handleSelectionUpdate);

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, isReplyViewDismissed]);

  const currentComment = comments?.find(
    (comment) => comment.id === activeCommentId,
  );

  const bubbleMenuProps = useMemo(
    () => ({
      shouldShow: ({ editor }: { editor: Editor }) => {
        const isCommentResolved = editor.getAttributes('comment')?.resolved;
        const disabled = disableInlineCommentRef.current;

        const shouldShow =
          (editor.isActive('comment') &&
            !isCommentResolved &&
            isCollabDocumentPublished &&
            !disabled) ??
          false;

        if (shouldShow) {
          const commentId = editor.getAttributes('comment')?.commentId;
          editor.commands.setCommentActive(commentId);
        } else {
          // Unset active state when bubble menu should hide
          editor.commands.unsetCommentActive();
        }

        return shouldShow;
      },
      appendTo: () =>
        document.getElementById('editor-canvas') as HTMLDivElement,
    }),
    [isCollabDocumentPublished],
  );

  return (
    <BubbleMenu
      {...bubbleMenuProps}
      options={{
        offset: {
          mainAxis: 0,
          crossAxis: 20,
        },
        placement: 'bottom',
        strategy: 'fixed',
        flip: {
          fallbackPlacements: ['top'],
        },
        shift: {
          crossAxis: true,
        },
        onHide: () => {
          // Additional safety to ensure active state is removed when menu hides
          editor.commands.unsetCommentActive();
        },
      }}
      editor={editor}
      className={cn(
        'shadow-elevation-4 rounded-lg color-bg-default border color-border-default',
        (commentDrawerOpen || isReplyViewDismissed) && 'hidden',
      )}
    >
      {/* @ts-expect-error ts */}
      <CommentDropdown
        editor={editor}
        activeCommentId={activeCommentId ?? undefined}
        isBubbleMenu={true}
        initialComment={currentComment?.content}
        selectedContent={currentComment?.selectedContent}
        isDisabled={
          currentComment && !Object.hasOwn(currentComment, 'commentIndex')
        }
        isCommentOwner={currentComment?.username === username}
      />
    </BubbleMenu>
  );
};
