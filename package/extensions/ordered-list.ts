import { OrderedList as StockOrderedList } from '@tiptap/extension-list';

// Tiptap 3.27+ turns plain-text pastes like `1. a` or `a. x` into lists,
// bypassing our markdown paste handler (TEC-2677). Our handler decides.
export const OrderedList = StockOrderedList.extend({
  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).filter(
      (plugin) => !plugin.props.handlePaste,
    );
  },
});
