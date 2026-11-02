// Ported from Edentext (https://github.com/stffnb/edentext, b5ee86a), src/lib/editor/extensions/pageBreaks.ts. AGPL-3.0.
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { getZoomScale } from '../../utils/zoom';
import { measureLines } from './line-split';
import type { Leaf } from './place';

// Containers whose children are placed one by one (docs/PAGES_MODE.md §4.2).
const WALKED = new Set([
  'dBlock',
  'bulletList',
  'orderedList',
  'taskList',
  'listItem',
  'taskItem',
  'blockquote',
]);

export const SPACER_CLASS = 'ddoc-page-spacer';

// CSS margin collapsing for two adjoining margins, negatives included.
export function collapsedMargin(a: number, b: number): number {
  if (a >= 0 && b >= 0) return Math.max(a, b);
  if (a < 0 && b < 0) return Math.min(a, b);
  return a + b;
}

// How far a block spacer moves what follows it: its height plus the margins
// it separates, minus the one margin that used to be between them.
export function spacerDisplacement(s: {
  height: number;
  marginAbove: number;
  marginBelow: number;
}): number {
  return (
    s.height +
    s.marginAbove +
    s.marginBelow -
    collapsedMargin(s.marginAbove, s.marginBelow)
  );
}

export type BoxEdge = {
  top: number;
  marginTop: number;
  blocksCollapse: boolean;
};

// Distance from the top margin edge of the outermost box that starts with a
// leaf down to the leaf's border box. Print keeps all of it after a forced
// break. chain[0] is the leaf, the last entry the outermost box; margins that
// collapse through count once, as the largest.
export function leadingOffset(chain: BoxEdge[]): number {
  const outer = chain[chain.length - 1];
  let collapsed = outer.marginTop;
  for (let i = chain.length - 2; i >= 0; i -= 1) {
    if (chain[i + 1].blocksCollapse) break;
    collapsed = Math.max(collapsed, chain[i].marginTop);
  }
  return chain[0].top - outer.top + collapsed;
}

const blocksMarginCollapse = (style: CSSStyleDeclaration) =>
  (parseFloat(style.paddingTop) || 0) > 0 ||
  (parseFloat(style.borderTopWidth) || 0) > 0 ||
  /flex|grid|flow-root|table/.test(style.display) ||
  style.overflow !== 'visible';

// Leaves in document order, measured in the view.dom frame, unscaled.
export function collectLeaves(
  view: EditorView,
  textHeight: number,
  options: { tableRows?: boolean } = {},
): Leaf[] {
  const { tableRows = false } = options;
  const scale = getZoomScale(view.dom);
  const originTop = view.dom.getBoundingClientRect().top;
  const range = document.createRange();
  const leaves: Leaf[] = [];
  let tableId = 0;

  const marginOf = (el: Element | null, side: 'Top' | 'Bottom') =>
    el ? parseFloat(getComputedStyle(el)[`margin${side}`]) || 0 : 0;
  const realSibling = (
    el: Element,
    dir: 'previousElementSibling' | 'nextElementSibling',
  ) => {
    let sib = el[dir];
    while (sib?.classList.contains(SPACER_CLASS)) sib = sib[dir];
    return sib;
  };

  // Spacers already in the DOM shift everything below them; every position
  // below is read back to where it would be without them.
  const spacers = Array.from(
    view.dom.querySelectorAll<HTMLElement>(`.${SPACER_CLASS}`),
  ).map((el) => {
    const rect = el.getBoundingClientRect();
    const parent = el.parentElement;
    let inText = false;
    try {
      inText =
        !!parent &&
        parent !== view.dom &&
        view.state.doc.resolve(view.posAtDOM(parent, 0)).parent.isTextblock;
    } catch {
      inText = false;
    }
    const height = rect.height / scale;
    return {
      el,
      inText,
      top: (rect.top - originTop) / scale,
      amount: inText
        ? height
        : spacerDisplacement({
            height,
            marginAbove: marginOf(
              realSibling(el, 'previousElementSibling'),
              'Bottom',
            ),
            marginBelow: marginOf(realSibling(el, 'nextElementSibling'), 'Top'),
          }),
    };
  });
  const before = (el: HTMLElement, includeInside: boolean) =>
    spacers.reduce((sum, s) => {
      const rel = el.compareDocumentPosition(s.el);
      const preceding = !!(rel & Node.DOCUMENT_POSITION_PRECEDING);
      const inside = !!(rel & Node.DOCUMENT_POSITION_CONTAINED_BY);
      return sum + (preceding || (includeInside && inside) ? s.amount : 0);
    }, 0);

  // The leaf and every box it is the first child of, below view.dom.
  const startingChain = (el: HTMLElement): BoxEdge[] => {
    const chain: BoxEdge[] = [];
    for (let e: HTMLElement = el; ; ) {
      const style = getComputedStyle(e);
      chain.push({
        top: (e.getBoundingClientRect().top - originTop) / scale,
        marginTop: parseFloat(style.marginTop) || 0,
        blocksCollapse: blocksMarginCollapse(style),
      });
      const parent = e.parentElement;
      if (!parent || parent === view.dom || parent.firstElementChild !== e) {
        return chain;
      }
      e = parent;
    }
  };

  const box = (pos: number) => {
    const el = view.nodeDOM(pos);
    if (!(el instanceof HTMLElement)) return null;
    const rect = el.getBoundingClientRect();
    return {
      el,
      top: (rect.top - originTop) / scale - before(el, false),
      bottom: (rect.bottom - originTop) / scale - before(el, true),
      marginTop: leadingOffset(startingChain(el)),
    };
  };

  // Outermost node that starts with the leaf: a spacer goes before it.
  const spacerAnchor = (pos: number) => {
    const $pos = view.state.doc.resolve(pos);
    let spacerPos = pos;
    for (let d = $pos.depth; d > 0 && $pos.index(d) === 0; d -= 1) {
      spacerPos = $pos.before(d);
    }
    const outer = view.nodeDOM(spacerPos);
    const prev =
      outer instanceof HTMLElement
        ? realSibling(outer, 'previousElementSibling')
        : null;
    const spacerCollapse = prev
      ? Math.max(
          0,
          Math.min(
            marginOf(prev, 'Bottom'),
            marginOf(outer as HTMLElement, 'Top'),
          ),
        )
      : 0;
    return { spacerPos, spacerCollapse };
  };

  const atomic = (
    pos: number,
    row?: Extract<Leaf, { kind: 'atomic' }>['row'],
  ) => {
    const b = box(pos);
    if (b) {
      leaves.push({
        kind: 'atomic',
        pos,
        top: b.top,
        bottom: b.bottom,
        marginTop: b.marginTop,
        ...spacerAnchor(pos),
        row,
      });
    }
  };

  const walk = (parent: PMNode, contentStart: number) =>
    parent.forEach((child, offset) => visit(child, contentStart + offset));

  const visitTable = (table: PMNode, pos: number) => {
    tableId += 1;
    const first = table.firstChild;
    const hasHeader =
      !!first &&
      first.childCount > 0 &&
      first.content.content.every((cell) => cell.type.name === 'tableHeader');
    const firstBox = hasHeader ? box(pos + 1) : null;
    const headerHeight = firstBox ? firstBox.bottom - firstBox.top : 0;
    table.forEach((_, offset) =>
      atomic(pos + 1 + offset, {
        tableId,
        isHeader: hasHeader && offset === 0,
        headerHeight,
      }),
    );
  };

  const visit = (node: PMNode, pos: number) => {
    const name = node.type.name;
    if (WALKED.has(name)) return walk(node, pos + 1);
    if (name === 'pageBreak') {
      leaves.push({ kind: 'forced', pos });
      return;
    }
    if (name === 'table') {
      return tableRows ? visitTable(node, pos) : atomic(pos);
    }
    if (name === 'callout') {
      const b = box(pos);
      if (b && b.bottom - b.top > textHeight) return walk(node, pos + 1);
      return atomic(pos);
    }
    const isMermaid = name === 'codeBlock' && node.attrs.language === 'mermaid';
    if (!node.isTextblock || isMermaid) return atomic(pos);

    const b = box(pos);
    if (!b) return;
    const lines = measureLines(view, b.el, {
      from: pos + 1,
      to: pos + 1 + node.content.size,
      originTop,
      bottom: b.bottom,
      scale,
      range,
      shiftAt: (top) =>
        spacers.reduce(
          (sum, s) =>
            b.el.contains(s.el) && s.inText && s.top <= top + 0.5
              ? sum + s.amount
              : sum,
          before(b.el, false),
        ),
    });
    // An empty textblock has no line boxes; it moves as a unit.
    if (lines.length === 0) return atomic(pos);
    leaves.push({
      kind: 'text',
      pos,
      top: b.top,
      bottom: b.bottom,
      marginTop: b.marginTop,
      ...spacerAnchor(pos),
      isHeading: name === 'heading',
      lines,
    });
  };

  walk(view.state.doc, 0);
  return leaves;
}
