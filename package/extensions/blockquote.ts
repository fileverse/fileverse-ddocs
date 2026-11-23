import { Blockquote as StockBlockquote } from '@tiptap/extension-blockquote';

// Tiptap 3.26+ binds Backspace to merge the next block into a quote, which
// drops a heading's type in v2. 3.11 bound none, so the core keymap decides.
export const Blockquote = StockBlockquote.extend({
  addKeyboardShortcuts() {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { Backspace, ...rest } = this.parent?.() ?? {};
    return rest;
  },
});
