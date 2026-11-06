import { Editor } from '@tiptap/react';

/**
 * Applies a link's text and URL to the selection. The text keeps the
 * formatting it replaces (or the caret's), except the colour setLink drops.
 */
export const applyLinkWithText = (
  editor: Editor,
  text: string,
  href: string,
) => {
  const { from, to } = editor.state.selection;
  if (from < to && text === editor.state.doc.textBetween(from, to)) {
    const chain = editor.chain().focus().extendMarkRange('link');
    (href ? chain.setLink({ href }) : chain.unsetLink()).run();
    return;
  }
  if (!text) return;
  const end = from + text.length;
  const chain = editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      tr.insertText(text, from, to).removeMark(
        from,
        end,
        state.schema.marks.link,
      );
      return true;
    });
  if (href) chain.setTextSelection({ from, to: end }).setLink({ href });
  chain.setTextSelection(end).run();
};
