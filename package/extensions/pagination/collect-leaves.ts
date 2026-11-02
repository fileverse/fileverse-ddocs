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

const realChild = (el: Element, last: boolean): HTMLElement | null => {
  let c = last ? el.lastElementChild : el.firstElementChild;
  while (c?.classList.contains(SPACER_CLASS)) {
    c = last ? c.previousElementSibling : c.nextElementSibling;
  }
  return c instanceof HTMLElement ? c : null;
};

// Margin an element presents to its neighbour: its own, collapsed with the
// ones of its first (top) or last (bottom) child chain until a blocker.
function effectiveMargin(el: HTMLElement, side: 'Top' | 'Bottom'): number {
  const style = getComputedStyle(el);
  const own = parseFloat(style[`margin${side}`]) || 0;
  const stops =
    (parseFloat(style[`padding${side}`]) || 0) > 0 ||
    (parseFloat(style[`border${side}Width`]) || 0) > 0 ||
    /flex|grid|flow-root|table/.test(style.display) ||
    !['visible', ''].includes(style.overflow);
  const child = stops ? null : realChild(el, side === 'Bottom');
  return child ? collapsedMargin(own, effectiveMargin(child, side)) : own;
}
export const effectiveTopMargin = (el: HTMLElement) =>
  effectiveMargin(el, 'Top');
export const effectiveBottomMargin = (el: HTMLElement) =>
  effectiveMargin(el, 'Bottom');

// What a block spacer adds beyond its own height between two siblings: the
// swallowed margin, or one row gap in a flex or grid parent (no collapsing).
function spacerExtra(
  parent: HTMLElement | null,
  prev: HTMLElement | null,
  next: HTMLElement | null,
): number {
  if (parent) {
    const style = getComputedStyle(parent);
    if (/flex|grid/.test(style.display)) {
      return prev && next ? parseFloat(style.rowGap) || 0 : 0;
    }
  }
  return spacerDisplacement({
    height: 0,
    marginAbove: prev ? effectiveBottomMargin(prev) : 0,
    marginBelow: next ? effectiveTopMargin(next) : 0,
  });
}

// A node's own content element: a node view's chrome (a code block's
// line-number gutter) is not text of the leaf and does not move with a spacer.
const contentOf = (el: HTMLElement): HTMLElement =>
  (el as { pmViewDesc?: { contentDOM?: HTMLElement | null } }).pmViewDesc
    ?.contentDOM ?? el;

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

  const realSibling = (
    el: Element,
    dir: 'previousElementSibling' | 'nextElementSibling',
  ): HTMLElement | null => {
    let sib = el[dir];
    while (sib?.classList.contains(SPACER_CLASS)) sib = sib[dir];
    return sib instanceof HTMLElement ? sib : null;
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
        : height +
          spacerExtra(
            parent,
            realSibling(el, 'previousElementSibling'),
            realSibling(el, 'nextElementSibling'),
          ),
    };
  });
  // Spacers are in document order: those before an element, then those
  // inside it, then the rest. The boundary is searched from the last one
  // found: visits mostly move forward, so one or two comparisons each.
  const sums = [0];
  spacers.forEach((s, i) => sums.push(sums[i] + s.amount));
  const hints = [0, 0];
  const endOf = (el: HTMLElement, includeInside: boolean) => {
    const passes = (i: number) => {
      const rel = el.compareDocumentPosition(spacers[i].el);
      return (
        !!(rel & Node.DOCUMENT_POSITION_PRECEDING) ||
        (includeInside && !!(rel & Node.DOCUMENT_POSITION_CONTAINED_BY))
      );
    };
    const hint = hints[Number(includeInside)];
    let lo = 0;
    let hi = hint - 1;
    if (hint === 0 || passes(hint - 1)) {
      lo = hint;
      hi = hint;
      for (let step = 1; hi < spacers.length && passes(hi); step *= 2) {
        lo = hi + 1;
        hi = Math.min(spacers.length, hi + step);
      }
    }
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (passes(mid)) lo = mid + 1;
      else hi = mid;
    }
    hints[Number(includeInside)] = lo;
    return lo;
  };

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
    // spacers[first, end) are inside el.
    const first = endOf(el, false);
    const end = endOf(el, true);
    return {
      el,
      first,
      end,
      top: (rect.top - originTop) / scale - sums[first],
      bottom: (rect.bottom - originTop) / scale - sums[end],
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
    const spacerCollapse =
      outer instanceof HTMLElement
        ? spacerExtra(
            outer.parentElement,
            realSibling(outer, 'previousElementSibling'),
            outer,
          )
        : 0;
    return { spacerPos, spacerCollapse };
  };

  type Atomic = Extract<Leaf, { kind: 'atomic' }>;
  const atomic = (pos: number, extra: Pick<Atomic, 'row' | 'table'> = {}) => {
    const b = box(pos);
    if (b) {
      leaves.push({
        kind: 'atomic',
        pos,
        top: b.top,
        bottom: b.bottom,
        marginTop: b.marginTop,
        ...spacerAnchor(pos),
        ...extra,
      });
    }
  };

  const walk = (parent: PMNode, contentStart: number) =>
    parent.forEach((child, offset) => visit(child, contentStart + offset));

  const tableHeader = (table: PMNode, pos: number) => {
    const first = table.firstChild;
    const hasHeader =
      !!first &&
      first.childCount > 0 &&
      first.content.content.every((cell) => cell.type.name === 'tableHeader');
    const firstBox = hasHeader ? box(pos + 1) : null;
    return {
      hasHeader,
      headerHeight: firstBox ? firstBox.bottom - firstBox.top : 0,
    };
  };

  const visitTable = (table: PMNode, pos: number) => {
    tableId += 1;
    const { hasHeader, headerHeight } = tableHeader(table, pos);
    table.forEach((_, offset) =>
      atomic(pos + 1 + offset, {
        row: { tableId, isHeader: hasHeader && offset === 0, headerHeight },
      }),
    );
  };

  // One leaf, with its rows: print breaks a tall table between rows.
  const wholeTable = (table: PMNode, pos: number) => {
    const rows: { top: number; bottom: number }[] = [];
    table.forEach((_, offset) => {
      const b = box(pos + 1 + offset);
      if (b) rows.push({ top: b.top, bottom: b.bottom });
    });
    const { headerHeight } = tableHeader(table, pos);
    atomic(pos, { table: { rows, headerHeight } });
  };

  const visit = (node: PMNode, pos: number) => {
    const name = node.type.name;
    if (WALKED.has(name)) return walk(node, pos + 1);
    if (name === 'pageBreak') {
      leaves.push({ kind: 'forced', pos });
      return;
    }
    if (name === 'table') {
      return tableRows ? visitTable(node, pos) : wholeTable(node, pos);
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
    const inner = spacers.slice(b.first, b.end).filter((s) => s.inText);
    const lines = measureLines(view, contentOf(b.el), {
      from: pos + 1,
      to: pos + 1 + node.content.size,
      originTop,
      bottom: b.bottom,
      scale,
      range,
      shiftAt: (top) =>
        inner.reduce(
          (sum, s) => (s.top <= top + 0.5 ? sum + s.amount : sum),
          sums[b.first],
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
