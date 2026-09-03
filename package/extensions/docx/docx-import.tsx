/* eslint-disable @typescript-eslint/no-explicit-any */
import { Extension } from '@tiptap/core';
import mammoth from 'mammoth';
import { inlineLoader } from '../../utils/inline-loader';
import { IpfsImageUploadResponse } from '../../types';
import { handleMarkdownContent } from '../mardown-paste-handler';
import { readDocxSpacingFromArchive } from './docx-spacing';

export const DOCX_STYLE_MAP = [
  'u => u',
  "highlight[color='yellow'] => mark[data-color='#FFFF00']",
  "highlight[color='green'] => mark[data-color='#00FF00']",
  "highlight[color='cyan'] => mark[data-color='#00FFFF']",
  "highlight[color='magenta'] => mark[data-color='#FF00FF']",
  "highlight[color='red'] => mark[data-color='#FF0000']",
  "highlight[color='blue'] => mark[data-color='#0000FF']",
  "highlight[color='darkBlue'] => mark[data-color='#00008B']",
  "highlight[color='darkCyan'] => mark[data-color='#008B8B']",
  "highlight[color='darkGreen'] => mark[data-color='#006400']",
  "highlight[color='darkMagenta'] => mark[data-color='#8B008B']",
  "highlight[color='darkRed'] => mark[data-color='#8B0000']",
  "highlight[color='darkYellow'] => mark[data-color='#808000']",
  "highlight[color='darkGray'] => mark[data-color='#A9A9A9']",
  "highlight[color='lightGray'] => mark[data-color='#D3D3D3']",
  "highlight[color='black'] => mark[data-color='#000000']",
  'highlight => mark',
];

declare module '@tiptap/core' {
  interface Commands {
    uploadDocxFile: {
      /**
       * Import a DOCX file and insert its content into the editor.
       * Automatically handles embedded images via IPFS secure image upload.
       */
      uploadDocxFile: (
        ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
        onError?: (error: string) => void,
        onDocxImport?: () => void,
      ) => any;
    };
  }
}

export const DocxFileHandler = Extension.create({
  name: 'docxFileHandler',

  addCommands() {
    return {
      uploadDocxFile:
        (
          ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
          onError?: (error: string) => void,
          onDocxImport?: () => void,
        ) =>
        async ({ view }: { view: any }) => {
          const input = document.createElement('input');
          input.type = 'file';
          input.accept =
            '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

          input.onchange = async (event: any) => {
            const files = event.target.files;
            if (!files || files.length === 0) return;

            const file = files[0];

            // Validate extension
            const isDocx =
              file.type ===
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
              file.name.endsWith('.docx');

            if (!isDocx) {
              const errMsg = `Oops! That file type isn't supported. Give it another go with a .docx file.`;
              onError?.(errMsg);
              throw new Error(errMsg);
            }

            const { showLoader, removeLoader } = inlineLoader(
              this.editor,
              'Importing DOCX file ...',
            );
            const loader = showLoader();

            // Show warning loader only for files larger than 10MB
            let warningLoader: HTMLDivElement | null = null;
            let removeWarningLoader: ((div?: HTMLDivElement) => void) | null =
              null;

            if (file.size > 10 * 1024 * 1024) {
              // 10MB in bytes
              const warningLoaderData = inlineLoader(
                this.editor,
                'Importing large file… this may take a while',
              );
              warningLoader = warningLoaderData.showLoader() as HTMLDivElement;
              removeWarningLoader = warningLoaderData.removeLoader;
            }

            try {
              const arrayBuffer = await file.arrayBuffer();

              const { value: extractedHtml } = await mammoth.convertToHtml(
                { arrayBuffer },
                {
                  styleMap: DOCX_STYLE_MAP,
                  // Off by default. Empty paragraphs must survive for the
                  // spacing pass below to line up one-to-one with the w:p
                  // elements — and a blank line the author typed is content.
                  ignoreEmptyParagraphs: false,
                  convertImage: (mammoth as any).images.inline(
                    async (element: any) => {
                      const buffer = await element.read('base64');
                      const contentType = element.contentType;
                      return {
                        src: `data:${contentType};base64,${buffer}`,
                      };
                    },
                  ),
                },
              );

              // Mammoth is a semantic converter and drops w:spacing entirely,
              // so the spacing is read from the same buffer and zipped back on.
              const spacedHtml = await readDocxSpacingFromArchive(
                arrayBuffer,
                extractedHtml,
              );

              // A blank line the author typed is content — which is why
              // mammoth is asked for them above. handleMarkdownContent strips
              // empty paragraphs by default (markdown-it invents its own), so
              // opt out here or the whole ignoreEmptyParagraphs pass is undone.
              // preserveLiteralText: this is HTML, not markdown. A tilde,
              // caret or asterisk the author typed is text — reinterpreting it
              // is what subscripted whole lines of dialogue.
              await handleMarkdownContent(view, spacedHtml, ipfsImageUploadFn, {
                preserveEmptyParagraphs: true,
                preserveLiteralText: true,
              });
              onDocxImport?.();
            } catch (err: any) {
              console.error(err);
              onError?.('Error importing DOCX file');
            } finally {
              removeLoader(loader);
              if (warningLoader && removeWarningLoader) {
                removeWarningLoader(warningLoader);
              }
            }
          };

          input.click();
          return true;
        },
    };
  },
});
