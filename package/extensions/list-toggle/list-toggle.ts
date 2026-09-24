import { Extension, commands as coreCommands } from '@tiptap/core';
import { refuse, rowBlocks, sharedList } from './shared';

const WRAPPABLE = new Set(['paragraph', 'heading']);

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
          // Tasks 2-6 replace this bridge branch by branch.
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
            const { blocks } = rowBlocks(range);
            if (!blocks.every((block) => WRAPPABLE.has(block.node.type.name))) {
              return refuse(tr);
            }
            return delegate();
          }
          return delegate();
        },
    };
  },
});
