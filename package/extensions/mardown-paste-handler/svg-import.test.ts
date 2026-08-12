import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import MarkdownIt from 'markdown-it';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  handleMarkdownContent,
  turndownService,
  setMarkdownInlineStyles,
} from './index';
import { markdownHtmlGuardPlugin } from './mark-down-html-guard-plugin';
import { ResizableMedia } from '../resizable-media';
import { MediaCaption } from '../resizable-media/media-caption';
import {
  sanitizeSvgForEmbed,
  encodeSvgToDataUri,
  decodeSvgDataUri,
  isSvgDataUri,
} from '../../utils/svg-embed';
import type { IpfsImageUploadResponse } from '../../types';

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

// What Task 4 emits: opening tag alone on line 1, no blank lines — one
// markdown-it html_block, so the children stay raw instead of going down the
// per-tag html_inline path (where the guard escapes <circle>).
const SVG_BLOCK = sanitizeSvgForEmbed(SVG) as string;

const HOSTILE_BLOCK =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)">\n' +
  '<script>alert(1)</script><circle cx="5" cy="5" r="4"/></svg>';

const schema = getSchema([StarterKit, ResizableMedia, MediaCaption]);

const importMarkdown = async (
  markdown: string,
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>,
): Promise<PMNode> => {
  const state = EditorState.create({ schema });
  let result: PMNode = state.doc;
  const view = {
    state,
    dispatch: (tr: { doc: PMNode }) => {
      result = tr.doc;
    },
  };
  await handleMarkdownContent(view, markdown, ipfsImageUploadFn, {
    replaceAll: true,
  });
  return result;
};

const allMedia = (doc: PMNode) => {
  const found: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === 'resizableMedia') found.push(node);
  });
  return found;
};

const firstMedia = (doc: PMNode) => allMedia(doc)[0];

const exportStyled = (html: string) => {
  setMarkdownInlineStyles(true);
  try {
    return turndownService.turndown(html);
  } finally {
    setMarkdownInlineStyles(false);
  }
};

// jsdom has no URL.createObjectURL; the re-upload path calls it for downloadUrl.
const originalCreateObjectURL = URL.createObjectURL;
beforeAll(() => {
  URL.createObjectURL = vi.fn(() => 'blob:mock') as typeof URL.createObjectURL;
});
afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
});

describe('svg import', () => {
  it('bare <svg> block becomes a resizableMedia node with an svg data URI src', async () => {
    const doc = await importMarkdown(`before\n\n${SVG_BLOCK}\n\nafter`);
    const media = firstMedia(doc);
    expect(media).toBeTruthy();
    expect(media.attrs.src.startsWith('data:image/svg+xml;base64,')).toBe(true);
    expect(decodeSvgDataUri(media.attrs.src)).toContain('<circle');
    expect(media.attrs['media-type']).toBe('img');
    expect(doc.textContent).toContain('before');
    expect(doc.textContent).toContain('after');
  });

  it('figure-wrapped svg keeps alignment and caption', async () => {
    const figure =
      '<figure data-type="resizable-media" data-align="right">\n' +
      `${SVG_BLOCK}\n` +
      '<figcaption>my caption</figcaption></figure>';
    const doc = await importMarkdown(figure);
    const media = firstMedia(doc);
    expect(media).toBeTruthy();
    expect(media.attrs.dataAlign).toBe('right');
    expect(media.attrs['media-type']).toBe('img');
    expect(decodeSvgDataUri(media.attrs.src)).toContain('<circle');
    expect(media.childCount).toBe(1);
    expect(media.firstChild!.type.name).toBe('mediaCaption');
    expect(media.firstChild!.textContent).toBe('my caption');
  });

  it('carries the svg width onto the media node', async () => {
    const sized = sanitizeSvgForEmbed(SVG, '354') as string;
    const figure = await importMarkdown(
      '<figure data-type="resizable-media" data-align="center">\n' +
        `${sized}\n` +
        '</figure>',
    );
    expect(firstMedia(figure).attrs.width).toBe('354');
    const bare = await importMarkdown(sized);
    expect(String(firstMedia(bare).attrs.width)).toBe('354');
  });

  it('strips scripts before encoding', async () => {
    const doc = await importMarkdown(`before\n\n${HOSTILE_BLOCK}\n\nafter`);
    const decoded = decodeSvgDataUri(firstMedia(doc).attrs.src) as string;
    expect(decoded).toContain('<circle');
    expect(decoded).not.toContain('script');
    expect(decoded).not.toContain('onload');
  });

  it('the guard no longer escapes svg blocks', () => {
    const md = new MarkdownIt({ html: true }).use(markdownHtmlGuardPlugin);
    const html = md.render(`before\n\n${SVG_BLOCK}\n\nafter`);
    expect(html).toContain('<svg');
    expect(html).toContain('<circle');
    expect(html).not.toContain('&lt;svg');
    expect(html).not.toContain('&lt;circle');
  });

  it('an svg block that parses to a non-svg root is never inserted as text', async () => {
    // <p> is an HTML-parser breakout tag inside foreign content: the <svg>
    // closes early and the paragraph lands beside it.
    const doc = await importMarkdown(
      'before\n\n<svg xmlns="http://www.w3.org/2000/svg">\n<p>x</p></svg>\n\nafter',
    );
    expect(doc.textContent).not.toContain('<svg');
    expect(doc.textContent).not.toContain('&lt;svg');
    for (const media of allMedia(doc)) {
      expect(isSvgDataUri(media.attrs.src)).toBe(true);
    }
  });

  it('re-uploads an imported svg as secure-img with its true mime type', async () => {
    // Distinct payload: the base64 upload cache is module-level and keyed by
    // the data URL, so a shared svg could be served from another test's entry.
    const unique = SVG.replace('<circle', '<title>upload</title><circle');
    const upload = vi.fn(
      async (): Promise<IpfsImageUploadResponse> => ({
        encryptionKey: 'k1',
        nonce: 'n1',
        ipfsUrl: 'https://gw/QmSvg',
        ipfsHash: 'QmSvg',
        authTag: 't1',
      }),
    );
    const doc = await importMarkdown(
      `${sanitizeSvgForEmbed(unique) as string}`,
      upload,
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0].type).toBe('image/svg+xml');
    const media = firstMedia(doc);
    expect(media.attrs['media-type']).toBe('secure-img');
    expect(media.attrs.mimeType).toBe('image/svg+xml');
    // tiptap's default attribute parse coerces the numeric string to a number.
    expect(String(media.attrs.version)).toBe('2');
    expect(media.attrs.ipfsHash).toBe('QmSvg');
    expect(media.attrs.encryptionKey).toBe('k1');
  });

  it('round-trips: a styles export of an svg node imports back to the sanitized svg', async () => {
    const md = exportStyled(
      '<div data-type="resizable-media" dataalign="right">' +
        `<img src="${encodeSvgToDataUri(SVG)}" />` +
        '<div data-type="media-caption-wrapper"><div data-type="media-caption" class="media-caption">my caption</div></div>' +
        '</div>',
    );
    const doc = await importMarkdown(md);
    const media = firstMedia(doc);
    expect(decodeSvgDataUri(media.attrs.src)).toBe(sanitizeSvgForEmbed(SVG));
    expect(media.attrs.dataAlign).toBe('right');
    expect(media.firstChild!.textContent).toBe('my caption');
  });
});
