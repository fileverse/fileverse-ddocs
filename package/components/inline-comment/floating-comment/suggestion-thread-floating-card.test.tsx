import { render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IComment } from '../../../extensions/comment';
import type { CommentFloatingThreadCard } from '../context/types';
import { SuggestionThreadFloatingCard } from './suggestion-thread-floating-card';

const mocks = vi.hoisted(() => ({
  state: {
    acceptSuggestion: vi.fn(),
    deleteComment: vi.fn(),
    focusCommentInEditor: vi.fn(),
    focusFloatingCard: vi.fn(),
    handleAddReply: vi.fn(),
    isConnected: false,
    isDDocOwner: true,
    setCommentDrawerOpen: vi.fn(),
    username: 'owner',
  },
}));

vi.mock('@fileverse/ui', () => ({
  Avatar: () => <div />,
  Button: ({ children }: { children: ReactNode }) => (
    <button>{children}</button>
  ),
  IconButton: ({
    icon,
    title,
    ...props
  }: {
    icon: string;
    title?: string;
  } & ComponentProps<'button'>) => (
    <button data-icon={icon} title={title} {...props} />
  ),
  TextAreaFieldV2: () => <textarea />,
  cn: (...values: unknown[]) => values.filter(Boolean).join(' '),
}));

vi.mock('../../../stores/comment-store', () => ({
  useCommentStore: (selector: (state: typeof mocks.state) => unknown) =>
    selector(mocks.state),
}));

vi.mock('../comment-card', () => ({
  CommentRepliesThread: () => null,
}));

vi.mock('../use-comment-card', () => ({
  useCommentCard: () => ({
    commentsContainerRef: { current: null },
    displayedReplies: [],
    ensStatus: { isEns: false, name: 'owner' },
    handleReplyToggleClick: vi.fn(),
    replyToggleLabel: '',
    shouldShowReplyThread: false,
    shouldShowReplyToggle: false,
    shouldShowResolvedMobileReplyCount: false,
    showAllReplies: false,
    visibleReplies: [],
  }),
}));

vi.mock('../use-ens-status', () => ({
  useEnsStatus: (username?: string) => ({
    isEns: false,
    name: username ?? 'Anonymous',
  }),
}));

vi.mock('../suggestion-diff-summary', () => ({
  SuggestionDiffSummary: () => null,
}));

vi.mock('./floating-auth-prompt', () => ({
  FloatingAuthPrompt: () => null,
}));

const comment: IComment = {
  id: 'suggestion-1',
  username: 'author',
  createdAt: new Date('2026-08-27T10:00:00Z'),
  isSuggestion: true,
  suggestionType: 'add',
  suggestedContent: 'Suggested text',
  replies: [],
};

const renderCard = ({
  isFocused,
  isDDocOwner,
  username = 'owner',
}: {
  isFocused: boolean;
  isDDocOwner: boolean;
  username?: string;
}) => {
  mocks.state.isDDocOwner = isDDocOwner;
  mocks.state.username = username;

  const thread: CommentFloatingThreadCard = {
    floatingCardId: 'thread:suggestion-1',
    type: 'thread',
    commentId: 'suggestion-1',
    selectedText: '',
    isFocused,
  };

  render(
    <SuggestionThreadFloatingCard
      thread={thread}
      comment={comment}
      tabName="Tab 1"
      isHidden={false}
      registerCardNode={vi.fn()}
    />,
  );
};

const getActionsContainer = (buttonTitle: string) => {
  const container = screen.getByTitle(buttonTitle).parentElement;
  expect(container).not.toBeNull();
  return container as HTMLElement;
};

describe('SuggestionThreadFloatingCard action visibility', () => {
  beforeEach(() => {
    mocks.state.isDDocOwner = true;
    mocks.state.username = 'owner';
  });

  it('keeps accept and reject actions visible for a focused owner card', () => {
    renderCard({ isFocused: true, isDDocOwner: true });

    const actions = getActionsContainer('Accept suggestion');
    expect(actions.classList.contains('opacity-100')).toBe(true);
    expect(actions.classList.contains('opacity-0')).toBe(false);
    expect(screen.queryByTitle('Reject suggestion')).not.toBeNull();
  });

  it('keeps owner actions hover-gated when the card is not focused', () => {
    renderCard({ isFocused: false, isDDocOwner: true });

    const actions = getActionsContainer('Accept suggestion');
    expect(actions.classList.contains('opacity-0')).toBe(true);
    expect(actions.classList.contains('group-hover:opacity-100')).toBe(true);
  });

  it('keeps author withdraw hover-gated on a focused non-owner card', () => {
    renderCard({
      isFocused: true,
      isDDocOwner: false,
      username: 'author',
    });

    const actions = getActionsContainer('Withdraw suggestion');
    expect(actions.classList.contains('opacity-0')).toBe(true);
    expect(actions.classList.contains('group-hover:opacity-100')).toBe(true);
  });
});
