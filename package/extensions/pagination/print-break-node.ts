import {
  DOMSerializer,
  type DOMOutputSpec,
  Node as PMNode,
  Schema,
} from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import type { PageStart, PrintBreak } from './place';

// Replaces the content hole (0) of a toDOM spec, at any depth.
const replaceHole = (
  spec: DOMOutputSpec,
  replacement: DOMOutputSpec,
): DOMOutputSpec => {
  if (!Array.isArray(spec)) return spec;
  return spec.map((part: unknown) =>
    part === 0
      ? replacement
      : Array.isArray(part)
        ? replaceHole(part as unknown as DOMOutputSpec, replacement)
        : part,
  ) as unknown as DOMOutputSpec;
};

// Print-only schema: the live schema plus one inline node that forces a page
// break without splitting its paragraph. Never registered in a live editor.
export const buildPrintSchema = (live: Schema): Schema => {
  let nodes = live.spec.nodes.append({
    printPageBreak: {
      inline: true,
      group: 'inline',
      atom: true,
      selectable: false,
      attrs: { page: { default: null } },
      toDOM: (node) => [
        'span',
        {
          'data-print-break': '',
          'data-print-page-start': node.attrs.page ?? undefined,
        },
      ],
    },
  });
  const codeBlock = nodes.get('codeBlock');
  // Code block content is text*, which would reject the inline break.
  if (codeBlock) {
    nodes = nodes.update('codeBlock', {
      ...codeBlock,
      content: '(text | printPageBreak)*',
    });
  }
  // v1 block spacing is written for the node view's DOM, which wraps the
  // block in a content div: [data-type=d-block] > [data-node-view-content].
  const dBlock = nodes.get('dBlock');
  const dBlockToDOM = dBlock?.toDOM;
  if (dBlock && dBlockToDOM) {
    nodes = nodes.update('dBlock', {
      ...dBlock,
      toDOM: (node) =>
        replaceHole(dBlockToDOM(node), [
          'div',
          { 'data-node-view-content': 'true' },
          0,
        ]),
    });
  }
  return new Schema({
    nodes,
    marks: live.spec.marks,
    topNode: live.spec.topNode,
  });
};

const isAttrs = (value: unknown): value is Record<string, unknown> =>
  value != null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { nodeType?: unknown }).nodeType == null;

const withAttrs = (
  out: DOMOutputSpec,
  attrs: Record<string, string>,
): DOMOutputSpec => {
  if (Array.isArray(out)) {
    const [tag, maybeAttrs, ...rest] = out as unknown[];
    return (isAttrs(maybeAttrs)
      ? [tag, { ...maybeAttrs, ...attrs }, ...rest]
      : [tag, attrs, ...out.slice(1)]) as unknown as DOMOutputSpec;
  }
  const dom = (out as { dom?: Node }).dom ?? (out as Node);
  if (dom instanceof HTMLElement) {
    Object.entries(attrs).forEach(([k, v]) => dom.setAttribute(k, v));
  }
  return out;
};

// Header rows print in a thead, which browsers repeat on every page.
const moveHeaderRowsToThead = (root: HTMLElement) => {
  root.querySelectorAll('table').forEach((table) => {
    const tbody = table.querySelector(':scope > tbody');
    const first = tbody?.querySelector(':scope > tr');
    if (!tbody || !first) return;
    const cells = [...first.children];
    if (cells.length === 0 || cells.some((cell) => cell.tagName !== 'TH')) {
      return;
    }
    const thead = document.createElement('thead');
    thead.appendChild(first);
    table.insertBefore(thead, tbody);
  });
};

export const serializeWithBreaks = (
  liveDoc: PMNode,
  printSchema: Schema,
  breaks: PrintBreak[],
  pageStarts: PageStart[],
): string => {
  const pageAt = new Map<string, number>();
  pageStarts.forEach((start, i) =>
    pageAt.set(`${start.kind}:${start.pos}`, i + 1),
  );

  // Inline breaks go in last position first so earlier positions stay valid.
  const tr = new Transform(PMNode.fromJSON(printSchema, liveDoc.toJSON()));
  breaks
    .filter((b) => b.kind === 'inText')
    .map((b) => b.pos)
    .sort((a, b) => b - a)
    .forEach((pos) =>
      tr.insert(
        pos,
        printSchema.nodes.printPageBreak.create({
          page: pageAt.get(`inText:${pos}`) ?? null,
        }),
      ),
    );

  // Block targets resolve after the inserts, by identity in the final doc.
  const marks = new Map<PMNode, Record<string, string>>();
  const mark = (pos: number, attrs: Record<string, string>) => {
    const node = tr.doc.nodeAt(tr.mapping.map(pos));
    if (node) marks.set(node, { ...marks.get(node), ...attrs });
  };
  breaks
    .filter((b) => b.kind === 'before')
    .forEach((b) => mark(b.pos, { 'data-print-break-before': '' }));
  pageStarts.forEach((start, i) => {
    if (start.kind === 'before') {
      mark(start.pos, { 'data-print-page-start': String(i + 1) });
    }
  });

  const base = DOMSerializer.fromSchema(printSchema);
  const nodes = Object.fromEntries(
    Object.entries(base.nodes).map(([name, toDOM]) => [
      name,
      (node: PMNode) => {
        let out = toDOM(node);
        // ProseMirror draws a trailing <br> in an empty textblock; without it
        // the printed block has no line and collapses to 0.
        if (node.isTextblock && node.content.size === 0) {
          out = replaceHole(out, [
            'br',
            { class: 'ProseMirror-trailingBreak' },
          ]);
        }
        const attrs = marks.get(node);
        return attrs ? withAttrs(out, attrs) : out;
      },
    ]),
  );
  const root = document.createElement('div');
  root.appendChild(
    new DOMSerializer(nodes, base.marks).serializeFragment(tr.doc.content),
  );
  moveHeaderRowsToThead(root);
  return root.innerHTML;
};
