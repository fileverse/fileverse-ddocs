import { Extension, getNodeType } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { isListItemNode, LIST_TOGGLE_META, refuse, sharedList } from './shared';
import { retypeItems, retypeList } from './retype';
import { toggleOffNested, toggleOffTopLevel } from './toggle-off';
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
      toggleList: (listTypeOrName, itemTypeOrName) => (props) => {
        const { state, tr } = props;
        tr.setMeta(LIST_TOGGLE_META, true);
        const { $from, $to } = state.selection;
        const listType = getNodeType(listTypeOrName, state.schema);
        const itemType = getNodeType(itemTypeOrName, state.schema);

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
        // A NodeSelection of an item ends directly in the list, one past the item.
        const lastIndex =
          $to.depth === shared.depth
            ? Math.max(firstIndex, $to.index(shared.depth) - 1)
            : $to.index(shared.depth);

        if (shared.node.type === listType) {
          if (isListItemNode(parent)) {
            return toggleOffNested(
              props,
              shared,
              firstIndex,
              lastIndex,
              parent,
              itemType,
              itemTypeOrName,
            );
          }
          return toggleOffTopLevel(
            tr,
            shared,
            firstIndex,
            lastIndex,
            state.schema.nodes.dBlock,
          );
        }
        const currentItem = shared.node.firstChild as ProseMirrorNode;
        if (currentItem.type === itemType) {
          return retypeList(tr, shared, listType);
        }
        return retypeItems(
          tr,
          shared,
          firstIndex,
          lastIndex,
          listType,
          itemType,
        );
      },
    };
  },
});
