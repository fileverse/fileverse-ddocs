import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { DBlockRuntimeState } from './dblock-runtime';
import { getDBlockRuntimeState } from './dblock-runtime';
import { isAllowedEmbedSrc } from '../../utils/is-allowed-embed-src';

const DBLOCK_MEDIA_CONVERSION_META = 'dblock-media-conversion';

type MediaCandidate =
  | {
      type: 'img';
      src: string;
      from: number;
      to: number;
    }
  | {
      type: 'iframe';
      src: string;
      from: number;
      to: number;
    };

interface MediaPluginState {
  version: number;
  shouldScan: boolean;
}

const dBlockMediaPluginKey = new PluginKey<MediaPluginState>(
  'dblock-media-conversion',
);

const getTextLinkHref = (node: ProseMirrorNode): string | null => {
  let href: string | null = null;

  node.descendants((child) => {
    if (href || !child.isText) {
      return false;
    }

    const linkMark = child.marks.find((mark) => mark.type.name === 'link');
    if (linkMark?.attrs.href) {
      href = String(linkMark.attrs.href);
      return false;
    }

    return true;
  });

  return href;
};

const getSecondTextChild = (node: ProseMirrorNode) => {
  const paragraph = node.firstChild;
  const secondChild = paragraph?.childCount ? paragraph.maybeChild(1) : null;
  return secondChild?.isText ? (secondChild.text ?? null) : null;
};

export const getDBlockMediaCandidate = (
  node: ProseMirrorNode,
  position: number,
): MediaCandidate | null => {
  const firstChild = node.firstChild;
  if (node.type.name !== 'dBlock' || firstChild?.type.name !== 'paragraph') {
    return null;
  }

  const textContent = node.textContent;
  if (!textContent) {
    return null;
  }

  const urlSrc = getTextLinkHref(firstChild);
  if (!urlSrc) {
    return null;
  }

  const from = position + 1;
  const to = position + node.nodeSize - 1;

  if (/\.(jpeg|jpg|gif|png)$/i.test(urlSrc)) {
    return {
      type: 'img',
      src: urlSrc,
      from,
      to,
    };
  }

  if (textContent.includes('<iframe')) {
    return {
      type: 'iframe',
      src: getSecondTextChild(node) ?? urlSrc,
      from,
      to,
    };
  }

  const youtubeMatch =
    textContent.match(
      /youtu\.?be(?:\.com)?\/(?:.*v(?:\/|=)|(?:.*\/)?)([a-zA-Z0-9-_]+)/,
    ) ||
    urlSrc.match(
      /youtu\.?be(?:\.com)?\/(?:.*v(?:\/|=)|(?:.*\/)?)([a-zA-Z0-9-_]+)/,
    );

  if (youtubeMatch && textContent.trim() === urlSrc.trim()) {
    return {
      type: 'iframe',
      src: `https://www.youtube.com/embed/${youtubeMatch[1]}`,
      from,
      to,
    };
  }

  const vimeoMatch = textContent.match(/vimeo\.com\/([a-zA-Z0-9-_]+)/);
  if (vimeoMatch) {
    return {
      type: 'iframe',
      src: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      from,
      to,
    };
  }

  return null;
};

const collectCandidates = (doc: ProseMirrorNode) => {
  const candidates: MediaCandidate[] = [];

  doc.forEach((node, position) => {
    const candidate = getDBlockMediaCandidate(node, position);
    if (candidate) {
      candidates.push(candidate);
    }
  });

  return candidates;
};

export const createDBlockMediaConversionPlugin = (
  getRuntimeState?: () => DBlockRuntimeState,
) =>
  new Plugin<MediaPluginState>({
    key: dBlockMediaPluginKey,
    state: {
      init: () => ({
        version: 0,
        shouldScan: false,
      }),
      apply: (tr, previous) => {
        if (
          !tr.docChanged ||
          tr.getMeta(DBLOCK_MEDIA_CONVERSION_META) ||
          tr.getMeta('y-sync$')
        ) {
          return {
            ...previous,
            shouldScan: false,
          };
        }

        return {
          version: previous.version + 1,
          shouldScan: true,
        };
      },
    },
    view: (view) => {
      let timeoutId: number | null = null;
      let lastVersion = 0;

      const clearPendingConversion = () => {
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const runConversion = () => {
        timeoutId = null;
        const runtime = getDBlockRuntimeState(getRuntimeState);

        if (runtime.isPreviewMode || !view.editable) {
          return;
        }

        const candidates = collectCandidates(view.state.doc);
        if (candidates.length === 0) {
          return;
        }

        const tr = view.state.tr;

        candidates
          .sort((a, b) => b.from - a.from)
          .forEach((candidate) => {
            if (
              candidate.type === 'iframe' &&
              !isAllowedEmbedSrc(candidate.src)
            ) {
              return;
            }

            const node =
              candidate.type === 'img'
                ? view.state.schema.nodes.resizableMedia?.create({
                    src: candidate.src,
                    'media-type': 'img',
                  })
                : view.state.schema.nodes.iframe?.create({
                    src: candidate.src,
                    width: 640,
                    height: 360,
                  });

            if (node) {
              tr.replaceWith(candidate.from, candidate.to, node);
            }
          });

        if (tr.docChanged) {
          tr.setMeta(DBLOCK_MEDIA_CONVERSION_META, true);
          view.dispatch(tr);
        }
      };

      return {
        update: (updatedView) => {
          const pluginState = dBlockMediaPluginKey.getState(updatedView.state);
          if (!pluginState?.shouldScan || pluginState.version === lastVersion) {
            return;
          }

          lastVersion = pluginState.version;
          clearPendingConversion();
          timeoutId = window.setTimeout(runConversion, 1000);
        },
        destroy: clearPendingConversion,
      };
    },
  });
