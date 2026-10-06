import { fireEvent, render } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeEditor } from '../../../utils/make-editor';
import { useSearchReplaceStore } from '../../../stores/search-replace-store';
import SearchReplace from './search-replace-popover';

const setPlatform = (platform: string) =>
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);

const state = () => useSearchReplaceStore.getState();

describe('find and replace shortcut', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = makeEditor();
    useSearchReplaceStore.setState({
      showSearchReplacePopover: false,
      showReplace: false,
    });
  });

  afterEach(() => {
    editor.destroy();
    vi.restoreAllMocks();
  });

  it('opens with replace shown on Ctrl+H off Mac', () => {
    setPlatform('Win32');
    render(<SearchReplace editor={editor} />);
    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true });
    expect(state().showSearchReplacePopover).toBe(true);
    expect(state().showReplace).toBe(true);
  });

  it('opens with replace shown on Cmd+Shift+H on Mac', () => {
    setPlatform('MacIntel');
    render(<SearchReplace editor={editor} />);
    fireEvent.keyDown(window, { code: 'KeyH', metaKey: true, shiftKey: true });
    expect(state().showSearchReplacePopover).toBe(true);
    expect(state().showReplace).toBe(true);
  });

  it('leaves Ctrl+H and Cmd+H alone on Mac', () => {
    setPlatform('MacIntel');
    render(<SearchReplace editor={editor} />);
    fireEvent.keyDown(window, { code: 'KeyH', ctrlKey: true });
    fireEvent.keyDown(window, { code: 'KeyH', metaKey: true });
    expect(state().showSearchReplacePopover).toBe(false);
  });

  it('does nothing for viewers, who cannot replace', () => {
    setPlatform('Win32');
    render(<SearchReplace editor={editor} viewerMode="view-only" />);
    const event = new KeyboardEvent('keydown', {
      code: 'KeyH',
      ctrlKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(state().showSearchReplacePopover).toBe(false);
  });
});
