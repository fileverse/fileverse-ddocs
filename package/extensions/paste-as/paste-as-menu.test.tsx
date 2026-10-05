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

  // The menu listens in the capture phase and stops a key it takes, so
  // "reached the editor" tells whether the menu left the key alone.
  const pressOnEditor = (init: KeyboardEventInit) => {
    let reachedEditor = false;
    const onKey = () => {
      reachedEditor = true;
    };
    editor.view.dom.addEventListener('keydown', onKey);
    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ...init,
        }),
      );
    });
    editor.view.dom.removeEventListener('keydown', onKey);
    return { reachedEditor };
  };
  const hasMedia = () =>
    JSON.stringify(editor.getJSON()).includes('resizableMedia');

  it('Enter embeds the image', () => {
    paste();
    expect(pressOnEditor({ key: 'Enter' }).reachedEditor).toBe(false);
    expect(hasMedia()).toBe(true);
  });

  it('leaves modified Enter to the editor', () => {
    paste();
    const { reachedEditor } = pressOnEditor({ key: 'Enter', shiftKey: true });
    expect(reachedEditor).toBe(true);
    expect(hasMedia()).toBe(false);
  });

  // BubbleMenu debounces hiding for a range selection by 250ms, so the key
  // listener outlives the candidate; it must not act or swallow keys then.
  it('does nothing once the selection has moved on, even before it hides', () => {
    paste();
    act(() => {
      editor.commands.setTextSelection({ from: 2, to: 6 });
    });
    const before = editor.getHTML();

    expect(pressOnEditor({ key: 'Escape' }).reachedEditor).toBe(true);
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true }),
      );
    });
    expect(editor.getHTML()).toBe(before);
    expect(pressOnEditor({ key: 'Enter' }).reachedEditor).toBe(true);
    expect(hasMedia()).toBe(false);
  });

  it('hides once the user types', () => {
    paste();
    act(() => {
      editor.commands.insertContent({ type: 'text', text: ' ' });
    });
    expect(menuVisible()).toBe('hidden');
  });
});
