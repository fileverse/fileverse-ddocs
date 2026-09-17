import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

const isWordChar = (ch: string) => /\S/.test(ch);

/**
 * Word range for a collapsed cursor in the current textblock: the word the
 * cursor touches, else the nearest word before it, else the nearest word
 * after it. Null only when the block has no word at all (empty block, or a
 * NodeSelection whose wrapper carries no text). Position math is relative
 * ($from.start() + parentOffset), so it is schema-agnostic (works under
 * dBlock wrappers).
 *
 * Falling back to a neighbour is what keeps the "can insert a comment"
 * enablement stable while typing: with an adjacent-only rule the answer
 * flipped on every space typed, and every consumer of the command snapshot
 * (the whole menu bar) re-rendered each time.
 */
export const findWordRangeAtCursor = (
  editor: Editor,
): { from: number; to: number } | null => {
  const $from = editor.state.selection.$from;
  const text = $from.parent.textContent;
  const offset = $from.parentOffset;
  let start = offset;
  let end = offset;
  while (start > 0 && isWordChar(text[start - 1])) start--;
  while (end < text.length && isWordChar(text[end])) end++;
  if (start === end) {
    // Nearest word before the cursor, else after it.
    let before = start;
    while (before > 0 && !isWordChar(text[before - 1])) before--;
    if (before > 0) {
      end = before;
      start = before;
      while (start > 0 && isWordChar(text[start - 1])) start--;
    } else {
      let after = end;
      while (after < text.length && !isWordChar(text[after])) after++;
      if (after === text.length) return null;
      start = after;
      end = after;
      while (end < text.length && isWordChar(text[end])) end++;
    }
  }
  const base = $from.start();
  return { from: base + start, to: base + end };
};

/**
 * Ensure a text target for anchored actions (inline comments): keep any
 * existing non-empty TextSelection; otherwise select the word under the
 * collapsed cursor. Shares findWordRangeAtCursor with enablement so
 * "enabled" always implies "dispatch does something".
 *
 * Only a TextSelection passes through untouched — a non-empty NodeSelection
 * (e.g. an image or horizontal rule selected as a node) looks "non-empty"
 * but has no text content, so `textBetween` over it is '' and anything
 * downstream that needs real text (e.g. createFloatingDraft) would silently
 * no-op. Falling through to findWordRangeAtCursor for any other selection
 * type gives either a legitimate adjacent word or null (schema-dependent —
 * e.g. false for a NodeSelection whose dBlock wrapper has no text).
 */
export const selectWordAtCursor = (editor: Editor): boolean => {
  const { selection } = editor.state;
  if (selection instanceof TextSelection && !selection.empty) return true;
  const range = findWordRangeAtCursor(editor);
  if (!range) return false;
  return editor.chain().setTextSelection(range).run();
};

/**
 * Single enablement predicate for anchored text actions (inline comments):
 * true when there's already a non-empty TextSelection, or a word is
 * reachable from a collapsed cursor via findWordRangeAtCursor (the block has
 * any word). Mirrors the passthrough condition in selectWordAtCursor so
 * "enabled" always implies selectWordAtCursor will produce a real text
 * target, and only changes when the cursor moves between blocks with and
 * without text, not on every space typed.
 */
export const hasTextTargetAtSelection = (editor: Editor): boolean => {
  const { selection } = editor.state;
  if (selection instanceof TextSelection && !selection.empty) return true;
  return findWordRangeAtCursor(editor) !== null;
};
