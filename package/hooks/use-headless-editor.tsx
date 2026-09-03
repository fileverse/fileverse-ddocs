/* eslint-disable @typescript-eslint/ban-ts-comment */
import { AnyExtension, Editor, JSONContent } from '@tiptap/react';
import { defaultExtensions } from '../extensions/default-extension';
import customTextInputRules from '../extensions/customTextInputRules';
import { PageBreak } from '../extensions/page-break';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { isJSONString } from '../utils/isJsonString';
import { fromUint8Array, toUint8Array } from 'js-base64';
import { sanitizeContent } from '../utils/sanitize-content';
import { unwrapDBlocksInJSON } from '../utils/block-schema';
import {
  DDOC_META_ROOT_KEY,
  SCHEMA_VERSION_META_KEY,
} from '../utils/schema-version';
import { handleMarkdownContent } from '../extensions/mardown-paste-handler';
import { DOCX_STYLE_MAP } from '../extensions/docx/docx-import';
import { readDocxSpacingFromArchive } from '../extensions/docx/docx-spacing';
import { IpfsImageUploadResponse } from '../types';
import mammoth from 'mammoth';
import { CommentExtension as Comment } from '../extensions/comment';
import {
  ACTIVE_TAB_STATE_KEY,
  DEFAULT_TAB_ID,
  getTabsYdocNodes,
  mergeTabAwareYjsUpdates,
} from '../components/tabs/utils/tab-utils';
import { v4 as uuidv4 } from 'uuid';

export interface UseHeadlessEditorProps {
  optionalExtensions?: string[];
}

export interface TabbedJSONContentTab {
  name: string;
  emoji: string | null;
  content: JSONContent;
}

export interface TabbedJSONContent {
  type: 'tabbed-doc';
  title: string;
  tabs: TabbedJSONContentTab[];
}

/**
 * The exact extension set the headless editor runs with. Exported so tests
 * can build an equivalent editor without the hook.
 */
export const getHeadlessExtensions = (options?: {
  ydoc?: Y.Doc;
  field?: string;
  optionalExtensions?: string[];
  schemaVersion?: number;
}): AnyExtension[] => {
  const ydoc = options?.ydoc ?? new Y.Doc();

  const getOptionalExtensions = () => {
    const optionalExtensions = [];
    if (options?.optionalExtensions?.includes('comment')) {
      const commentExtensions = Comment.configure({
        HTMLAttributes: {
          class: 'inline-comment',
        },
      });
      optionalExtensions.push(commentExtensions);
    }
    return optionalExtensions;
  };

  return [
    ...defaultExtensions({
      onError: () => null,
      schemaVersion: options?.schemaVersion,
    }).filter((extension) => extension.name !== 'characterCount'),
    customTextInputRules,
    PageBreak,
    Collaboration.configure({
      document: ydoc,
      ...(options?.field ? { field: options.field } : {}),
    }),
    ...getOptionalExtensions(),
  ] as unknown as AnyExtension[];
};

export const setJSONContent = (content: JSONContent, editor: Editor) => {
  const hasDBlock = Boolean(editor.schema.nodes.dBlock);
  editor.commands.setContent(
    sanitizeContent({
      data: hasDBlock ? content : unwrapDBlocksInJSON(content),
      wrapInDBlock: hasDBlock,
    }),
  );
};

export const writeJSONContentToYjsField = ({
  content,
  field,
  schemaVersion,
  ydoc,
}: {
  content: JSONContent;
  field: string;
  schemaVersion?: number;
  ydoc: Y.Doc;
}) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({ ydoc, field, schemaVersion }),
    textDirection: 'auto',
    autofocus: false,
  });

  setJSONContent(content, editor);
  editor.destroy();
};

export const createHeadlessEditorRuntime = (props?: UseHeadlessEditorProps) => {
  const getEditor = (options?: { schemaVersion?: number }) => {
    const ydoc = new Y.Doc();

    // Blobs produced headlessly (templates, imports) already have content
    // when the real editor first mounts them, so useDocSchemaVersion will
    // never stamp them — the stamp must be born inside the blob here, or
    // the doc is treated as legacy v1 forever. 'self' origin, same as the
    // mount-time stamping: bootstrapping metadata is not a user edit.
    if ((options?.schemaVersion ?? 1) >= 2) {
      ydoc.transact(() => {
        ydoc
          .getMap(DDOC_META_ROOT_KEY)
          .set(SCHEMA_VERSION_META_KEY, options?.schemaVersion);
      }, 'self');
    }

    const extensions = getHeadlessExtensions({
      ydoc,
      optionalExtensions: props?.optionalExtensions,
      schemaVersion: options?.schemaVersion,
    });

    const editor = new Editor({
      extensions,
      textDirection: 'auto',
      autofocus: false,
    });
    return { editor, ydoc };
  };

  const isContentYjsEncoded = (
    initialContent: string[] | JSONContent | string | null,
  ) => {
    return (
      Array.isArray(initialContent) ||
      (typeof initialContent === 'string' && !isJSONString(initialContent))
    );
  };

  const mergeAndApplyUpdate = (contents: string[], ydoc: Y.Doc) => {
    Y.applyUpdate(ydoc, toUint8Array(mergeTabAwareYjsUpdates(contents)));
  };

  const mergeYjsUpdates = (contents: string[]) => {
    return mergeTabAwareYjsUpdates(contents);
  };

  const setContent = (
    initialContent: string | string[] | JSONContent,
    editor: Editor,
    ydoc: Y.Doc,
  ) => {
    if (!editor) throw new Error('cannot set content without Editor');
    const isYjsEncoded = isContentYjsEncoded(initialContent as string);
    if (isYjsEncoded) {
      if (Array.isArray(initialContent)) {
        mergeAndApplyUpdate(initialContent, ydoc);
      } else {
        Y.applyUpdate(ydoc, toUint8Array(initialContent as string));
      }
    } else {
      // v1-shaped JSON (templates, legacy exports) cannot load into the flat
      // schema; setJSONContent hoists blocks out of their dBlock wrappers.
      setJSONContent(initialContent as JSONContent, editor);
    }
  };

  const getYjsConvertor = (options?: { schemaVersion?: number }) => {
    const { editor, ydoc } = getEditor(options);
    return {
      convertJSONContentToYjsEncodedString: (content: JSONContent) => {
        setContent(content, editor, ydoc);
        return fromUint8Array(Y.encodeStateAsUpdate(ydoc));
      },
      convertTabbedJSONContentToYjsEncodedString: (
        template: TabbedJSONContent,
      ) => {
        if (template.tabs.length === 0) {
          throw new Error('Tabbed template must contain at least one tab');
        }

        const tabIds = template.tabs.map((_, index) =>
          index === 0 ? DEFAULT_TAB_ID : uuidv4(),
        );
        const tabNodes = getTabsYdocNodes(ydoc);

        setContent(template.tabs[0].content, editor, ydoc);
        template.tabs.slice(1).forEach((tab, index) => {
          writeJSONContentToYjsField({
            content: tab.content,
            field: tabIds[index + 1],
            schemaVersion: options?.schemaVersion,
            ydoc,
          });
        });

        ydoc.transact(() => {
          tabNodes.order.insert(0, tabIds);
          template.tabs.forEach((tab, index) => {
            const tabId = tabIds[index];
            tabNodes.nameById.set(tabId, tab.name);
            tabNodes.emojiById.set(tabId, tab.emoji);
          });
          tabNodes.tabState.set(ACTIVE_TAB_STATE_KEY, tabIds[0]);
        }, 'self');

        return fromUint8Array(Y.encodeStateAsUpdate(ydoc));
      },
      cleanup: () => {
        if (editor) {
          editor.destroy();
        }
        if (ydoc) {
          ydoc.destroy();
        }
      },
    };
  };

  const downloadContentAsMd = async (
    content: string | string[] | JSONContent,
    title: string,
  ) => {
    const { editor, ydoc } = getEditor();
    setContent(content, editor, ydoc);
    if (editor) {
      const generateDownloadUrl = await editor.commands.exportMarkdownFile();
      if (generateDownloadUrl) {
        const url = generateDownloadUrl;
        const link = document.createElement('a');
        link.href = url;
        link.download = title + '.md';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        editor.destroy();
      } else {
        throw new Error('Failed to generate download url');
      }
    } else {
      throw new Error('Editor is not available');
    }
  };

  const downloadContentAsHtml = async (
    content: string | string[] | JSONContent,
    title: string,
  ) => {
    const { editor, ydoc } = getEditor();
    setContent(content, editor, ydoc);
    if (editor) {
      const generateDownloadUrl = await editor.commands.exportHtmlFile({
        title,
      });
      if (generateDownloadUrl) {
        const url = generateDownloadUrl;
        const link = document.createElement('a');
        link.href = url;
        link.download = title + '.html';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        editor.destroy();
      } else {
        throw new Error('Failed to generate download url');
      }
    } else {
      throw new Error('Editor is not available');
    }
  };

  const downloadContentAsTxt = async (
    content: string | string[] | JSONContent,
    title: string,
  ) => {
    const { editor, ydoc } = getEditor();
    setContent(content, editor, ydoc);
    if (editor) {
      const generateDownloadUrl = await editor.commands.exportTxtFile({
        title,
      });
      if (generateDownloadUrl) {
        const url = generateDownloadUrl;
        const link = document.createElement('a');
        link.href = url;
        link.download = title + '.txt';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        editor.destroy();
      } else {
        throw new Error('Failed to generate download url');
      }
    } else {
      throw new Error('Editor is not available');
    }
  };
  async function getYjsContentFromMarkdown(
    file: File,
    ipfsImageUploadFn: (file: File) => Promise<IpfsImageUploadResponse>,
  ): Promise<string | null> {
    if (file.type === 'text/markdown' || file.name.endsWith('.md')) {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = (err) => reject(err);
        reader.readAsText(file);
      });

      const { editor, ydoc } = getEditor();

      await handleMarkdownContent(editor.view, content, ipfsImageUploadFn);

      const yjsContent = Y.encodeStateAsUpdate(ydoc);
      const result = fromUint8Array(yjsContent);

      editor.destroy();
      !ydoc.isDestroyed && ydoc.destroy();
      return result;
    }

    return null;
  }

  async function getYjsContentFromDocx(
    file: File,
    ipfsImageUploadFn: (file: File) => Promise<IpfsImageUploadResponse>,
  ): Promise<string | null> {
    if (
      file.type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.name.endsWith('.docx')
    ) {
      try {
        const arrayBuffer = await file.arrayBuffer();

        // Same mammoth configuration as the in-editor import
        // (extensions/docx/docx-import.tsx): the style map is what carries
        // underline and highlight, and empty paragraphs must survive so the
        // spacing pass can pair 1:1 with the w:p elements.
        const { value: extractedHtml } = await mammoth.convertToHtml(
          { arrayBuffer },
          {
            styleMap: DOCX_STYLE_MAP,
            ignoreEmptyParagraphs: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            convertImage: (mammoth as any).images.inline(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              async (element: any) => {
                const buffer = await element.read('base64');
                const contentType = element.contentType; // e.g., "image/png"
                return {
                  src: `data:${contentType};base64,${buffer}`,
                };
              },
            ),
          },
        );

        // Mammoth is a semantic converter and drops every presentation
        // attribute, so spacing, alignment, font and colour are read off the
        // same buffer and zipped back on.
        const spacedHtml = await readDocxSpacingFromArchive(
          arrayBuffer,
          extractedHtml,
        );

        const { editor, ydoc } = getEditor();

        // Feed extracted HTML into your existing import pipeline
        await handleMarkdownContent(
          editor.view,
          spacedHtml,
          ipfsImageUploadFn,
          { preserveEmptyParagraphs: true },
        );

        const yjsContent = Y.encodeStateAsUpdate(ydoc);
        const result = fromUint8Array(yjsContent);

        editor.destroy();
        !ydoc.isDestroyed && ydoc.destroy();
        return result;
      } catch (err) {
        console.error('Error processing DOCX file:', err);
        return null;
      }
    }

    return null;
  }

  return {
    setContent,
    getEditor,
    getYjsConvertor,
    downloadContentAsMd,
    downloadContentAsHtml,
    downloadContentAsTxt,
    mergeYjsUpdates,
    handleMarkdownContent,
    getYjsContentFromMarkdown,
    getYjsContentFromDocx,
  };
};

export const useHeadlessEditor = (props?: UseHeadlessEditorProps) =>
  createHeadlessEditorRuntime(props);
