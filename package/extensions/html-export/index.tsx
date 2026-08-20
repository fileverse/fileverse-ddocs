/* eslint-disable @typescript-eslint/no-explicit-any */
import { Editor, Extension } from '@tiptap/core';
import { inlineLoader } from '../../utils/inline-loader';
import { IpfsImageFetchPayload } from '../../types';
import { getTemporaryEditor } from '../../utils/helpers';
import { searchForSecureImageNodeAndEmbedImageContent } from '../mardown-paste-handler';
import DOMPurify from 'dompurify';
import { prettifyHtml } from '../../utils/prettify-html';
import { sanitizeCustomCss } from '../../utils/sanitize-css';
import {
  MERMAID_SVG_ATTRS,
  MERMAID_SVG_TAGS,
  renderMermaidBlocks,
} from '../code-block/render-mermaid-html';

// Define the command type
declare module '@tiptap/core' {
  interface Commands {
    exportHtmlContent: {
      exportHtmlContent: () => any;
    };
    exportHtmlFile: {
      exportHtmlFile: (props?: { title?: string }) => any;
    };
  }
}

const buildHtmlExportBody = async (
  editor: Editor,
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>,
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>,
): Promise<string> => {
  const originalDoc: any = editor.state.doc;

  const docWithEmbedImageContent: any =
    await searchForSecureImageNodeAndEmbedImageContent(
      originalDoc,
      ipfsImageFetchFn,
      fetchV1ImageFn,
    );

  const temporalEditor = getTemporaryEditor(
    editor,
    docWithEmbedImageContent.toJSON(),
  );

  try {
    const rawHtml = temporalEditor.getHTML();
    const inlineHtml = await renderMermaidBlocks(rawHtml);
    return sanitizeHtmlExportBody(inlineHtml);
  } finally {
    temporalEditor.destroy();
  }
};

export const sanitizeHtmlExportBody = (html: string): string =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'h1',
      'h2',
      'h3',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'strong',
      'em',
      'u',
      's',
      'mark',
      'span',
      'br',
      'hr',
      'a',
      'img',
      'table',
      'tbody',
      'tr',
      'td',
      'th',
      'thead',
      'tfoot',
      ...MERMAID_SVG_TAGS,
    ],
    // `style` is listed explicitly even though MERMAID_SVG_ATTRS already
    // carries it: block styling (paragraph spacing, alignment, line height)
    // reaches an export through this one attribute, and inheriting it from a
    // list named for Mermaid SVGs makes it look incidental. Naming it here
    // keeps narrowing that list from silently stripping every block style.
    ALLOWED_ATTR: ['href', 'src', 'alt', 'style', ...MERMAID_SVG_ATTRS],
    FORBID_ATTR: ['data-toc-id', 'data-tight'],
  });

const HtmlExportExtension = (
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>,
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>,
) => {
  return Extension.create({
    name: 'htmlExport',

    addCommands() {
      return {
        exportHtmlContent:
          () =>
          async ({ editor }: { editor: Editor }): Promise<string> => {
            const { showLoader, removeLoader } = inlineLoader(
              editor,
              'Preparing HTML ...',
            );
            const loader = showLoader();

            try {
              return await buildHtmlExportBody(
                editor,
                ipfsImageFetchFn,
                fetchV1ImageFn,
              );
            } finally {
              removeLoader(loader);
            }
          },
        exportHtmlFile:
          (props?: { title?: string }) =>
          async ({ editor }: { editor: Editor }): Promise<string> => {
            const { showLoader, removeLoader } = inlineLoader(
              editor,
              'Exporting HTML file ...',
            );
            const loader = showLoader();

            try {
              const bodyHtml = await buildHtmlExportBody(
                editor,
                ipfsImageFetchFn,
                fetchV1ImageFn,
              );
              const styleTag = sanitizeCustomCss(
                editor.storage?.markdownPasteHandler?.customCSS || '',
                'body',
              );
              const styleBlock = styleTag
                ? `\n      <style>\n${styleTag}\n      </style>`
                : '';
              const title = props?.title || 'Untitled';
              const htmlContent = `
  <html>
    <head>
      <title>${title}</title>${styleBlock}
    </head>
    <body>
      ${bodyHtml}
    </body>
  </html>
`;
              const documentHtml = await prettifyHtml(htmlContent);
              const blob = new Blob([documentHtml], {
                type: 'text/html;charset=utf-8',
              });
              return URL.createObjectURL(blob);
            } finally {
              removeLoader(loader);
            }
          },
      };
    },
  });
};

export default HtmlExportExtension;
