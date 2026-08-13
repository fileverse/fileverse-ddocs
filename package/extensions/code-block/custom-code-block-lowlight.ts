import CodeBlockLowlight, {
  CodeBlockLowlightOptions,
} from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import CodeBlockNodeView from './components/code-block-node-view';
import { TextSelection } from 'prosemirror-state';

export interface MermaidLimits {
  maxSourceBytes?: number;
  maxRenderMs?: number;
}

export interface CustomCodeBlockLowlightOptions
  extends CodeBlockLowlightOptions {
  mermaidLimits: MermaidLimits;
}

export const CustomCodeBlockLowlight =
  CodeBlockLowlight.extend<CustomCodeBlockLowlightOptions>({
    addOptions() {
      const parent = (this.parent?.() ?? {}) as CodeBlockLowlightOptions;
      return {
        ...parent,
        mermaidLimits: {} as MermaidLimits,
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockNodeView);
    },
    addAttributes() {
      return {
        language: {
          default: 'plaintext',
          parseHTML: (element) => {
            // ddoc's own HTML carries the language on the <pre>.
            const dataLanguage = element.getAttribute('data-language');
            if (dataLanguage) return dataLanguage;
            // Markdown import (markdown-it) instead emits
            // `<code class="language-x">` with no data-language. Read the class
            // so fenced languages — notably `mermaid` — survive the markdown
            // round-trip (paste, file import, Split View) instead of silently
            // degrading to a plaintext code block.
            const codeClass =
              element.querySelector('code')?.getAttribute('class') || '';
            const match = codeClass.match(/language-(\S+)/);
            return match ? match[1] : 'plaintext';
          },
          renderHTML: (attributes) => ({
            'data-language': attributes.language,
          }),
        },
        lineNumbers: {
          default: true,
          parseHTML: (element) =>
            element.hasAttribute('data-line-numbers')
              ? element.getAttribute('data-line-numbers') === 'true'
              : true,
          renderHTML: (attributes) => ({
            'data-line-numbers': String(attributes.lineNumbers),
          }),
        },
        wordWrap: {
          default: false,
          parseHTML: (element) =>
            element.hasAttribute('data-word-wrap')
              ? element.getAttribute('data-word-wrap') === 'true'
              : false,
          renderHTML: (attributes) => ({
            'data-word-wrap': String(attributes.wordWrap),
          }),
        },
        tabSize: {
          default: 2,
          parseHTML: (element) =>
            Number(element.getAttribute('data-tab-size')) || 2,
          renderHTML: (attributes) => ({
            'data-tab-size': String(attributes.tabSize),
          }),
        },
        shouldFocus: {
          default: false,
          parseHTML: (element) =>
            element.hasAttribute('data-should-focus')
              ? element.getAttribute('data-should-focus') === 'true'
              : false,
          renderHTML: (attributes) => ({
            'data-should-focus': String(attributes.shouldFocus),
          }),
        },
        code: {
          default: '',
          parseHTML: (element) => element.textContent || '',
          renderHTML: () => ({}),
        },
      };
    },
    addKeyboardShortcuts() {
      return {
        Tab: () => {
          if (!this.editor.isActive('codeBlock')) return false;
          return this.editor.commands.command(({ tr, state }) => {
            const { selection } = state;
            const { $from, $to } = selection;
            const codeBlockPos = $from.before();
            const codeBlockNode = state.doc.nodeAt(codeBlockPos);
            if (!codeBlockNode || codeBlockNode.type.name !== 'codeBlock')
              return false;

            const tabSize = codeBlockNode.attrs.tabSize || 2;
            const start = $from.pos - codeBlockPos - 1;
            const end = $to.pos - codeBlockPos - 1;
            const text = codeBlockNode.textContent;
            const lines = text.split('\n');

            let charCount = 0;
            let fromLine = 0,
              toLine = 0;
            for (let i = 0; i < lines.length; i++) {
              if (charCount <= start) fromLine = i;
              if (charCount < end) toLine = i;
              charCount += lines[i].length + 1;
            }

            // If cursor is at the start of a line, indent that line
            if (start === charCount - lines[fromLine].length - 1) {
              for (let i = fromLine; i <= toLine; i++) {
                if (lines[i].length === 0) {
                  lines[i] = ' '.repeat(tabSize);
                } else {
                  lines[i] = ' '.repeat(tabSize) + lines[i];
                }
              }
            } else {
              // If cursor is in the middle of a line, insert spaces at cursor position
              const currentLine = lines[fromLine];
              const cursorPos = start - (charCount - currentLine.length - 1);
              lines[fromLine] =
                currentLine.slice(0, cursorPos) +
                ' '.repeat(tabSize) +
                currentLine.slice(cursorPos);
            }

            const newText = lines.join('\n');
            tr.replaceWith(
              codeBlockPos + 1,
              codeBlockPos + 1 + text.length,
              state.schema.text(newText),
            );

            // Adjust cursor position
            const newFrom = $from.pos + tabSize;
            const newTo = $to.pos + tabSize;
            tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));

            return true;
          });
        },
        'Shift-Tab': () => {
          if (!this.editor.isActive('codeBlock')) return false;
          return this.editor.commands.command(({ tr, state }) => {
            const { selection } = state;
            const { $from, $to } = selection;
            const codeBlockPos = $from.before();
            const codeBlockNode = state.doc.nodeAt(codeBlockPos);
            if (!codeBlockNode || codeBlockNode.type.name !== 'codeBlock')
              return false;

            const tabSize = codeBlockNode.attrs.tabSize || 2;
            const start = $from.pos - codeBlockPos - 1;
            const end = $to.pos - codeBlockPos - 1;
            const text = codeBlockNode.textContent;
            const lines = text.split('\n');

            let charCount = 0;
            let fromLine = 0,
              toLine = 0;
            for (let i = 0; i < lines.length; i++) {
              if (charCount <= start) fromLine = i;
              if (charCount < end) toLine = i;
              charCount += lines[i].length + 1;
            }

            // If cursor is at the start of a line, outdent that line
            if (start === charCount - lines[fromLine].length - 1) {
              for (let i = fromLine; i <= toLine; i++) {
                if (lines[i].length === 0) {
                  lines[i] = '';
                } else {
                  // Remove up to tabSize spaces from the start of the line
                  const leadingSpaces = lines[i].match(/^[ ]*/)?.[0] || '';
                  const spacesToRemove = Math.min(
                    tabSize,
                    leadingSpaces.length,
                  );
                  lines[i] = lines[i].slice(spacesToRemove);
                }
              }
            } else {
              // If cursor is in the middle of a line, still outdent from the start
              const currentLine = lines[fromLine];
              const leadingSpaces = currentLine.match(/^[ ]*/)?.[0] || '';
              const spacesToRemove = Math.min(tabSize, leadingSpaces.length);
              lines[fromLine] = currentLine.slice(spacesToRemove);
            }

            const newText = lines.join('\n');
            tr.replaceWith(
              codeBlockPos + 1,
              codeBlockPos + 1 + text.length,
              state.schema.text(newText),
            );

            // Adjust cursor position
            const newFrom = $from.pos - tabSize;
            const newTo = $to.pos - tabSize;
            tr.setSelection(TextSelection.create(tr.doc, newFrom, newTo));

            return true;
          });
        },
        Enter: () => {
          if (!this.editor.isActive('codeBlock')) return false;
          const editor = this.editor;
          const { state } = editor;
          const { selection } = state;
          const { $from, empty } = selection;

          if (!empty || $from.parent.type.name !== 'codeBlock') return false;

          const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2;
          const endsWithDoubleNewline =
            $from.parent.textContent.endsWith('\n\n');

          // Triple-enter exit: delete the two trailing newlines and create a
          // new dBlock after the enclosing dBlock.
          if (isAtEnd && endsWithDoubleNewline) {
            return editor
              .chain()
              .command(({ tr, dispatch }) => {
                if (dispatch) {
                  tr.delete($from.pos - 2, $from.pos);
                }
                return true;
              })
              .command(({ tr, state, dispatch }) => {
                const { $from } = state.selection;
                const dBlockType = state.schema.nodes.dBlock;
                const paragraphType = state.schema.nodes.paragraph;
                if (!paragraphType) return false;

                // Find the block to escape past: the enclosing dBlock in v1,
                // the codeBlock itself in the flat v2 schema. The loop walks
                // deepest-first, so in v1 the (deeper) codeBlock is skipped
                // and the dBlock still wins.
                let boundaryDepth = -1;
                for (let d = $from.depth; d >= 0; d--) {
                  const name = $from.node(d).type.name;
                  if (
                    name === 'dBlock' ||
                    (!dBlockType && name === 'codeBlock')
                  ) {
                    boundaryDepth = d;
                    break;
                  }
                }
                if (boundaryDepth === -1) return false;

                const boundaryEnd = $from.after(boundaryDepth);
                const newBlock = dBlockType
                  ? dBlockType.create(null, paragraphType.create())
                  : paragraphType.create();

                if (dispatch) {
                  tr.insert(boundaryEnd, newBlock);
                  // Cursor at start of the new paragraph: +1 into the
                  // paragraph, +1 more when a dBlock wraps it.
                  tr.setSelection(
                    TextSelection.create(
                      tr.doc,
                      boundaryEnd + (dBlockType ? 2 : 1),
                    ),
                  );
                }
                return true;
              })
              .focus()
              .run();
          }

          // Default: insert a single newline inside the code block.
          return editor.commands.newlineInCode();
        },
        Backspace: () => {
          if (!this.editor.isActive('codeBlock')) return false;
          return this.editor.commands.command(({ tr, state }) => {
            const { selection } = state;
            const { $from, empty } = selection;
            const codeBlockPos = $from.before();
            const codeBlockNode = state.doc.nodeAt(codeBlockPos);
            if (!codeBlockNode || codeBlockNode.type.name !== 'codeBlock')
              return false;

            // If all content is selected and Backspace is pressed, ensure code block remains with a single empty line
            const codeBlockTextLength = codeBlockNode.textContent.length;
            const codeBlockStart = codeBlockPos + 1;
            const codeBlockEnd = codeBlockStart + codeBlockTextLength;

            if (
              !empty &&
              selection.from === codeBlockStart &&
              selection.to === codeBlockEnd
            ) {
              // Replace all content with a single empty line
              tr.replaceWith(
                codeBlockStart,
                codeBlockEnd,
                state.schema.text(''),
              );
              // Set cursor at the start
              tr.setSelection(TextSelection.create(tr.doc, codeBlockStart));
              return true;
            }

            // Allow normal Backspace behavior otherwise
            return false;
          });
        },
      };
    },
  });
