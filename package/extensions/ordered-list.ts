import type { Attributes } from '@tiptap/core';
import { OrderedList as StockOrderedList } from '@tiptap/extension-list';

// Tiptap 3.27+ turns plain-text pastes like `1. a` or `a. x` into lists,
// bypassing our markdown paste handler (TEC-2677). Our handler decides.
export const OrderedList = StockOrderedList.extend({
  addAttributes() {
    const parent: Attributes = this.parent?.() ?? {};
    return {
      ...parent,
      // 3.11 read only the `type` attribute; 3.34 also maps CSS
      // `list-style-type`, storing a type we render as `1.` anyway.
      type: {
        ...parent.type,
        parseHTML: (element: HTMLElement) => element.getAttribute('type'),
      },
    };
  },

  addProseMirrorPlugins() {
    return (this.parent?.() ?? []).filter(
      (plugin) => !plugin.props.handlePaste,
    );
  },
});
