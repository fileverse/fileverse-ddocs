import { createRef } from 'react';
import { render } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentFloatingContainer } from './comment-floating-container';

let shouldRender = true;

vi.mock('../use-comment-list-container', () => ({
  useCommentListContainer: () => ({
    floatingCardListContainerRef: { current: null },
    mountedFloatingCards: [],
    registerCardNode: () => {},
    shouldRender,
  }),
}));

vi.mock('../../../stores/comment-store', () => ({
  useCommentStore: () => [],
}));

const renderContainer = (isHidden: boolean, onVisibleChange = vi.fn()) => {
  const result = render(
    <CommentFloatingContainer
      editor={{} as Editor}
      editorWrapperRef={createRef()}
      scrollContainerRef={createRef()}
      tabName="Tab 1"
      isHidden={isHidden}
      onVisibleChange={onVisibleChange}
    />,
  );
  return { ...result, onVisibleChange };
};

beforeEach(() => {
  shouldRender = true;
});

describe('CommentFloatingContainer onVisibleChange', () => {
  it('reports visible when cards render and the column is not hidden', () => {
    const { onVisibleChange } = renderContainer(false);
    expect(onVisibleChange).toHaveBeenLastCalledWith(true);
  });

  it('reports hidden when the drawer hides the column', () => {
    const { onVisibleChange } = renderContainer(true);
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);
  });

  it('reports hidden when there are no cards', () => {
    shouldRender = false;
    const { onVisibleChange } = renderContainer(false);
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);
  });

  it('reports hidden on unmount', () => {
    const { onVisibleChange, unmount } = renderContainer(false);
    unmount();
    expect(onVisibleChange).toHaveBeenLastCalledWith(false);
  });
});
