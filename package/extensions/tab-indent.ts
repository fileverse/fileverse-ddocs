import { Extension, type Editor } from '@tiptap/core';

const EM_SPACE = '\u2003';

// Tab/Shift-Tab for both schemas: EM-space indent in headings and
// block-level paragraphs, sink/lift in lists.
export const indentOnTab = (editor: Editor): boolean => {
  const { $from } = editor.state.selection;
  const node = $from.node($from.depth);

  // An active AI autocomplete suggestion owns Tab.
  if (
    typeof document !== 'undefined' &&
    document.querySelector('.autocomplete-suggestion-container') !== null
  ) {
    return false;
  }

  // A block-level paragraph: under dBlock (v1), the top node (v2), or a
  // column (v2; v1 columns hold dBlocks).
  const parent = $from.depth > 0 ? $from.node($from.depth - 1) : null;
  const isBlockParagraph =
    node.type.name === 'paragraph' &&
    (parent?.type.name === 'dBlock' ||
      parent?.type.name === 'column' ||
      parent?.type === editor.schema.topNodeType);

  // Headings and block-level paragraphs indent with an EM space.
  if (node.type.name === 'heading' || isBlockParagraph) {
    editor.commands.insertContent(EM_SPACE, {
      parseOptions: { preserveWhitespace: 'full' },
    });
    return true;
  }

  // List items sink; a first item cannot sink but the key is still consumed
  // so focus never leaves the editor.
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem') {
      editor.commands.sinkListItem(name);
      return true;
    }
  }

  return false;
};

export const outdentOnShiftTab = (editor: Editor): boolean => {
  const { $from } = editor.state.selection;

  if ($from.pos > 0) {
    const before = editor.state.doc.textBetween($from.pos - 1, $from.pos, '\0');
    // One Tab lands as two EM spaces, so one Shift-Tab removes two.
    if (before === EM_SPACE) {
      editor
        .chain()
        .deleteRange({ from: $from.pos - 2, to: $from.pos })
        .run();
      return true;
    }
  }

  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem' || name === 'taskItem') {
      return editor.commands.liftListItem(name);
    }
  }

  return false;
};

export const TabIndent = Extension.create({
  name: 'tabIndent',
  // Above ListItem/TaskItem, whose own Tab would leak to the browser on a
  // first item.
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Tab: () => indentOnTab(this.editor),
      'Shift-Tab': () => outdentOnShiftTab(this.editor),
    };
  },
});
