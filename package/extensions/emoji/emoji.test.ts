import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Emoji } from './emoji';

// emojiSearch now waits on a lazily loaded chunk; hold it open so the
// suggestion can close (or reopen) before the results arrive.
const pending: Array<() => void> = [];
let failLoad = false;
vi.mock('./components/emoji-utils', () => ({
  emojiSearch: () =>
    new Promise((resolve, reject) =>
      pending.push(() =>
        failLoad
          ? reject(new Error('ChunkLoadError'))
          : resolve([{ name: 'smile', emoji: '😄' }]),
      ),
    ),
}));

const popups = () => document.querySelectorAll('[data-tippy-root]').length;
const flush = async () => {
  pending.splice(0).forEach((resolve) => resolve());
  await new Promise((r) => setTimeout(r, 0));
};

describe('emoji suggestion with slow results', () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, Emoji],
    });
  });

  afterEach(() => {
    failLoad = false;
    editor.destroy();
    document.body.innerHTML = '';
  });

  it('opens a popup once results arrive', async () => {
    editor.commands.insertContent('::');
    await flush();
    expect(popups()).toBe(1);
  });

  it('opens no popup when the suggestion closed while loading', async () => {
    editor.commands.insertContent('::');
    editor.commands.clearContent();
    await flush();
    expect(popups()).toBe(0);
  });

  it('keeps one popup when the suggestion reopened while loading', async () => {
    editor.commands.insertContent('::');
    editor.commands.clearContent();
    editor.commands.insertContent('::');
    await flush();
    expect(popups()).toBe(1);
  });

  it('treats a failed data load as no results, without an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    failLoad = true;
    editor.commands.insertContent('::');
    await flush();
    await new Promise((r) => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(document.querySelector('[data-tippy-root]')?.textContent ?? '').toBe(
      '',
    );
  });
});
