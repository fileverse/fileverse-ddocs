import { Document as TiptapDocument } from '@tiptap/extension-document';

export const Document = TiptapDocument.extend({
  content: '(dBlock|columns|pageBreak)+',
});

// Schema v2: blocks sit directly under doc, no dBlock wrapper.
// pageBreak and columns are listed explicitly because their groups are
// 'pageBreak' and 'columns', not 'block'.
export const FlatDocument = TiptapDocument.extend({
  content: '(block|columns|pageBreak)+',
});

export default Document;
