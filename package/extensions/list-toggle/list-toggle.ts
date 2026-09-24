import { Extension, commands as coreCommands, getNodeType } from '@tiptap/core';
import { isListItemNode, refuse, sharedList } from './shared';
import { toggleOffTopLevel } from './toggle-off';
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
          const parent = $from.node(shared.depth - 1);
          const firstIndex = $from.index(shared.depth);
          const lastIndex = $to.index(shared.depth);

          if (shared.node.type === listType) {
            if (isListItemNode(parent)) return delegate(); // Task 4: toggleOffNested
            return toggleOffTopLevel(
              tr,
              shared,
              firstIndex,
              lastIndex,
              state.schema.nodes.dBlock,
            );
          }
          return delegate(); // Tasks 5-6: retype
        },
    };
  },
});
