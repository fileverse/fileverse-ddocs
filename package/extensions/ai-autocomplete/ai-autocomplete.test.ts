import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

const generate = vi.fn(async () => ({ response: ' more words' }));
vi.mock('ollama/browser', () => ({
  Ollama: class {
    generate = generate;
  },
}));

import { AiAutocomplete } from './ai-autocomplete';

const makeEditor = (paginationEnabled: boolean | null) => {
  const extensions = [
    StarterKit,
    AiAutocomplete.configure({
      model: { modelName: 'm' },
      isEnabled: true,
      typingDebounceTime: 10,
    }),
  ];
  if (paginationEnabled !== null) {
    extensions.push(
      Extension.create({
        name: 'pagination',
        addStorage: () => ({ enabled: paginationEnabled }),
      }) as never,
    );
  }
  return new Editor({ extensions, content: '<p>Hello world</p>' });
};

const typeKey = (editor: Editor) => {
  editor.commands.focus('end');
  editor.view.someProp('handleKeyDown', (f) =>
    f(editor.view, new KeyboardEvent('keydown', { key: 'a' })),
  );
};

describe('AiAutocomplete in Pages mode', () => {
  let editor: Editor;
  beforeEach(() => {
    vi.useFakeTimers();
    generate.mockClear();
  });
  afterEach(() => {
    editor.destroy();
    vi.useRealTimers();
  });

  it('fetches when pagination is absent', async () => {
    editor = makeEditor(null);
    typeKey(editor);
    await vi.advanceTimersByTimeAsync(50);
    expect(generate).toHaveBeenCalled();
  });

  it('fetches when pagination is disabled', async () => {
    editor = makeEditor(false);
    typeKey(editor);
    await vi.advanceTimersByTimeAsync(50);
    expect(generate).toHaveBeenCalled();
  });

  it('never fetches while pagination is enabled', async () => {
    editor = makeEditor(true);
    typeKey(editor);
    await vi.advanceTimersByTimeAsync(50);
    expect(generate).not.toHaveBeenCalled();
  });
});
