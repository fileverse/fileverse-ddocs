import { describe, it, expect } from 'vitest';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { turndownService, setMarkdownInlineStyles } from './index';
import { ResizableMedia } from '../resizable-media';
import { MediaCaption } from '../resizable-media/media-caption';

const exportStyled = (html: string) => {
  setMarkdownInlineStyles(true);
  try {
    return turndownService.turndown(html);
  } finally {
    setMarkdownInlineStyles(false);
  }
};

const wrapper = (inner: string, wrapperAttrs = 'dataalign="center"') =>
  `<div data-type="resizable-media" ${wrapperAttrs}>${inner}</div>`;

const captioned = (captionHtml: string) =>
  `<div data-type="media-caption-wrapper"><div data-type="media-caption" class="media-caption">${captionHtml}</div></div>`;

describe('media figure export (styles mode)', () => {
  it('exports image + caption as figure/figcaption with data-align', () => {
    const md = exportStyled(
      wrapper(`<img src="a.png" alt="chart" />${captioned('my caption')}`),
    );
    expect(md).toContain(
      '<figure data-type="resizable-media" data-align="center">',
    );
    expect(md).toContain('src="a.png"');
    expect(md).toContain('alt="chart"');
    expect(md).toContain('<figcaption>my caption</figcaption>');
    expect(md).toContain('</figure>');
  });

  it('omits figcaption when there is no caption', () => {
    const md = exportStyled(wrapper('<img src="a.png" />'));
    expect(md).toContain('<figure data-type="resizable-media"');
    expect(md).not.toContain('figcaption');
  });

  it('omits figcaption when the caption is empty', () => {
    const md = exportStyled(wrapper(`<img src="a.png" />${captioned('  ')}`));
    expect(md).not.toContain('figcaption');
  });

  it('carries non-center alignment and float', () => {
    const md = exportStyled(
      wrapper('<img src="a.png" />', 'dataalign="right" datafloat="left"'),
    );
    expect(md).toContain('data-align="right"');
    expect(md).toContain('data-float="left"');
  });

  it('defaults to data-align="center" when the wrapper has no alignment', () => {
    const md = exportStyled(wrapper('<img src="a.png" />', ''));
    expect(md).toContain('data-align="center"');
  });

  it('preserves resize width but drops the 100%/auto defaults', () => {
    const md = exportStyled(
      wrapper('<img src="a.png" width="420" height="auto" />'),
    );
    expect(md).toContain('width="420"');
    expect(md).not.toContain('height=');
    const full = exportStyled(wrapper('<img src="a.png" width="100%" />'));
    expect(full).not.toContain('width=');
  });

  it('preserves secure-image identity attrs on the inner img', () => {
    const md = exportStyled(
      wrapper(
        '<img src="https://gw/x" ipfshash="Qm123" encryptionkey="k1" media-type="secure-img" />',
      ),
    );
    expect(md).toContain('ipfshash="Qm123"');
    expect(md).toContain('encryptionkey="k1"');
    expect(md).toContain('media-type="secure-img"');
  });

  it('keeps links inside the caption', () => {
    const md = exportStyled(
      wrapper(
        `<img src="a.png" />${captioned('see <a href="https://x.dev">docs</a>')}`,
      ),
    );
    expect(md).toContain(
      '<figcaption>see <a href="https://x.dev">docs</a></figcaption>',
    );
  });

  it('passes base64 data-URI srcs through untouched', () => {
    const md = exportStyled(
      wrapper('<img src="data:image/png;base64,AAAA" />'),
    );
    expect(md).toContain('src="data:image/png;base64,AAAA"');
  });

  it('wraps video media in a figure too', () => {
    const md = exportStyled(
      wrapper(
        `<video src="v.mp4" controls="true"></video>${captioned('clip')}`,
      ),
    );
    expect(md).toContain('<figure data-type="resizable-media"');
    expect(md).toContain('<video src="v.mp4"');
    expect(md).toContain('<figcaption>clip</figcaption>');
  });

  it('emits no figure in plain (non-styles) export', () => {
    setMarkdownInlineStyles(false);
    const md = turndownService.turndown(
      wrapper(`<img src="a.png" alt="chart" />${captioned('my caption')}`),
    );
    expect(md).not.toContain('<figure');
    expect(md).toContain('![chart](a.png)');
    expect(md).toContain('my caption');
  });
});

describe('media figure import (schema parse)', () => {
  const schema = getSchema([StarterKit, ResizableMedia, MediaCaption]);

  const parseBody = (html: string) => {
    const doc = document.implementation.createHTMLDocument();
    doc.body.innerHTML = html;
    return PMDOMParser.fromSchema(schema).parse(doc.body);
  };

  const findMedia = (doc: PMNode) => {
    let found: PMNode | null = null;
    doc.descendants((node) => {
      if (node.type.name === 'resizableMedia') {
        found = node;
        return false;
      }
    });
    return found! as PMNode;
  };

  it('restores alignment, src and caption from an exported figure', () => {
    const media = findMedia(
      parseBody(
        '<figure data-type="resizable-media" data-align="right"><img src="a.png" alt="chart" /><figcaption>my caption</figcaption></figure>',
      ),
    );
    expect(media).toBeTruthy();
    expect(media.attrs.src).toBe('a.png');
    expect(media.attrs.dataAlign).toBe('end');
    expect(media.attrs['media-type']).toBe('img');
    expect(media.childCount).toBe(1);
    expect(media.firstChild!.type.name).toBe('mediaCaption');
    expect(media.firstChild!.textContent).toBe('my caption');
  });

  it('restores float, width and secure-image attrs from the inner img', () => {
    const media = findMedia(
      parseBody(
        '<figure data-type="resizable-media" data-align="left" data-float="right">' +
          '<img src="https://gw/x" width="420" ipfshash="Qm123" encryptionkey="k1" media-type="secure-img" />' +
          '</figure>',
      ),
    );
    expect(media.attrs.dataAlign).toBe('start');
    expect(media.attrs.dataFloat).toBe('right');
    expect(media.attrs.width).toBe('420');
    expect(media.attrs.ipfsHash).toBe('Qm123');
    expect(media.attrs.encryptionKey).toBe('k1');
    expect(media.attrs['media-type']).toBe('secure-img');
  });

  it('parses a figure without figcaption as an uncaptioned node', () => {
    const media = findMedia(
      parseBody(
        '<figure data-type="resizable-media"><img src="a.png" /></figure>',
      ),
    );
    expect(media.attrs.dataAlign).toBe('center');
    expect(media.childCount).toBe(0);
  });

  it('parses a video figure', () => {
    const media = findMedia(
      parseBody(
        '<figure data-type="resizable-media" data-align="center"><video src="v.mp4"></video><figcaption>clip</figcaption></figure>',
      ),
    );
    expect(media.attrs['media-type']).toBe('video');
    expect(media.attrs.src).toBe('v.mp4');
    expect(media.firstChild!.textContent).toBe('clip');
  });

  it('still parses a generic figure (no data-type) via the bare img rule', () => {
    const media = findMedia(
      parseBody('<figure><img src="web.png" /></figure>'),
    );
    expect(media).toBeTruthy();
    expect(media.attrs.src).toBe('web.png');
  });

  it('round-trips: export output parses back to the same node', () => {
    const md = exportStyled(
      wrapper(
        `<img src="a.png" alt="chart" width="420" />${captioned('my caption')}`,
        'dataalign="right"',
      ),
    );
    const figureHtml = md.slice(
      md.indexOf('<figure'),
      md.indexOf('</figure>') + 9,
    );
    const media = findMedia(parseBody(figureHtml));
    expect(media.attrs.src).toBe('a.png');
    expect(media.attrs.alt).toBe('chart');
    expect(media.attrs.width).toBe('420');
    expect(media.attrs.dataAlign).toBe('end');
    expect(media.firstChild!.textContent).toBe('my caption');
  });
});
