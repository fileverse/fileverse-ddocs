import { Editor } from '@tiptap/react';

/**
 * Applies a link's text and URL to the selection. The text keeps the
 * formatting it replaces (or the caret's), so linking never resets font size.
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
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const link = state.schema.marks.link;
      const end = from + text.length;
      tr.insertText(text, from, to).removeMark(from, end, link);
      if (href) tr.addMark(from, end, link.create({ href }));
      return true;
    })
    .run();
};
