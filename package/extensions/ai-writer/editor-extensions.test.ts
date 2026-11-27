import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import { aiWriterEditorExtensions } from './editor-extensions';

// The AI writer's inner editor must behave like the document's: ordered list
// `type` only from the attribute, no upstream quote Backspace merge.
describe('AI writer inner editor', () => {
  let editor: Editor | null = null;
  afterEach(() => editor?.destroy());

  const open = (html: string) => {
    editor = new Editor({ extensions: aiWriterEditorExtensions() });
    editor.commands.setContent(html);
    return editor;
  };

  it('uses our OrderedList', () => {
    const e = open(
      '<ol style="list-style-type:lower-alpha"><li><p>one</p></li></ol>',
    );
    expect(e.state.doc.firstChild?.type.name).toBe('orderedList');
    expect(e.state.doc.firstChild?.attrs.type).toBeNull();
  });

  it('uses our Blockquote', () => {
    const e = open('<blockquote><p>q1</p><p>q2</p></blockquote>');
    e.commands.setTextSelection(6);
    expect(e.state.selection.$from.parent.textContent).toBe('q2');
    expect(e.state.selection.$from.parentOffset).toBe(0);
    e.view.someProp('handleKeyDown', (f) =>
      f(e.view, new KeyboardEvent('keydown', { key: 'Backspace' })),
    );
    const quote = e.state.doc.firstChild!;
    expect(quote.type.name).toBe('blockquote');
    expect(quote.childCount).toBe(1);
    expect(quote.textContent).toBe('q1q2');
  });
});
