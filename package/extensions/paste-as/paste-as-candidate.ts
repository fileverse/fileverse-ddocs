import { Extension, getMarkRange, type Editor } from '@tiptap/core';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  type EditorState,
} from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TWITTER_REGEX } from '../../constants/twitter';

export type PasteAsCandidate =
  | { kind: 'image'; href: string }
  | { kind: 'tweet'; href: string; tweetId: string };

const IMAGE_PATH_REGEX = /\.(jpe?g|gif|png|webp)$/i;

const isImageUrl = (href: string) => {
  try {
    return IMAGE_PATH_REGEX.test(new URL(href).pathname);
  } catch {
    return false;
  }
};

interface PastedRange {
  from: number;
  to: number;
}

export const pasteAsPluginKey = new PluginKey<PastedRange | null>('pasteAs');

/**
 * Remembers the range the last paste filled. The paste stays live while the
 * selection still ends at the end of that range (mapped through later
 * changes); typing, clicking or arrowing away ends it. Judged on state, not
 * on which transaction did what: the editor's own paste colour clean-up
 * (use-tab-editor) selects the pasted range, re-marks it and puts the caret
 * back a tick later, and that must not dismiss the menu.
 */
export const PasteAs = Extension.create({
  name: 'pasteAs',
  addProseMirrorPlugins() {
    return [
      new Plugin<PastedRange | null>({
        key: pasteAsPluginKey,
        state: {
          init: () => null,
          apply: (tr, pasted, oldState, newState) => {
            const { selection } = newState;
            if (tr.getMeta('uiEvent') === 'paste' || tr.getMeta('paste')) {
              if (!selection.empty) return null;
              return {
                from: tr.mapping.map(oldState.selection.from, -1),
                to: selection.from,
              };
            }
            if (pasted === null) return null;
            // assoc -1 on the end: text typed there lands after it, so the
            // caret moves on and the menu goes.
            const to = tr.mapping.map(pasted.to, -1);
            if (selection.to !== to) return null;
            return { from: tr.mapping.map(pasted.from, 1), to };
          },
        },
      }),
    ];
  },
});

/**
 * A bare URL link under the caret that could become an embed. "Bare" means
 * the link text is the URL itself, which is what Link's autolink produces
 * from a paste; a named link is left alone.
 *
 * Reads the mark range rather than `isActive('link')`: right after a paste
 * the caret sits at the end of the link with stored marks already stamped
 * (caret-marks), so `isActive` is false there even though the link is.
 */
const findBareLink = (state: EditorState) => {
  const linkType = state.schema.marks.link;
  if (!linkType) return null;
  const range = getMarkRange(state.selection.$from, linkType);
  if (!range) return null;

  const href = state.doc
    .nodeAt(range.from)
    ?.marks.find((mark) => mark.type === linkType)?.attrs.href;
  if (typeof href !== 'string' || !href) return null;
  if (state.doc.textBetween(range.from, range.to) !== href) return null;

  const tweetId = href.match(TWITTER_REGEX)?.[2];
  const candidate: PasteAsCandidate | null = tweetId
    ? { kind: 'tweet', href, tweetId }
    : isImageUrl(href)
      ? { kind: 'image', href }
      : null;
  return candidate && { candidate, range };
};

export const findBareLinkCandidate = (
  state: EditorState,
): PasteAsCandidate | null => findBareLink(state)?.candidate ?? null;

/**
 * The paste-as menu's candidate: a bare embeddable link the user just
 * pasted. The link has to lie inside the pasted range, or a paste that
 * merely ends next to an older link would offer to convert that one.
 */
export const getPasteAsCandidate = (
  state: EditorState,
): PasteAsCandidate | null => {
  const pasted = pasteAsPluginKey.getState(state);
  if (!pasted || !state.selection.empty) return null;
  const found = findBareLink(state);
  if (!found) return null;
  const { range, candidate } = found;
  return range.from >= pasted.from && range.to <= pasted.to ? candidate : null;
};

/**
 * Replace the link under the caret with the candidate's embed node and
 * select that node, so the caret does not fall into a neighbouring block.
 */
export const embedPasteAsCandidate = (
  editor: Editor,
  candidate: PasteAsCandidate,
) => {
  const chain = editor
    .chain()
    .focus()
    .extendMarkRange('link')
    .deleteSelection();
  const isEmbed =
    candidate.kind === 'tweet'
      ? (node: ProseMirrorNode) =>
          node.type.name === 'embeddedTweet' &&
          node.attrs.tweetId === candidate.tweetId
      : (node: ProseMirrorNode) =>
          node.type.name === 'resizableMedia' &&
          node.attrs.src === candidate.href;

  return (
    candidate.kind === 'tweet'
      ? chain.setTweetEmbed({ tweetId: candidate.tweetId })
      : chain.setMedia({ src: candidate.href, 'media-type': 'img' })
  )
    .command(({ tr, dispatch }) => {
      // Same transaction as the insert: the match nearest the caret is
      // the node just inserted, whatever the schema wraps it in.
      const near = tr.selection.from;
      let embedPos: number | null = null;
      tr.doc.descendants((node, pos) => {
        if (!isEmbed(node)) return true;
        if (
          embedPos === null ||
          Math.abs(pos - near) < Math.abs(embedPos - near)
        ) {
          embedPos = pos;
        }
        return false;
      });
      if (embedPos !== null && dispatch) {
        tr.setSelection(NodeSelection.create(tr.doc, embedPos));
      }
      return true;
    })
    .run();
};
