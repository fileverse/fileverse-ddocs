/**
 * Comment Decoration Plugin
 *
 * Paints comment highlights as ProseMirror decorations (visual layer)
 * instead of marks (document content). Anchor positions stored as
 * Yjs RelativePositions.
 */

import {
  Extension,
  getChangedRanges,
  type ChangedRange,
  type Editor,
} from '@tiptap/core';
import { type EditorState, Plugin, PluginKey } from '@tiptap/pm/state';
import { type Transform } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  ySyncPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { SuggestionType } from '../../types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommentAnchor {
  id: string;
  anchorFrom: Y.RelativePosition;
  anchorTo: Y.RelativePosition;
  resolved: boolean;
  deleted: boolean;
  isSuggestion?: boolean;
  suggestionType?: SuggestionType;
  originalContent?: string;
  suggestedContent?: string;
}

interface CommentDecorationPluginState {
  decorations: DecorationSet;
}

type CommentAnchorRange = { from: number; to: number };
type CommentAnchorRelativeRange = {
  anchorFrom: Y.RelativePosition;
  anchorTo: Y.RelativePosition;
};

export type CommentAnchorTransactionChange =
  | { id: string; type: 'unchanged' }
  | { id: string; type: 'deleted' }
  | ({
      id: string;
      type: 'edited';
    } & CommentAnchorRange &
      CommentAnchorRelativeRange);

// ---------------------------------------------------------------------------
// Plugin Key
// ---------------------------------------------------------------------------

export const commentDecorationPluginKey =
  new PluginKey<CommentDecorationPluginState>('commentDecoration');

// ---------------------------------------------------------------------------
// Anchor helpers
// ---------------------------------------------------------------------------

export function resolveCommentAnchorRangeInState(
  anchor: Pick<CommentAnchor, 'anchorFrom' | 'anchorTo'>,
  state: EditorState,
): CommentAnchorRange | null {
  // Primary anchor resolution from RelativePositions.
  // Used during decoration building and transaction pre-state analysis.
  const syncState = ySyncPluginKey.getState(state);
  if (!syncState?.binding) {
    return null;
  }

  const maxPos = state.doc.content.size;
  const { doc, type, binding } = syncState;

  try {
    const from = relativePositionToAbsolutePosition(
      doc,
      type,
      anchor.anchorFrom,
      binding.mapping,
    );
    const to = relativePositionToAbsolutePosition(
      doc,
      type,
      anchor.anchorTo,
      binding.mapping,
    );

    // Validate resolved range — reject invalid, empty, or out-of-bounds ranges.
    if (from === null || to === null || from >= to) {
      return null;
    }

    if (from < 0 || to > maxPos) {
      return null;
    }

    return { from, to };
  } catch {
    // Gracefully handle resolution errors (e.g., corrupted positions)
    return null;
  }
}

/**
 * Resolve anchorFrom to a single absolute position.
 * Used for 'add' suggestion anchors where anchorFrom === anchorTo (cursor,
 * no initial selection) — resolveCommentAnchorRangeInState rejects from >= to,
 * so we need a separate path that allows a point position.
 */
export function resolveCommentAnchorPointInState(
  anchor: Pick<CommentAnchor, 'anchorFrom'>,
  state: EditorState,
): number | null {
  const syncState = ySyncPluginKey.getState(state);
  if (!syncState?.binding) return null;
  const { doc, type, binding } = syncState;
  try {
    const pos = relativePositionToAbsolutePosition(
      doc,
      type,
      anchor.anchorFrom,
      binding.mapping,
    );
    if (pos === null || pos < 0 || pos > state.doc.content.size) return null;
    return pos;
  } catch {
    return null;
  }
}

export function hasResolvableCommentAnchorInState(
  anchor: Pick<
    CommentAnchor,
    'anchorFrom' | 'anchorTo' | 'isSuggestion' | 'suggestionType'
  >,
  state: EditorState,
): boolean {
  if (anchor.isSuggestion && anchor.suggestionType === 'add') {
    return resolveCommentAnchorPointInState(anchor, state) !== null;
  }

  return resolveCommentAnchorRangeInState(anchor, state) !== null;
}

function resolveCommentAnchorRangeFromRenderedDecorations(
  commentId: string,
  state: EditorState,
): CommentAnchorRange | null {
  const pluginState = commentDecorationPluginKey.getState(state);
  const matchingDecorations =
    pluginState?.decorations.find(undefined, undefined, (spec) => {
      return spec?.commentId === commentId;
    }) ?? [];

  if (matchingDecorations.length === 0) {
    return null;
  }

  const from = Math.min(
    ...matchingDecorations.map((decoration) => decoration.from),
  );
  const to = Math.max(
    ...matchingDecorations.map((decoration) => decoration.to),
  );

  if (from >= to) {
    return null;
  }

  return { from, to };
}

function resolveCommentAnchorPointFromRenderedDecorations(
  commentId: string,
  state: EditorState,
): number | null {
  const pluginState = commentDecorationPluginKey.getState(state);
  return resolveCommentAnchorPointFromDecorationSet(
    commentId,
    pluginState?.decorations,
  );
}

function resolveCommentAnchorPointFromDecorationSet(
  commentId: string,
  decorations?: DecorationSet,
): number | null {
  const matchingDecorations =
    decorations?.find(undefined, undefined, (spec) => {
      return spec?.commentId === commentId;
    }) ?? [];

  const pointDecoration = matchingDecorations.find(
    (decoration) => decoration.from === decoration.to,
  );

  return pointDecoration?.from ?? null;
}

export function resolveCommentAnchorRangeForAnalysis(
  anchor: Pick<CommentAnchor, 'id' | 'anchorFrom' | 'anchorTo'>,
  state: EditorState,
): CommentAnchorRange | null {
  return (
    // For pre-transaction analysis, trust the rendered highlight snapshot first.
    // The sync plugin's Yjs mapping objects are live and can drift relative to
    // an old EditorState, while the old decoration set still reflects what the
    // user actually saw highlighted before the edit.
    resolveCommentAnchorRangeFromRenderedDecorations(anchor.id, state) ??
    resolveCommentAnchorRangeInState(anchor, state)
  );
}

export function resolveCommentAnchorPointForAnalysis(
  anchor: Pick<CommentAnchor, 'id' | 'anchorFrom'>,
  state: EditorState,
): number | null {
  return (
    // Match range analysis: use the rendered pre-transaction widget first,
    // because Yjs relative positions can resolve through live mappings.
    resolveCommentAnchorPointFromRenderedDecorations(anchor.id, state) ??
    resolveCommentAnchorPointInState(anchor, state)
  );
}

function createCommentAnchorFromRangeInState(
  state: EditorState,
  from: number,
  to: number,
): CommentAnchorRelativeRange | null {
  const syncState = ySyncPluginKey.getState(state);

  if (!syncState?.binding || from >= to) {
    return null;
  }

  const { type, binding } = syncState;

  return {
    anchorFrom: absolutePositionToRelativePosition(from, type, binding.mapping),
    anchorTo: absolutePositionToRelativePosition(to, type, binding.mapping),
  };
}

function doesChangedRangeCoverAnchor(
  changedRange: ChangedRange,
  anchorRange: CommentAnchorRange,
) {
  // Identify full-span replacement of the original anchor.
  // Used to classify anchors as 'deleted' during transaction analysis.
  return (
    changedRange.oldRange.from <= anchorRange.from &&
    changedRange.oldRange.to >= anchorRange.to
  );
}

function doesChangedRangeAffectAnchor(
  changedRange: ChangedRange,
  anchorRange: CommentAnchorRange,
) {
  return (
    changedRange.oldRange.from < anchorRange.to &&
    changedRange.oldRange.to > anchorRange.from
  );
}

function isBoundaryInsertionAtAnchor(
  changedRange: ChangedRange,
  anchorRange: CommentAnchorRange,
) {
  const isPureInsertion =
    changedRange.oldRange.from === changedRange.oldRange.to &&
    changedRange.newRange.from !== changedRange.newRange.to;

  if (!isPureInsertion) {
    return false;
  }

  return (
    changedRange.oldRange.from === anchorRange.from ||
    changedRange.oldRange.from === anchorRange.to
  );
}

function getImpactingChangedRanges(
  changedRanges: ChangedRange[],
  anchorRange: CommentAnchorRange,
) {
  return changedRanges.filter(
    (changedRange) =>
      doesChangedRangeAffectAnchor(changedRange, anchorRange) ||
      isBoundaryInsertionAtAnchor(changedRange, anchorRange),
  );
}

// Mark/attribute-only steps have empty StepMaps. Tiptap still reports their
// from/to as changed ranges, but they do not move or delete anchored text.
function isPositionPreservingTransform(transform: Transform) {
  return transform.mapping.maps.every((stepMap) => {
    const ranges = (stepMap as unknown as { ranges?: readonly number[] })
      .ranges;
    return !ranges || ranges.length === 0;
  });
}

function doChangedRangesCoverWholeAnchor(
  changedRanges: ChangedRange[],
  anchorRange: CommentAnchorRange,
) {
  // Check if multiple changed ranges, when combined, fully cover
  // the original anchor span. This handles multi-step transactions where
  // the full anchor text is eventually replaced (e.g., paste-over-selection).
  // If true, classify the anchor as 'deleted'.
  const coveredSegments = changedRanges
    .map((changedRange) => ({
      from: Math.max(anchorRange.from, changedRange.oldRange.from),
      to: Math.min(anchorRange.to, changedRange.oldRange.to),
    }))
    .filter((segment) => segment.to > segment.from)
    .sort((left, right) => left.from - right.from);

  if (coveredSegments.length === 0) {
    return false;
  }

  let coveredUntil = coveredSegments[0].from;

  if (coveredUntil > anchorRange.from) {
    return false;
  }

  for (const segment of coveredSegments) {
    if (segment.from > coveredUntil) {
      return false;
    }

    coveredUntil = Math.max(coveredUntil, segment.to);

    if (coveredUntil >= anchorRange.to) {
      return true;
    }
  }

  return coveredUntil >= anchorRange.to;
}

function doesChangedRangeDeletePointAnchor(
  changedRange: ChangedRange,
  point: number,
) {
  // Add suggestions are point anchors. If existing content is deleted across
  // either side of that point, the insertion location no longer belongs to the
  // original text context and should not reattach to neighboring content.
  return (
    changedRange.oldRange.to > changedRange.oldRange.from &&
    changedRange.oldRange.from <= point &&
    changedRange.oldRange.to >= point
  );
}

function mapAnchorRangeThroughTransform(
  range: CommentAnchorRange,
  transform: Transform,
  mappedDoc: EditorState['doc'],
): CommentAnchorRange | null {
  // Map boundaries directly with opposite association so deletes shrink the
  // anchor instead of letting decoration mapping absorb nearby text.
  const from = transform.mapping.map(range.from, 1);
  const to = transform.mapping.map(range.to, -1);

  if (from >= to) {
    return null;
  }

  if (from < 0 || to > mappedDoc.content.size) {
    return null;
  }

  return { from, to };
}

/**
 * Analyze transaction changes to classify each active anchor's mutation status.
 *
 * This is the core transaction analysis function that determines
 * whether each anchor remains unchanged, gets edited, or is deleted.
 *
 * Classification rules (in order):
 * 1. If the transform preserves positions → 'unchanged'
 * 2. Skip deleted or resolved anchors → 'unchanged'
 * 3. If anchor has no old position → 'unchanged'
 * 4. If no changed ranges touch the anchor → 'unchanged'
 * 5. If any changed range fully covers the anchor → 'deleted' (full-span replacement)
 * 6. If combined changed ranges fully cover the anchor → 'deleted' (multi-step removal)
 * 7. If anchor maps through transform → check if position or content changed:
 *    a. If both unchanged → 'unchanged'
 *    b. Otherwise → 'edited' (return new position and relative anchor)
 * 8. If mapping fails → 'deleted'
 */
export function analyzeCommentAnchorTransactionChanges(
  anchors: CommentAnchor[],
  oldState: EditorState,
  newState: EditorState,
  transform: Transform,
): CommentAnchorTransactionChange[] {
  if (isPositionPreservingTransform(transform)) {
    return anchors.map((anchor) => ({ id: anchor.id, type: 'unchanged' }));
  }

  const changedRanges = getChangedRanges(transform);

  if (changedRanges.length === 0) {
    return anchors.map((anchor) => ({ id: anchor.id, type: 'unchanged' }));
  }

  return anchors.map((anchor) => {
    // Skip anchors marked as deleted or resolved.
    if (anchor.deleted || anchor.resolved) {
      return { id: anchor.id, type: 'unchanged' };
    }

    if (anchor.isSuggestion && anchor.suggestionType === 'add') {
      const oldPoint = resolveCommentAnchorPointForAnalysis(anchor, oldState);

      if (oldPoint === null) {
        return { id: anchor.id, type: 'unchanged' };
      }

      return changedRanges.some((changedRange) =>
        doesChangedRangeDeletePointAnchor(changedRange, oldPoint),
      )
        ? { id: anchor.id, type: 'deleted' }
        : { id: anchor.id, type: 'unchanged' };
    }

    // Resolve the anchor's old absolute range from pre-transaction state.
    const oldRange = resolveCommentAnchorRangeForAnalysis(anchor, oldState);

    if (!oldRange) {
      return { id: anchor.id, type: 'unchanged' };
    }

    // Find all changed ranges that overlap with this anchor.
    const impactingRanges = getImpactingChangedRanges(changedRanges, oldRange);
    const oldSelectedContent = oldState.doc.textBetween(
      oldRange.from,
      oldRange.to,
      ' ',
    );

    // If no changes touch the anchor, it remains unchanged.
    if (impactingRanges.length === 0) {
      return { id: anchor.id, type: 'unchanged' };
    }

    // If any changed range (or combined ranges) fully covers the old anchor,
    // classify as deleted.
    if (
      impactingRanges.some((changedRange) =>
        doesChangedRangeCoverAnchor(changedRange, oldRange),
      ) ||
      doChangedRangesCoverWholeAnchor(impactingRanges, oldRange)
    ) {
      return { id: anchor.id, type: 'deleted' };
    }

    // Map the old anchor range through the transform to find new position.
    const mappedRange = mapAnchorRangeThroughTransform(
      oldRange,
      transform,
      newState.doc,
    );

    if (!mappedRange) {
      return { id: anchor.id, type: 'deleted' };
    }

    // Create new RelativePositions for the mapped range.
    const nextAnchor = createCommentAnchorFromRangeInState(
      newState,
      mappedRange.from,
      mappedRange.to,
    );

    if (!nextAnchor) {
      return { id: anchor.id, type: 'unchanged' };
    }

    const newSelectedContent = newState.doc.textBetween(
      mappedRange.from,
      mappedRange.to,
      ' ',
    );
    const didMappedRangeChange =
      mappedRange.from !== oldRange.from || mappedRange.to !== oldRange.to;
    const didSelectedContentChange = newSelectedContent !== oldSelectedContent;

    // Only emit 'edited' if either anchor position or selected content changed.
    if (!didMappedRangeChange && !didSelectedContentChange) {
      return { id: anchor.id, type: 'unchanged' };
    }

    return {
      id: anchor.id,
      type: 'edited',
      from: mappedRange.from,
      to: mappedRange.to,
      ...nextAnchor,
    };
  });
}

// ---------------------------------------------------------------------------
// Build decorations from anchors
// ---------------------------------------------------------------------------

function createSuggestionWidget(
  text: string,
  commentId: string,
  isActive: boolean,
): HTMLElement {
  const span = document.createElement('span');
  span.className = 'suggestion-add';
  span.textContent = text;
  // Both attributes so the layout engine can locate this widget as either a
  // suggestion-draft anchor (before submit) or a thread anchor (after submit).
  span.dataset.suggestionId = commentId;
  span.dataset.commentId = commentId;
  span.dataset.active = isActive ? 'true' : 'false';
  return span;
}

const createSuggestionWidgetRenderer =
  (text: string, commentId: string, isActive: boolean) => () =>
    createSuggestionWidget(text, commentId, isActive);

function buildDecorations(
  anchors: CommentAnchor[],
  state: EditorState,
  activeCommentId: string | null,
  previousDecorations?: DecorationSet | null,
): DecorationSet {
  // Build a new set of decorations from the current anchor list.
  // This is called:
  //   - On plugin init
  //   - On every doc change
  //   - When explicitly triggered via triggerDecorationRebuild()
  const syncState = ySyncPluginKey.getState(state);
  if (!syncState?.binding) {
    return DecorationSet.empty;
  }

  const decorations: Decoration[] = [];
  for (const anchor of anchors) {
    // Skip deleted anchors entirely.
    if (anchor.deleted) continue;
    // Skip resolved anchors. For regular comments this is an explicit resolve.
    // For suggestions, `resolved: true` arrives only via Accept — at which
    // point the doc already contains the accepted text (applyAcceptedSuggestion
    // dispatched the edit). Rendering the strikethrough/widget against the
    // post-accept doc would put the decoration over the wrong range, so drop
    // it everywhere.
    if (anchor.resolved) continue;

    const isActive = anchor.id === activeCommentId;

    // 'add' suggestions: cursor-based, anchorFrom === anchorTo.
    // resolveCommentAnchorRangeInState rejects from >= to, so use point
    // resolution and render a single widget. side: -1 positions the widget
    // visually before the caret at the same document position — gives the
    // Google-Docs-style "cursor advances through the proposed text" feel.
    // Key includes the content so PM redraws when the draft's suggestedContent
    // changes (typing / backspace during an Add draft).
    if (anchor.isSuggestion && anchor.suggestionType === 'add') {
      if (!anchor.suggestedContent) continue;
      const directPoint = resolveCommentAnchorPointInState(anchor, state);
      const fallbackPoint = resolveCommentAnchorPointFromDecorationSet(
        anchor.id,
        previousDecorations ?? undefined,
      );
      const insertPoint = directPoint ?? fallbackPoint;
      if (insertPoint === null) continue;
      decorations.push(
        Decoration.widget(
          insertPoint,
          createSuggestionWidgetRenderer(
            anchor.suggestedContent,
            anchor.id,
            isActive,
          ),
          {
            commentId: anchor.id,
            active: isActive,
            suggestion: true,
            side: -1,
            key: `suggestion-insert-${anchor.id}-${anchor.suggestedContent}-${
              isActive ? 'active' : 'inactive'
            }`,
          },
        ),
      );
      continue;
    }

    const range = resolveCommentAnchorRangeInState(anchor, state);

    if (!range) {
      continue;
    }

    // Suggestion branch: render strikethrough (Delete/Replace) and/or widget
    // (Replace's proposed text). Skip the regular comment decoration that
    // follows — suggestions don't get the inline-comment background.
    if (anchor.isSuggestion) {
      const { suggestionType, suggestedContent } = anchor;

      // Link: purple text over the original selected range.
      if (suggestionType === 'link' && range.from < range.to) {
        decorations.push(
          Decoration.inline(
            range.from,
            range.to,
            {
              class: 'suggestion-link',
              'data-suggestion-id': anchor.id,
              'data-comment-id': anchor.id,
              'data-active': isActive ? 'true' : 'false',
            },
            { commentId: anchor.id, active: isActive, suggestion: true },
          ),
        );
      }

      // Delete / Replace: strikethrough on the original text range.
      // Include both data-suggestion-id (for draft anchor lookup) and
      // data-comment-id (for submitted thread anchor lookup).
      if (
        (suggestionType === 'delete' || suggestionType === 'replace') &&
        range.from < range.to
      ) {
        decorations.push(
          Decoration.inline(
            range.from,
            range.to,
            {
              class: 'suggestion-delete',
              'data-suggestion-id': anchor.id,
              'data-comment-id': anchor.id,
              'data-active': isActive ? 'true' : 'false',
            },
            { commentId: anchor.id, active: isActive, suggestion: true },
          ),
        );
      }

      // Replace: widget showing the proposed content before the struck-through range.
      // Key includes the content so PM redraws when the draft's suggestedContent
      // changes (typing / backspace during a Replace draft).
      if (suggestionType === 'replace' && suggestedContent) {
        decorations.push(
          Decoration.widget(
            range.from,
            createSuggestionWidgetRenderer(
              suggestedContent,
              anchor.id,
              isActive,
            ),
            {
              commentId: anchor.id,
              active: isActive,
              suggestion: true,
              side: -1,
              key: `suggestion-insert-${anchor.id}-${suggestedContent}-${
                isActive ? 'active' : 'inactive'
              }`,
            },
          ),
        );
      }

      continue;
    }

    // Decoration state does not inherit the active-thread class that the mark
    // DOM toggles in editable mode, so mirror activeCommentId here to keep
    // preview and editable highlights visually aligned.
    // Create an inline decoration at the anchor's current range.
    // The CSS class triggers visual styling; commentId enables click-to-activate-thread.
    decorations.push(
      Decoration.inline(
        range.from,
        range.to,
        {
          class: isActive
            ? 'inline-comment inline-comment--active'
            : 'inline-comment inline-comment--unresolved',
          'data-comment-id': anchor.id,
          'data-active': isActive ? 'true' : 'false',
        },
        { commentId: anchor.id, active: isActive },
      ),
    );
  }

  return DecorationSet.create(state.doc, decorations);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export interface CommentDecorationOptions {
  getAnchors: () => CommentAnchor[];
  getActiveCommentId: () => string | null;
}

export const CommentDecorationExtension =
  Extension.create<CommentDecorationOptions>({
    name: 'commentDecoration',

    addOptions() {
      return {
        getAnchors: () => [],
        getActiveCommentId: () => null,
      };
    },

    addProseMirrorPlugins() {
      const { getAnchors, getActiveCommentId } = this.options;

      return [
        new Plugin({
          key: commentDecorationPluginKey,

          state: {
            init(_, editorState) {
              // Build decorations on plugin init.
              return {
                decorations: buildDecorations(
                  getAnchors(),
                  editorState,
                  getActiveCommentId(),
                ),
              };
            },
            apply(tr, pluginState, _oldState, newState) {
              // Rebuild decorations if:
              //   1. Explicit rebuild triggered (tr.getMeta(commentDecorationPluginKey))
              //   2. The doc changed *and* the Y.Doc already reflects that change
              //
              // Rebuilding resolves RelativePositions against the Y.Doc, so it is
              // only correct when the Y.Doc is in sync with `newState.doc`. That
              // holds for Yjs-origin changes (remote peers, undo/redo): the Y.Doc
              // is updated first and the ProseMirror transaction is dispatched from
              // the observer. It does NOT hold for local edits — y-tiptap flushes
              // ProseMirror → Y.Doc from its plugin view, which runs after every
              // plugin's apply(). Resolving here would read pre-edit Yjs content and
              // paint the highlight at stale coordinates: shifted by the size of the
              // edit, or dropped entirely when the stale range no longer fits the
              // shorter doc.
              //
              // For local edits (and non-doc changes such as selection moves), map
              // the rendered decorations through the transaction instead. ProseMirror's
              // own mapping is exact for those, and the anchor analysis in
              // comment-store-provider re-resolves from the synced Y.Doc afterwards.
              const isYjsOriginChange =
                !!tr.getMeta(ySyncPluginKey)?.isChangeOrigin;

              if (
                tr.getMeta(commentDecorationPluginKey) ||
                (tr.docChanged && isYjsOriginChange)
              ) {
                const previousDecorations = tr.docChanged
                  ? null
                  : pluginState.decorations;

                return {
                  decorations: buildDecorations(
                    getAnchors(),
                    newState,
                    getActiveCommentId(),
                    previousDecorations,
                  ),
                };
              }

              return {
                decorations: pluginState.decorations.map(tr.mapping, tr.doc),
              };
            },
          },

          props: {
            decorations(state) {
              return (
                commentDecorationPluginKey.getState(state)?.decorations ??
                DecorationSet.empty
              );
            },
          },
        }),
      ];
    },
  });

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------
/**
 * Public helper functions for comment anchor creation and inspection.
 * These are consumed by the draft-creation flow and transaction-analysis layer.
 */

export function createCommentAnchorFromEditor(
  editor: Editor,
  from: number,
  to: number,
): CommentAnchorRelativeRange | null {
  // Create anchor from explicit absolute range.
  return createCommentAnchorFromRangeInState(editor.state, from, to);
}

/**
 * Create a point anchor (anchorFrom === anchorTo) at a single doc position.
 * Used by the suggestion-mode draft flow when the viewer places a cursor
 * without selecting text — createCommentAnchorFromEditor rejects from >= to
 * since an empty range is invalid for regular comments.
 */
export function createCommentAnchorPointFromEditor(
  editor: Editor,
  pos: number,
): CommentAnchorRelativeRange | null {
  const syncState = ySyncPluginKey.getState(editor.state);
  if (!syncState?.binding) return null;
  const { type, binding } = syncState;
  try {
    const relPos = absolutePositionToRelativePosition(
      pos,
      type,
      binding.mapping,
    );
    return { anchorFrom: relPos, anchorTo: relPos };
  } catch {
    return null;
  }
}

export function createCommentAnchorFromSelection(
  editor: Editor,
): CommentAnchorRelativeRange | null {
  // Create anchor from current editor selection. Returns null if no selection.
  const { from, to } = editor.state.selection;

  if (from === to) {
    return null;
  }

  return createCommentAnchorFromRangeInState(editor.state, from, to);
}

export function triggerDecorationRebuild(editor: Editor) {
  // Force immediate decoration rebuild.
  // Called after:
  //   - initialCommentAnchors updated (consumer rehydration)
  //   - edited anchors batch-updated in commentAnchorsRef
  if (!editor?.view || editor.isDestroyed) {
    return;
  }

  const tr = editor.state.tr;
  tr.setMeta(commentDecorationPluginKey, { rebuild: true });
  editor.view.dispatch(tr);
}

export function getCommentAtPosition(
  editor: Editor,
  pos: number,
  getAnchors: () => CommentAnchor[],
): CommentAnchor | null {
  // Find the active (undeleted) anchor containing the cursor position.
  // Used in transaction listener to auto-activate floating threads on selection.
  const anchors = getAnchors();

  for (const anchor of anchors) {
    if (anchor.deleted) {
      continue;
    }

    // Add suggestions are point-anchored (anchorFrom === anchorTo); range
    // resolution rejects them. Match if the cursor sits at the insert point
    // or anywhere inside the widget's proposed content length.
    if (anchor.isSuggestion && anchor.suggestionType === 'add') {
      const point = resolveCommentAnchorPointInState(anchor, editor.state);
      if (point === null) continue;
      const widgetEnd = point + (anchor.suggestedContent?.length ?? 0);
      if (pos >= point && pos <= widgetEnd) {
        return anchor;
      }
      continue;
    }

    const range = resolveCommentAnchorRangeInState(anchor, editor.state);

    if (!range) {
      continue;
    }

    if (pos >= range.from && pos <= range.to) {
      return anchor;
    }
  }

  return null;
}

export function getCommentAnchorRange(
  editor: Editor,
  commentId: string,
  getAnchors: () => CommentAnchor[],
): CommentAnchorRange | null {
  // Find the current absolute range for a specific comment anchor.
  const anchor = getAnchors().find(
    (entry) => entry.id === commentId && !entry.deleted,
  );

  if (!anchor) {
    return null;
  }

  return resolveCommentAnchorRangeInState(anchor, editor.state);
}

function resolveAcceptedDeleteRange(
  state: EditorState,
  from: number,
  to: number,
): CommentAnchorRange {
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);

  if (
    !$from.sameParent($to) ||
    !$from.parent.isTextblock ||
    $from.parentOffset === 0 ||
    $to.parentOffset === $to.parent.content.size
  ) {
    return { from, to };
  }

  const spaceBefore =
    $from.parent.textBetween(
      $from.parentOffset - 1,
      $from.parentOffset,
      '',
      '',
    ) === ' ';
  const spaceAfter =
    $to.parent.textBetween($to.parentOffset, $to.parentOffset + 1, '', '') ===
    ' ';

  return spaceBefore && spaceAfter ? { from, to: to + 1 } : { from, to };
}

/**
 * Apply the accepted suggestion's change to the document.
 * Called by the store's acceptSuggestion action before resolving on-chain.
 * Returns false if the anchor can't be resolved or the suggestion type is unknown.
 */
export function applyAcceptedSuggestion(
  editor: Editor,
  anchor: CommentAnchor,
): boolean {
  if (!anchor.isSuggestion) return false;

  const state = editor.state;
  const syncState = ySyncPluginKey.getState(state);
  if (!syncState?.binding) return false;

  const { doc, type, binding } = syncState;

  try {
    const from = relativePositionToAbsolutePosition(
      doc,
      type,
      anchor.anchorFrom,
      binding.mapping,
    );
    const to = relativePositionToAbsolutePosition(
      doc,
      type,
      anchor.anchorTo,
      binding.mapping,
    );

    if (from === null || to === null) return false;
    if (from < 0 || to > state.doc.content.size) return false;

    const { suggestionType, suggestedContent } = anchor;

    // Insert as an explicit text node (NOT a string). When passed a string,
    // TipTap parses it as HTML via DOMParser, wrapping in <p>. Inserting a
    // <p> mid-paragraph causes ProseMirror to silently no-op the step — the
    // command returns true but tr.docChanged stays false, so y-prosemirror
    // never syncs to Y.Doc and the consumer's onChange never fires.
    // Passing { type: 'text', text } skips parsing and produces a real
    // ReplaceStep that y-prosemirror picks up.
    const textNode = (text: string) => ({ type: 'text', text });

    if (suggestionType === 'add') {
      if (!suggestedContent) return false;
      return editor
        .chain()
        .focus()
        .insertContentAt(from, textNode(suggestedContent))
        .run();
    }
    if (suggestionType === 'delete') {
      if (from >= to) return false;
      const deleteRange = resolveAcceptedDeleteRange(state, from, to);
      return editor.chain().focus().deleteRange(deleteRange).run();
    }
    if (suggestionType === 'replace') {
      if (from >= to || !suggestedContent) return false;
      return editor
        .chain()
        .focus()
        .deleteRange({ from, to })
        .insertContentAt(from, textNode(suggestedContent))
        .run();
    }
    if (suggestionType === 'link') {
      if (from >= to || !suggestedContent) return false;
      return editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setLink({ href: suggestedContent })
        .run();
    }
    return false;
  } catch {
    return false;
  }
}
