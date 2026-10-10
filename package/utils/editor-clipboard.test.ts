import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { runClipboardAction } from './editor-clipboard';

describe.each([1, 2])('editor clipboard (schema v%s)', (schemaVersion) => {
  let editor: Editor;
  let textStart: number;
  beforeEach(() => {
    editor = new Editor({
      extensions: getHeadlessExtensions({ schemaVersion }),
      editorProps: {
        clipboardTextSerializer: (slice) =>
          slice.content.textBetween(0, slice.content.size, '\n\n'),
      },
    });
    editor.commands.setContent('<p><strong>hello</strong> world</p>');
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'hello') textStart = pos;
    });
    editor.commands.setTextSelection({ from: textStart, to: textStart + 5 });
    vi.stubGlobal(
      'ClipboardEvent',
      class extends Event {
        clipboardData: DataTransfer | null;
        constructor(type: string, options?: ClipboardEventInit) {
          super(type);
          this.clipboardData = options?.clipboardData ?? null;
        }
      },
    );
    vi.stubGlobal(
      'DataTransfer',
      class {
        values = new Map<string, string>();
        items = [];
        files = [];
        get types() {
          return [...this.values.keys()];
        }
        setData(type: string, value: string) {
          this.values.set(type, value);
        }
        getData(type: string) {
          return this.values.get(type) ?? '';
        }
      },
    );
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });
  });
  afterEach(() => {
    editor.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const clipboard = (value: object) =>
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value,
    });

  it('copies selected text and deletes it only after a successful cut', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard({ writeText });
    await runClipboardAction(editor, 'copy');
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(editor.state.doc.textContent).toBe('hello world');
    await runClipboardAction(editor, 'cut');
    expect(editor.state.doc.textContent).toBe(' world');
  });

  it('keeps content when clipboard write is denied', async () => {
    clipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) });
    const onError = vi.fn();
    await runClipboardAction(editor, 'cut', onError);
    expect(editor.state.doc.textContent).toBe('hello world');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('does not delete a new selection while clipboard permission is pending', async () => {
    let finish!: () => void;
    clipboard({
      writeText: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });
    const cut = runClipboardAction(editor, 'cut');
    editor.commands.setTextSelection({
      from: textStart + 6,
      to: textStart + 11,
    });
    finish();
    await cut;
    expect(editor.state.doc.textContent).toBe('hello world');
  });

  it('pastes literal text with line breaks without interpreting HTML', async () => {
    clipboard({ readText: vi.fn().mockResolvedValue('<b>literal</b>\nnext') });
    await runClipboardAction(editor, 'pasteWithoutFormatting');
    expect(editor.getText()).toContain('<b>literal</b>');
    expect(editor.getJSON().content).toHaveLength(2);
  });

  it('does not paste into a selection changed during clipboard read', async () => {
    let finish!: (text: string) => void;
    clipboard({
      readText: () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    });
    const paste = runClipboardAction(editor, 'pasteWithoutFormatting');
    editor.commands.setTextSelection(textStart + 11);
    finish('replacement');
    await paste;
    expect(editor.state.doc.textContent).toBe('hello world');
  });

  it('never cuts or pastes in a read-only editor', async () => {
    const writeText = vi.fn();
    const readText = vi.fn();
    clipboard({ writeText, readText });
    editor.setEditable(false);
    await runClipboardAction(editor, 'cut');
    await runClipboardAction(editor, 'paste');
    expect(writeText).not.toHaveBeenCalled();
    expect(readText).not.toHaveBeenCalled();
    expect(editor.state.doc.textContent).toBe('hello world');
  });

  it('keeps rich HTML when pasting through the normal paste pipeline', async () => {
    clipboard({
      read: vi.fn().mockResolvedValue([
        {
          types: ['text/html', 'text/plain'],
          getType: async (type: string) => ({
            text: async () =>
              type === 'text/html' ? '<p><em>rich text</em></p>' : 'rich text',
          }),
        },
      ]),
    });
    await runClipboardAction(editor, 'paste');
    expect(editor.getText()).toContain('rich text');
    expect(editor.view.dom.querySelector('em')?.textContent).toBe('rich text');
  });

  it('reports clipboard read rejection without changing content', async () => {
    clipboard({ read: vi.fn().mockRejectedValue(new Error('denied')) });
    const onError = vi.fn();
    await runClipboardAction(editor, 'paste', onError);
    expect(editor.state.doc.textContent).toBe('hello world');
    expect(onError).toHaveBeenCalledOnce();
  });
});
