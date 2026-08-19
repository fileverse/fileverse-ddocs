/* eslint-disable @typescript-eslint/ban-ts-comment */
// define your extension array

import StarterKit from '@tiptap/starter-kit';
import FontFamily from '@tiptap/extension-font-family';
import TextAlign from '@tiptap/extension-text-align';
import {
  getHierarchicalIndexes,
  type TableOfContentDataItem,
} from '@tiptap/extension-table-of-contents';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { v4 as uuidv4 } from 'uuid';

const ExtendedTextStyle = TextStyle.extend({
  addAttributes() {
    return {
      // ...this.parent?.(),
      // color: {
      //   default: null,
      //   parseHTML: (element) => element.style.color,
      //   renderHTML: (attributes) => {
      //     if (!attributes.color) {
      //       return {};
      //     }
      //     return {
      //       style: `color: ${attributes.color}`,
      //     };
      //   },
      // },
      'data-original-color': {
        default: null,
        parseHTML: (element) => element.getAttribute('data-original-color'),
        renderHTML: (attributes) => {
          if (!attributes['data-original-color']) {
            return {};
          }
          return {
            'data-original-color': attributes['data-original-color'],
          };
        },
      },
    };
  },
});
import { CommonMarkBold, CommonMarkItalic } from './commonmark-emphasis';
import HorizontalRule from './horizontal-rule';
import ColumnExtension from './multi-column';
import { FlatColumn } from './multi-column/column';
import { CollapsibleHeading } from './collapsible-heading';
import { Color } from '@tiptap/extension-color';
import { Iframe } from './iframe';
import { EmbeddedTweet } from './twitter-embed';
import { createDBlockExtension } from './d-block';
import { FlatHeadingCollapse } from './d-block/dblock-collapse';
import { FlatMediaConversion } from './d-block/dblock-media-plugin';
import { BlockId } from './block-id';
import { ListNormalization } from './list-normalization';
import { UndoSelection } from './undo-selection';
import { AiWriterSpaceTrigger } from './ai-writer/ai-writer-space-trigger';
import { SuperchargedTableExtensions } from './supercharged-table';
import { Document, FlatDocument } from './document';
import { TrailingNode } from './trailing-node';
import { type NodeType } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { type Editor, InputRule } from '@tiptap/core';
import { actionButton } from './action-button';
import { Markdown } from 'tiptap-markdown';
import Typography from '@tiptap/extension-typography';
import MarkdownPasteHandler from './mardown-paste-handler';
import HtmlExportExtension from './html-export';
import TextExportExtension from './text-export';
import OdtExportExtension from './odt-export';
import { DocxFileHandler } from './docx/docx-import';
import { MathExtension } from '@aarkue/tiptap-math-extension';
import { Footnote } from './footnote/footnote';
import Superscript from '@tiptap/extension-superscript';
import Subscript from '@tiptap/extension-subscript';
import {
  BulletList,
  TaskList,
  TaskItem,
  ListItem,
} from '@tiptap/extension-list';
import {
  Dropcursor,
  Gapcursor,
  Placeholder,
  CharacterCount,
} from '@tiptap/extensions';
import { ResizableMedia } from './resizable-media';
import { MediaCaption } from './resizable-media/media-caption';
import LinkPreview from './link-preview/link-preview';
import { Callout } from './callout/callout';
import { FontSize } from './font-size';
import { FontFamilyPersistence } from './font-family-persistence';
import { TypographyPersistence } from './typography-persistence';
import { CustomCodeBlockLowlight } from './code-block/custom-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import { LineHeight } from './line-height';

import { Emoji } from './emoji/emoji';

const lowlight = createLowlight(common);
import { IpfsImageFetchPayload, IpfsImageUploadResponse } from '../types';
import { type ToCItemType } from '../components/toc/types';
import type { DBlockRuntimeStateRef } from './d-block/dblock-runtime';
import { CustomLink } from './custom-link';
import { suggestionTrackingPluginKey } from './suggestion/suggestion-tracking-extension';
import { DdocTableOfContents } from './table-of-contents';
import SearchAndReplace from './search-replace/search-replace';
import { SuperscriptSubscriptControls } from './superscript-subscript-controls';

const pendingTocIdRepairs = new WeakSet<Editor>();

const isValidTocId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0;

const isLinkSafeHeadingId = (id: unknown): id is string =>
  isValidTocId(id) &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    id,
  );

const addIdCount = (counts: Map<string, number>, id: unknown) => {
  if (!isValidTocId(id)) return;
  counts.set(id, (counts.get(id) ?? 0) + 1);
};

const getHeadingIdCounts = (editor: Editor) => {
  const counts = new Map<string, number>();

  editor.state.doc.descendants((node) => {
    if (node.type.name !== 'heading' || node.textContent.length === 0) {
      return;
    }

    addIdCount(counts, node.attrs.id);
    addIdCount(counts, node.attrs['data-toc-id']);
  });

  return counts;
};

const getRepairTocId = (idCounts: Map<string, number>) => {
  let id = uuidv4();

  while (idCounts.has(id)) {
    id = uuidv4();
  }

  idCounts.set(id, 1);

  return id;
};

const getSafeExistingTocId = (id: unknown, idCounts: Map<string, number>) => {
  if (!isLinkSafeHeadingId(id) || idCounts.get(id) !== 1) {
    return null;
  }

  return id;
};

const scheduleMissingTocIdRepair = (items: TableOfContentDataItem[]) => {
  const editor = items.find((item) => item.editor)?.editor;

  if (!editor || pendingTocIdRepairs.has(editor)) {
    return;
  }

  pendingTocIdRepairs.add(editor);

  queueMicrotask(() => {
    pendingTocIdRepairs.delete(editor);

    if (editor.isDestroyed) {
      return;
    }

    const idCounts = getHeadingIdCounts(editor);
    let tr = editor.state.tr;

    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading' || node.textContent.length === 0) {
        return;
      }

      if (isValidTocId(node.attrs['data-toc-id'])) {
        return;
      }

      // Reuse a heading ID only when it is unique across both link-facing attrs.
      const existingId = getSafeExistingTocId(node.attrs.id, idCounts);

      if (existingId) {
        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          'data-toc-id': existingId,
        });
        return;
      }

      const id = getRepairTocId(idCounts);
      tr = tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        id,
        'data-toc-id': id,
      });
    });

    if (!tr.docChanged) {
      return;
    }

    editor.view.dispatch(
      tr
        .setMeta('addToHistory', false)
        .setMeta(suggestionTrackingPluginKey, true),
    );
  });
};

const ExtendedSubscript = Subscript.extend({
  addProseMirrorPlugins() {
    const parentPlugins = this.parent?.() || [];
    return [
      ...parentPlugins,
      new Plugin({
        props: {
          // Extends the default Subscript mark so users can exit subscript mode by typing a space.
          handleTextInput: (view, from, to, text) => {
            if (text !== ' ') return false;
            const { state } = view;
            const { selection } = state;
            if (!selection.empty) return false;

            const subscriptMark = state.schema.marks.subscript;
            if (!subscriptMark) return false;

            const activeMarks = state.storedMarks || selection.$from.marks();
            if (!subscriptMark.isInSet(activeMarks)) return false;

            // Replace the current text input with a literal space and remove
            // the stored subscript mark so subsequent typing is normal text.
            const tr = state.tr.replaceRangeWith(
              from,
              to,
              state.schema.text(' '),
            );
            tr.removeStoredMark(subscriptMark);
            view.dispatch(tr);
            return true;
          },
        },
      }),
    ];
  },
});

export const defaultExtensions = ({
  ipfsImageFetchFn,
  onError,
  metadataProxyUrl,
  onCopyHeadingLink,
  ipfsImageUploadFn,
  fetchV1ImageFn,
  onTocUpdate,
  dBlockRuntimeStateRef,
  hasAvailableModels = false,
  schemaVersion = 1,
}: {
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  onError: (error: string) => void;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  metadataProxyUrl?: string;
  onCopyHeadingLink?: (link: string) => void;
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
  onTocUpdate?: (data: ToCItemType[], isCreate?: boolean) => void;
  dBlockRuntimeStateRef?: DBlockRuntimeStateRef;
  hasAvailableModels?: boolean;
  schemaVersion?: number;
}) => [
  FontFamily,
  FontFamilyPersistence,
  TypographyPersistence,
  StarterKit.configure({
    strike: {
      HTMLAttributes: {
        class: 'select-text pointer-events-auto',
      },
    },
    // Replaced by CommonMarkBold/CommonMarkItalic below: upstream input/paste
    // rules italicize spaced `* x *`, eating multiplication (TEC-2634).
    bold: false,
    italic: false,
    underline: {
      HTMLAttributes: {
        class: 'select-text pointer-events-auto',
      },
    },
    link: false,
    paragraph: {
      HTMLAttributes: {
        class: 'select-text pointer-events-auto transition-all',
      },
    },
    orderedList: {
      HTMLAttributes: {
        class:
          'flex flex-col items-start list-decimal list-outside space-y-2 !ml-[1.25rem]',
      },
    },
    blockquote: {
      HTMLAttributes: {
        class:
          'pl-4 border-l-4 color-border-default italic color-text-secondary my-2',
      },
    },
    code: {
      HTMLAttributes: {
        class:
          'rounded bg-transparent p-1.5 font-mono font-medium color-text-default text-body-sm',
        spellcheck: 'false',
      },
    },
    heading: false,
    undoRedo: false,
    gapcursor: false,
    dropcursor: false,
    document: false,
    horizontalRule: false,
    bulletList: false,
    listItem: false,
    codeBlock: false,
    // v1 uses the custom dBlock-aware TrailingNode registered below; the
    // flat v2 schema uses StarterKit's stock one (schema-agnostic).
    trailingNode: schemaVersion >= 2 ? undefined : false,
  }),
  CommonMarkBold.configure({
    HTMLAttributes: {
      class: 'select-text pointer-events-auto',
    },
  }),
  CommonMarkItalic.configure({
    HTMLAttributes: {
      class: 'select-text pointer-events-auto',
    },
  }),
  CollapsibleHeading.configure({
    HTMLAttributes: {
      class: 'select-text pointer-events-auto',
    },
  }),
  DdocTableOfContents.configure({
    getIndex: getHierarchicalIndexes,
    onUpdate: (data, isCreate) => {
      const invalidItems = data.filter((item) => !isValidTocId(item.id));
      const validItems = data.filter((item) => isValidTocId(item.id));

      if (invalidItems.length > 0) {
        // Fallback for ToC IDs that reach onUpdate before TipTap repairs them.
        scheduleMissingTocIdRepair(invalidItems);
      }

      const newData = validItems.map((item) => {
        return {
          id: item.id,
          level: item.level,
          textContent: item.textContent,
          itemIndex: item.itemIndex,
          isActive: item.isActive,
        };
      });
      onTocUpdate?.(newData, isCreate);
    },
  }),
  CustomCodeBlockLowlight.configure({
    lowlight,
    defaultLanguage: 'plaintext',
  }),
  FontSize,
  LineHeight,
  Typography,
  TextAlign.configure({
    types: ['heading', 'paragraph'],
  }),
  HorizontalRule,
  CustomLink.configure({
    shouldAutoLink: (url) => /^https?:\/\//.test(url),
    autolink: true,
    openOnClick: false,
    HTMLAttributes: {
      class: 'custom-text-link',
      rel: 'noopener noreferrer',
      target: '_blank',
    },
    onForeignHeadingLink: onError,
  }),
  Placeholder.configure({
    placeholder: () => '',
    includeChildren: true,
    showOnlyCurrent: true,
  }),
  Highlight.configure({ multicolor: true }),
  ExtendedTextStyle,
  Color,
  TaskList.configure({
    HTMLAttributes: {
      class: 'not-prose space-y-2 !ml-0',
    },
  }),
  TaskItem.configure({
    HTMLAttributes: {
      class: 'grid task-item',
    },
    nested: true,
  }),
  BulletList.configure({
    HTMLAttributes: {
      class: 'not-prose space-y-2 !ml-[1.25rem]',
    },
  }),
  ListItem.configure({
    HTMLAttributes: {
      class: 'leading-normal w-full',
    },
  }),
  Dropcursor.configure({
    width: 3,
    color: '#d1d5db',
  }),
  MediaCaption,
  ResizableMedia.configure({
    onError: onError,
    ipfsImageUploadFn,
    ipfsImageFetchFn,
    fetchV1ImageFn,
  }),
  // v1 keeps the gap cursor it has always shipped with. v2 drops it
  // entirely (TEC-2679): the flat schema exposes gap positions at every
  // image→table / table→table / before-embed boundary, where the cursor
  // renders as a stray dash glued to the following block's border — while
  // mouse clicks in the gap don't even reach it (browser caret-from-point
  // snaps into the nearest table cell) and vertical arrows hop table→table
  // past it. Tiptap's Notion-like template ships the extension too, but the
  // state is equally unreachable through normal input there (verified live:
  // mid-gap clicks land in a cell, arrows skip the boundary) — the real
  // insert-between-blocks affordance is the block handle's plus button,
  // which we match. Removing the state beats restyling an artifact users
  // can neither aim for nor understand.
  ...(schemaVersion >= 2 ? [] : [Gapcursor]),
  // Both schemas: Yjs restores a stale selection after undo/redo.
  UndoSelection,
  // Schema fork. v1: every block wrapped in a dBlock (TrailingNode's position
  // math assumes the wrapper, so it is v1-only until re-homed in M2).
  // v2: flat top node, stock Tiptap structure.
  ...(schemaVersion >= 2
    ? [
        FlatDocument,
        // Supplies the read-only-preview heading chrome that v1 renders from
        // its node view (flat blocks have none).
        FlatHeadingCollapse.configure({ onCopyHeadingLink }),
        // Pasted image/video URLs convert to media in v1 through a plugin
        // registered inside the dBlock extension; re-registered here for v2.
        FlatMediaConversion.configure({
          getRuntimeState: dBlockRuntimeStateRef
            ? () => dBlockRuntimeStateRef.current
            : undefined,
        }),
        BlockId,
        // Notion-template parity: Backspace on an empty block between two
        // same-type lists joins them (TEC-2679). v1's lists live inside
        // dBlock wrappers where this is the custom keymap's territory.
        ListNormalization,
        // Same hasAvailableModels gate as v1's in-dBlock space trigger.
        ...(hasAvailableModels ? [AiWriterSpaceTrigger] : []),
      ]
    : [
        createDBlockExtension({
          ipfsImageUploadFn,
          onCopyHeadingLink,
          hasAvailableModels,
          getRuntimeState: dBlockRuntimeStateRef
            ? () => dBlockRuntimeStateRef.current
            : undefined,
        }),
        TrailingNode,
        Document,
      ]),
  ...SuperchargedTableExtensions,
  Iframe.configure({ ipfsImageFetchFn, fetchV1ImageFn }),
  EmbeddedTweet,
  actionButton.configure({
    onError,
  }),
  // v2 swaps the column node for one whose content is bare blocks.
  ...(schemaVersion >= 2
    ? [ColumnExtension.configure({ column: false }), FlatColumn]
    : [ColumnExtension]),
  DocxFileHandler.configure({
    ipfsImageUploadFn,
    onError,
  }),
  MarkdownPasteHandler(ipfsImageUploadFn, ipfsImageFetchFn),
  HtmlExportExtension(ipfsImageFetchFn, fetchV1ImageFn),
  TextExportExtension(),
  OdtExportExtension(ipfsImageFetchFn, fetchV1ImageFn),
  Markdown.configure({
    tightListClass: 'tight',
    bulletListMarker: '-',
    linkify: true,
    breaks: true,
    transformPastedText: true,
    tightLists: true,
    html: true,
    transformCopiedText: true,
  }),
  CharacterCount,
  SearchAndReplace,
  MathExtension.configure({
    addInlineMath: true,
    // Math is notation here, not a calculator. With evaluation on, clicking a
    // formula toggles an appended "=<result>", and the evaluator only handles
    // plain arithmetic — so any symbolic math (\sum, \int, fractions, an
    // empty-bound \sum_{123}^{}) shows "=Error" on click. Disable it so math
    // just renders.
    evaluation: false,
    delimiters: 'dollar',
    katexOptions: {
      throwOnError: false,
      strict: false,
    },
    renderTextMode: 'raw-latex',
  }),
  Footnote,
  Superscript.configure({
    HTMLAttributes: {
      class: 'superscript',
    },
  }),
  ExtendedSubscript.configure({
    HTMLAttributes: {
      class: 'subscript',
    },
  }),
  SuperscriptSubscriptControls,
  LinkPreview.configure({
    metadataProxyUrl: metadataProxyUrl,
  }),
  Callout,
  Emoji,
];

export const createInputRule = (
  pattern: RegExp,
  data: string,
  type: NodeType,
) => {
  return new InputRule({
    find: pattern,
    // @ts-ignore
    handler: ({ state, range, commands }) => {
      const attributes = {
        data,
      };

      const { tr } = state;
      const start = range.from;
      const end = range.to;

      tr.insert(start - 1, type.create(attributes)).delete(
        tr.mapping.map(start),
        tr.mapping.map(end),
      );

      // focus on the node that was just created
      commands.focus(end - 1);
    },
  });
};
