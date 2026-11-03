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
      toDOM: (node) => {
        const out = replaceHole(dBlockToDOM(node), [
          'div',
          { 'data-node-view-content': 'true' },
          0,
        ]);
        // The node view marks a table block; its width cap hangs off it.
        return node.firstChild?.type.name === 'table'
          ? withAttrs(out, { class: 'is-table' })
          : out;
      },
    });
  }
  // The table node view renders div.tableWrapper > table.
  const table = nodes.get('table');
  const tableToDOM = table?.toDOM;
  if (table && tableToDOM) {
    nodes = nodes.update('table', {
      ...table,
      toDOM: (node) => ['div', { class: 'tableWrapper' }, tableToDOM(node)],
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
    if (!isAttrs(maybeAttrs)) {
      return [tag, attrs, ...out.slice(1)] as unknown as DOMOutputSpec;
    }
    const style = [maybeAttrs.style, attrs.style].filter(Boolean).join('; ');
    return [
      tag,
      { ...maybeAttrs, ...attrs, ...(style ? { style } : {}) },
      ...rest,
    ] as unknown as DOMOutputSpec;
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
    // Chrome ignores break-before in a repeated thead, and a page-start mark
    // there would repeat on every page: both move to the table's wrapper.
    const outer = table.parentElement?.classList.contains('tableWrapper')
      ? table.parentElement
      : table;
    ['data-print-break-before', 'data-print-page-start'].forEach((name) => {
      const value = first.getAttribute(name);
      if (value === null) return;
      first.removeAttribute(name);
      outer.setAttribute(name, value);
    });
  });
};

const topLevel = (root: HTMLElement, el: Element) => {
  while (el.parentElement && el.parentElement !== root) el = el.parentElement;
  return el;
};

// On a row whose page repeats the header on screen (docs/PAGES_MODE.md §13.6).
export const REPEAT_HEADER = 'data-print-repeat-header';

// WebKit ignores break-before on a table row. The table splits there instead:
// a piece repeats the header when the screen does, and the live column widths
// stay pinned.
const splitTablesAtRowBreaks = (root: HTMLElement) => {
  const rows = [...root.querySelectorAll('tr[data-print-break-before]')];
  rows.reverse().forEach((row) => {
    const table = row.closest('table');
    if (!table) return;
    const top = topLevel(root, table);
    row.removeAttribute('data-print-break-before');
    if (!row.previousElementSibling) {
      top.setAttribute('data-print-break-before', '');
      return;
    }
    const chain: Element[] = [];
    for (
      let el: Element | null = table;
      el && el !== root;
      el = el.parentElement
    ) {
      chain.unshift(el);
    }
    const clones = chain.map((el) => el.cloneNode(false) as Element);
    clones.forEach((clone, i) => {
      clone.removeAttribute('data-print-break-before');
      clone.removeAttribute('data-print-page-start');
      clone.setAttribute('data-print-continued', '');
      if (i > 0) clones[i - 1].appendChild(clone);
    });
    const piece = clones[clones.length - 1];
    const parts = row.hasAttribute(REPEAT_HEADER)
      ? ':scope > colgroup, :scope > thead'
      : ':scope > colgroup';
    table
      .querySelectorAll(parts)
      .forEach((el) => piece.appendChild(el.cloneNode(true)));
    const body = document.createElement('tbody');
    for (let r: Element | null = row; r; ) {
      const next: Element | null = r.nextElementSibling;
      body.appendChild(r);
      r = next;
    }
    piece.appendChild(body);
    clones[0].setAttribute('data-print-break-before', '');
    chain.forEach((el) => el.setAttribute('data-print-split', ''));
    top.after(clones[0]);
  });

  root
    .querySelectorAll(`[${REPEAT_HEADER}]`)
    .forEach((el) => el.removeAttribute(REPEAT_HEADER));

  root.querySelectorAll('[data-print-col-widths]').forEach((holder) => {
    const widths = holder.getAttribute('data-print-col-widths')!.split(',');
    holder.removeAttribute('data-print-col-widths');
    const split =
      holder.hasAttribute('data-print-split') ||
      holder.hasAttribute('data-print-continued');
    const table =
      holder instanceof HTMLTableElement
        ? holder
        : holder.querySelector('table');
    const cols = table?.querySelectorAll<HTMLElement>(
      ':scope > colgroup > col',
    );
    if (!split || !table || cols?.length !== widths.length) return;
    const total = widths.reduce((sum, w) => sum + Number(w), 0);
    table.style.tableLayout = 'fixed';
    table.style.width = `${total}px`;
    cols.forEach((col, i) => (col.style.width = `${widths[i]}px`));
  });
};

// A table piece holding an in-cell break prints its header once, as a body
// row: the screen repeats no header across that split (§13.6).
const demoteHeadersAcrossInCellBreaks = (root: HTMLElement) => {
  root.querySelectorAll('table').forEach((table) => {
    const thead = table.querySelector(':scope > thead');
    const tbody = table.querySelector(':scope > tbody');
    const split = [
      ...table.querySelectorAll('td [data-print-break], th [data-print-break]'),
    ].some((el) => el.closest('table') === table);
    if (!thead || !tbody || !split) return;
    tbody.prepend(...thead.children);
    thead.remove();
  });
};

export const serializeWithBreaks = (
  liveDoc: PMNode,
  printSchema: Schema,
  breaks: PrintBreak[],
  pageStarts: PageStart[],
  blockAttrs: { pos: number; attrs: Record<string, string> }[] = [],
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
  blockAttrs.forEach(({ pos, attrs }) => mark(pos, attrs));
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
  splitTablesAtRowBreaks(root);
  demoteHeadersAcrossInCellBreaks(root);
  return root.innerHTML;
};
