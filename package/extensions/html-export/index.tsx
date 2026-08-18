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
    exportHtmlFile: {
      exportHtmlFile: (props?: { title?: string }) => any;
    };
  }
}

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
        exportHtmlFile:
          (props?: { title?: string }) =>
          async ({ editor }: { editor: Editor }): Promise<string> => {
            const { showLoader, removeLoader } = inlineLoader(
              editor,
              'Exporting HTML file ...',
            );

            const loader = showLoader();

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

            const rawHtml = temporalEditor.getHTML();
            const inlineHtml = await renderMermaidBlocks(rawHtml);

            // Hooks are global on the DOMPurify instance — remove in a
            // finally so this empty-element pruning can't leak into every
            // later sanitize (it would even delete an svg's empty <path>s).
            DOMPurify.addHook('afterSanitizeElements', (node: any) => {
              if (
                node.nodeType === 1 &&
                node.tagName !== 'BR' &&
                !node.textContent.trim() &&
                !node.children.length
              ) {
                node.parentNode?.removeChild(node);
              }
            });

            // Sanitize HTML content using the utility function.
            //
            // `style` is listed explicitly: it is what lets block styling
            // (paragraph spacing, alignment, line height) survive HTML export.
            // It also arrives via MERMAID_SVG_ATTRS, so naming it here keeps it
            // from being dropped by accident if that list is ever narrowed.
            let cleanHtml: string;
            try {
              cleanHtml = DOMPurify.sanitize(inlineHtml, {
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
                ALLOWED_ATTR: ['href', 'style', ...MERMAID_SVG_ATTRS],
                FORBID_ATTR: ['data-toc-id', 'data-tight'],
              });
            } finally {
              // DOMPurify is a module singleton, so a hook left registered here
              // also fires on the markdown import sanitize, where it deletes
              // childless textless elements — including a spacing-only
              // paragraph. finally, so a throw cannot leak it.
              DOMPurify.removeHook('afterSanitizeElements');
            }

            // Build metadata dynamically from props
            const metadata = {
              title: props?.title || 'Untitled',
              date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
            };

            // The document's custom CSS (author-supplied). sanitizeCustomCss
            // scopes it to `body` (the export's document root, mirroring the
            // editor's `.ProseMirror`) AND strips injection vectors — breakout,
            // url()/@import exfiltration, position:fixed overlays. The returned
            // string is already `body { … }`-wrapped and safe to embed. Injected
            // AFTER DOMPurify (which sanitizes the body only), so it survives.
            const styleTag = sanitizeCustomCss(
              editor.storage?.markdownPasteHandler?.customCSS || '',
              'body',
            );
            const styleBlock = styleTag
              ? `\n      <style>\n${styleTag}\n      </style>`
              : '';

            // Create a clean HTML document (no classes/IDs); the only styling is
            // the author's custom CSS, when present.
            const htmlContent = `
  <html>
    <head>
      <title>${metadata.title}</title>${styleBlock}
    </head>
    <body>
      ${cleanHtml}
    </body>
  </html>
`;

            const formattedHtml = await prettifyHtml(htmlContent);
            const blob = new Blob([formattedHtml], {
              type: 'text/html;charset=utf-8',
            });
            const downloadUrl = URL.createObjectURL(blob);

            temporalEditor.destroy();
            removeLoader(loader);
            return downloadUrl;
          },
      };
    },
  });
};

export default HtmlExportExtension;
