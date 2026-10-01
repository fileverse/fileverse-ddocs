import { Fragment, Slice } from '@tiptap/pm/model';
import type { NodeRange, NodeType } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { ReplaceAroundStep } from '@tiptap/pm/transform';

/**
 * prosemirror-transform's `lift`, with the lifted content wrapped in
 * `wrapper` when given: a dBlock is `group: 'dBlock'`, so a block inside a
 * list item cannot be wrapped in one first and lifted afterwards — the
 * wrapper has to be part of the lift step's slice (spec §3.4 step 2).
 */
export const liftOut = (
  tr: Transaction,
  range: NodeRange,
  target: number,
  wrapper: NodeType | null,
) => {
  const { $from, $to, depth } = range;
  const gapStart = $from.before(depth + 1);
  const gapEnd = $to.after(depth + 1);
  let start = gapStart;
  let end = gapEnd;

  let before = Fragment.empty;
  let openStart = 0;
  for (let d = depth, splitting = false; d > target; d--) {
    if (splitting || $from.index(d) > 0) {
      splitting = true;
      before = Fragment.from($from.node(d).copy(before));
      openStart++;
    } else {
      start--;
    }
  }
  let after = Fragment.empty;
  let openEnd = 0;
  for (let d = depth, splitting = false; d > target; d--) {
    if (splitting || $to.after(d + 1) < $to.end(d)) {
      splitting = true;
      after = Fragment.from($to.node(d).copy(after));
      openEnd++;
    } else {
      end++;
    }
  }

  const middle = wrapper ? Fragment.from(wrapper.create()) : Fragment.empty;
  const insert = before.size - openStart + (wrapper ? 1 : 0);
  tr.step(
    new ReplaceAroundStep(
      start,
      end,
      gapStart,
      gapEnd,
      new Slice(before.append(middle).append(after), openStart, openEnd),
      insert,
      true,
    ),
  );
};
