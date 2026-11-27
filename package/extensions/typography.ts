import StockTypography from '@tiptap/extension-typography';
import { keepInUndoGroup } from './input-rule-undo-group';

export const Typography = StockTypography.extend({
  addInputRules() {
    return keepInUndoGroup(this.parent?.() ?? []);
  },
});
