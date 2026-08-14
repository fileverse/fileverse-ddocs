/* eslint-disable react-refresh/only-export-components */
/* eslint-disable @typescript-eslint/no-explicit-any */

import React, {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { List, type RowComponentProps } from 'react-window';
import { ensureLoaded } from '../utils/font-loader';
import type { FontDescriptor } from '../types';
import { IEditorTool, useEditorToolVisiibility } from '../hooks/use-visibility';
import { Editor, JSONContent } from '@tiptap/react';
import type { EditorProps } from '@tiptap/pm/view';
import { useEditorCommands } from '../hooks/use-editor-commands';
import { startImageUpload } from '../utils/upload-images';
import cn from 'classnames';
import UtilsModal from './utils-modal';
import {
  Carousel,
  CarouselContent,
  CarouselIndicator,
  CarouselItem,
} from '../common/carousel';
import {
  Button,
  DropdownMenuItem,
  IconButton,
  LucideIcon,
  TextAreaFieldV2,
  TextField,
  Tooltip,
  useTheme,
} from '@fileverse/ui';
import { useMediaQuery } from 'usehooks-ts';
import { colors, textColors } from '../utils/colors';
import { validateImageExtension } from '../utils/check-image-type';
import { handleContentPrint } from '../utils/handle-print';
import { useCommentRefs } from '../stores/comment-store-provider';
import {
  convertListToParagraphs,
  convertToList,
} from './editor-bubble-menu/node-selector';
import { searchForSecureImageNodeAndEmbedImageContent } from '../extensions/mardown-paste-handler';
import { renderMermaidBlocks } from '../extensions/code-block/render-mermaid-html';
import { inlineLoader } from '../utils/inline-loader';
import { IpfsImageFetchPayload, IpfsImageUploadResponse } from '../types';
import { getTemporaryEditor } from '../utils/helpers';
import { extractTitleFromContent } from '../utils/extract-title-from-content';
import { getContrastColor } from '../utils/color-utils';
import { parseHeadingLink } from '../utils/heading-link';
import { setShowReplacePopoverWithData } from '../extensions/search-replace/utils';

export interface IEditorToolElement {
  icon: any;
  title: string;
  onClick: (name?: string) => void;
  isActive: boolean;
  group?: string;
  isNew?: boolean;
  subtitle?: string;
  notVisible?: number;
  disabled?: boolean;
}

const fontStack = {
  Arial: 'Arial, Arial, Helvetica, sans-serif',
  Calibri: 'Calibri, sans-serif',
  'Comic Sans MS': 'Comic Sans MS, Comic Sans',
  Cursive: 'Cursive',
  Georgia: 'Georgia, serif',
  Impact: 'Impact, Charcoal, sans-serif',
  'Lucida Grande': 'Lucida Sans Unicode, Lucida Grande, sans-serif',
  Monospace: 'monospace',
  Palatino: 'Palatino Linotype, Book Antiqua, Palatino, serif',
  Serif: 'serif',
  'Times New Roman': 'Times New Roman, serif',
  'Trebuchet MS': 'Trebuchet MS, sans-serif',
  Verdana: 'Verdana, Geneva, sans-serif',
};

type PickerEntry = {
  title: string;
  value: string;
  command: (editor: Editor) => void;
  preview?: React.ReactNode;
};

export const baselineFonts: PickerEntry[] = [
  {
    title: 'Default',
    value: 'default',
    command: (editor: Editor) => {
      editor.chain().focus().unsetFontFamily().run();
    },
  },
  ...Object.entries(fontStack).map<PickerEntry>(([key, value]) => ({
    title: key,
    value,
    command: (editor: Editor) => {
      editor.chain().focus().setFontFamily(value).run();
    },
  })),
];

export function buildPickerEntries(
  consumerFonts: FontDescriptor[],
): PickerEntry[] {
  const consumerEntries: PickerEntry[] = consumerFonts.map((f) => ({
    title: f.name,
    value: f.family,
    preview: f.preview,
    command: (editor: Editor) => {
      editor.chain().focus().setFontFamily(f.family).run();
    },
  }));
  const byValue = new Map<string, PickerEntry>();
  for (const e of baselineFonts) byValue.set(e.value, e);
  for (const e of consumerEntries) byValue.set(e.value, e);

  // Sort baseline + consumer fonts together A–Z by title, but keep "Default"
  // pinned at the top since it's the unset action, not a font.
  return [...byValue.values()].sort((a, b) => {
    if (a.value === 'default') return -1;
    if (b.value === 'default') return 1;
    return a.title.localeCompare(b.title);
  });
}

// Font-size / line-height helpers moved to utils/typography (re-exported
// here for backward compatibility).
export * from '../utils/typography';
import { getFontSizeOptions, getLineHeightOptions } from '../utils/typography';

export const ERR_MSG_MAP = {
  IMAGE_SIZE: 'Image size should be less than 10MB',
};

export const IMG_UPLOAD_SETTINGS = {
  Extended: {
    maxSize: 1024 * 1024 * 10,
    errorMsg: 'Image size should be less than 10MB',
  },
  Base: {
    maxSize: 1024 * 100,
    errorMsg: 'Image size should be less than 100kb',
  },
};

/**
 * `Editor#setOptions({ editorProps })` replaces the whole `editorProps`
 * object rather than merging it — tiptap merges top-level options but
 * swaps nested objects like `editorProps` wholesale. Calling
 * `editor.setOptions({ editorProps: { handleKeyDown } })` directly would
 * silently discard everything else already configured on `editorProps`:
 * `attributes` (including classes set at construction time, e.g.
 * `main-doc-editor` from `DdocEditorProps`), `clipboardTextSerializer`,
 * and the `handleDOMEvents` wired in `use-tab-editor.tsx`. Always patch
 * `editorProps` through this helper instead of calling
 * `editor.setOptions({ editorProps: ... })` directly.
 */
export const mergeEditorProps = (
  editor: Editor,
  patch: Partial<EditorProps>,
) => {
  editor.setOptions({
    editorProps: {
      ...editor.options.editorProps,
      ...patch,
    },
  });
};

export const useEditorToolbar = ({
  editor,
  onError,
  isPresentationMode,
  setIsPresentationMode,
  enableCollaboration,
  ipfsImageUploadFn,
  onMarkdownExport,
  onMarkdownImport,
  onPdfExport,
  onHtmlExport,
  onTxtExport,
  onOdtExport,
  ipfsImageFetchFn,
  onDocxImport,
  fetchV1ImageFn,
}: {
  editor: Editor | null;
  isPresentationMode?: boolean;
  setIsPresentationMode?: () => void;
  enableCollaboration?: boolean;
  onError?: (errorString: string) => void;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  onMarkdownExport?: () => void;
  onMarkdownImport?: () => void;
  onPdfExport?: () => void;
  onHtmlExport?: () => void;
  onTxtExport?: () => void;
  onOdtExport?: () => void;
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  onDocxImport?: () => void;
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
  isConnected?: boolean;
}) => {
  const {
    ref: toolRef,
    toolVisibility,
    setToolVisibility,
  } = useEditorToolVisiibility(IEditorTool.NONE);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [fileExportsOpen, setFileExportsOpen] = useState(false);

  const { buttonRef } = useCommentRefs();

  // Single source of truth for editor-derived state: the same reactive
  // command registry the second-level nav consumes. It re-renders this hook's
  // consumer only when a derived value changes (deep-equality gated inside
  // useEditorCommands), covering mark changes that don't move the selection
  // (toolbar buttons, shortcuts) — which a selectionUpdate listener misses.
  // Only the state side is consumed here; onClick dispatches are unchanged.
  const editorCommands = useEditorCommands(editor);

  useEffect(() => {
    if (!editor) return;

    // Add keyboard shortcuts to the editor's keymap
    mergeEditorProps(editor, {
      handleKeyDown: (_, event) => {
        // Strikethrough shortcut (Ctrl + Shift + X for Windows/Linux | Cmd + Shift + X for Mac)
        if (
          (event.ctrlKey && event.shiftKey && event.code === 'KeyX') ||
          (event.metaKey && event.shiftKey && event.code === 'KeyX')
        ) {
          event.preventDefault();
          editor.chain().focus().toggleStrike().run();
          return true;
        }

        // Open link popup (Alt/Option + Enter)
        if ((event.altKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          setToolVisibility(IEditorTool.LINK_POPUP);
          return true;
        }

        // Inline comment shortcut (Shift + Cmd + M for Mac, Ctrl + Alt + m for others)
        if (
          (navigator.platform.includes('Mac')
            ? event.shiftKey && event.metaKey
            : (event.ctrlKey || event.metaKey) && event.altKey) &&
          event.key.toLowerCase() === 'm'
        ) {
          event.preventDefault();

          // First check if there's text selected
          const { state } = editor;
          const { from, to } = state.selection;
          const selectedText = state.doc.textBetween(from, to, ' ');

          if (selectedText) {
            editor
              .chain()
              .setHighlight({
                color: 'var(--color-inline-comment)',
              })
              .run();

            if (buttonRef.current) {
              buttonRef.current.click();
            }
          }
          return true;
        }

        // Line height increase shortcut (Alt + Shift + ↑)
        if (event.altKey && event.shiftKey && event.key === 'ArrowUp') {
          event.preventDefault();
          const lineHeights = ['120%', '138%', '180%', '240%', '300%', '360%'];

          // Get line height from current block node
          let currentLineHeight = editor.getAttributes('paragraph')?.lineHeight;
          if (!currentLineHeight && editor.isActive('heading')) {
            currentLineHeight = editor.getAttributes('heading')?.lineHeight;
          }
          if (!currentLineHeight && editor.isActive('listItem')) {
            currentLineHeight = editor.getAttributes('listItem')?.lineHeight;
          }
          currentLineHeight = currentLineHeight || '138%';

          const currentIndex = lineHeights.indexOf(currentLineHeight);
          const nextIndex = Math.min(currentIndex + 1, lineHeights.length - 1);
          editor.chain().setLineHeight(lineHeights[nextIndex]).run();
          return true;
        }

        // Line height decrease shortcut (Alt + Shift + ↓)
        if (event.altKey && event.shiftKey && event.key === 'ArrowDown') {
          event.preventDefault();
          const lineHeights = ['120%', '138%', '180%', '240%', '300%', '360%'];

          // Get line height from current block node
          let currentLineHeight = editor.getAttributes('paragraph')?.lineHeight;
          if (!currentLineHeight && editor.isActive('heading')) {
            currentLineHeight = editor.getAttributes('heading')?.lineHeight;
          }
          if (!currentLineHeight && editor.isActive('listItem')) {
            currentLineHeight = editor.getAttributes('listItem')?.lineHeight;
          }
          currentLineHeight = currentLineHeight || '138%';

          const currentIndex = lineHeights.indexOf(currentLineHeight);
          const prevIndex = Math.max(currentIndex - 1, 0);
          editor.chain().setLineHeight(lineHeights[prevIndex]).run();
          return true;
        }
        return false;
      },
    });

    return () => {
      // Clean up by removing just the handleKeyDown patch added above.
      // Merge (not replace) so attributes/clipboardTextSerializer/
      // handleDOMEvents configured elsewhere on editorProps survive —
      // setting `handleKeyDown` to undefined is equivalent to omitting it
      // (ProseMirror only calls it when defined).
      if (editor) {
        mergeEditorProps(editor, { handleKeyDown: undefined });
      }
    };
  }, [editor, setToolVisibility, buttonRef]);

  const undoRedoTools: Array<IEditorToolElement | null> = [
    {
      icon: 'Undo',
      title: 'Undo',
      onClick: () => {
        editor?.chain().undo().run();
      },
      isActive: editorCommands['edit.undo'].isEnabled,
    },
    {
      icon: 'Redo',
      title: 'Redo',
      onClick: () => {
        editor?.chain().redo().run();
      },
      isActive: editorCommands['edit.redo'].isEnabled,
    },
    null,
  ];
  const toolbar: Array<IEditorToolElement | null> = [
    {
      icon: 'Baseline',
      title: 'Text Color',
      onClick: () => setToolVisibility(IEditorTool.TEXT_COLOR),
      isActive: toolVisibility === IEditorTool.TEXT_COLOR,
    },
    {
      icon: 'Highlighter',
      title: 'Highlight',
      onClick: () => setToolVisibility(IEditorTool.HIGHLIGHT),
      isActive: toolVisibility === IEditorTool.HIGHLIGHT,
    },
    null,
    {
      icon: 'Bold',
      title: 'Bold',
      onClick: () => editor?.chain().focus().toggleBold().run(),
      isActive: editorCommands['format.bold'].isActive ?? false,
    },
    {
      icon: 'Italic',
      title: 'Italic',
      onClick: () => editor?.chain().focus().toggleItalic().run(),
      isActive: editorCommands['format.italic'].isActive ?? false,
    },
    {
      icon: 'Underline',
      title: 'Underlined',
      onClick: () => editor?.chain().focus().toggleUnderline().run(),
      isActive: editorCommands['format.underline'].isActive ?? false,
    },
    {
      icon: 'Strikethrough',
      title: 'Strikethrough',
      onClick: () => editor?.chain().focus().toggleStrike().run(),
      isActive: editorCommands['format.strike'].isActive ?? false,
    },
    null,
    {
      icon: 'List',
      title: 'List',
      onClick: () => {
        if (!editor) return;
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('bulletList')) {
          const result = editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();

          setToolVisibility(IEditorTool.NONE);
          return result;
        }

        const result = editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'bulletList',
                itemType: 'listItem',
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();

        setToolVisibility(IEditorTool.NONE);
        return result;
      },
      isActive: editorCommands['format.list.bullet'].isActive ?? false,
      group: 'More',
      notVisible: 1030,
    },
    {
      icon: 'ListOrdered',
      title: 'Ordered List',
      onClick: () => {
        if (!editor) return;
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('orderedList')) {
          const result = editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();

          setToolVisibility(IEditorTool.NONE);
          return result;
        }

        const result = editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'orderedList',
                itemType: 'listItem',
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();

        setToolVisibility(IEditorTool.NONE);
        return result;
      },
      isActive: editorCommands['format.list.numbered'].isActive ?? false,
      group: 'More',
      notVisible: 1030,
    },
    {
      icon: 'ListChecks',
      title: 'To-do List',
      onClick: () => {
        if (!editor) return;
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('taskList')) {
          const result = editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();

          setToolVisibility(IEditorTool.NONE);
          return result;
        }

        const result = editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'taskList',
                itemType: 'taskItem',
                hasAttrs: true,
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();

        setToolVisibility(IEditorTool.NONE);
        return result;
      },
      isActive: editorCommands['format.list.check'].isActive ?? false,
      group: 'More',
      notVisible: 1160,
    },
    {
      icon: 'AlignLeft',
      title: 'Alignment',
      onClick: () => setToolVisibility(IEditorTool.ALIGNMENT),
      isActive: toolVisibility === IEditorTool.ALIGNMENT,
      group: 'More',
      notVisible: 1160,
    },
    {
      icon: 'LineHeight',
      title: 'Line Height',
      onClick: () => setToolVisibility(IEditorTool.LINE_HEIGHT),
      isActive: toolVisibility === IEditorTool.LINE_HEIGHT,
      group: 'More',
      notVisible: 1270,
    },
    {
      icon: 'TextQuote',
      title: 'Quote',
      onClick: () => editor?.chain().focus().toggleBlockquote().run(),
      isActive: editorCommands['insert.quote'].isActive ?? false,
      group: 'More',
      notVisible: 1270,
    },
    null,
    {
      icon: 'Superscript',
      title: 'Superscript',
      onClick: () =>
        editor?.chain().focus().unsetSubscript().toggleSuperscript().run(),
      isActive: editorCommands['format.superscript'].isActive ?? false,
      group: 'More',
      notVisible: 1370,
    },
    {
      icon: 'Subscript',
      title: 'Subscript',
      onClick: () => {
        editor?.chain().focus().unsetSuperscript().toggleSubscript().run();
      },
      isActive: editorCommands['format.subscript'].isActive ?? false,
      group: 'More',
      notVisible: 1370,
    },
    null,
    {
      icon: 'Link',
      title: 'Link',
      onClick: () => {
        setToolVisibility(IEditorTool.LINK_POPUP);
      },
      isActive: editorCommands['insert.link'].isActive ?? false,
      group: 'More',
      notVisible: 1560,
    },
    {
      icon: 'ImagePlus',
      title: 'Upload Image',
      onClick: () => {
        if (!editor) return;
        editor?.chain().focus().deleteRange(editor.state.selection).run();
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png, image/jpeg, image/gif';
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
      },
      isActive: false,
      group: 'More',
      notVisible: 1560,
    },
    {
      icon: 'Code',
      title: 'Code',
      onClick: () => {
        if (editor?.isActive('codeBlock')) {
          editor?.chain().focus().toggleCodeBlock().run();
        }
        editor?.chain().focus().toggleCode().run();
      },
      isActive: editorCommands['insert.code'].isActive ?? false,
      group: 'More',
      notVisible: 1560,
    },
    {
      icon: 'Braces',
      title: 'Code Block',
      onClick: () => {
        if (editor?.isActive('code')) {
          editor?.chain().focus().toggleCode().run();
        }
        editor?.chain().focus().toggleCodeBlock().run();
      },
      isActive: editorCommands['insert.codeBlock'].isActive ?? false,
      group: 'More',
      notVisible: 1560,
    },
    {
      icon: 'Table',
      title: 'Add table',
      onClick: () =>
        editor
          ?.chain()
          .focus()
          .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
          .run(),
      isActive: false,
      group: 'More',
      notVisible: 1560,
    },
    null,
    {
      icon: 'PilcrowRight',
      title: 'Set text direction to left-to-right',
      onClick: () => editor?.commands.setTextDirection('ltr'),
      isActive: editorCommands['format.direction'].current === 'ltr',
      group: 'More',
      notVisible: 1560,
    },
    {
      icon: 'PilcrowLeft',
      title: 'Set text direction to right-to-left',
      onClick: () => editor?.commands.setTextDirection('rtl'),
      isActive: editorCommands['format.direction'].current === 'rtl',
      group: 'More',
      notVisible: 1560,
    },
    null,
    {
      icon: 'FileSearch',
      title: 'Find/Replace',
      onClick: () => (editor ? setShowReplacePopoverWithData(editor) : {}),
      isActive: false,
      group: 'More',
      notVisible: 1560,
    },
    null,
    {
      icon: 'Presentation',
      title: enableCollaboration
        ? 'Slides Mode is not supported during real-time collaboration'
        : 'Slides mode',
      onClick: () => {
        if (enableCollaboration) return;
        if (!editor) return;
        if (editor.isEmpty) {
          onError?.(
            'Your document is empty. Add some content before starting presentation mode.',
          );
          // Bail here or presentation mode still mounts and its own
          // empty-content backstop fires a second, different error toast.
          return;
        }
        editor.chain().focus().run(); // added editor focus and delegated the presentation mode setter to give the popover closing time.
        setTimeout(() => {
          setIsPresentationMode?.();
        }, 50);
      },
      isActive: isPresentationMode ?? false,
      disabled: enableCollaboration,
      group: 'More',
      notVisible: 1560,
    },
  ];

  const importOptions: Array<IEditorToolElement | null> = [
    {
      icon: 'FileInput',
      title: 'Markdown (.md)',
      onClick: async () => {
        await editor?.commands.uploadMarkdownFile(ipfsImageUploadFn, onError);
        onMarkdownImport?.();
      },
      isActive: false,
    },
    {
      icon: 'FileInput',
      title: 'Microsoft Word (.docx)',
      onClick: async () => {
        await editor?.commands.uploadDocxFile(
          ipfsImageUploadFn,
          onError,
          onDocxImport,
        );
      },
      isActive: false,
      isNew: true,
    },
  ];

  const exportOptions: Array<IEditorToolElement | null> = [
    {
      icon: 'FileExport',
      title: 'PDF document (.pdf)',
      onClick: () => {
        if (editor) {
          const closeAndPrint = async () => {
            const { showLoader, removeLoader } = inlineLoader(
              editor,
              'Exporting PDF file ...',
            );

            const loader = showLoader();
            const originalDoc = editor.state.doc;
            const docWithEmbedImageContent =
              await searchForSecureImageNodeAndEmbedImageContent(
                originalDoc,
                ipfsImageFetchFn,
                fetchV1ImageFn,
                true,
              );

            const temporalEditor = getTemporaryEditor(
              editor,
              docWithEmbedImageContent.toJSON(),
            );

            const rawHtml = temporalEditor.getHTML();
            const inlineHtml = await renderMermaidBlocks(rawHtml);
            handleContentPrint(inlineHtml);
            removeLoader(loader);
            temporalEditor.destroy();
          };
          setFileExportsOpen(false);
          setTimeout(closeAndPrint, 200);
          onPdfExport?.();
        }
      },
      isActive: false,
    },
    {
      icon: 'FileText',
      title: 'Web page (.html)',
      subtitle: 'AO3 compatible',
      onClick: async (name?: string) => {
        if (editor) {
          const editorContent = editor.getJSON();
          const title = extractTitleFromContent(
            editorContent as unknown as { content: JSONContent },
          );
          const fileName = name || title || 'Untitled';
          const generateDownloadUrl = await editor.commands.exportHtmlFile({
            title: fileName,
          });
          if (generateDownloadUrl) {
            const url = generateDownloadUrl;
            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.html`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }
        onHtmlExport?.();
      },
      isActive: false,
    },
    {
      icon: 'FileText',
      title: 'Plain Text (.txt)',
      onClick: async (name?: string) => {
        if (editor) {
          const editorContent = editor.getJSON();
          const title = extractTitleFromContent(
            editorContent as unknown as { content: JSONContent },
          );
          const fileName = name || title || 'Untitled';
          const generateDownloadUrl = await editor.commands.exportTxtFile();
          if (generateDownloadUrl) {
            const url = generateDownloadUrl;
            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.txt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }
        onTxtExport?.();
      },
      isActive: false,
    },
    {
      icon: 'FileOutput',
      title: 'Markdown (.md)',
      onClick: async () => {
        if (editor) {
          const editorContent = editor?.getJSON();
          const title = extractTitleFromContent(
            editorContent as unknown as { content: JSONContent },
          );
          const generateDownloadUrl = await editor.commands.exportMarkdownFile({
            title: title || 'Untitled',
          });
          if (generateDownloadUrl) {
            const url = generateDownloadUrl;
            const link = document.createElement('a');
            link.href = url;
            link.download = `${title || 'Untitled'}.md`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }
        onMarkdownExport?.();
      },
      isActive: false,
    },
    {
      icon: 'FileOutput',
      title: 'Markdown with CSS (.md)',
      subtitle: 'Keeps colors, fonts & highlights',
      onClick: async () => {
        if (editor) {
          const editorContent = editor?.getJSON();
          const title = extractTitleFromContent(
            editorContent as unknown as { content: JSONContent },
          );
          const generateDownloadUrl = await editor.commands.exportMarkdownFile({
            title: title || 'Untitled',
            includeStyles: true,
          });
          if (generateDownloadUrl) {
            const url = generateDownloadUrl;
            const link = document.createElement('a');
            link.href = url;
            link.download = `${title || 'Untitled'}.md`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }
        onMarkdownExport?.();
      },
      isActive: false,
    },
    {
      icon: 'FileText',
      title: 'OpenDocument (.odt)',
      subtitle: 'Image support is coming soon',
      onClick: async (name?: string) => {
        if (editor) {
          const editorContent = editor.getJSON();
          const title = extractTitleFromContent(editorContent);
          const fileName = name || title || 'Untitled';
          const generateDownloadUrl = await editor.commands.exportOdtFile({
            title: fileName,
          });
          if (generateDownloadUrl) {
            const url = generateDownloadUrl;
            const link = document.createElement('a');
            link.href = url;
            link.download = `${fileName}.odt`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }
        }
        onOdtExport?.();
      },
      isActive: false,
    },
  ];

  const printHandler = () => {
    if (editor) {
      const closeAndPrint = async () => {
        const originalDoc = editor.state.doc;
        const docWithEmbedImageContent =
          await searchForSecureImageNodeAndEmbedImageContent(
            originalDoc,
            ipfsImageFetchFn,
            fetchV1ImageFn,
            true,
          );

        const temporalEditor = getTemporaryEditor(
          editor,
          docWithEmbedImageContent.toJSON(),
        );

        const rawHtml = temporalEditor.getHTML();
        const inlineHtml = await renderMermaidBlocks(rawHtml);
        handleContentPrint(inlineHtml);
        temporalEditor.destroy();
      };
      setFileExportsOpen(false);
      setTimeout(closeAndPrint, 200);
      onPdfExport?.();
    }
  };

  const bottomToolbar: Array<IEditorToolElement | null> = [
    {
      icon: 'Undo',
      title: 'Undo',
      onClick: () => {
        editor?.chain().undo().run();
      },
      isActive: editorCommands['edit.undo'].isEnabled,
    },
    {
      icon: 'Redo',
      title: 'Redo',
      onClick: () => {
        editor?.chain().redo().run();
      },
      isActive: editorCommands['edit.redo'].isEnabled,
    },
    null,
    {
      icon: 'Type',
      title: 'Text formating',
      onClick: () => setToolVisibility(IEditorTool.TEXT_FORMATING),
      isActive: toolVisibility === IEditorTool.TEXT_FORMATING,
    },
    null,
    {
      icon: 'Table',
      title: 'Add table',
      onClick: () =>
        editor
          ?.chain()
          .focus()
          .insertTable({ rows: 3, cols: 2, withHeaderRow: true })
          .run(),
      isActive: false,
    },
    null,
    {
      icon: 'ListChecks',
      title: 'To-do list',
      onClick: () => {
        if (!editor) return;
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('taskList')) {
          const result = editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();

          setToolVisibility(IEditorTool.NONE);
          return result;
        }

        const result = editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'taskList',
                itemType: 'taskItem',
                hasAttrs: true,
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();

        setToolVisibility(IEditorTool.NONE);
        return result;
      },
      isActive: false,
    },
    null,
    {
      icon: 'ImagePlus',
      title: 'Add image',
      onClick: () => {
        if (!editor) return;
        editor?.chain().focus().deleteRange(editor.state.selection).run();
        // upload image
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/png, image/jpeg, image/gif';
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
      },
      isActive: false,
    },
  ];
  return {
    undoRedoTools,
    toolbar,
    exportOptions,
    printHandler,
    importOptions,
    bottomToolbar,
    toolRef,
    toolVisibility,
    setToolVisibility,
    isExportModalOpen,
    setIsExportModalOpen,
    fileExportsOpen,
    setFileExportsOpen,
  };
};

export const TextHighlighter = ({
  editor,
  setVisibility,
  elementRef,
}: {
  editor: Editor;
  elementRef: React.RefObject<HTMLDivElement>;
  setVisibility: Dispatch<SetStateAction<IEditorTool>>;
}) => {
  return (
    <div
      ref={elementRef}
      className="z-50 h-auto gap-0.5 flex flex-wrap max-h-[400px] w-[14.7rem] overflow-y-auto scroll-smooth rounded color-bg-default px-2 py-2 shadow-elevation-3 transition-all"
    >
      {colors.map((color) => {
        const contrastColor = getContrastColor(color.color);
        const tickColorClassName =
          contrastColor === '#000000' ? 'text-black' : 'text-white';
        return (
          <div
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              editor
                .chain()
                .focus()
                .toggleHighlight({ color: color.color })
                .run();
              setVisibility(IEditorTool.NONE);
            }}
            key={color.color}
            className={cn(
              'w-5 rounded-full flex items-center justify-center cursor-pointer ease-in duration-200 hover:scale-[1.05] h-5',
              color.code,
            )}
          >
            <LucideIcon
              name="Check"
              className={cn(
                'w-[14px] aspect-square',
                editor.isActive('highlight', {
                  color: color.color,
                })
                  ? 'visible'
                  : 'invisible',
                tickColorClassName,
              )}
            />
          </div>
        );
      })}

      <Button
        variant="ghost"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor.chain().focus().unsetHighlight().run();
          setVisibility(IEditorTool.NONE);
        }}
        className="w-full justify-start mt-2 gap-1 !p-1 h-fit"
      >
        <LucideIcon name="Ban" className="w-[18px] aspect-square" />
        <span>None</span>
      </Button>
    </div>
  );
};

const ROW_HEIGHT = 28;
const MAX_VISIBLE_ROWS = 12;

type FontRowSharedProps = {
  entries: PickerEntry[];
  editor: Editor;
  setToolVisibility: Dispatch<SetStateAction<IEditorTool>>;
  loadingValue: string | null;
  setLoadingValue: Dispatch<SetStateAction<string | null>>;
};

const FontRow = ({
  index,
  style,
  entries,
  editor,
  setToolVisibility,
  loadingValue,
  setLoadingValue,
}: RowComponentProps<FontRowSharedProps>) => {
  const font = entries[index];
  const isActive = editor.isActive('textStyle', { fontFamily: font.value });
  const isLoading = loadingValue === font.value;
  return (
    <DropdownMenuItem
      style={style}
      // Keep the menu open while the font loads; we close it explicitly once
      // the font has applied via setToolVisibility below.
      onSelect={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={async () => {
        setLoadingValue(font.value);
        try {
          await ensureLoaded(font.value);
          font.command(editor);
          setToolVisibility(IEditorTool.NONE);
        } finally {
          // Only clear if this row still owns the spinner — a later click on
          // another font must not have its spinner cleared by our resolution.
          setLoadingValue((current) =>
            current === font.value ? null : current,
          );
        }
      }}
      className={cn(
        'w-full gap-2 text-left',
        isActive && '!bg-[hsl(var(--color-bg-brand))] color-text-on-brand',
      )}
    >
      {font.preview ?? (
        <p className="font-medium" style={{ fontFamily: font.value }}>
          {font.title}
        </p>
      )}
      {isLoading && <span className="ml-auto text-xs opacity-60">…</span>}
    </DropdownMenuItem>
  );
};

export const EditorFontFamily = ({
  elementRef,
  editor,
  setToolVisibility,
  fonts: consumerFonts = [],
}: {
  elementRef: React.RefObject<HTMLDivElement>;
  editor: Editor;
  setToolVisibility: Dispatch<SetStateAction<IEditorTool>>;
  fonts?: FontDescriptor[];
}) => {
  const entries = useMemo(
    () => buildPickerEntries(consumerFonts),
    [consumerFonts],
  );
  const [loadingValue, setLoadingValue] = useState<string | null>(null);

  const visibleHeight = Math.min(entries.length, MAX_VISIBLE_ROWS) * ROW_HEIGHT;

  return (
    <div
      ref={elementRef}
      className={cn(
        'z-50 w-48 color-bg-default px-1 py-2 shadow-elevation-1 transition-all rounded',
      )}
      style={{
        maxHeight: visibleHeight,
        height: `calc(var(--radix-dropdown-menu-content-available-height) - 3rem)`,
        minHeight: '6rem',
      }}
    >
      <List
        rowComponent={FontRow}
        rowCount={entries.length}
        rowHeight={ROW_HEIGHT}
        rowProps={{
          entries,
          editor,
          setToolVisibility,
          loadingValue,
          setLoadingValue,
        }}
        style={{ height: '100%', width: '100%' }}
      />
    </div>
  );
};

export const EditorAlignment = ({
  elementRef,
  editor,
  setToolVisibility,
}: {
  elementRef: React.RefObject<HTMLDivElement>;
  editor: Editor;
  setToolVisibility: Dispatch<SetStateAction<IEditorTool>>;
}) => {
  return (
    <div
      ref={elementRef}
      className="z-50 h-auto left-[47rem] flex flex-wrap gap-1 max-h-[330px] overflow-y-auto scroll-smooth rounded color-bg-default px-1 py-2 shadow-elevation-3 transition-all"
    >
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor?.chain().focus().setTextAlign('left').run();
          setToolVisibility(IEditorTool.NONE);
        }}
        className={cn(
          'rounded w-8 h-8 p-1 flex justify-center items-center cursor-pointer transition',
          editor.isActive({ textAlign: 'left' })
            ? 'color-bg-brand xl:hover:brightness-90 color-text-on-brand'
            : 'hover:color-bg-default-hover',
        )}
      >
        <LucideIcon name="AlignLeft" />
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor?.chain().focus().setTextAlign('center').run();
          setToolVisibility(IEditorTool.NONE);
        }}
        className={cn(
          'rounded w-8 h-8 p-1 flex justify-center items-center cursor-pointer transition',
          editor.isActive({ textAlign: 'center' })
            ? 'color-bg-brand xl:hover:brightness-90 color-text-on-brand'
            : 'hover:color-bg-default-hover',
        )}
      >
        <LucideIcon name="AlignCenter" />
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor?.chain().focus().setTextAlign('right').run();
          setToolVisibility(IEditorTool.NONE);
        }}
        className={cn(
          'rounded w-8 h-8 p-1 flex justify-center items-center cursor-pointer transition',
          editor.isActive({ textAlign: 'right' })
            ? 'color-bg-brand xl:hover:brightness-90 color-text-on-brand'
            : 'hover:color-bg-default-hover',
        )}
      >
        <LucideIcon name="AlignRight" />
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          editor?.chain().focus().setTextAlign('justify').run();
          setToolVisibility(IEditorTool.NONE);
        }}
        className={cn(
          'rounded w-8 h-8 p-1 flex justify-center items-center cursor-pointer transition',
          editor.isActive({ textAlign: 'justify' })
            ? 'color-bg-brand xl:hover:brightness-90 color-text-on-brand'
            : 'hover:color-bg-default-hover',
        )}
      >
        <LucideIcon name="AlignJustify" />
      </button>
    </div>
  );
};

export const EditorList = ({
  elementRef,
  editor,
  setToolVisibility,
}: {
  elementRef: React.RefObject<HTMLDivElement>;
  editor: Editor;
  setToolVisibility: Dispatch<SetStateAction<IEditorTool>>;
}) => {
  return (
    <div
      ref={elementRef}
      className={cn(
        'z-50 h-auto gap-2 flex flex-wrap max-h-[330px] overflow-y-auto scroll-smooth rounded color-bg-default px-1 py-2 shadow-elevation-1 transition-all',
      )}
    >
      <Tooltip text="unordered list">
        <button
          onClick={() => {
            editor?.chain().focus().toggleBulletList().run();
            setToolVisibility(IEditorTool.NONE);
          }}
          className={`hover:color-bg-default-hover ${
            editor.isActive('bulletList') ? 'color-bg-default-hover' : ''
          } rounded-lg w-8 h-8 p-1 flex  justify-center items-center`}
        >
          <LucideIcon name="List" />
        </button>
      </Tooltip>

      <Tooltip text="ordered list">
        <button
          onClick={() => {
            editor?.chain().focus().toggleOrderedList().run();
            setToolVisibility(IEditorTool.NONE);
          }}
          className={`hover:color-bg-default-hover ${
            editor.isActive('orderedList') ? 'color-bg-default-hover' : ''
          } rounded-lg w-8 h-8 p-1 flex  justify-center items-center`}
        >
          <LucideIcon name="ListOrdered" />
        </button>
      </Tooltip>

      <Tooltip text="to-do list">
        <button
          onClick={() => {
            editor?.chain().focus().toggleTaskList().run();
            setToolVisibility(IEditorTool.NONE);
          }}
          className={`hover:color-bg-default-hover ${
            editor.isActive('taskList') ? 'color-bg-default-hover' : ''
          } rounded-lg w-8 h-8 p-1 flex  justify-center items-center`}
        >
          <LucideIcon name="ListChecks" />
        </button>
      </Tooltip>
    </div>
  );
};

export const LinkPopup = ({
  elementRef,
  editor,
  setToolVisibility,
  bubbleMenu,
  setIsLinkPopupOpen,
  onError,
}: {
  elementRef: React.RefObject<HTMLDivElement>;
  editor: Editor;
  setToolVisibility: Dispatch<SetStateAction<IEditorTool>>;
  bubbleMenu?: boolean;
  setIsLinkPopupOpen?: Dispatch<SetStateAction<boolean>>;
  onError?: (errorString: string) => void;
}) => {
  const [url, setUrl] = useState<string>(editor.getAttributes('link').href);
  const apply = useCallback(() => {
    // empty
    if (url === '' || url === undefined) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }

    // Validate URL
    const urlPattern =
      /^(https?:\/\/)?([\w-]+(\.[\w-]+)+\.?(:\d+)?(\/\S*)?|\w+@[\w.-]+\.\w+)\s*$/i;

    if (!urlPattern.test(url)) {
      if (onError && typeof onError === 'function') {
        onError('Invalid URL');
      }
      return;
    }

    // Add https:// prefix if it's missing
    let finalUrl = url;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      finalUrl = 'https://' + url;
    }
    finalUrl = finalUrl.trim();

    // Update link
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: finalUrl })
      .run();

    setToolVisibility(IEditorTool.NONE);
    if (bubbleMenu && setIsLinkPopupOpen) setIsLinkPopupOpen(false);
    const parsed = parseHeadingLink(finalUrl);
    if (parsed && !parsed.headingEl) {
      onError?.('This heading link belongs to a different document.');
    }
  }, [url, editor, bubbleMenu, setIsLinkPopupOpen, onError, setToolVisibility]);
  return (
    <div
      ref={elementRef}
      className="z-50 h-auto gap-2 items-center flex max-h-[330px] overflow-y-auto scroll-smooth rounded-lg color-bg-default p-2 shadow-elevation-1 transition-all"
    >
      <TextField
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          setUrl(e.target.value)
        }
        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
        className="w-full"
        placeholder="Add link here"
        value={url}
      />
      <div className="h-full flex items-center gap-2">
        <Button onClick={() => apply()} className="min-w-fit h-[36px]">
          Apply
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            editor.chain().focus().unsetLink().run();
            setToolVisibility(IEditorTool.NONE);
          }}
          className="min-w-fit h-[36px]"
        >
          Unset
        </Button>
      </div>
    </div>
  );
};

export const InlineCommentPopup = ({
  elementRef,
  editor,
  setIsCommentSectionOpen,
  setIsInlineCommentOpen,
  inlineCommentData,
  setInlineCommentData,
  onInlineComment,
}: {
  elementRef: React.RefObject<HTMLDivElement>;
  editor: Editor;
  setIsCommentSectionOpen: Dispatch<SetStateAction<boolean>>;
  setIsInlineCommentOpen: Dispatch<SetStateAction<boolean>>;
  inlineCommentData: {
    highlightedTextContent: string;
    inlineCommentText: string;
    handleClick: boolean;
  };
  setInlineCommentData: (data: {
    highlightedTextContent?: string;
    inlineCommentText?: string;
    handleClick?: boolean;
  }) => void;
  onInlineComment?: () => void;
}) => {
  const [comment, setComment] = useState(
    inlineCommentData.inlineCommentText || '',
  );
  const isMobile = useMediaQuery('(max-width: 1023px)');
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setComment(value);
    setInlineCommentData({ inlineCommentText: value });
  };

  // Unset highlight when popup is closed without submitting
  const handleClosePopup = () => {
    editor.chain().unsetHighlight().run();
    setComment('');
    setInlineCommentData({
      inlineCommentText: '',
      highlightedTextContent: '',
      handleClick: false,
    });
    setIsInlineCommentOpen(false);
  };

  // Close popup if click is outside or ESC key is pressed
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (
        elementRef.current &&
        !elementRef.current.contains(event.target as Node)
      ) {
        handleClosePopup();
      }
    };
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClosePopup();
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscKey);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscKey);
    };
  }, [elementRef]);

  const handleClick = () => {
    if (comment.trim()) {
      // Update comment data and highlight
      setInlineCommentData({ inlineCommentText: comment, handleClick: true });
      editor.chain().unsetHighlight().run();
      setIsCommentSectionOpen(true);
      onInlineComment?.();
      // Reset comment field and close inline comment
      setComment('');
      setIsInlineCommentOpen(false);

      // Close popup using ref
      if (elementRef.current?.parentElement) {
        // Find and close the nearest popover/dropdown container
        const popoverContent = elementRef.current.closest('[role="dialog"]');
        if (popoverContent) {
          popoverContent.remove();
        }
      }

      // Clear selection to hide bubble menu by collapsing selection to start
      const { from } = editor.state.selection;
      editor.chain().focus().setTextSelection(from).run();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleClick();
      onInlineComment?.();
    }
  };

  return (
    <div
      ref={elementRef}
      className="w-[300px] color-bg-default-selected shadow-[0px_4px_16px_-4px_rgba(0,0,0,0.15)] rounded-md"
    >
      <TextAreaFieldV2
        value={comment}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        className="color-bg-default-selected w-[296px] font-normal min-h-[44px] max-h-[196px] pt-2 border-none overflow-y-auto no-scrollbar"
        placeholder="Type your comment"
        autoFocus
      />
      {comment.trim() !== '' && (
        <div className="h-full flex items-center gap-2 p-3">
          <span className="w-full text-[12px] color-text-secondary">
            Press{' '}
            <span className="font-semibold">{isMobile ? 'Send' : 'Enter'}</span>{' '}
            to send a comment
          </span>
          <Button className="!min-w-[10px] !h-8 !px-2" onClick={handleClick}>
            <LucideIcon name="SendHorizontal" size="md" />
          </Button>
        </div>
      )}
    </div>
  );
};

export const ScriptsPopup = ({
  elementRef,
  editor,
}: {
  elementRef: React.RefObject<HTMLDivElement>;
  editor: Editor;
}) => {
  const options = [
    {
      title: 'Superscript',
      command: () =>
        editor.chain().focus().unsetSubscript().toggleSuperscript().run(),
      isActive: () => editor.isActive('superscript'),
      icon: 'Superscript',
    },
    {
      title: 'Subscript',
      command: () =>
        editor.chain().focus().unsetSuperscript().toggleSubscript().run(),
      isActive: () => editor.isActive('subscript'),
      icon: 'Subscript',
    },
    {
      title: 'None',
      command: () =>
        editor.chain().focus().unsetSuperscript().unsetSubscript().run(),
      isActive: () =>
        !editor.isActive('superscript') && !editor.isActive('subscript'),
      icon: 'RemoveFormatting',
    },
  ];

  return (
    <div ref={elementRef} className="z-50 w-48 color-bg-default rounded p-1">
      <div className="flex flex-col gap-1 justify-center w-fit sm:w-full transition-all">
        {options.map((option) => (
          <Button
            key={option.title}
            variant="ghost"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              option.command();
            }}
            className={cn(
              'flex items-center justify-between w-full px-2 py-1 text-body-sm',
              option.isActive() &&
                'color-bg-brand hover:!bg-[#B6A02E] color-text-on-brand',
            )}
          >
            <div className="flex items-center gap-2">
              <div className="rounded color-bg-default color-text-default p-1">
                <LucideIcon name={option.icon} size="sm" />
              </div>
              <span>{option.title}</span>
            </div>
            {option.isActive() && (
              <LucideIcon name="Check" size="sm" className="ml-2" />
            )}
          </Button>
        ))}
      </div>
    </div>
  );
};

export const TextColor = ({
  editor,
  setVisibility,
  elementRef,
}: {
  editor: Editor | null;
  elementRef: React.RefObject<HTMLDivElement>;
  setVisibility: Dispatch<SetStateAction<IEditorTool>>;
}) => {
  const { theme } = useTheme();
  return (
    <div
      ref={elementRef}
      className="h-auto gap-0.5 rounded color-bg-default px-3 py-3 shadow-elevation-3 transition-all max-w-fit"
    >
      <div className="grid grid-cols-[repeat(15,_minmax(0,_1fr))] gap-0.5">
        {textColors.map((color) => {
          const contrastColor = getContrastColor(
            (color as Record<string, string>)[theme] || color.light,
          );
          const tickColorClassName =
            contrastColor === '#000000' ? 'text-black' : 'text-white';
          const colorCSSVariable = `var(--color-editor-${color.name})`;
          return (
            <div
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (!editor) return;
                editor.chain().focus().setColor(colorCSSVariable).run();
                setVisibility(IEditorTool.NONE);
              }}
              key={color.name}
              className={cn(
                'w-5 rounded-full flex justify-center items-center cursor-pointer ease-in duration-200 hover:scale-[1.05] h-5',
              )}
              style={{ backgroundColor: colorCSSVariable }}
            >
              <LucideIcon
                name="Check"
                className={cn(
                  'w-[14px] aspect-square',
                  editor?.isActive('textStyle', {
                    color: colorCSSVariable,
                  }) || false
                    ? 'visible'
                    : 'invisible',
                  tickColorClassName,
                )}
              />
            </div>
          );
        })}
      </div>
      <Button
        variant="ghost"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (!editor) return;
          editor.chain().focus().unsetColor().run();
          setVisibility(IEditorTool.NONE);
        }}
        className="w-full justify-center mt-2 gap-1 !p-1 h-fit min-w-fit"
      >
        <LucideIcon name="Ban" className="w-[18px] aspect-square" />
        <span>None</span>
      </Button>
    </div>
  );
};

export const TextHeading = ({ editor }: { editor: Editor }) => {
  const headings = [
    {
      title: 'Text',
      description: 'Normal',
      icon: 'Type',
      command: (editor: Editor) =>
        editor.chain().focus().toggleNode('paragraph', 'paragraph').run(),
      isActive: () =>
        editor.isActive('paragraph') &&
        !editor.isActive('bulletList') &&
        !editor.isActive('orderedList'),
    },
    {
      title: 'Heading 1',
      description: 'Big',
      icon: 'Heading1',
      command: (editor: Editor) => {
        editor.chain().focus().toggleHeading({ level: 1 }).run();
      },
      isActive: () => editor.isActive('heading', { level: 1 }),
    },
    {
      title: 'Heading 2',
      description: 'Medium',
      icon: 'Heading2',
      command: (editor: Editor) => {
        editor.chain().focus().toggleHeading({ level: 2 }).run();
      },
      isActive: () => editor.isActive('heading', { level: 2 }),
    },
    {
      title: 'Heading 3',
      description: 'Small',
      icon: 'Heading3',
      command: (editor: Editor) => {
        editor.chain().focus().toggleHeading({ level: 3 }).run();
      },
      isActive: () => editor.isActive('heading', { level: 3 }),
    },
  ];

  return (
    <div
      className={cn(
        'z-50 flex w-48 flex-col overflow-hidden rounded color-bg-default p-1 shadow-elevation-1',
      )}
    >
      {headings.map((heading) => (
        <DropdownMenuItem
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => heading.command(editor)}
          key={heading.title}
          className={cn(
            'gap-2',
            heading.isActive() && '!bg-[hsl(var(--color-bg-brand))]',
          )}
        >
          <div className="flex h-10 w-10 items-center justify-center rounded color-bg-default color-text-default">
            <LucideIcon name={heading.icon} size="md" />
          </div>
          <div>
            <p className="font-medium">{heading.title}</p>
            <p className="text-xs text-stone-500"> {heading.description} </p>
          </div>
        </DropdownMenuItem>
      ))}
    </div>
  );
};

export const FontSizePicker = ({
  editor,
  setVisibility,
  elementRef,
  currentSize,
  onSetFontSize,
}: {
  editor: Editor;
  elementRef: React.RefObject<HTMLDivElement>;
  setVisibility: Dispatch<SetStateAction<IEditorTool>>;
  currentSize?: string;
  onSetFontSize: (fontSize: string) => void;
}) => {
  const fontSizes = getFontSizeOptions(editor);

  return (
    <div
      ref={elementRef}
      className={cn(
        'z-50 flex flex-col justify-center items-center overflow-hidden rounded color-bg-default p-2 gap-1 shadow-elevation-1',
      )}
    >
      {fontSizes.map((fontSize) => (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onSetFontSize(fontSize.value);
            setVisibility(IEditorTool.NONE);
          }}
          key={fontSize.title}
          className={cn(
            'flex w-full items-center justify-center rounded px-2 py-1 text-center text-sm color-text-default transition',
            {
              ['color-bg-brand xl:hover:brightness-90 color-text-on-brand']:
                currentSize === fontSize.value,
              ['hover:color-bg-default-hover']: currentSize !== fontSize.value,
            },
          )}
        >
          <p className="font-medium">{fontSize.title}</p>
        </button>
      ))}
    </div>
  );
};

export const LineHeightPicker = ({
  setVisibility,
  elementRef,
  currentLineHeight,
  onSetLineHeight,
}: {
  editor: Editor;
  elementRef: React.RefObject<HTMLDivElement>;
  setVisibility: Dispatch<SetStateAction<IEditorTool>>;
  currentLineHeight?: string;
  onSetLineHeight: (lineHeight: string) => void;
}) => {
  const lineHeightOptions = getLineHeightOptions();

  return (
    <div
      ref={elementRef}
      className={cn(
        'z-50 flex flex-col justify-center items-center overflow-hidden rounded color-bg-default p-2 gap-1 shadow-elevation-1',
      )}
    >
      {lineHeightOptions.map((lineHeight) => (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onSetLineHeight(lineHeight.value);
            setVisibility(IEditorTool.NONE);
          }}
          key={lineHeight.value}
          className={cn(
            'flex w-full items-center gap-2 rounded px-2 py-1 text-sm color-text-default transition min-w-[120px]',
            {
              ['color-bg-default-hover']:
                currentLineHeight === lineHeight.value,
              ['hover:color-bg-default-hover']:
                currentLineHeight !== lineHeight.value,
            },
          )}
        >
          {currentLineHeight === lineHeight.value ? (
            <LucideIcon name="Check" size="sm" />
          ) : (
            <div className="w-4" />
          )}
          <span className="font-medium">{lineHeight.label}</span>
          <span className="text-xs color-text-secondary">
            {lineHeight.description}
          </span>
        </button>
      ))}
    </div>
  );
};

export const TextFormatingPopup = ({
  editor,
  isOpen,
  setIsOpen,
  setToolVisibility,
}: {
  editor: Editor | null;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  setToolVisibility: Dispatch<SetStateAction<IEditorTool>>;
}) => {
  const headings = [
    {
      title: 'Text',
      description: 'Normal',
      icon: 'Type',
      command: (editor: Editor) => {
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        // If it's already a list type, convert to paragraphs
        if (
          editor.isActive('bulletList') ||
          editor.isActive('orderedList') ||
          editor.isActive('taskList')
        ) {
          const result = editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();

          setToolVisibility(IEditorTool.NONE);
          return result;
        }

        // Otherwise use the default paragraph toggle
        const result = editor
          .chain()
          .focus()
          .toggleNode('paragraph', 'paragraph')
          .setTextSelection({ from, to })
          .focus()
          .run();

        setToolVisibility(IEditorTool.NONE);
        return result;
      },
      isActive: () =>
        editor?.isActive('paragraph') &&
        !editor?.isActive('bulletList') &&
        !editor?.isActive('orderedList'),
    },
    {
      title: 'Heading 1',
      description: 'Big',
      icon: 'Heading1',
      command: (editor: Editor) => {
        editor.chain().toggleHeading({ level: 1 }).run();
        setToolVisibility(IEditorTool.NONE);
      },
      isActive: () => editor?.isActive('heading', { level: 1 }),
    },
    {
      title: 'Heading 2',
      description: 'Medium',
      icon: 'Heading2',
      command: (editor: Editor) => {
        editor.chain().toggleHeading({ level: 2 }).run();
        setToolVisibility(IEditorTool.NONE);
      },
      isActive: () => editor?.isActive('heading', { level: 2 }),
    },
    {
      title: 'Heading 3',
      description: 'Small',
      icon: 'Heading3',
      command: (editor: Editor) => {
        editor.chain().toggleHeading({ level: 3 }).run();
        setToolVisibility(IEditorTool.NONE);
      },
      isActive: () => editor?.isActive('heading', { level: 3 }),
    },
  ];

  const textAlignments = [
    {
      title: 'Left',
      description: 'Left',
      icon: 'AlignLeft',
      command: (editor: Editor) => {
        editor.chain().setTextAlign('left').focus().run();
        setToolVisibility(IEditorTool.NONE);
      },
      isActive: () => editor?.isActive({ textAlign: 'left' }),
    },
    {
      title: 'Center',
      description: 'Center',
      icon: 'AlignCenter',
      command: (editor: Editor) => {
        editor.chain().setTextAlign('center').focus().run();
        setToolVisibility(IEditorTool.NONE);
      },
      isActive: () => editor?.isActive({ textAlign: 'center' }),
    },
    {
      title: 'Right',
      description: 'Right',
      icon: 'AlignRight',
      command: (editor: Editor) => {
        editor.chain().setTextAlign('right').focus().run();
        setToolVisibility(IEditorTool.NONE);
      },
      isActive: () => editor?.isActive({ textAlign: 'right' }),
    },
  ];

  const textStyles = [
    {
      title: 'Bold',
      description: 'Bold text',
      icon: 'Bold',
      command: (editor: Editor) => editor.chain().toggleBold().run(),
      isActive: () => editor?.isActive('bold'),
    },
    {
      title: 'Italic',
      description: 'Italic text',
      icon: 'Italic',
      command: (editor: Editor) => editor.chain().toggleItalic().run(),
      isActive: () => editor?.isActive('italic'),
    },
    {
      title: 'Underline',
      description: 'Underline text',
      icon: 'Underline',
      command: (editor: Editor) => editor.chain().toggleUnderline().run(),
      isActive: () => editor?.isActive('underline'),
    },
    {
      title: 'Strikethrough',
      description: 'Strikethrough text',
      icon: 'Strikethrough',
      command: (editor: Editor) => editor.chain().toggleStrike().run(),
      isActive: () => editor?.isActive('strike'),
    },
    {
      title: 'Superscript',
      description: 'Superscript text',
      icon: 'Superscript',
      command: (editor: Editor) =>
        editor.chain().unsetSubscript().toggleSuperscript().run(),
      isActive: () => editor?.isActive('superscript'),
    },
    {
      title: 'Subscript',
      description: 'Subscript text',
      icon: 'Subscript',
      command: (editor: Editor) =>
        editor.chain().unsetSuperscript().toggleSubscript().run(),
      isActive: () => editor?.isActive('subscript'),
    },
  ];

  const others = [
    {
      title: 'Code',
      description: 'Code',
      icon: 'Code',
      command: (editor: Editor) => editor.chain().toggleCode().run(),
      isActive: () => editor?.isActive('code'),
    },
    {
      title: 'Link',
      description: 'Link',
      icon: 'Link',
      command: () => setToolVisibility(IEditorTool.LINK_POPUP),
      isActive: () => false,
    },
    {
      title: 'Quote',
      description: 'Quote',
      icon: 'TextQuote',
      command: (editor: Editor) => editor.chain().toggleBlockquote().run(),
      isActive: () => editor?.isActive('blockquote'),
    },
  ];

  const listStyles = [
    {
      title: 'Bullet List',
      description: 'Bullet list',
      icon: 'List',
      command: (editor: Editor) => {
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('bulletList')) {
          const result = editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();

          setToolVisibility(IEditorTool.NONE);
          return result;
        }

        const result = editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'bulletList',
                itemType: 'listItem',
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();

        setToolVisibility(IEditorTool.NONE);
        return result;
      },
      isActive: () => editor?.isActive('bulletList'),
    },
    {
      title: 'Ordered List',
      description: 'Ordered list',
      icon: 'ListOrdered',
      command: (editor: Editor) => {
        const { from, to, state, hasMultipleLists } =
          checkActiveListsAndDBlocks(editor);

        if (hasMultipleLists) {
          return;
        }

        if (editor.isActive('orderedList')) {
          const result = editor
            .chain()
            .focus()
            .command((props) =>
              convertListToParagraphs({ ...props, state, from, to }),
            )
            .setTextSelection({ from, to })
            .focus()
            .run();

          setToolVisibility(IEditorTool.NONE);
          return result;
        }

        const result = editor
          .chain()
          .focus()
          .command((props) =>
            convertToList({
              ...props,
              state,
              from,
              to,
              listConfig: {
                type: 'orderedList',
                itemType: 'listItem',
              },
            }),
          )
          .setTextSelection({ from, to })
          .focus()
          .run();

        setToolVisibility(IEditorTool.NONE);
        return result;
      },
      isActive: () => editor?.isActive('orderedList'),
    },
    {
      title: 'Code Block',
      description: 'Code block',
      icon: 'Braces',
      command: (editor: Editor) => editor.chain().toggleCodeBlock().run(),
      isActive: () => editor?.isActive('codeBlock'),
    },
  ];

  return (
    <UtilsModal
      title="Text formating"
      isOpen={isOpen}
      setIsOpen={setIsOpen}
      onCloseAutoFocus={() => {
        setToolVisibility((currentToolVisibility) => {
          if (currentToolVisibility === IEditorTool.TEXT_FORMATING) {
            return IEditorTool.NONE;
          }
          return currentToolVisibility;
        });
      }}
      content={
        <div className="px-4 flex flex-col gap-2 w-full">
          <div className="flex justify-start sm:justify-center items-center gap-1">
            {headings.map((heading) => (
              <button
                onClick={() => editor && heading.command(editor)}
                key={heading.title}
                className={cn(
                  'flex w-fit items-center font-medium space-x-2 rounded p-2 text-center text-sm color-text-default transition',
                  {
                    ['color-bg-brand xl:hover:brightness-90 color-text-on-brand']:
                      heading.isActive(),
                    ['hover:color-bg-default-hover']: !heading.isActive(),
                  },
                )}
              >
                {heading.title}
              </button>
            ))}
          </div>
          <div className="flex justify-between sm:justify-center items-center gap-1">
            <div className="mobile-util-btn-group rounded flex gap-1 justify-evenly w-full sm:w-fit p-1">
              {textAlignments.map((textAlignment) => (
                <button
                  onClick={() => editor && textAlignment.command(editor)}
                  key={textAlignment.title}
                  className={cn(
                    'flex items-center space-x-2 rounded px-4 py-1 color-text-default transition h-9',
                    {
                      ['color-bg-brand xl:hover:brightness-90 color-text-on-brand']:
                        textAlignment.isActive(),
                      ['hover:color-bg-default-hover']:
                        !textAlignment.isActive(),
                    },
                  )}
                >
                  <LucideIcon name={textAlignment.icon} size="md" />
                </button>
              ))}
            </div>
            <div className="mobile-util-btn-group rounded flex gap-1 justify-evenly w-full sm:w-fit p-1">
              {others.map((other) => (
                <button
                  onClick={() => editor && other.command(editor)}
                  key={other.title}
                  className={cn(
                    'flex items-center space-x-2 rounded px-4 py-1 color-text-default transition h-9',
                    {
                      ['color-bg-brand xl:hover:brightness-90 color-text-on-brand']:
                        other.isActive(),
                      ['hover:color-bg-default-hover']: !other.isActive(),
                    },
                  )}
                >
                  <LucideIcon name={other.icon} size="md" />
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1 justify-center">
            <div className="mobile-util-btn-group rounded flex gap-1 justify-evenly p-1 w-full sm:w-fit ">
              {textStyles.slice(0, 4).map((textStyle) => (
                <button
                  onClick={() => editor && textStyle.command(editor)}
                  key={textStyle.title}
                  className={cn(
                    'flex items-center space-x-2 rounded px-4 py-1 color-text-default transition h-9',
                    {
                      ['color-bg-brand xl:hover:brightness-90 color-text-on-brand']:
                        textStyle.isActive(),
                      ['hover:color-bg-default-hover']: !textStyle.isActive(),
                    },
                  )}
                >
                  <LucideIcon name={textStyle.icon} size="sm" />
                </button>
              ))}
            </div>
            <div className="mobile-util-btn-group rounded flex gap-1 justify-evenly p-1 w-full sm:w-fit ">
              {textStyles.slice(4).map((textStyle) => (
                <button
                  onClick={() => editor && textStyle.command(editor)}
                  key={textStyle.title}
                  className={cn(
                    'flex items-center space-x-2 rounded px-4 py-1 color-text-default transition h-9',
                    {
                      ['color-bg-brand xl:hover:brightness-90 color-text-on-brand']:
                        textStyle.isActive(),
                      ['hover:color-bg-default-hover']: !textStyle.isActive(),
                    },
                  )}
                >
                  <LucideIcon name={textStyle.icon} size="sm" />
                </button>
              ))}
            </div>
          </div>
          <div className="mobile-util-btn-group rounded flex gap-1 justify-center self-center w-fit p-1">
            {listStyles.map((listStyle) => (
              <button
                onClick={() => editor && listStyle.command(editor)}
                key={listStyle.title}
                className={cn(
                  'flex items-center space-x-2 rounded px-4 py-1 color-text-default transition h-9',
                  {
                    ['color-bg-brand xl:hover:brightness-90 color-text-on-brand']:
                      listStyle.isActive(),
                    ['hover:color-bg-default-hover']: !listStyle.isActive(),
                  },
                )}
              >
                <LucideIcon name={listStyle.icon} size="md" />
              </button>
            ))}
          </div>

          {/* New Layout */}
          <div className="flex flex-col gap-4 mt-4">
            <p className="text-left sm:text-center text-lg font-semibold leading-none tracking-tight">
              Text color
            </p>
            <Carousel
              opts={{
                align: 'start',
                dragFree: true,
                slidesToScroll: 'auto',
              }}
              className="w-full max-w-md mx-auto"
            >
              <CarouselContent>
                <CarouselItem
                  style={{
                    flexBasis: 'calc(100% / 12)',
                  }}
                >
                  <button
                    className="mb-1 drop-shadow flex justify-center items-center cursor-pointer transition"
                    onClick={() => {
                      editor && editor.chain().unsetColor().run();
                    }}
                  >
                    <LucideIcon name="Ban" className="w-6 h-6" />
                  </button>
                </CarouselItem>
                {colors.map((color, index) => (
                  <CarouselItem
                    key={index}
                    style={{
                      flexBasis: 'calc(100% / 12)',
                    }}
                  >
                    <button
                      onClick={() => {
                        editor && editor.chain().setColor(color.color).run();
                      }}
                      key={color.color}
                      className={cn(
                        'w-6 h-6 mb-1 drop-shadow rounded-full flex justify-center items-center cursor-pointer transition',
                        color.code,
                      )}
                    >
                      <LucideIcon
                        name="Check"
                        className={cn(
                          'w-[14px] aspect-square',
                          editor?.isActive('textStyle', {
                            color: color.color,
                          })
                            ? 'visible'
                            : 'invisible',
                        )}
                      />
                    </button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <div className="flex justify-center gap-2 mt-4 w-full max-w-sm">
                {Array.from({ length: colors.length / 8 }).map((_, index) => (
                  <CarouselIndicator key={index} index={index} />
                ))}
              </div>
            </Carousel>
          </div>
        </div>
      }
    />
  );
};

export const TextColorPicker = ({ editor }: { editor: Editor }) => {
  return (
    <UtilsModal
      title="Text color"
      content={
        <Carousel
          opts={{
            align: 'start',
            dragFree: true,
            slidesToScroll: 'auto',
          }}
          className="w-full max-w-md px-4 mx-auto"
        >
          <CarouselContent>
            <CarouselItem
              style={{
                flexBasis: 'calc(100% / 12)',
              }}
            >
              <IconButton
                icon="Ban"
                onClick={() => {
                  editor.chain().focus().unsetColor().run();
                }}
              />
            </CarouselItem>
            {colors.map((color, index) => (
              <CarouselItem
                key={index}
                style={{
                  flexBasis: 'calc(100% / 12)',
                }}
              >
                <button
                  onClick={() => {
                    editor.chain().focus().setColor(color.color).run();
                  }}
                  key={color.color}
                  className={cn(
                    'w-6 h-6 mb-1 drop-shadow rounded-full flex justify-center items-center cursor-pointer transition',
                    color.code,
                  )}
                >
                  <LucideIcon
                    name="Check"
                    className={cn(
                      'w-[14px] aspect-square',
                      editor.isActive('textStyle', {
                        color: color.color,
                      })
                        ? 'visible'
                        : 'invisible',
                    )}
                  />
                </button>
              </CarouselItem>
            ))}
          </CarouselContent>
          <div className="flex justify-center gap-2 mt-4 w-full max-w-sm">
            {Array.from({ length: colors.length / 8 }).map((_, index) => (
              <CarouselIndicator key={index} index={index} />
            ))}
          </div>
        </Carousel>
      }
    />
  );
};

export const checkActiveListsAndDBlocks = (editor: Editor) => {
  const { state } = editor;
  const { from, to } = state.selection;

  const activeListTypes = ['bulletList', 'orderedList', 'taskList'].filter(
    (type) => editor.isActive(type),
  );

  const activeDBlocks: number[] = [];
  const activeListDBlocks: number[] = [];
  const hasDBlock = Boolean(state.schema.nodes.dBlock);

  // First pass: collect the top-level containers in the selection.
  // v1: the dBlock wrappers. Flat v2: the top-level blocks themselves.
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (hasDBlock) {
      if (node.type.name === 'dBlock') {
        activeDBlocks.push(pos);
        let containsList = false;
        node.content.forEach((child) => {
          if (
            ['bulletList', 'orderedList', 'taskList'].includes(child.type.name)
          ) {
            containsList = true;
          }
        });
        if (containsList) {
          activeListDBlocks.push(pos);
        }
      }
      return;
    }

    if (state.doc.resolve(pos).depth === 0) {
      activeDBlocks.push(pos);
      if (['bulletList', 'orderedList', 'taskList'].includes(node.type.name)) {
        activeListDBlocks.push(pos);
      }
    }
  });

  // Check if there are multiple dBlocks with different content types.
  // Flat schema: mixed means the selection spans both list and non-list
  // top-level blocks.
  const hasMultipleContentTypes = !hasDBlock
    ? activeListDBlocks.length > 0 &&
      activeListDBlocks.length < activeDBlocks.length
    : activeDBlocks.length > 1 &&
      activeDBlocks.some((pos) => {
        const node = state.doc.nodeAt(pos);
        if (!node) return false;

        // Check if this dBlock has a different content type than others
        const hasListContent = node.content.content.some((child) =>
          ['bulletList', 'orderedList', 'taskList'].includes(child.type.name),
        );
        const hasNonListContent = node.content.content.some(
          (child) =>
            !['bulletList', 'orderedList', 'taskList'].includes(
              child.type.name,
            ),
        );

        return (
          (hasListContent && hasNonListContent) || // Mixed content in same dBlock
          (hasListContent && activeListDBlocks.length < activeDBlocks.length)
        ); // Some dBlocks don't have lists
      });

  return {
    activeListTypes,
    activeListDBlocks,
    activeDBlocks,
    from,
    to,
    state,
    hasMultipleLists:
      activeListTypes.length > 1 ||
      (activeListDBlocks.length > 1 && activeListTypes.length === 1) ||
      hasMultipleContentTypes,
  };
};
