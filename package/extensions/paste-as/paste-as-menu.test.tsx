import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import { Selection } from '@tiptap/pm/state';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { PasteAsMenu } from './paste-as-menu';

const IMG = 'https://example.com/pic.png';

// floating-ui positions the menu from DOM rects jsdom does not implement.
const emptyRect = () => new DOMRect(0, 0, 0, 0);
for (const proto of [Range.prototype, Element.prototype]) {
  if (!proto.getClientRects) {
    proto.getClientRects = () => [] as unknown as DOMRectList;
  }
  if (!proto.getBoundingClientRect) proto.getBoundingClientRect = emptyRect;
}

const menuEl = () =>
  [...document.querySelectorAll('p')]
    .find((p) => p.textContent?.trim() === 'Paste as')
    ?.closest('div[style]') as HTMLElement | undefined;

// BubbleMenu detaches its element on hide, so "absent" is hidden too.
const menuVisible = () =>
  menuEl()?.style.visibility === 'visible' ? 'visible' : 'hidden';

const tick = () => new Promise((r) => setTimeout(r, 30));

describe('PasteAsMenu', () => {
  let editor: Editor;
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      extensions: getHeadlessExtensions(),
      textDirection: 'auto',
    });
    editor.commands.setContent('<p>Sources:</p><p></p>');
    render(<PasteAsMenu editor={editor} />);
  });

  afterEach(async () => {
    cleanup();
    await tick(); // let focus()'s requestAnimationFrame settle before destroy
    editor.destroy();
    host.remove();
  });

  const paste = () =>
    act(() => {
      editor.commands.setTextSelection(Selection.atEnd(editor.state.doc).from);
      editor.view.dispatch(
        editor.state.tr
          .insertText(IMG)
          .setMeta('paste', true)
          .setMeta('uiEvent', 'paste'),
      );
    });

  it('shows after pasting an image URL', () => {
    paste();
    expect(menuVisible()).toBe('visible');
  });

  it('stays shown through a meta-only transaction', () => {
    paste();
    act(() => {
      editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
    });
    expect(menuVisible()).toBe('visible');
  });

  // BubbleMenu re-runs shouldShow on a timeout after every editor focus
  // event; the app focuses the view from several effects and node views.
  it('stays shown through an editor focus event', async () => {
    paste();
    await act(async () => {
      editor.view.dom.dispatchEvent(new FocusEvent('focus'));
      await tick();
    });
    expect(menuVisible()).toBe('visible');
  });

  it('stays shown through a focus() that does not move the caret', async () => {
    paste();
    await act(async () => {
      editor.commands.focus();
      await tick();
    });
    expect(menuVisible()).toBe('visible');
  });

  it('comes back after the paste colour clean-up re-selects the range', () => {
    paste();
    const to = editor.state.selection.from;
    act(() => {
      editor
        .chain()
        .setTextSelection({ from: to - IMG.length, to })
        .setColor('')
        .run();
      editor.commands.setTextSelection(to);
    });
    expect(menuVisible()).toBe('visible');
  });

  it('hides once the user types', () => {
    paste();
    act(() => {
      editor.commands.insertContent({ type: 'text', text: ' ' });
    });
    expect(menuVisible()).toBe('hidden');
  });
});
