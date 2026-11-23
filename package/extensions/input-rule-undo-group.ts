import { InputRule } from '@tiptap/core';

// Tiptap 3.34 tags every rule transaction with `inputRule`, and Collaboration
// then calls stopCapturing(), so each text replacement split the undo group.
// 3.11 kept them in one step with the typed text; markdown shortcuts still split.
export const keepInUndoGroup = (rules: InputRule[]): InputRule[] =>
  rules.map(
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
