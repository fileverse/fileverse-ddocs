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
import { canSplit, type Transform } from '@tiptap/pm/transform';
import { TextSelection } from '@tiptap/pm/state';
import { type ResolvedPos } from '@tiptap/pm/model';
import { getSplittedAttributes } from '@tiptap/core';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  ySyncPluginKey,
  yUndoPluginKey,
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { SuggestionMultilineStructure, SuggestionType } from '../../types';
import { validMultilineStructure } from '../suggestion/multiline-structure';
import { captureSplit, declareSplit } from '../caret-marks/split-declaration';
import { suggestionTrackingPluginKey } from '../suggestion/suggestion-tracking-extension';

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
  multilineStructure?: SuggestionMultilineStructure;
  followsSuggestionId?: string;
  isDraft?: boolean;
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

const ACCEPTED_BREAK_POINTS = 'acceptedSuggestionBreakPoints';
const SUGGESTION_ADD_POINT_OVERRIDES = 'suggestionAddPointOverrides';

/** Each tab has its own Yjs fragment and its own pending Add overrides. */
function getSuggestionAddPointOverrides(
  state: EditorState,
  create = false,
): Y.Map<Uint8Array> | null {
  const syncState = ySyncPluginKey.getState(state);
  if (!syncState?.binding) return null;
  const field = [...syncState.doc.share].find(
    ([, sharedType]) => sharedType === syncState.type,
  )?.[0];
  if (!field) return null;
  const root = syncState.doc.getMap(SUGGESTION_ADD_POINT_OVERRIDES) as Y.Map<
    Y.Map<Uint8Array>
  >;
  let tabPoints = root.get(field);
  if (!tabPoints && create) {
    tabPoints = new Y.Map<Uint8Array>();
    root.set(field, tabPoints);
  }
  return tabPoints instanceof Y.Map ? tabPoints : null;
}

function resolveSuggestionAddPointOverride(
  anchor: CommentAnchor,
  state: EditorState,
): number | null {
  const encoded = getSuggestionAddPointOverrides(state)?.get(anchor.id);
  if (!(encoded instanceof Uint8Array)) return null;
  try {
    return resolveCommentAnchorPointInState(
      { anchorFrom: Y.decodeRelativePosition(encoded) },
      state,
    );
  } catch {
    return null;
  }
}

/** Resolve following Adds against the accepted break's persisted Yjs position. */
export function resolveSuggestionAddPointInState(
  anchor: CommentAnchor,
  state: EditorState,
  anchors: CommentAnchor[] | ReadonlyMap<string, CommentAnchor>,
): number | null {
  const point =
    (anchor.followsSuggestionId
      ? null
      : resolveSuggestionAddPointOverride(anchor, state)) ??
    resolveCommentAnchorPointInState(anchor, state);
  if (point === null || !anchor.followsSuggestionId) return point;
  const parent = Array.isArray(anchors)
    ? anchors.find((entry) => entry.id === anchor.followsSuggestionId)
    : anchors.get(anchor.followsSuggestionId);
  if (!parent?.resolved || !parent.multilineStructure) return point;
  if (
    !validMultilineStructure(
      parent.suggestedContent,
      parent.multilineStructure,
    ) ||
    parent.multilineStructure.insertedTexts.some(Boolean) ||
    parent.multilineStructure.structureType.length !== 1
  )
    return null;
  const acceptedPoint: Uint8Array | undefined = ySyncPluginKey
    .getState(state)
    ?.doc.getMap(ACCEPTED_BREAK_POINTS)
    .get(parent.id);
  if (acceptedPoint) {
    return resolveCommentAnchorPointInState(
      { ...anchor, anchorFrom: Y.decodeRelativePosition(acceptedPoint) },
      state,
    );
  }
  // Compatibility for breaks accepted before their positions were persisted.
  const parentPoint = resolveCommentAnchorPointInState(parent, state);
  if (parentPoint === null) return null;
  const kind = parent.multilineStructure.structureType[0];
  if (kind === 'soft' || kind === 'text') return parentPoint + 1;
  const currentBlockEnd = state.doc.resolve(parentPoint).after();
  let nextTextblock: number | null = null;
  state.doc.nodesBetween(
    currentBlockEnd,
    state.doc.content.size,
    (node, pos) => {
      if (nextTextblock !== null) return false;
      if (node.isTextblock && pos >= currentBlockEnd) {
        nextTextblock = pos + 1;
        return false;
      }
      return true;
    },
  );
  return nextTextblock;
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
  multilineStructure?: SuggestionMultilineStructure,
  listMarker = '• ',
  paragraphAfterHeading = false,
  asFollowingListItem = false,
  visualCaret = false,
  listMarkerAt?: (nextItem: number) => string,
): HTMLElement {
  if (asFollowingListItem && multilineStructure) {
    const item = document.createElement('li');
    item.className = 'suggestion-add suggestion-list-item-preview';
    const paragraph = document.createElement('p');
    paragraph.textContent = multilineStructure.insertedTexts[1] || '\u200b';
    if (listMarker === '☐ ') {
      item.classList.add('grid', 'task-item');
      item.dataset.checked = 'false';
      const label = document.createElement('label');
      label.contentEditable = 'false';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.disabled = true;
      checkbox.setAttribute('aria-label', 'Suggested task item checkbox');
      label.append(checkbox, document.createElement('span'));
      const content = document.createElement('div');
      content.append(paragraph);
      item.append(label, content);
    } else {
      item.append(paragraph);
    }
    item.dataset.suggestionId = commentId;
    item.dataset.commentId = commentId;
    item.dataset.active = isActive ? 'true' : 'false';
    if (visualCaret) item.dataset.visualCaret = 'true';
    return item;
  }
  const span = document.createElement('span');
  span.className = 'suggestion-add';
  let currentLine: HTMLElement = span;
  const appendPart = (part: string) => {
    currentLine.append(document.createTextNode(part));
  };
  if (multilineStructure && validMultilineStructure(text, multilineStructure)) {
    let listItemCount = 0;
    multilineStructure.insertedTexts.forEach((part, index) => {
      if (index > 0) {
        const kind = multilineStructure.structureType[index - 1];
        const breakNode = document.createElement('br');
        breakNode.dataset.suggestionBreak = kind;
        if (kind === 'listItem') {
          // Keep the widget inline so the native caret stays beside the
          // proposed text. The marker is positioned in the list gutter.
          span.append(breakNode);
          if (listMarker === '☐ ') {
            currentLine = document.createElement('span');
            currentLine.className = 'suggestion-task-line';
            span.append(currentLine);
          }
          const markerAnchor = document.createElement('span');
          markerAnchor.className = 'suggestion-list-marker-anchor';
          const marker = document.createElement('span');
          marker.className = 'suggestion-list-marker';
          marker.textContent = listMarkerAt?.(listItemCount + 1) ?? listMarker;
          if (listMarker === '• ') marker.dataset.bullet = 'disc';
          if (listMarker === '◦ ') marker.dataset.bullet = 'circle';
          if (listMarker === '▪ ') marker.dataset.bullet = 'square';
          if (listMarker === '☐ ') marker.dataset.task = 'true';
          if (/^[a-z]+\. $/.test(listMarker)) {
            marker.dataset.nestedOrdered = 'true';
          }
          listItemCount++;
          markerAnchor.append(marker);
          currentLine.append(markerAnchor);
        } else if (kind === 'block') {
          // A block split has paragraph spacing, unlike a soft break.
          breakNode.hidden = true;
          span.append(breakNode);
          currentLine = document.createElement('span');
          currentLine.className = 'suggestion-paragraph-line';
          if (paragraphAfterHeading) {
            currentLine.classList.add('suggestion-paragraph-after-heading');
          }
          span.append(currentLine);
        } else {
          currentLine.append(breakNode);
        }
      }
      // Keep an empty trailing proposed line visible after its break.
      appendPart(part || (index > 0 ? '\u200b' : ''));
    });
  } else {
    appendPart(text);
  }
  // Both attributes so the layout engine can locate this widget as either a
  // suggestion-draft anchor (before submit) or a thread anchor (after submit).
  span.dataset.suggestionId = commentId;
  span.dataset.commentId = commentId;
  span.dataset.active = isActive ? 'true' : 'false';
  return span;
}

const createSuggestionWidgetRenderer =
  (
    text: string,
    commentId: string,
    isActive: boolean,
    multilineStructure?: SuggestionMultilineStructure,
    listMarker?: string,
    paragraphAfterHeading?: boolean,
    asFollowingListItem?: boolean,
    visualCaret?: boolean,
    listMarkerAt?: (nextItem: number) => string,
  ) =>
  () =>
    createSuggestionWidget(
      text,
      commentId,
      isActive,
      multilineStructure,
      listMarker,
      paragraphAfterHeading,
      asFollowingListItem,
      visualCaret,
      listMarkerAt,
    );

function breaksIntoParagraphAfterHeading(
  state: EditorState,
  position: number,
  multilineStructure?: SuggestionMultilineStructure,
): boolean {
  if (!multilineStructure?.structureType.includes('block')) return false;
  const $position = state.doc.resolve(position);
  return (
    $position.parent.type.name === 'heading' &&
    $position.parentOffset === $position.parent.content.size
  );
}

function followingListItemPreviewPosition(
  state: EditorState,
  pos: number,
  multilineStructure?: SuggestionMultilineStructure,
): number | null {
  if (
    multilineStructure?.insertedTexts.length !== 2 ||
    multilineStructure.insertedTexts[0] !== '' ||
    multilineStructure.structureType[0] !== 'listItem'
  )
    return null;
  const $pos = state.doc.resolve(pos);
  if (!hasOnlyHardBreaksAfterCursor($pos)) return null;
  for (let depth = $pos.depth; depth >= 0; depth--) {
    if (!['listItem', 'taskItem'].includes($pos.node(depth).type.name))
      continue;
    if (
      $pos.node(depth).type.name === 'taskItem' &&
      $pos.index(depth) < $pos.node(depth).childCount - 1
    )
      return null;
    return $pos.after(depth);
  }
  return null;
}

function hasOnlyHardBreaksAfterCursor($pos: ResolvedPos): boolean {
  let onlyHardBreaks = true;
  $pos.parent.content.cut($pos.parentOffset).forEach((node) => {
    if (node.type.name !== 'hardBreak') onlyHardBreaks = false;
  });
  return onlyHardBreaks;
}

function suggestionListMarker(
  state: EditorState,
  pos: number,
  nextItem = 1,
): string {
  const $pos = state.doc.resolve(pos);
  let listDepth = 0;
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (['bulletList', 'orderedList', 'taskList'].includes(node.type.name)) {
      listDepth++;
    }
  }
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth);
    if (node.type.name === 'orderedList') {
      const number = (node.attrs.start ?? 1) + $pos.index(depth) + nextItem;
      if (depth < 2 || $pos.node(depth - 1).type.name !== 'listItem') {
        return `${number}. `;
      }
      const roman =
        depth >= 3 &&
        $pos.node(depth - 2).type.name === 'orderedList' &&
        $pos.node(depth - 3).type.name === 'listItem';
      return `${roman ? romanListMarker(number) : alphaListMarker(number)}. `;
    }
    if (node.type.name === 'taskList') return '☐ ';
    if (node.type.name === 'bulletList') {
      return ['• ', '◦ ', '▪ '][Math.min(listDepth - 1, 2)];
    }
  }
  return '• ';
}

function alphaListMarker(number: number): string {
  let value = number;
  let label = '';
  while (value > 0) {
    value--;
    label = String.fromCharCode(97 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function romanListMarker(number: number): string {
  const numerals: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let value = number;
  let label = '';
  for (const [amount, numeral] of numerals) {
    while (value >= amount) {
      label += numeral;
      value -= amount;
    }
  }
  return label;
}

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
  const anchorsById = new Map(anchors.map((anchor) => [anchor.id, anchor]));
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
      const directPoint = resolveSuggestionAddPointInState(
        anchor,
        state,
        anchorsById,
      );
      const resolvedParent = anchor.followsSuggestionId
        ? anchorsById.get(anchor.followsSuggestionId)?.resolved
        : false;
      const fallbackPoint = resolveCommentAnchorPointFromDecorationSet(
        anchor.id,
        previousDecorations ?? undefined,
      );
      const insertPoint =
        directPoint ?? (resolvedParent ? null : fallbackPoint);
      if (insertPoint === null) continue;
      const followingItemPos = followingListItemPreviewPosition(
        state,
        insertPoint,
        anchor.multilineStructure,
      );
      const visualCaret =
        followingItemPos !== null &&
        anchor.isDraft &&
        state.selection.empty &&
        state.selection.from === insertPoint;
      if (visualCaret) {
        const $source = state.doc.resolve(insertPoint);
        const sourceStart = $source.before();
        decorations.push(
          Decoration.node(sourceStart, sourceStart + $source.parent.nodeSize, {
            class: 'suggestion-source-caret-hidden',
          }),
        );
      }
      decorations.push(
        Decoration.widget(
          followingItemPos ?? insertPoint,
          createSuggestionWidgetRenderer(
            anchor.suggestedContent,
            anchor.id,
            isActive,
            anchor.multilineStructure,
            suggestionListMarker(state, insertPoint),
            breaksIntoParagraphAfterHeading(
              state,
              insertPoint,
              anchor.multilineStructure,
            ),
            followingItemPos !== null,
            Boolean(visualCaret),
            (nextItem) => suggestionListMarker(state, insertPoint, nextItem),
          ),
          {
            commentId: anchor.id,
            active: isActive,
            suggestion: true,
            side: -1,
            key: `suggestion-insert-${anchor.id}-${anchor.suggestedContent}-${JSON.stringify(anchor.multilineStructure)}-${suggestionListMarker(state, insertPoint)}-${visualCaret ? 'caret' : 'no-caret'}-${
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
        const followingItemPos = followingListItemPreviewPosition(
          state,
          range.to,
          anchor.multilineStructure,
        );
        decorations.push(
          Decoration.widget(
            followingItemPos ?? range.from,
            createSuggestionWidgetRenderer(
              suggestedContent,
              anchor.id,
              isActive,
              anchor.multilineStructure,
              suggestionListMarker(state, range.from),
              breaksIntoParagraphAfterHeading(
                state,
                range.to,
                anchor.multilineStructure,
              ),
              followingItemPos !== null,
              false,
              (nextItem) => suggestionListMarker(state, range.from, nextItem),
            ),
            {
              commentId: anchor.id,
              active: isActive,
              suggestion: true,
              side: -1,
              key: `suggestion-insert-${anchor.id}-${suggestedContent}-${JSON.stringify(anchor.multilineStructure)}-${suggestionListMarker(state, range.from)}-${
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
                  null,
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

          view(editorView) {
            const syncState = ySyncPluginKey.getState(editorView.state);
            const overrides = syncState?.doc.getMap(
              SUGGESTION_ADD_POINT_OVERRIDES,
            );
            let disposed = false;
            let rebuildQueued = false;
            const onOverridesChanged = () => {
              if (disposed || rebuildQueued) return;
              rebuildQueued = true;
              // Yjs observers run during synchronization. Rebuild only after
              // the editor state and Y.Doc have both settled.
              queueMicrotask(() => {
                rebuildQueued = false;
                if (disposed) return;
                editorView.dispatch(
                  editorView.state.tr.setMeta(commentDecorationPluginKey, {
                    rebuild: true,
                  }),
                );
              });
            };
            overrides?.observeDeep(onOverridesChanged);
            return {
              destroy() {
                disposed = true;
                overrides?.unobserveDeep(onOverridesChanged);
              },
            };
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
  assoc: -1 | 1 = -1,
): CommentAnchorRelativeRange | null {
  const syncState = ySyncPluginKey.getState(editor.state);
  if (!syncState?.binding) return null;
  const { type, binding } = syncState;
  try {
    let relPos = absolutePositionToRelativePosition(pos, type, binding.mapping);
    if (assoc === 1) {
      const absolute = Y.createAbsolutePositionFromRelativePosition(
        relPos,
        syncState.doc,
      );
      if (!absolute) return null;
      relPos = Y.createRelativePositionFromTypeIndex(
        absolute.type,
        absolute.index,
        1,
      );
    }
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
  getCreatedAt?: (commentId: string) => Date | string | undefined,
): CommentAnchor | null {
  // Choose the newest unresolved regular comment at this position. Decoration
  // spans can merge in the DOM, so their single rendered ID cannot decide it.
  // Used in transaction listener to auto-activate floating threads on selection.
  const anchors = getAnchors();
  let unresolvedMatch: CommentAnchor | null = null;
  let newestCreatedAt = Number.NEGATIVE_INFINITY;
  let suggestionMatch: CommentAnchor | null = null;
  let resolvedMatch: CommentAnchor | null = null;

  for (const anchor of anchors) {
    if (anchor.deleted || (anchor.isSuggestion && anchor.resolved)) {
      continue;
    }

    // Add suggestions are point-anchored (anchorFrom === anchorTo); range
    // resolution rejects them. Match if the cursor sits at the insert point
    // or anywhere inside the widget's proposed content length.
    if (anchor.isSuggestion && anchor.suggestionType === 'add') {
      const point = resolveSuggestionAddPointInState(
        anchor,
        editor.state,
        anchors,
      );
      if (point === null) continue;
      const widgetEnd = point + (anchor.suggestedContent?.length ?? 0);
      if (pos >= point && pos <= widgetEnd) {
        suggestionMatch ??= anchor;
      }
      continue;
    }

    const range = resolveCommentAnchorRangeInState(anchor, editor.state);

    if (!range) {
      continue;
    }

    if (pos >= range.from && pos <= range.to) {
      if (!anchor.resolved) {
        if (anchor.isSuggestion) {
          suggestionMatch ??= anchor;
          continue;
        }
        const createdAt = getCreatedAt?.(anchor.id);
        const parsedTimestamp = createdAt
          ? new Date(createdAt).getTime()
          : Number.NaN;
        const timestamp = Number.isFinite(parsedTimestamp)
          ? parsedTimestamp
          : Number.NEGATIVE_INFINITY;
        if (
          !unresolvedMatch ||
          timestamp > newestCreatedAt ||
          (getCreatedAt && timestamp === newestCreatedAt)
        ) {
          unresolvedMatch = anchor;
          newestCreatedAt = timestamp;
        }
        continue;
      }
      resolvedMatch ??= anchor;
    }
  }

  return unresolvedMatch ?? suggestionMatch ?? resolvedMatch;
}

export function getCommentAnchorRange(
  editor: Editor,
  commentId: string,
  getAnchors: () => CommentAnchor[],
): CommentAnchorRange | null {
  // Find the current absolute range for a specific comment anchor.
  const anchor = getAnchors().find(
    (entry) =>
      entry.id === commentId &&
      !entry.deleted &&
      !(entry.isSuggestion && entry.resolved),
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

function dBlockStartAt(state: EditorState, position: number): number | null {
  const $position = state.doc.resolve(position);
  for (let depth = $position.depth; depth > 0; depth--) {
    if ($position.node(depth).type.name === 'dBlock') {
      return $position.before(depth);
    }
  }
  return null;
}

/**
 * Find the block we are about to split. Keep only unfinished additions that
 * sit in that same block now; saved comments cannot reliably tell us this.
 */
function pendingIndependentAddsInDBlock(
  state: EditorState,
  sourcePoint: number,
  acceptedId: string,
  relatedAnchors: CommentAnchor[],
) {
  const sourceBlock = dBlockStartAt(state, sourcePoint);
  if (sourceBlock === null) return [];
  return relatedAnchors.flatMap((candidate) => {
    if (
      candidate.id === acceptedId ||
      !candidate.isSuggestion ||
      candidate.suggestionType !== 'add' ||
      candidate.isDraft ||
      candidate.resolved ||
      candidate.deleted ||
      candidate.followsSuggestionId
    )
      return [];
    const point = resolveCommentAnchorPointForAnalysis(candidate, state);
    if (point === null || dBlockStartAt(state, point) !== sourceBlock) {
      return [];
    }
    return [{ anchor: candidate, point }];
  });
}

/**
 * Apply the accepted suggestion's change to the document.
 * Called by the store's acceptSuggestion action before resolving on-chain.
 * Returns false if the anchor can't be resolved or the suggestion type is unknown.
 */
export function applyAcceptedSuggestion(
  editor: Editor,
  anchor: CommentAnchor,
  relatedAnchors: CommentAnchor[] = [],
): boolean {
  if (!anchor.isSuggestion || anchor.resolved || anchor.deleted) return false;

  const state = editor.state;
  const syncState = ySyncPluginKey.getState(state);
  if (!syncState?.binding) return false;

  const { doc, type, binding } = syncState;

  try {
    let from = relativePositionToAbsolutePosition(
      doc,
      type,
      anchor.anchorFrom,
      binding.mapping,
    );
    let to = relativePositionToAbsolutePosition(
      doc,
      type,
      anchor.anchorTo,
      binding.mapping,
    );

    if (from === null || to === null) return false;
    if (from < 0 || to > state.doc.content.size) return false;

    if (anchor.suggestionType === 'add') {
      const logicalPoint = resolveSuggestionAddPointInState(
        anchor,
        state,
        relatedAnchors,
      );
      if (logicalPoint === null) return false;
      from = logicalPoint;
      to = logicalPoint;
    }

    const { suggestionType, suggestedContent } = anchor;

    if (anchor.multilineStructure) {
      if (
        (suggestionType !== 'add' && suggestionType !== 'replace') ||
        !validMultilineStructure(suggestedContent, anchor.multilineStructure) ||
        (suggestionType === 'add' && from !== to) ||
        (suggestionType === 'replace' && from >= to)
      )
        return false;
      const $from = state.doc.resolve(from);
      const $to = state.doc.resolve(to);
      if (!$from.parent.isTextblock || !$to.parent.isTextblock) return false;
      if (
        suggestionType === 'replace' &&
        state.doc.textBetween(from, to, '\n') !== anchor.originalContent
      )
        return false;

      // Check where additions are before the split. Leave other blocks alone.
      const pendingAdds =
        state.schema.nodes.dBlock &&
        anchor.multilineStructure.structureType.includes('block')
          ? pendingIndependentAddsInDBlock(
              state,
              from,
              anchor.id,
              relatedAnchors,
            )
          : [];

      const tr = state.tr;
      if (suggestionType === 'replace') tr.delete(from, to);
      tr.setSelection(TextSelection.create(tr.doc, from));
      const line = anchor.multilineStructure;
      for (let index = 0; index < line.insertedTexts.length; index++) {
        if (index > 0) {
          const kind = line.structureType[index - 1];
          const position = tr.selection.from;
          const $cursor = tr.doc.resolve(position);
          if (kind === 'text') {
            if ($cursor.parent.type.name !== 'codeBlock') return false;
            tr.insertText('\n');
          } else if (kind === 'soft') {
            const hardBreak = state.schema.nodes.hardBreak;
            if (
              !hardBreak ||
              !$cursor.parent.canReplaceWith(
                $cursor.index(),
                $cursor.index(),
                hardBreak,
              )
            )
              return false;
            tr.insert(position, hardBreak.create());
            tr.setSelection(TextSelection.create(tr.doc, position + 1));
          } else {
            const item = Array.from({ length: $cursor.depth + 1 }, (_, depth) =>
              $cursor.node($cursor.depth - depth),
            ).find(
              (node) =>
                node.type.name === 'listItem' || node.type.name === 'taskItem',
            );
            if (
              kind === 'block' &&
              (item || $cursor.parent.type.name === 'codeBlock')
            )
              return false;
            if (kind === 'listItem' && !item) return false;
            const capture = captureSplit(tr, editor);
            const itemDepth =
              kind === 'listItem'
                ? Array.from(
                    { length: $cursor.depth + 1 },
                    (_, offset) => $cursor.depth - offset,
                  ).find(
                    (depth) => $cursor.node(depth).type.name === 'listItem',
                  )
                : undefined;
            const depth =
              kind === 'listItem' || $cursor.node(-1).type.name === 'dBlock'
                ? 2
                : 1;
            const block = $cursor.parent;
            const nextBlockType =
              kind === 'block' &&
              block.type.name === 'heading' &&
              $cursor.parentOffset === block.content.size
                ? state.schema.nodes.paragraph
                : block.type;
            if (!nextBlockType) return false;
            const blockAttrs = getSplittedAttributes(
              editor.extensionManager.attributes,
              block.type.name,
              block.attrs,
            );
            const wrapperAttrs =
              kind === 'listItem' && item
                ? getSplittedAttributes(
                    editor.extensionManager.attributes,
                    item.type.name,
                    item.attrs,
                  )
                : $cursor.node(-1).attrs;
            const types =
              depth === 2
                ? [
                    {
                      type: $cursor.node(-1).type,
                      attrs: wrapperAttrs,
                    },
                    { type: nextBlockType, attrs: blockAttrs },
                  ]
                : [{ type: nextBlockType, attrs: blockAttrs }];
            if (
              itemDepth !== undefined &&
              hasOnlyHardBreaksAfterCursor($cursor) &&
              $cursor.index(itemDepth) < item!.childCount - 1
            ) {
              // Splitting the paragraph here moves its trailing sublist to
              // the new item. Keep that sublist on the original item and
              // insert the proposed sibling after the complete item.
              const sibling = item!.type.create(wrapperAttrs, [
                nextBlockType.create(blockAttrs),
              ]);
              const afterItem = $cursor.after(itemDepth);
              tr.insert(afterItem, sibling);
              tr.setSelection(TextSelection.create(tr.doc, afterItem + 2));
              if (capture) declareSplit(tr, capture);
            } else {
              if (!canSplit(tr.doc, position, depth, types)) return false;
              tr.split(position, depth, types);
              tr.setSelection(
                TextSelection.create(tr.doc, position + depth * 2),
              );
              if (capture) declareSplit(tr, capture);
            }
          }
        }
        const part = line.insertedTexts[index];
        if (part) tr.insertText(part);
      }
      if (!tr.docChanged) return false;
      tr.setMeta(suggestionTrackingPluginKey, true);
      // Work out where these additions should be after the whole edit.
      // Skip any point the edit removed.
      const mappedAdds = pendingAdds.flatMap(({ anchor: candidate, point }) => {
        const result = tr.mapping.mapResult(
          point,
          candidate.anchorFrom.assoc === 1 ? 1 : -1,
        );
        if (
          result.deleted ||
          result.pos < 0 ||
          result.pos > tr.doc.content.size
        )
          return [];
        return [{ anchor: candidate, point: result.pos }];
      });
      const persistAcceptedBreak =
        suggestionType === 'replace' &&
        line.structureType.length === 1 &&
        !line.insertedTexts.some(Boolean);
      let wroteOverride = false;
      if (persistAcceptedBreak || mappedAdds.length > 0) {
        // Save the edit and corrected positions together, so other people,
        // reload, and Undo see the same result.
        doc.transact(() => {
          // Include this tab's overrides in the same Yjs undo item as the
          // structural edit. Other tabs have separate editors/undo managers.
          const tabOverrides =
            mappedAdds.length > 0
              ? getSuggestionAddPointOverrides(editor.state, true)
              : null;
          if (tabOverrides) {
            yUndoPluginKey
              .getState(editor.state)
              ?.undoManager?.addToScope(tabOverrides);
          }
          editor.view.dispatch(tr);
          if (persistAcceptedBreak) {
            const point = createCommentAnchorPointFromEditor(
              editor,
              editor.state.selection.from,
            );
            if (point) {
              doc
                .getMap(ACCEPTED_BREAK_POINTS)
                .set(anchor.id, Y.encodeRelativePosition(point.anchorFrom));
            }
          }
          if (mappedAdds.length > 0 && editor.state.doc.eq(tr.doc)) {
            // Once the shared document has the split, save a new position
            // only if an addition now points to the wrong place. Leave the
            // original saved comment as it is.
            for (const { anchor: candidate, point } of mappedAdds) {
              if (
                resolveSuggestionAddPointInState(
                  candidate,
                  editor.state,
                  relatedAnchors,
                ) === point
              )
                continue;
              const mappedAnchor = createCommentAnchorPointFromEditor(
                editor,
                point,
                candidate.anchorFrom.assoc === 1 ? 1 : -1,
              );
              if (!mappedAnchor || !tabOverrides) continue;
              tabOverrides.set(
                candidate.id,
                Y.encodeRelativePosition(mappedAnchor.anchorFrom),
              );
              wroteOverride = true;
            }
          }
        }, ySyncPluginKey);
      } else {
        editor.view.dispatch(tr);
      }
      if (wroteOverride) triggerDecorationRebuild(editor);
      return true;
    }

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
