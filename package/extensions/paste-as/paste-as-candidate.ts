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

export const pasteAsPluginKey = new PluginKey<number | null>('pasteAs');

/**
 * Remembers where the last paste left the caret. The paste stays live while
 * the selection still ends at that spot (mapped through later changes);
 * typing, clicking or arrowing away ends it. Judged on state, not on which
 * transaction did what: the editor's own paste colour clean-up
 * (use-tab-editor) selects the pasted range, re-marks it and puts the caret
 * back a tick later, and that must not dismiss the menu.
 */
export const PasteAs = Extension.create({
  name: 'pasteAs',
  addProseMirrorPlugins() {
    return [
      new Plugin<number | null>({
        key: pasteAsPluginKey,
        state: {
          init: () => null,
          apply: (tr, anchor, _old, newState) => {
            const { selection } = newState;
            if (tr.getMeta('uiEvent') === 'paste' || tr.getMeta('paste')) {
              return selection.empty ? selection.from : null;
            }
            if (anchor === null) return null;
            // assoc -1: text typed at the anchor lands after it, so the
            // caret moves on and the menu goes.
            const mapped = tr.mapping.map(anchor, -1);
            return selection.to === mapped ? mapped : null;
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
export const findBareLinkCandidate = (
  state: EditorState,
): PasteAsCandidate | null => {
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
  if (tweetId) return { kind: 'tweet', href, tweetId };
  if (isImageUrl(href)) return { kind: 'image', href };
  return null;
};

/** The paste-as menu's candidate: a bare embeddable link the user just pasted. */
export const getPasteAsCandidate = (
  state: EditorState,
): PasteAsCandidate | null => {
  if (pasteAsPluginKey.getState(state) === null) return null;
  if (!state.selection.empty) return null;
  return findBareLinkCandidate(state);
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
