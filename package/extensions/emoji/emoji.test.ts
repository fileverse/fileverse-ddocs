import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Emoji } from './emoji';

// emojiSearch now waits on a lazily loaded chunk; hold it open so the
// suggestion can close (or reopen) before the results arrive.
const pending: Array<() => void> = [];
vi.mock('./components/emoji-utils', () => ({
  emojiSearch: () =>
    new Promise((resolve) =>
      pending.push(() => resolve([{ name: 'smile', emoji: '😄' }])),
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
});
