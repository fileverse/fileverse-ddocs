import type { JSONContent } from '@tiptap/core';
import type { Node, ResolvedPos } from 'prosemirror-model';

const times = <T>(n: number, fn: (i: number) => T): T[] =>
  Array.from({ length: n }, (_, i) => fn(i));

export const buildNode = ({ type, content }: JSONContent): JSONContent =>
  content ? { type, content } : { type };

export const buildParagraph = ({ content }: Partial<JSONContent>) =>
  buildNode({ type: 'paragraph', content });

export const buildDBlock = ({ content }: Partial<JSONContent>) =>
  buildNode({ type: 'dBlock', content });

export const buildColumn = ({ content }: Partial<JSONContent>) =>
  buildNode({ type: 'column', content });

export const buildColumnBlock = ({ content }: Partial<JSONContent>) =>
  buildNode({ type: 'columns', content });

export const buildNColumns = (n: number, wrapInDBlock = true) => {
  const content = wrapInDBlock
    ? [buildDBlock({ content: [buildParagraph({})] })]
    : [buildParagraph({})];
  const fn = () => buildColumn({ content });
  return times(n, fn);
};

interface PredicateProps {
  node: Node;
  pos: number;
  start: number;
}

export type Predicate = (props: PredicateProps) => boolean;

export const findParentNodeClosestToPos = (
  $pos: ResolvedPos,
  predicate: Predicate,
) => {
  for (let i = $pos.depth; i > 0; i--) {
    const node = $pos.node(i);
    const pos = i > 0 ? $pos.before(i) : 0;
    const start = $pos.start(i);
    if (predicate({ node, pos, start })) {
      return {
        start,
        depth: i,
        node,
        pos,
      };
    }
  }
  throw Error('no ancestor found');
};
