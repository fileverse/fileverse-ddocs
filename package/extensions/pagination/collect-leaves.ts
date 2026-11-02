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
export function collectLeaves(view: EditorView, textHeight: number): Leaf[] {
  const scale = getZoomScale(view.dom);
  const originTop = view.dom.getBoundingClientRect().top;
  const range = document.createRange();
  const leaves: Leaf[] = [];
  let tableId = 0;

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
      top: (rect.top - originTop) / scale,
      bottom: (rect.bottom - originTop) / scale,
      marginTop: leadingOffset(startingChain(el)),
    };
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
        spacerPos: pos,
        spacerCollapse: 0,
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
    if (name === 'table') return visitTable(node, pos);
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
    });
    // An empty textblock has no line boxes; it moves as a unit.
    if (lines.length === 0) return atomic(pos);
    leaves.push({
      kind: 'text',
      pos,
      top: b.top,
      bottom: b.bottom,
      marginTop: b.marginTop,
      spacerPos: pos,
      spacerCollapse: 0,
      isHeading: name === 'heading',
      lines,
    });
  };

  walk(view.state.doc, 0);
  return leaves;
}
