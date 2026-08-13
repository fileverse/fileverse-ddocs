import { Node, mergeAttributes } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { schemaHasDBlock, wrapBlockNode } from '../../utils/block-schema';

export const MediaCaption = Node.create({
  name: 'mediaCaption',

  content: 'inline*',

  marks: 'link',

  isolating: true,

  selectable: false,

  parseHTML() {
    // figcaption is how styles-mode markdown serializes the caption (inside
    // <figure data-type="resizable-media">) — see the mediaFigure rule.
    return [{ tag: 'div[data-type="media-caption"]' }, { tag: 'figcaption' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'media-caption',
        class: 'media-caption',
      }),
      0,
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { $head } = editor.state.selection;

        // Only handle if we're inside a mediaCaption
        let insideMediaCaption = false;
        for (let d = $head.depth; d > 0; d--) {
          if ($head.node(d).type.name === this.name) {
            insideMediaCaption = true;
            break;
          }
        }
        if (!insideMediaCaption) return false;

        // Find the resizableMedia ancestor and the dBlock that contains it
        let resizableMediaPos = -1;
        let resizableMediaNode = null;
        for (let d = $head.depth; d > 0; d--) {
          const node = $head.node(d);
          if (node.type.name === 'resizableMedia') {
            resizableMediaPos = $head.before(d);
            resizableMediaNode = node;
            break;
          }
        }

        if (!resizableMediaNode || resizableMediaPos === -1) return false;

        const afterMedia = resizableMediaPos + resizableMediaNode.nodeSize;
        const { doc } = editor.state;

        // Check if there's a dBlock after the resizableMedia's parent dBlock
        // The resizableMedia sits inside a dBlock, so afterMedia is the end of the dBlock
        const parentDBlockDepth = (() => {
          for (let d = $head.depth; d > 0; d--) {
            if ($head.node(d).type.name === 'dBlock') return d;
          }
          return -1;
        })();

        if (parentDBlockDepth === -1) {
          // No dBlock ancestor: the flat v2 schema, or v1 edge cases.
          // Caret lands inside the new paragraph: +1 into it, +1 more when a
          // dBlock wrapper is added around it.
          const caretOffset = schemaHasDBlock(editor.schema) ? 2 : 1;
          return editor
            .chain()
            .insertContentAt(
              afterMedia,
              wrapBlockNode(editor.schema, { type: 'paragraph' }),
            )
            .focus(afterMedia + caretOffset)
            .run();
        }

        const dBlockPos = $head.before(parentDBlockDepth);
        const dBlockNode = $head.node(parentDBlockDepth);
        const afterDBlock = dBlockPos + dBlockNode.nodeSize;

        // Check if there's already a node after this dBlock
        if (afterDBlock < doc.content.size) {
          const nextNode = doc.nodeAt(afterDBlock);
          if (nextNode) {
            // Focus into the next block (dBlock paragraph would be at afterDBlock + 2)
            return editor.commands.focus(afterDBlock + 2);
          }
        }

        // No block after — create a new dBlock
        return editor
          .chain()
          .insertContentAt(afterDBlock, {
            type: 'dBlock',
            content: [{ type: 'paragraph' }],
          })
          .focus(afterDBlock + 2)
          .run();
      },

      Backspace: ({ editor }) => {
        const { $head, empty } = editor.state.selection;

        if (!empty) return false;

        // Only handle if we're inside a mediaCaption
        let mediaCaptionDepth = -1;
        for (let d = $head.depth; d > 0; d--) {
          if ($head.node(d).type.name === this.name) {
            mediaCaptionDepth = d;
            break;
          }
        }
        if (mediaCaptionDepth === -1) return false;

        const captionNode = $head.node(mediaCaptionDepth);
        const captionPos = $head.before(mediaCaptionDepth);
        const isAtStart = $head.start(mediaCaptionDepth) === $head.pos;

        // Only remove the caption if it's empty and cursor is at the start
        if (captionNode.textContent === '' && isAtStart) {
          const { tr } = editor.state;
          tr.delete(captionPos, captionPos + captionNode.nodeSize);

          // Find the resizableMedia parent and select it
          for (let d = $head.depth; d > 0; d--) {
            if ($head.node(d).type.name === 'resizableMedia') {
              const mediaPos = $head.before(d);
              tr.setSelection(TextSelection.create(tr.doc, mediaPos));
              break;
            }
          }

          editor.view.dispatch(tr);
          return true;
        }

        return false;
      },
    };
  },
});
