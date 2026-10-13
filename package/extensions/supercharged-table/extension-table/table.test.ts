import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { getHeadlessExtensions } from '../../../hooks/use-headless-editor';
import { insertCommands } from '../../../utils/insert-commands';

describe.each([1, 2])('insert table (schema v%i)', (schemaVersion) => {
  let editor: Editor;

  afterEach(() => editor?.destroy());

  const setup = (content: string) => {
    editor = new Editor({
      extensions: getHeadlessExtensions({ schemaVersion }),
    });
    editor.commands.setContent(content);
  };

  const textPosition = (text: string) => {
    let position: number | undefined;
    editor.state.doc.descendants((node, pos) => {
      if (position === undefined && node.isText && node.text?.includes(text)) {
        position = pos + node.text.indexOf(text);
      }
    });
    if (position === undefined) throw new Error(`Text not found: ${text}`);
    return position;
  };

  const expectTableAndCaret = () => {
    editor.state.doc.check();
    const tables: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') tables.push(pos);
    });
    expect(tables).toHaveLength(1);
    const table = editor.state.doc.nodeAt(tables[0])!;
    expect(table.childCount).toBe(3);
    expect(table.firstChild?.childCount).toBe(2);
    expect(editor.isActive('tableHeader')).toBe(true);
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$from.parentOffset).toBe(0);
    expect(editor.state.selection.from).toBe(tables[0] + 4);
  };

  it.each([0, 6, 23])(
    'preserves text when inserting at offset %i',
    (offset) => {
      const text = 'Total budget: Rp 150000';
      setup(`<p>${text}</p>`);
      editor.commands.setTextSelection(textPosition(text) + offset);

      insertCommands.table(editor);

      expect(editor.state.doc.textContent).toBe(text);
      expectTableAndCaret();
    },
  );

  it('inserts into an empty paragraph without changing adjacent paragraphs', () => {
    setup('<p>Before</p><p></p><p>After</p>');
    let emptyPosition = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) {
        emptyPosition = pos + 1;
      }
    });
    editor.commands.setTextSelection(emptyPosition);

    insertCommands.table(editor);

    expect(editor.state.doc.textContent).toBe('BeforeAfter');
    expectTableAndCaret();
  });

  it.each([false, true])(
    'replaces only the selected text (backwards: %s)',
    (backwards) => {
      const selected = 'replace this long selected passage '.repeat(5);
      setup(`<p>Keep ${selected}safe</p>`);
      const from = textPosition(selected);
      const to = from + selected.length;
      editor.commands.setTextSelection(
        backwards ? { from: to, to: from } : { from, to },
      );

      insertCommands.table(editor);

      expect(editor.state.doc.textContent).toBe('Keep safe');
      expectTableAndCaret();
    },
  );

  it('inserts after deleting the slash range in the same chain', () => {
    setup('<p>Keep this</p><p>/table</p>');
    const from = textPosition('/table');
    const to = from + '/table'.length;
    editor.commands.setTextSelection(to);

    insertCommands.table(editor, { from, to });

    expect(editor.state.doc.textContent).toBe('Keep this');
    expectTableAndCaret();
  });
});
