import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import MobileToolbar from './mobile-toolbar';
import { makeEditor } from '../utils/make-editor';
import {
  CommentStoreContext,
  createCommentStore,
} from '../stores/comment-store';

// The toolbar only reads refs from the full comment provider.
vi.mock('../stores/comment-store-provider', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useCommentRefs: () => ({}),
}));
import {
  openLinkDialog,
  useLinkDialogStore,
} from '../stores/link-dialog-store';

describe('MobileToolbar link dialog', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('opens when insert.link requests it', () => {
    editor = makeEditor('<p>hello</p>');
    render(
      <CommentStoreContext.Provider value={createCommentStore()}>
        <MobileToolbar
          editor={editor}
          isKeyboardVisible={false}
          isNavbarVisible
          setIsNavbarVisible={() => {}}
        />
      </CommentStoreContext.Provider>,
    );
    expect(screen.queryByPlaceholderText('Paste URL')).toBeNull();
    act(() => openLinkDialog());
    expect(screen.getByPlaceholderText('Paste URL')).toBeTruthy();
    expect(useLinkDialogStore.getState().isLinkDialogRequested).toBe(false);
  });
});
