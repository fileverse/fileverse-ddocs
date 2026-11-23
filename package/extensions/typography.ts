import { InputRule } from '@tiptap/core';
import StockTypography from '@tiptap/extension-typography';

// Tiptap 3.34 tags every rule transaction with `inputRule`, and Collaboration
// then calls stopCapturing(), so each smart quote or dash split the undo group.
// 3.11 kept typed text with them in one step; markdown shortcuts still split.
export const Typography = StockTypography.extend({
  addInputRules() {
    return (this.parent?.() ?? []).map(
      (rule) =>
        new InputRule({
          find: rule.find,
          undoable: rule.undoable,
          handler: (props) => {
            const { tr } = props.state;
            const setMeta = tr.setMeta.bind(tr);
            tr.setMeta = (key, value) =>
              key === 'inputRule' ? tr : setMeta(key, value);
            return rule.handler(props);
          },
        }),
    );
  },
});
