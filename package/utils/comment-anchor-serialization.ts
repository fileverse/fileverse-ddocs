import * as Y from 'yjs';
import type { CommentAnchor } from '../extensions/comment/comment-decoration-plugin';
import type { SerializedCommentAnchor } from '../types';

export const getSerializedCommentAnchorsKey = (
  anchors?: SerializedCommentAnchor[],
) => {
  if (!anchors || anchors.length === 0) {
    return null;
  }

  return anchors
    .map((anchor) =>
      JSON.stringify([
        anchor.id,
        anchor.anchorFrom,
        anchor.anchorTo,
        anchor.resolved,
        anchor.deleted,
        anchor.isSuggestion,
        anchor.suggestionType,
        anchor.originalContent,
        anchor.suggestedContent,
        anchor.multilineStructure,
        anchor.followsSuggestionId,
      ]),
    )
    .join(',');
};

export const deserializeCommentAnchors = (
  anchors?: SerializedCommentAnchor[],
): CommentAnchor[] => {
  if (!anchors || anchors.length === 0) {
    return [];
  }

  return anchors
    .map((anchor) => {
      try {
        const base: CommentAnchor = {
          id: anchor.id,
          anchorFrom: Y.decodeRelativePosition(
            Uint8Array.from(atob(anchor.anchorFrom), (char) =>
              char.charCodeAt(0),
            ),
          ),
          anchorTo: Y.decodeRelativePosition(
            Uint8Array.from(atob(anchor.anchorTo), (char) =>
              char.charCodeAt(0),
            ),
          ),
          resolved: anchor.resolved,
          deleted: anchor.deleted,
        };

        // Preserve suggestion metadata so suggestion decorations render
        // correctly after reload (cache schema for suggestions evolves;
        // package can't render them without these fields).
        if (anchor.isSuggestion) {
          base.isSuggestion = true;
          base.suggestionType = anchor.suggestionType;
          base.originalContent = anchor.originalContent;
          base.suggestedContent = anchor.suggestedContent;
          base.multilineStructure = anchor.multilineStructure;
          base.followsSuggestionId = anchor.followsSuggestionId;
        }

        return base;
      } catch {
        return null;
      }
    })
    .filter((anchor): anchor is CommentAnchor => anchor !== null);
};
