import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// Flat-schema (v2) home of "a single space in an empty paragraph opens the
// AI writer". v1 ships the equivalent plugin inside the dBlock extension
// (dblock.ts, gated on hasAvailableModels there too).
export const AiWriterSpaceTrigger = Extension.create({
  name: 'aiWriterSpaceTrigger',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('aiwriter-space-trigger'),
        props: {
          handleTextInput: (view, from, _to, text) => {
            if (text !== ' ') return false;

            const { state, dispatch } = view;
            // Self-disables when the AI writer node is not in the schema.
            if (!state.schema.nodes.aiWriter) return false;

            const { $from } = state.selection;
            const node = $from.node($from.depth);
            if (node?.type?.name !== 'paragraph' || node.textContent !== '') {
              return false;
            }

            // Top-level paragraphs and column cells: the same scope the v1
            // trigger covers via its dBlock-parent check.
            const parentName = $from.node($from.depth - 1)?.type?.name;
            if (parentName !== 'doc' && parentName !== 'column') {
              return false;
            }

            const prevChar = state.doc.textBetween(from - 1, from, '\0');
            if (prevChar === ' ') {
              return false;
            }

            let hasActiveAIWriter = false;
            state.doc.descendants((child) => {
              if (child.type.name === 'aiWriter') {
                hasActiveAIWriter = true;
                return false;
              }
              return true;
            });
            if (hasActiveAIWriter) {
              return false;
            }

            const aiWriterNode = state.schema.nodes.aiWriter.create({
              prompt: '',
              content: '',
              tone: 'neutral',
            });
            dispatch(
              state.tr.replaceRangeWith(
                $from.before(),
                $from.after(),
                aiWriterNode,
              ),
            );
            return true;
          },
        },
      }),
    ];
  },
});
