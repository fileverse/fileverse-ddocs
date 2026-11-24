import StarterKit from '@tiptap/starter-kit';
import { SuperchargedTableExtensions } from '../supercharged-table/supercharged-table-kit';
import { OrderedList } from '../ordered-list';
import { Blockquote } from '../blockquote';

// The AI writer's inner editor: its HTML is inserted into the doc, so it uses
// our list and quote extensions, not StarterKit's.
export const aiWriterEditorExtensions = () => [
  StarterKit.configure({ orderedList: false, blockquote: false }),
  OrderedList,
  Blockquote,
  ...SuperchargedTableExtensions,
];
