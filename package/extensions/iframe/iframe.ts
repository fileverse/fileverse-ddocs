/* eslint-disable @typescript-eslint/no-explicit-any */
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { getResizableMediaNodeView } from '../resizable-media/resizable-media-node-view';
import { IpfsImageFetchPayload } from '../../types';
import { isAllowedEmbedSrc } from '../../utils/is-allowed-embed-src';
import { replaceSelectionWithBlockNode } from '../../utils/block-insert';

export interface IframeOptions {
  allowFullscreen: boolean;
  HTMLAttributes: {
    [key: string]: any;
  };
  width?: number;
  height?: number;
  ipfsImageFetchFn: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  fetchV1ImageFn: (hash: string) => Promise<ArrayBuffer | undefined>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    iframe: {
      /**
       * Add an iframe
       */
      setIframe: (options: {
        src: string;
        alt?: string;
        title?: string;
        width?: number;
        height?: number;
      }) => ReturnType;
    };
  }
}

export const Iframe = Node.create<IframeOptions>({
  name: 'iframe',

  group: 'block',

  atom: true,

  draggable: true,

  addOptions() {
    return {
      allowFullscreen: true,
      HTMLAttributes: {
        class: 'iframe-wrapper',
      },
      ipfsImageFetchFn: async () => ({ url: '', file: new File([], '') }),
      fetchV1ImageFn: async () => undefined,
    };
  },

  addAttributes() {
    return {
      src: {
        default: null,
      },
      frameborder: {
        default: 0,
      },
      allowfullscreen: {
        default: this.options.allowFullscreen,
        parseHTML: () => this.options.allowFullscreen,
      },
      'media-type': {
        default: 'iframe',
      },
      alt: {
        default: null,
      },
      title: {
        default: null,
      },
      width: {
        default: this.options.width,
      },
      height: {
        default: this.options.height,
      },
      dataAlign: {
        default: 'left', // 'left' | 'center' | 'right'
      },
      dataFloat: {
        default: null, // 'left' | 'right'
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

  parseHTML() {
    return [
      {
        tag: 'iframe',
        getAttrs: (el) => {
          const src = (el as HTMLElement).getAttribute('src');
          if (!isAllowedEmbedSrc(src)) return false;
          const width = (el as HTMLElement).getAttribute('width');
          const height = (el as HTMLElement).getAttribute('height');
          return { src, width, height };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'iframe',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
    ];
  },

  addCommands() {
    return {
      setIframe:
        (options: { src: string; width?: number; height?: number }) =>
        ({ tr, dispatch }) => {
          if (!isAllowedEmbedSrc(options.src)) return false;
          const node = this.type.create(options);

          if (dispatch) {
            // Replaces the old `selection.from - 1` magic offset, which
            // assumed the action-button flow's exact post-delete selection
            // and stranded the caret at the dBlock boundary afterwards.
            replaceSelectionWithBlockNode(tr, node);
          }

          return true;
        },
    };
  },
});
