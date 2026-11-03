import { paragraphs, rng, sentence, sentences, svgImage } from './gen';
import { PAGES_FIXTURES_META } from './meta';

export type PagesFixture = {
  id: string;
  title: string;
  html: string;
  landscape?: boolean;
};

const prose = () => {
  const r = rng(1);
  return `<h1>Long prose</h1>${paragraphs(r, 70)}`;
};

const headings = () => {
  const r = rng(2);
  let html = '<h1>Headings</h1>';
  for (let i = 0; i < 45; i += 1) {
    const level = i % 3 === 0 ? 2 : 3;
    html += `<h${level}>${sentence(r, 2, 6)}</h${level}>`;
    html += paragraphs(r, 1 + (i % 3), 1, 4);
  }
  return html;
};

const lists = () => {
  const r = rng(3);
  const item = () => `<li><p>${sentences(r, 1, 4)}</p></li>`;
  const nested = (depth: number): string =>
    `<ul>${Array.from({ length: 4 }, () =>
      depth < 2
        ? `<li><p>${sentences(r, 1, 3)}</p>${nested(depth + 1)}</li>`
        : item(),
    ).join('')}</ul>`;
  const ordered = `<ol>${Array.from({ length: 30 }, item).join('')}</ol>`;
  const tasks = `<ul data-type="taskList">${Array.from(
    { length: 20 },
    (_, i) =>
      `<li data-type="taskItem" data-checked="${i % 2 === 0}"><label><input type="checkbox"></label><div><p>${sentences(r, 1, 3)}</p></div></li>`,
  ).join('')}</ul>`;
  return `<h1>Lists</h1>${nested(0)}${nested(0)}${ordered}${tasks}${nested(0)}`;
};

const table = (r: () => number, rows: number, header: boolean) => {
  const cell = (tag: 'td' | 'th', text: string) =>
    `<${tag}><p>${text}</p></${tag}>`;
  const head = header
    ? `<tr>${['Item', 'Owner', 'Notes'].map((t) => cell('th', t)).join('')}</tr>`
    : '';
  const body = Array.from(
    { length: rows },
    (_, i) =>
      `<tr>${cell('td', `Row ${i + 1}`)}${cell('td', sentence(r, 2, 4))}${cell(
        'td',
        i % 4 === 0 ? sentences(r, 2, 4) : sentence(r, 3, 8),
      )}</tr>`,
  ).join('');
  return `<table><tbody>${head}${body}</tbody></table>`;
};

const tables = () => {
  const r = rng(4);
  return `<h1>Tables</h1>${paragraphs(r, 3)}${table(r, 60, true)}${paragraphs(
    r,
    2,
  )}${table(r, 40, false)}${paragraphs(r, 2)}${table(r, 25, true)}`;
};

const images = () => {
  const r = rng(5);
  const sizes: [number, number][] = [
    [600, 200],
    [400, 500],
    [602, 700],
    [300, 300],
    [500, 600],
    [602, 400],
  ];
  return `<h1>Images</h1>${sizes
    .map(([w, h], i) => `${paragraphs(r, 2 + (i % 3))}${svgImage(w, h)}`)
    .join('')}${paragraphs(r, 4)}`;
};

const code = () => {
  const r = rng(6);
  const block = (lines: number) =>
    `<pre><code>${Array.from(
      { length: lines },
      (_, i) => `const line${i} = compute(${i}, '${sentence(r, 2, 5)}');`,
    ).join('\n')}</code></pre>`;
  return `<h1>Code</h1>${paragraphs(r, 4)}${block(10)}${paragraphs(
    r,
    3,
  )}${block(30)}${paragraphs(r, 2)}${block(80)}${paragraphs(
    r,
    2,
  )}<pre><code class="language-mermaid">graph TD; A[Start] --> B[Review]; B --> C[Approve]; B --> D[Revise]; D --> B</code></pre>${paragraphs(
    r,
    4,
  )}`;
};

const mixedFonts = () => {
  const r = rng(7);
  const fonts = ['Georgia', 'Arial', 'Courier New', 'Times New Roman'];
  const sizes = ['12px', '14px', '18px', '22px'];
  let html = '<h1>Mixed fonts and spacing</h1>';
  for (let i = 0; i < 40; i += 1) {
    const font = fonts[i % fonts.length];
    const size = sizes[(i * 3) % sizes.length];
    const spacing =
      i % 5 === 0 ? ' style="margin-top: 24px; margin-bottom: 18px"' : '';
    html += `<p${spacing}><span style="font-family: ${font}; font-size: ${size}">${sentences(
      r,
      2,
      6,
    )}</span> ${sentences(r, 1, 3)}</p>`;
    if (i % 8 === 7) html += `<h2>${sentence(r, 2, 5)}</h2>`;
  }
  return html;
};

const breaksAndContainers = () => {
  const r = rng(8);
  const callout = `<aside data-type="callout"><p>${sentences(r, 2, 5)}</p><p>${sentences(r, 1, 3)}</p></aside>`;
  const quote = `<blockquote><p>${sentences(r, 3, 6)}</p><p>${sentences(r, 2, 4)}</p></blockquote>`;
  return `<h1>Breaks and containers</h1>${paragraphs(r, 3)}<div data-type="page-break"></div>${paragraphs(
    r,
    2,
  )}${callout}${paragraphs(r, 6)}${quote}<hr>${paragraphs(r, 5)}<div data-type="page-break"></div><h2>${sentence(
    r,
    2,
    5,
  )}</h2>${paragraphs(r, 8)}${callout}${quote}${paragraphs(r, 6)}`;
};

const columns = () => {
  const r = rng(9);
  const cols = () =>
    `<div data-type="columns"><div data-type="column">${paragraphs(
      r,
      2,
      1,
      4,
    )}</div><div data-type="column">${paragraphs(r, 2, 1, 4)}</div></div>`;
  return `<h1>Columns</h1>${paragraphs(r, 4)}${cols()}${paragraphs(
    r,
    5,
  )}${cols()}${paragraphs(r, 6)}${cols()}${paragraphs(r, 4)}`;
};

const proposal = () => {
  const r = rng(10);
  return [
    '<h1>Project proposal</h1>',
    paragraphs(r, 3),
    `<h2>Scope</h2>${paragraphs(r, 4)}`,
    `<ul>${Array.from({ length: 8 }, () => `<li><p>${sentences(r, 1, 3)}</p></li>`).join('')}</ul>`,
    `<h2>Timeline</h2>${table(r, 18, true)}`,
    `<h2>Architecture</h2>${paragraphs(r, 3)}${svgImage(602, 360)}`,
    `<aside data-type="callout"><p>${sentences(r, 2, 4)}</p></aside>`,
    `<h2>Budget</h2>${paragraphs(r, 4)}${table(r, 12, true)}`,
    '<div data-type="page-break"></div>',
    `<h2>Terms</h2><ol>${Array.from({ length: 14 }, () => `<li><p>${sentences(r, 2, 5)}</p></li>`).join('')}</ol>`,
    `<pre><code>${Array.from({ length: 12 }, (_, i) => `step ${i}: ${sentence(r, 2, 5)}`).join('\n')}</code></pre>`,
    paragraphs(r, 6),
  ].join('');
};

// Blocks taller than a page and blocks a page splits (§13.5 to §13.7).
const tallBlocks = () => {
  const r = rng(12);
  const captioned = (w: number, h: number, caption: string) =>
    svgImage(w, h, '#fde68a').replace(
      /^<img (.*) width="(\d+)">$/,
      `<div data-type="resizable-media" width="$2"><img $1><div data-type="media-caption-wrapper"><div data-type="media-caption">${caption}</div></div></div>`,
    );
  const cols = `<div data-type="columns"><div data-type="column">${paragraphs(
    r,
    9,
    3,
    6,
  )}</div><div data-type="column">${paragraphs(r, 9, 3, 6)}</div></div>`;
  const mermaid = `<pre><code class="language-mermaid">graph TD; ${Array.from(
    { length: 30 },
    (_, i) => `N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`,
  ).join('; ')}</code></pre>`;
  const iframe =
    '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ" width="602" height="1400"></iframe>';
  const cell = (tag: 'td' | 'th', html: string) => `<${tag}>${html}</${tag}>`;
  const tallRowTable = `<table><tbody><tr>${['Item', 'Owner', 'Notes']
    .map((t) => cell('th', `<p>${t}</p>`))
    .join('')}</tr>${Array.from(
    { length: 4 },
    (_, i) =>
      `<tr>${cell('td', `<p>Row ${i + 1}</p>`)}${cell(
        'td',
        `<p>${sentence(r, 2, 4)}</p>`,
      )}${cell('td', i === 1 ? paragraphs(r, 5, 3, 5) : `<p>${sentence(r, 3, 8)}</p>`)}</tr>`,
  ).join('')}</tbody></table>`;
  const codeBlock = `<pre><code>${Array.from(
    { length: 60 },
    (_, i) => `const line${i} = compute(${i}, '${sentence(r, 2, 5)}');`,
  ).join('\n')}</code></pre>`;
  return [
    '<h1>Tall blocks</h1>',
    paragraphs(r, 2),
    svgImage(400, 2000),
    paragraphs(r, 2),
    captioned(602, 920, 'A captioned image about a page tall'),
    paragraphs(r, 2),
    cols,
    paragraphs(r, 2),
    mermaid,
    paragraphs(r, 2),
    iframe,
    paragraphs(r, 2),
    tallRowTable,
    paragraphs(r, 2),
    table(r, 30, false),
    paragraphs(r, 3),
    codeBlock,
    paragraphs(r, 2),
    `<aside data-type="callout">${paragraphs(r, 7)}</aside>`,
    paragraphs(r, 2),
    `<blockquote>${paragraphs(r, 7)}</blockquote>`,
    paragraphs(r, 2),
    `<ul>${Array.from({ length: 28 }, () => `<li><p>${sentences(r, 1, 3)}</p></li>`).join('')}</ul>`,
    paragraphs(r, 3),
  ].join('');
};

// ~50,000 words for the performance check (§12.12 item 6).
const large = () => {
  const r = rng(11);
  const parts = ['<h1>Large document</h1>'];
  for (let i = 0; i < 58; i += 1) {
    parts.push(`<h2>${sentence(r, 2, 6)}</h2>`, paragraphs(r, 6));
    if (i % 2 === 1) parts.push(`<h3>${sentence(r, 2, 5)}</h3>`);
    parts.push(paragraphs(r, 6));
    if (i % 3 === 0) {
      parts.push(
        `<ul>${Array.from({ length: 6 }, () => `<li><p>${sentences(r, 1, 3)}</p></li>`).join('')}</ul>`,
      );
    }
    if (i % 12 === 5) parts.push(svgImage(602, 300));
    if (i % 16 === 9) parts.push(table(r, 8, true));
  }
  return parts.join('');
};

const BUILDERS: Record<string, () => string> = {
  '01': prose,
  '02': headings,
  // Pages shows collapsed headings expanded (§12.7): lays out and prints as 02.
  '02c': () => headings().replace(/<h2>/g, '<h2 data-collapsed="true">'),
  '03': lists,
  '04': tables,
  '05': images,
  '06': code,
  '07': mixedFonts,
  '08': breaksAndContainers,
  '09': columns,
  '10': proposal,
  '11': large,
  '12': tallBlocks,
};

export const PAGES_FIXTURES: PagesFixture[] = PAGES_FIXTURES_META.map(
  (meta) => ({ ...meta, html: BUILDERS[meta.id]() }),
);
