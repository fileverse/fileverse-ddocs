import { Editor, Range } from '@tiptap/core';
import { startImageUpload } from './upload-images';
import { validateImageExtension } from './check-image-type';
import { IMG_UPLOAD_SETTINGS } from '../components/editor-utils';
import { IpfsImageUploadResponse } from '../types';
import { caretStyle, filterSplittable } from '../extensions/caret-marks';

type InsertCommand = (editor: Editor, range?: Range) => void;

export type UploadImageOptions = {
  onError?: (errorString: string) => void;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
};

/**
 * File-picker image upload — mirrors the toolbar flow
 * (editor-utils.tsx "Upload Image") and the slash "Image" item.
 */
export const uploadImageCommand = (
  editor: Editor,
  { onError, ipfsImageUploadFn }: UploadImageOptions = {},
) => {
  editor.chain().focus().deleteRange(editor.state.selection).run();
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png, image/jpeg, image/gif, image/svg+xml';
  input.onchange = async () => {
    if (input.files?.length) {
      const file = input.files[0];
      if (!validateImageExtension(file, onError)) {
        return;
      }
      const size = file.size;
      const imgConfig = ipfsImageUploadFn
        ? IMG_UPLOAD_SETTINGS.Extended
        : IMG_UPLOAD_SETTINGS.Base;
      if (size > imgConfig.maxSize) {
        if (onError && typeof onError === 'function') {
          onError(imgConfig.errorMsg);
        }
        return;
      }
      const pos = editor.view.state.selection.from;
      startImageUpload(file, editor.view, pos, ipfsImageUploadFn);
    }
  };
  input.click();
};

/** Start a chain, deleting the slash-command range when invoked from the slash menu. */
const begin = (editor: Editor, range?: Range) => {
  const chain = editor.chain().focus();
  return range ? chain.deleteRange(range) : chain;
};

/**
 * Insert commands shared by the slash menu and `useEditorCommands`.
 * Bodies are moved verbatim from `slash-command-utils.tsx`; the optional
 * `range` only differs when invoked from the slash menu.
 */
export const insertCommands: Record<string, InsertCommand> = {
  callout: (editor, range) => {
    // Captured from the pre-insert state and declared last (spec 3.3): Rule
    // A1 stamps the callout's empty paragraph with it.
    const { $from } = editor.state.selection;
    const style = filterSplittable(
      caretStyle(editor.state, $from.parent.isTextblock ? $from.parent : null),
      editor,
    );
    begin(editor, range)
      .insertContent({
        type: 'callout',
        content: [{ type: 'paragraph', content: [] }],
      })
      .command(({ tr }) => {
        tr.setStoredMarks(style);
        return true;
      })
      .run();
  },
  pageBreak: (editor, range) => {
    begin(editor, range).setPageBreak().run();
  },
  divider: (editor, range) => {
    begin(editor, range).setHorizontalRule().run();
  },
  quote: (editor, range) => {
    begin(editor, range)
      .toggleNode('paragraph', 'paragraph')
      .toggleBlockquote()
      .run();
  },
  code: (editor, range) => {
    begin(editor, range).toggleCode().run();
  },
  codeBlock: (editor, range) => {
    begin(editor, range).toggleCodeBlock().run();
  },
  table: (editor, range) => {
    begin(editor, range)
      .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
      .run();
  },
  // The column commands never consumed the slash range (existing behavior).
  // setColumns places the caret in the first cell within its own
  // transaction; a post-hoc focus(head - 1) here read the PRE-insert
  // selection at chain-build time and aimed at a stale position.
  columns2: (editor) => {
    editor.chain().focus().setColumns(2).run();
  },
  columns3: (editor) => {
    editor.chain().focus().setColumns(3).run();
  },
  bulletList: (editor, range) => {
    begin(editor, range).toggleBulletList().run();
  },
  numberedList: (editor, range) => {
    begin(editor, range).toggleOrderedList().run();
  },
  todoList: (editor, range) => {
    begin(editor, range).toggleTaskList().run();
  },
  video: (editor, range) => {
    begin(editor, range).setActionButton('iframe-video').run();
  },
  mermaid: (editor, range) => {
    begin(editor, range).setCodeBlock({ language: 'mermaid' }).run();
  },
  plainText: (editor, range) => {
    begin(editor, range).setCodeBlock({ language: 'plaintext' }).run();
  },
  tweet: (editor, range) => {
    begin(editor, range).setActionButton('twitter').run();
  },
  soundcloud: (editor, range) => {
    begin(editor, range).setActionButton('iframe-soundcloud').run();
  },
};
