import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';

const isParagraph = (node: ProseMirrorNode | null) =>
  node?.type.name === 'paragraph';

/**
 * Edge spacing policy (spec §3.5), mirroring the ownership plugin's takeEdge
 * rule: an item's spaceBefore belongs to its first child and its spaceAfter
 * to its last child, each only when that child is a paragraph.
 */

/** Item → paragraphs. The item's value wins over the paragraph's own. */
export const edgesToParagraphs = (
  tr: Transaction,
  itemPos: number,
  item: ProseMirrorNode,
) => {
  const first = item.firstChild;
  const last = item.lastChild;
  if (!first || !last) return;
  const firstPos = itemPos + 1;
  const lastPos = itemPos + item.nodeSize - 1 - last.nodeSize;
  const patches = new Map<number, Record<string, unknown>>();
  if (isParagraph(first) && item.attrs.spaceBefore != null) {
    patches.set(firstPos, { spaceBefore: item.attrs.spaceBefore });
  }
  if (isParagraph(last) && item.attrs.spaceAfter != null) {
    patches.set(lastPos, {
      ...(patches.get(lastPos) ?? {}),
      spaceAfter: item.attrs.spaceAfter,
    });
  }
  patches.forEach((attrs, pos) => {
    const node = tr.doc.nodeAt(pos) as ProseMirrorNode;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  });
};

/** Paragraphs → the (new) item at itemPos; the moved values are nulled on the paragraphs. */
export const edgesToItem = (tr: Transaction, itemPos: number) => {
  const item = tr.doc.nodeAt(itemPos) as ProseMirrorNode;
  const first = item.firstChild;
  const last = item.lastChild;
  if (!first || !last) return;
  const firstPos = itemPos + 1;
  const lastPos = itemPos + item.nodeSize - 1 - last.nodeSize;
  const itemAttrs: Record<string, unknown> = { ...item.attrs };
  const clear = new Map<number, string[]>();
  if (isParagraph(first) && first.attrs.spaceBefore != null) {
    itemAttrs.spaceBefore = first.attrs.spaceBefore;
    clear.set(firstPos, ['spaceBefore']);
  }
  if (isParagraph(last) && last.attrs.spaceAfter != null) {
    itemAttrs.spaceAfter = last.attrs.spaceAfter;
    clear.set(lastPos, [...(clear.get(lastPos) ?? []), 'spaceAfter']);
  }
  if (!clear.size) return;
  tr.setNodeMarkup(itemPos, undefined, itemAttrs);
  clear.forEach((keys, pos) => {
    const node = tr.doc.nodeAt(pos) as ProseMirrorNode;
    const nulled = Object.fromEntries(keys.map((key) => [key, null]));
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...nulled });
  });
};
