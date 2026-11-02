import { getMermaid } from './lazy-mermaid';

export const MERMAID_SVG_TAGS = [
  'svg',
  'g',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textPath',
  'defs',
  'marker',
  'use',
  'symbol',
  'foreignObject',
  'title',
  'desc',
  'style',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
];

export const MERMAID_SVG_ATTRS = [
  'viewBox',
  'xmlns',
  'xmlns:xlink',
  'd',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'transform',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'points',
  'dx',
  'dy',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-family',
  'font-weight',
  'style',
  'class',
  'id',
  'marker-end',
  'marker-start',
  'marker-mid',
  'offset',
  'stop-color',
  'stop-opacity',
  'opacity',
  'fill-opacity',
  'stroke-opacity',
  'clip-path',
  'mask',
  'preserveAspectRatio',
];

export async function renderMermaidBlocks(
  html: string,
  options: { skip?: (pre: HTMLElement) => boolean } = {},
): Promise<string> {
  if (!html.includes('data-language="mermaid"')) return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const blocks = Array.from(
    doc.querySelectorAll<HTMLElement>('pre[data-language="mermaid"]'),
  ).filter((pre) => !options.skip?.(pre));
  if (blocks.length === 0) return html;
  const mermaid = await getMermaid();
  for (let i = 0; i < blocks.length; i++) {
    const el = blocks[i];
    const source = el.textContent || '';
    const id = `mermaid-export-${i}-${Date.now()}`;
    try {
      const { svg } = await mermaid.render(id, source);
      const wrapper = doc.createElement('div');
      wrapper.innerHTML = svg;
      const node = wrapper.firstElementChild;
      if (node) el.replaceWith(node);
    } catch {
      // Leave the original <pre> in place if rendering fails.
    }
  }
  return doc.body.innerHTML;
}
