import { Extension, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { canJoin } from '@tiptap/pm/transform';

const JOINABLE_LISTS = ['bulletList', 'orderedList', 'taskList'];

// Parity with Tiptap's Notion-like template, which ships a template-private
// `listNormalization` extension doing exactly this (verified live against
// their running editor): pressing Backspace on an EMPTY top-level block that
// sits between two lists of the same type removes the block and joins the
// lists into one. `[one, two, three]  ␣  [four, five]` → Backspace →
// `[one, two, three, four, five]`, caret at the end of "three".
//
// Deliberately a KEYMAP, not an appendTransaction invariant: the template
// behaves identically (a programmatic delete of the middle block leaves two
// adjacent lists in ITS doc too — their Simple Editor keeps them separate
// forever), and an invariant would also fight collab-applied edits and undo
// grouping. Everything that doesn't match the exact pattern falls through to
// stock Backspace behavior.
export const joinListsAroundEmptyBlock = (editor: Editor): boolean => {
  const { state, view } = editor;
  const { selection } = state;
  if (!selection.empty) return false;

  const { $from } = selection;
  if (
    $from.depth !== 1 ||
    !$from.parent.isTextblock ||
    $from.parent.content.size > 0
  ) {
    return false;
  }

  const { doc } = state;
  const index = $from.index(0);
  if (index === 0 || index >= doc.childCount - 1) return false;

  const before = doc.child(index - 1);
  const after = doc.child(index + 1);
  if (
    before.type !== after.type ||
    !JOINABLE_LISTS.includes(before.type.name)
  ) {
    return false;
  }

  const from = $from.before(1);
  const to = $from.after(1);
  const tr = state.tr.delete(from, to);
  // After the deletion the two lists meet exactly at `from`.
  if (!canJoin(tr.doc, from)) return false;
  tr.join(from);
  tr.setSelection(TextSelection.near(tr.doc.resolve(from), -1));
  tr.scrollIntoView();
  view.dispatch(tr);
  return true;
};

export const ListNormalization = Extension.create({
  name: 'listNormalization',

  addKeyboardShortcuts() {
    return {
      Backspace: () => joinListsAroundEmptyBlock(this.editor),
    };
  },
});
