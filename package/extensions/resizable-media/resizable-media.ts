/* eslint-disable @typescript-eslint/no-explicit-any */
import { mergeAttributes, Node, nodeInputRule } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { getResizableMediaNodeView } from './resizable-media-node-view';
import { getMediaPasteDropPlugin } from './media-paste-drop-plugin';
import UploadImagesPlugin from '../../utils/upload-images';
import { InlineLoaderPlugin } from '../../utils/inline-loader';
import { IpfsImageFetchPayload, IpfsImageUploadResponse } from '../../types';
import { wrapBlockNode } from '../../utils/block-schema';

/** The toolbar's alignment buttons test for start | center | end, so a `left`
 *  or `right` renders fine but leaves no button active. Pasted HTML and inline
 *  styles both speak left/right, and `justify` has no support anywhere, so
 *  every read is folded to the vocabulary. */
const canonicalAlign = (value: string | null | undefined): string => {
  if (value === 'left' || value === 'start') return 'start';
  if (value === 'right' || value === 'end') return 'end';
  return 'center';
};

// Background color of a media element, from an inline style or the
// data-background-color round-trip attribute (whichever is present).
const readBackgroundColor = (el: HTMLElement | null): string | null =>
  el?.style?.backgroundColor ||
  el?.getAttribute('data-background-color') ||
  null;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    resizableMedia: {
      /**
       * Set media
       */
      setMedia: (options: {
        'media-type': 'img' | 'video';
        src: string;
        alt?: string;
        title?: string;
        width?: string;
        height?: string;
      }) => ReturnType;
    };
  }
}

export interface MediaOptions {
  // inline: boolean, // we have floating support, so block is good enough
  // allowBase64: boolean, // we're not going to allow this
  HTMLAttributes: Record<string, any>;
  onError: (error: string) => void;
  ipfsImageUploadFn: (file: File) => Promise<IpfsImageUploadResponse>;
  ipfsImageFetchFn: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  fetchV1ImageFn: (url: string) => Promise<ArrayBuffer | undefined>;
}

export const IMAGE_INPUT_REGEX =
  /(?:^|\s)(!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\))$/;

export const VIDEO_INPUT_REGEX =
  /!\[(.+|:?)]\((\S+)(?:(?:\s+)["'](\S+)["'])?\)/;

export const ResizableMedia = Node.create<MediaOptions>({
  name: 'resizableMedia',

  addOptions() {
    return {
      HTMLAttributes: {
        class: 'rounded-lg border color-border-default',
      },
      ipfsImageUploadFn: async () => {
        return {
          encryptionKey: '',
          nonce: '',
          ipfsUrl: '',
          ipfsHash: '',
          authTag: '',
        };
      },
      ipfsImageFetchFn: async () => {
        return { url: '', file: new File([], '') };
      },
      fetchV1ImageFn: async () => undefined,
      onError: () => {
        console.error('Error uploading media');
      },
    };
  },

  inline: false,

  group: 'block',

  content: 'mediaCaption?',

  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      'media-type': {
        default: null,
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: '100%',
      },
      height: {
        default: 'auto',
      },
      dataAlign: {
        default: 'center', // 'start' | 'center' | 'end'
        // Attribute-level parsing outranks every rule's getAttrs — including
        // TipTap's implicit reader, which picks up renderHTML's lowercased
        // `dataalign`. Folding here is the only place that catches every path.
        parseHTML: (element: HTMLElement) =>
          canonicalAlign(
            element.getAttribute('data-align') ||
              element.getAttribute('dataalign') ||
              element.style.textAlign,
          ),
      },
      dataFloat: {
        default: null, // 'left' | 'right'
      },
      // Backdrop behind the media — lets a transparent PNG stay visible on
      // dark/colored themes. Read from an inline `background-color` (so it can
      // be hand-authored in the Split View markdown) or `data-background-color`
      // (how it round-trips), and re-emitted as both on render.
      backgroundColor: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          element.style?.backgroundColor ||
          element.getAttribute('data-background-color') ||
          null,
        renderHTML: (attributes: { backgroundColor?: string | null }) =>
          attributes.backgroundColor
            ? {
                'data-background-color': attributes.backgroundColor,
                style: `background-color: ${attributes.backgroundColor}`,
              }
            : {},
      },
      ipfsHash: { default: null },
      mimeType: { default: null },
      encryptionKey: { default: null },
      ipfsUrl: { default: null },
      nonce: { default: null },
      version: { default: null },
      encryptedKey: { default: null },
      url: { default: null },
      iv: { default: null },
      privateKey: { default: null },
      authTag: { default: null },
      // Legacy attribute — kept so Yjs-encoded docs that still carry a
      // caption string survive the Yjs → ProseMirror sync. The node view
      // migrates it to a mediaCaption child node on mount, then clears it.
      caption: {
        default: null,
        rendered: false,
      },
    };
  },

  selectable: true,

  parseHTML() {
    return [
      {
        // Styles-mode markdown serializes media as
        // <figure data-type="resizable-media"> (the mediaFigure turndown
        // rule) — restore alignment/size/caption so a Split View round-trip
        // is lossless. Identity/crypto/size attrs live on the inner
        // <img>/<video>, not the figure, so per-attribute parseHTML (which
        // only reads the matched element) misses them — copy explicitly.
        tag: 'figure[data-type="resizable-media"]',
        contentElement: (el) => {
          const figcaption = (el as HTMLElement).querySelector('figcaption');
          const holder = document.createElement('div');
          if (figcaption) holder.appendChild(figcaption.cloneNode(true));
          return holder;
        },
        getAttrs: (el) => {
          const root = el as HTMLElement;
          const img = root.querySelector('img');
          const media = img || root.querySelector('video');
          if (!media) return false;
          const attrs: Record<string, string | null> = {
            src: media.getAttribute('src'),
            'media-type':
              media.getAttribute('media-type') || (img ? 'img' : 'video'),
            dataAlign: canonicalAlign(
              root.getAttribute('data-align') || root.getAttribute('dataalign'),
            ),
          };
          const float = root.getAttribute('data-float');
          if (float) attrs.dataFloat = float;
          if (img) attrs.backgroundColor = readBackgroundColor(img);
          for (const name of [
            'alt',
            'title',
            'width',
            'height',
            'ipfsHash',
            'mimeType',
            'encryptionKey',
            'ipfsUrl',
            'nonce',
            'version',
            'encryptedKey',
            'url',
            'iv',
            'privateKey',
            'authTag',
          ]) {
            const value = media.getAttribute(name);
            if (value != null) attrs[name] = value;
          }
          return attrs;
        },
      },
      {
        tag: 'div[data-type="resizable-media"]',
        // The wrapper's only ProseMirror content is the optional caption (see
        // renderHTML's media-caption-wrapper hole). Point the parser at that
        // wrapper so it doesn't descend into the <img>/<video>, which would
        // otherwise re-match the bare 'img'/'video' rules below and produce a
        // duplicate resizableMedia node on copy-paste. When no caption exists,
        // return a detached empty element so nothing inside is parsed.
        contentElement: (el) =>
          (el as HTMLElement).querySelector(
            '[data-type="media-caption-wrapper"]',
          ) || document.createElement('div'),
        getAttrs: (el) => {
          const root = el as HTMLElement;
          const img = root.querySelector('img');
          const video = root.querySelector('video');
          const align = canonicalAlign(
            root.getAttribute('data-align') || root.getAttribute('dataalign'),
          );
          if (img) {
            return {
              src: img.getAttribute('src'),
              'media-type': 'img',
              dataAlign: align,
              backgroundColor: readBackgroundColor(img),
            };
          }
          if (video) {
            return {
              src: video.getAttribute('src'),
              'media-type': 'video',
              dataAlign: align,
            };
          }
          return {};
        },
      },
      {
        tag: 'img',
        getAttrs: (el) => {
          const img = el as HTMLImageElement;
          const align = canonicalAlign(
            img.getAttribute('data-align') ||
              img.getAttribute('dataalign') ||
              img.style.textAlign,
          );
          return {
            src: img.getAttribute('src'),
            'media-type': 'img',
            dataAlign: align,
            backgroundColor: readBackgroundColor(img),
          };
        },
      },
      {
        tag: 'video',
        getAttrs: (el) => ({
          src: (el as HTMLVideoElement).getAttribute('src'),
          'media-type': 'video',
        }),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const { 'media-type': mediaType } = HTMLAttributes;

    if (!mediaType)
      console.error(
        'TiptapMediaExtension-renderHTML method: Media Type not set, going default with image',
      );

    const wrapperAttrs = mergeAttributes(
      { 'data-type': 'resizable-media' },
      this.options.HTMLAttributes,
      HTMLAttributes,
    );

    let mediaEl: any;
    if (mediaType === 'video') {
      mediaEl = [
        'video',
        { controls: 'true', style: 'width: 100%', ...HTMLAttributes },
        ['source', HTMLAttributes],
      ];
    } else if (mediaType === 'iframe') {
      mediaEl = ['iframe', HTMLAttributes];
    } else {
      mediaEl = ['img', HTMLAttributes];
    }

    // When a mediaCaption child exists, emit it via a content hole (0) nested
    // in its own wrapper so the hole remains the only child of its parent.
    if (node.content.childCount > 0) {
      return [
        'div',
        wrapperAttrs,
        mediaEl,
        ['div', { 'data-type': 'media-caption-wrapper' }, 0],
      ];
    }

    // Legacy caption (attr only, no child) — render as static text so PDF/MD/
    // HTML exports include it without requiring the user to migrate first.
    const legacyCaption = node.attrs.caption;
    if (legacyCaption) {
      return [
        'div',
        wrapperAttrs,
        mediaEl,
        ['div', { class: 'media-caption' }, legacyCaption],
      ];
    }

    return ['div', wrapperAttrs, mediaEl];
  },

  addCommands() {
    return {
      setMedia:
        (options) =>
        ({ commands }) => {
          const { 'media-type': mediaType } = options;

          if (mediaType === 'img') {
            return commands.insertContent({
              type: this.name,
              attrs: options,
            });
          }
          if (mediaType === 'video') {
            return commands.insertContent({
              type: this.name,
              attrs: {
                ...options,
                controls: 'true',
              },
            });
          }

          if (!mediaType)
            console.error(
              'TiptapMediaExtension-setMedia: Media Type not set, going default with image',
            );

          return commands.insertContent({
            type: this.name,
            attrs: options,
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(
      getResizableMediaNodeView(
        this.options.ipfsImageFetchFn,
        this.options.fetchV1ImageFn,
      ),
    );
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;

        if (selection.empty) {
          return false;
        }

        const pos = selection.$to.pos;

        return editor.commands.insertContentAt(
          pos,
          wrapBlockNode(editor.schema, { type: 'paragraph' }),
        );
      },
    };
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: IMAGE_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => {
          const [, , alt, src, title] = match;

          return {
            src,
            alt,
            title,
            'media-type': 'img',
          };
        },
      }),
      nodeInputRule({
        find: VIDEO_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => {
          const [, , src] = match;

          return {
            src,
            'media-type': 'video',
          };
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      getMediaPasteDropPlugin(
        this.options.onError,
        this.options.ipfsImageUploadFn,
      ),
      UploadImagesPlugin(),
      InlineLoaderPlugin(),
    ];
  },
});
