import { Extension, commands as coreCommands, getNodeType } from '@tiptap/core';
import { refuse, sharedList } from './shared';
import { wrapRow } from './wrap';

/**
 * One list engine for every trigger and both schemas (docs/LIST_TOGGLE.md).
 * toggleBulletList / toggleOrderedList / toggleTaskList and the Mod-Shift
 * shortcuts all call toggleList, so overriding it catches all of them.
 */
export const ListToggle = Extension.create({
  name: 'listToggle',

  addCommands() {
    return {
      toggleList:
        (listTypeOrName, itemTypeOrName, keepMarks, attributes) => (props) => {
          const { state, tr } = props;
          const { $from, $to } = state.selection;
          const listType = getNodeType(listTypeOrName, state.schema);
          // Tasks 3-6 replace this bridge branch by branch.
          const delegate = () =>
            coreCommands.toggleList(
              listTypeOrName,
              itemTypeOrName,
              keepMarks,
              attributes,
            )(props) || refuse(tr);

          const shared = sharedList($from, $to);
          if (!shared) {
            const range = $from.blockRange($to);
            if (!range) return refuse(tr);
            return (
              wrapRow(tr, range, listType, state.schema.nodes.paragraph) ||
              refuse(tr)
            );
          }
          return delegate();
        },
    };
  },
});
