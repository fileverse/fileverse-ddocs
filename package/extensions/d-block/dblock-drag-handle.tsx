import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import { NodeRangeSelection } from '@tiptap/extension-node-range';
import { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { useMediaQuery } from 'usehooks-ts';
import { cn } from '@fileverse/ui';
import useContentItemActions, {
  ResolvedContentItem,
} from '../../hooks/use-content-item-actions';
import { getDBlockRenderMeta, toggleHeadingCollapse } from './dblock-collapse';
import { wrapBlockNode } from '../../utils/block-schema';
import type { DBlockRuntimeState } from './dblock-runtime';
import { DBlockMenu } from './components/menu';
import { CollapseButton, GripButton, PlusButton } from './components/buttons';
import {
  AddBlockTooltip,
  CollapseTooltip,
  DragTooltip,
} from './components/tooltips';

interface HoveredBlock {
  node: ProseMirrorNode;
  pos: number;
}

const CLUSTER_HEIGHT = 24;

const getFirstLineOffset = (editor: Editor, pos: number): number => {
  try {
    // v1: nodeDOM(pos) → div[data-type=d-block] → div[data-node-view-content]
    // → the actual block element (p/hN/ul/...). In the flat schema there is no
    // wrapper node view, so nodeDOM(pos) IS that block element. Either way we
    // want the element whose computed line-height sets the first line's center.
    const domNode = editor.view.nodeDOM(pos) as HTMLElement | null;
    const blockEl =
      (domNode?.querySelector<HTMLElement>('[data-node-view-content] > *') ??
        domNode) ?? null;
    const lineHeight = blockEl
      ? parseFloat(getComputedStyle(blockEl).lineHeight)
      : NaN;
    return Number.isFinite(lineHeight) && lineHeight > CLUSTER_HEIGHT
      ? Math.round((lineHeight - CLUSTER_HEIGHT) / 2)
      : 0;
  } catch {
    return 0;
  }
};

// The DragHandle plugin always targets the depth-1 (top-level) node, so
// inside a columns layout the hovered node is the `columns` node itself —
// never the nested dBlock. Accept ANY top-level block (dBlock, columns,
// pageBreak): the menu actions and the plus button are NodeSelection-based
// and operate correctly on the whole block, which beats rendering controls
// that silently no-op. Nested/stale positions (depth > 0 after an edit
// shifted the doc under a stored pos) resolve to null.
export const resolveTopLevelBlock = (
  editor: Editor,
  pos: number,
): ResolvedContentItem | null => {
  const { doc } = editor.state;
  if (pos < 0 || pos > doc.content.size) return null;
  const $pos = doc.resolve(pos);
  if ($pos.depth !== 0) return null;
  const node = $pos.nodeAfter;
  if (!node) return null;
  return { editor, node, pos };
};

// Rescue path for dragging CHILDLESS top-level blocks (captionless media,
// iframe/tweet embeds, page breaks, empty paragraphs). The upstream
// DragHandle re-resolves its drag target from the drag event's coordinates:
// `posAtDOM(blockDom, 0)` lands INSIDE the block, and for a childless node
// `doc.nodeAt(insidePos)` is null, so `getDragHandleRanges` returns [] and
// `dragHandler` bails without ever setting `view.dragging` — the drop then
// silently does nothing ("cannot move the image", TEC-2679). A caption (or
// any child) makes `nodeAt` non-null, which is why captioned images drag
// fine; v1 was immune because the dBlock wrapper always supplied a child.
// We know the hovered block reliably from onNodeChange, so for exactly the
// childless case we build the drag state ourselves (same shape as the
// upstream dragHandler) and stop the event from reaching the broken path.
export const rescueLeafBlockDragStart = (
  editor: Editor,
  pos: number,
  node: ProseMirrorNode,
  event: DragEvent,
): boolean => {
  if (node.childCount > 0) return false;
  if (!event.dataTransfer) return false;

  const { view } = editor;
  const selection = NodeRangeSelection.create(
    view.state.doc,
    pos,
    pos + node.nodeSize,
  );
  const slice = selection.content();

  const dom = view.nodeDOM(pos);
  if (dom instanceof HTMLElement) {
    const ghost = document.createElement('div');
    ghost.append(dom.cloneNode(true));
    ghost.style.position = 'absolute';
    ghost.style.top = '-10000px';
    document.body.append(ghost);
    event.dataTransfer.clearData();
    event.dataTransfer.setDragImage(ghost, 0, 0);
    const cleanup = () => ghost.remove();
    document.addEventListener('drop', cleanup, { once: true });
    document.addEventListener('dragend', cleanup, { once: true });
  }

  view.dragging = { slice, move: true };
  view.dispatch(view.state.tr.setSelection(selection));

  // Mirror the upstream handler: the floating handle sits under the cursor
  // at drag start and would swallow the first dragover events. Upstream's
  // own dragend listener restores pointer-events (we only stop dragSTART
  // propagation, never dragend).
  setTimeout(() => {
    const handleEl = document.querySelector<HTMLElement>('.drag-handle');
    if (handleEl) handleEl.style.pointerEvents = 'none';
  }, 0);

  return true;
};

// Stable identity: DragHandle's internal useEffect depends on
// `computePositionConfig` (and `onNodeChange`) by reference. A new object
// literal on every render would tear down and re-register the ProseMirror
// plugin on every render, which resets the handle to `visibility: hidden`
// each time (see `hideHandle()` in the plugin's `view()` factory) — the
// handle would never stay visible.
const COMPUTE_POSITION_CONFIG = { placement: 'left-start' as const };

export const DBlockDragHandle = ({
  editor,
  runtimeState,
}: {
  editor: Editor;
  runtimeState: DBlockRuntimeState;
}) => {
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const isBelowLargeScreen = useMediaQuery('(max-width: 1024px)');

  const resolveBlock = useCallback(
    (): ResolvedContentItem | null =>
      hovered ? resolveTopLevelBlock(editor, hovered.pos) : null,
    [editor, hovered],
  );
  const actions = useContentItemActions(editor, resolveBlock);

  // Stable identity for the same reason as COMPUTE_POSITION_CONFIG above —
  // must not close over `hovered` (that would change identity every time
  // `hovered` changes, which is exactly when DragHandle calls it).
  // The plugin also calls this with `node: null` on keydown/mouseleave
  // (it resets its internal currentNode); we deliberately keep the last
  // hovered block in state rather than clearing it, so an open menu
  // doesn't lose its target block.
  const handleNodeChange = useCallback(
    ({
      node,
      editor: dragHandleEditor,
      pos,
    }: {
      node: ProseMirrorNode | null;
      editor: Editor;
      pos: number;
    }) => {
      if (node) {
        // Applied imperatively, NOT via React state/effect: the plugin
        // writes the handle's left/top in this same task (its mousemove
        // rAF + computePosition microtasks), while a React commit lands in
        // a LATER task — the browser can paint between the two, flashing
        // the cluster at the block top before the offset corrects it.
        // Writing the transform here keeps both style writes inside one
        // task, so they always paint together.
        const offset = getFirstLineOffset(dragHandleEditor, pos);
        if (clusterRef.current) {
          clusterRef.current.style.transform = offset
            ? `translateY(${offset}px)`
            : '';
        }
      }
      setHovered((prev) => {
        if (!node) return prev;
        if (prev && prev.pos === pos && prev.node === node) return prev;
        return { node, pos };
      });
    },
    [],
  );

  useEffect(() => {
    setMenuOpen(false);
  }, [hovered?.pos]);

  // Native (not React-synthetic) listener: the DragHandle plugin physically
  // relocates our rendered element outside the React root, so synthetic
  // event delegation cannot be relied on here. Bubbling from the grip
  // reaches the cluster div BEFORE the plugin's own listener on its parent
  // element, which lets us take over exactly the childless-block case —
  // see rescueLeafBlockDragStart above.
  const resolveBlockRef = useRef(resolveBlock);
  resolveBlockRef.current = resolveBlock;
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster) return;

    const onDragStart = (event: DragEvent) => {
      const current = resolveBlockRef.current();
      if (!current) return;
      if (
        rescueLeafBlockDragStart(
          current.editor,
          current.pos,
          current.node,
          event,
        )
      ) {
        event.stopPropagation();
      }
    };

    cluster.addEventListener('dragstart', onDragStart);
    return () => cluster.removeEventListener('dragstart', onDragStart);
  }, []);

  if (runtimeState.isPresentationMode && runtimeState.isPreviewMode) {
    return null;
  }

  const meta = hovered ? getDBlockRenderMeta(hovered.node, hovered.pos) : null;

  const shouldShowEditingControls =
    !runtimeState.isPreviewMode && !isBelowLargeScreen;
  // Heading-only buttons stay MOUNTED (reserving their width) and toggle
  // `invisible` instead of unmounting. The DragHandle plugin computes the
  // handle's `left` from the cluster's width at reposition time; a cluster
  // that widens after positioning (chevron appearing for a heading) grows
  // rightward over the block's text. Constant width keeps `left` stable.
  const isHeadingHovered = Boolean(meta?.isHeading);

  const handleAddBlock = (event: React.MouseEvent<HTMLButtonElement>) => {
    const current = resolveBlock();
    if (!current) return;
    const insertPos = event.altKey
      ? current.pos
      : current.pos + current.node.nodeSize;
    current.editor.commands.insertContentAt(
      insertPos,
      // v1 needs the dBlock wrapper; the flat schema rejects it (and silently
      // inserts nothing), so the shape comes from the live schema.
      wrapBlockNode(current.editor.schema, { type: 'paragraph' }),
    );
  };

  const handleDragClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.altKey) {
      actions.deleteNode();
      return;
    }
    setMenuOpen((open) => !open);
  };

  const handleToggleCollapse = () => {
    const current = resolveBlock();
    if (current) toggleHeadingCollapse(current.editor, current.pos);
  };

  const buttonClassName = cn(
    'd-block-button color-text-default hover:color-bg-default-hover aspect-square h-5 w-5 min-w-0 shrink-0',
  );

  return (
    <DragHandle
      editor={editor}
      computePositionConfig={COMPUTE_POSITION_CONFIG}
      onNodeChange={handleNodeChange}
    >
      <div
        ref={clusterRef}
        aria-label="block-controls"
        className="flex h-6 items-center justify-end gap-0.5 pr-2"
      >
        {shouldShowEditingControls ? (
          <>
            <AddBlockTooltip>
              <PlusButton
                onClick={handleAddBlock}
                className={buttonClassName}
              />
            </AddBlockTooltip>
            <DBlockMenu
              isOpen={menuOpen}
              onOpenChange={setMenuOpen}
              trigger={
                <DragTooltip>
                  <GripButton
                    onClick={handleDragClick}
                    className={buttonClassName}
                  />
                </DragTooltip>
              }
              actions={actions}
            />
          </>
        ) : null}
        <CollapseTooltip isCollapsed={Boolean(meta?.isThisHeadingCollapsed)}>
          <CollapseButton
            isCollapsed={Boolean(meta?.isThisHeadingCollapsed)}
            onToggle={handleToggleCollapse}
            className={cn(
              buttonClassName,
              !isHeadingHovered && 'invisible pointer-events-none',
            )}
          />
        </CollapseTooltip>
      </div>
    </DragHandle>
  );
};
