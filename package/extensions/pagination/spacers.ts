import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { SPACER_CLASS } from './collect-leaves';
import type { Spacer } from './place';

const SPACER_ROW_CLASS = 'ddoc-page-spacer-row';
const SPACER_HEADER_CLASS = 'ddoc-page-spacer-header';

// No pos: the key keeps the DOM node when only positions shift.
export function spacerKey(s: Spacer): string {
  return `${s.kind}:${s.height}:${s.page}`;
}

// Height of an inText spacer from its decoration key, null for anything else.
export function inTextSpacerHeight(key: unknown): number | null {
  const [kind, height] = String(key).split(':');
  return kind === 'inText' ? Number(height) || 0 : null;
}

// Repeated header height from a row spacer's decoration key, else 0.
export function rowSpacerHeader(key: unknown): number {
  const [kind, , header] = String(key).split(':');
  return kind === 'row' ? Number(header) || 0 : 0;
}

// A 0px div does nothing visible and lets margins collapse through it.
const visible = (spacers: Spacer[]) => spacers.filter((s) => s.height > 0);

function createSpacerElement(s: Spacer): HTMLElement {
  const el = document.createElement('div');
  el.className = SPACER_CLASS;
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-label', `Page ${s.page}`);
  el.style.height = `${s.height}px`;
  return el;
}

// The header height is measured (and divided by the zoom scale): whole pixels
// in the keys, or float noise at another zoom re-dispatches the same spacers.
const headerKey = (s: Spacer) => Math.round(s.header ?? 0);

// One borderless cell across the table; the row's height is the spacer's,
// less the whole-pixel header. A separator role is invalid on a tbody row.
function createSpacerRow(s: Spacer, columns: number): HTMLElement {
  const tr = document.createElement('tr');
  tr.className = `${SPACER_CLASS} ${SPACER_ROW_CLASS}`;
  tr.setAttribute('contenteditable', 'false');
  tr.setAttribute('aria-hidden', 'true');
  tr.style.display = 'table-row';
  tr.style.height = `${Math.max(0, s.height - headerKey(s))}px`;
  const td = document.createElement('td');
  td.colSpan = columns;
  Object.assign(td.style, {
    padding: '0',
    border: 'none',
    background: 'none',
    minWidth: '0',
    maxWidth: 'none',
    height: 'auto',
  });
  tr.appendChild(td);
  return tr;
}

// The header row as the view draws it, inert. Rowspans would reach into the
// rows after the clone.
function createHeaderClone(
  view: EditorView,
  tableStart: number,
  header: PMNode,
): HTMLElement {
  const live = view.nodeDOM(tableStart);
  const clone =
    live instanceof HTMLElement && live.tagName === 'TR'
      ? (live.cloneNode(true) as HTMLElement)
      : (DOMSerializer.fromSchema(view.state.schema).serializeNode(
          header,
        ) as HTMLElement);
  clone.classList.add(SPACER_CLASS, SPACER_HEADER_CLASS);
  clone.setAttribute('contenteditable', 'false');
  clone.setAttribute('aria-hidden', 'true');
  clone.style.display = 'table-row';
  clone.querySelectorAll('.column-resize-handle').forEach((el) => el.remove());
  clone.querySelectorAll<HTMLTableCellElement>('td, th').forEach((cell) => {
    cell.rowSpan = 1;
    // A cell node view's chrome (the hover "…" trigger) sits outside its
    // content; atoms inside the content stay, so the height matches.
    const content = cell.querySelector('[data-node-view-content]');
    cell
      .querySelectorAll('.trigger-button, [contenteditable="false"]')
      .forEach((el) => {
        const chrome =
          el.classList.contains('trigger-button') ||
          (!!content && !content.contains(el));
        if (chrome) el.remove();
      });
  });
  clone
    .querySelectorAll('.selectedCell, .ProseMirror-selectednode')
    .forEach((el) =>
      el.classList.remove('selectedCell', 'ProseMirror-selectednode'),
    );
  return clone;
}

const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h, 33) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(36);
};

type Widget = {
  pos: number;
  key: string;
  side: number;
  toDOM: (view: EditorView, getPos: () => number | undefined) => HTMLElement;
};

// A spacer between table rows is a spacer row and, when the header repeats,
// a clone of the header row (docs/PAGES_MODE.md §13.6).
function widgetsOf(doc: PMNode, s: Spacer): Widget[] {
  const $pos = doc.resolve(s.pos);
  const table = $pos.parent;
  if (table.type.name !== 'table') {
    return [
      {
        pos: s.pos,
        key: spacerKey(s),
        side: -1,
        toDOM: () => createSpacerElement(s),
      },
    ];
  }
  let columns = 0;
  table.firstChild?.forEach((cell) => {
    columns += Number(cell.attrs.colspan) || 1;
  });
  const out: Widget[] = [
    {
      pos: s.pos,
      key: `row:${s.height}:${headerKey(s)}:${s.page}`,
      side: -2,
      toDOM: () => createSpacerRow(s, Math.max(1, columns)),
    },
  ];
  const header = table.firstChild;
  if (s.header && header) {
    out.push({
      pos: s.pos,
      key: `header:${hash(JSON.stringify(header.toJSON()))}:${headerKey(s)}:${s.page}`,
      side: -1,
      // The doc may have moved on since the set was built.
      toDOM: (view, getPos) => {
        const at = getPos() ?? s.pos;
        return createHeaderClone(
          view,
          view.state.doc.resolve(at).start(),
          header,
        );
      },
    });
  }
  return out;
}

const widgets = (doc: PMNode, spacers: Spacer[]) =>
  visible(spacers).flatMap((s) => widgetsOf(doc, s));

export function buildSpacerDecorations(
  doc: PMNode,
  spacers: Spacer[],
): DecorationSet {
  return DecorationSet.create(
    doc,
    widgets(doc, spacers).map((w) =>
      Decoration.widget(w.pos, w.toDOM, {
        side: w.side,
        key: w.key,
        ignoreSelection: true,
        marks: [],
      }),
    ),
  );
}

// find() lists a set's own decorations before its children's, so compare
// as sorted (pos, key) pairs, not by index. Keys come from the same widgets
// buildSpacerDecorations makes, so an edited table header no longer matches.
export function spacersMatch(
  current: DecorationSet,
  next: Spacer[],
  doc: PMNode,
): boolean {
  const id = (pos: number, key: string) => `${pos}|${key}`;
  const have = current
    .find()
    .map((d) =>
      id(d.from, (d as unknown as { spec: { key: string } }).spec.key),
    )
    .sort();
  const want = widgets(doc, next)
    .map((w) => id(w.pos, w.key))
    .sort();
  return have.length === want.length && have.every((v, i) => v === want[i]);
}
