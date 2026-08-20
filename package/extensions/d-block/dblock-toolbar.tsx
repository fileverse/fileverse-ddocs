import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Editor, JSONContent } from '@tiptap/react';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  createMoreTemplates,
  createTemplateButtons,
  renderTemplateButtons,
} from '../../utils/template-utils';
import { unwrapDBlocksInJSON } from '../../utils/block-schema';
import type { TabbedJSONContent } from '../../hooks/use-headless-editor';
import {
  DEFAULT_DBLOCK_RUNTIME_STATE,
  type DBlockRuntimeState,
} from './dblock-runtime';
import { DBlockDragHandle } from './dblock-drag-handle';

interface DBlockTemplateTarget {
  node: ProseMirrorNode;
  pos: number;
}

// v1 wraps the paragraph in a dBlock; in the flat schema the block IS the
// paragraph.
const isBlankParagraphBlock = (block: ProseMirrorNode): boolean => {
  const paragraph =
    block.type.name === 'dBlock' ? block.content.firstChild : block;
  if (paragraph?.type.name !== 'paragraph') {
    return false;
  }
  let hasContent = false;
  paragraph.content.forEach((child) => {
    if ((child.isText && child.text?.trim()) || !child.isText) {
      hasContent = true;
    }
  });
  return !hasContent;
};

export const getTemplateTarget = (
  editor: Editor | null,
  runtimeState: DBlockRuntimeState,
): DBlockTemplateTarget | null => {
  if (
    !editor ||
    editor.isDestroyed ||
    runtimeState.isPreviewMode ||
    runtimeState.isCollaboratorsDoc ||
    // Split View renders the doc read-only on the right — no template picker.
    runtimeState.isSplitView
  ) {
    return null;
  }

  // A visually clean doc is not always a single block: converting the first
  // block to a heading ('# ' or the toolbar) makes TrailingNode append an
  // empty paragraph, and converting back never removes it. So instead of
  // requiring childCount === 1, require EVERY block to be a blank paragraph
  // — any real content anywhere still hides the picker.
  const { doc } = editor.state;
  let allBlank = true;
  doc.forEach((child) => {
    if (!isBlankParagraphBlock(child)) {
      allBlank = false;
    }
  });

  const node = doc.firstChild;
  const pos = 0;

  if (!node || !allBlank) {
    return null;
  }

  const { selection } = editor.state;
  const isFirstDBlockFocused =
    selection.$anchor.pos >= pos &&
    selection.$anchor.pos <= pos + node.nodeSize;

  if (!isFirstDBlockFocused) {
    return null;
  }

  return {
    node,
    pos,
  };
};

const DBlockTemplateOverlay = ({
  editor,
  enableFanficTemplate,
  onApplyTabbedTemplate,
  runtimeState,
}: {
  editor: Editor | null;
  enableFanficTemplate: boolean;
  onApplyTabbedTemplate?: (template: TabbedJSONContent) => void;
  runtimeState: DBlockRuntimeState;
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [visibleTemplateCount, setVisibleTemplateCount] = useState(2);
  const [refreshKey, setRefreshKey] = useState(0);
  const isFocusMode = runtimeState.isFocusMode;

  useEffect(() => {
    if (!editor) return;

    const refresh = () => setRefreshKey((key) => key + 1);
    editor.on('transaction', refresh);
    editor.on('selectionUpdate', refresh);
    window.addEventListener('resize', refresh);

    return () => {
      editor.off('transaction', refresh);
      editor.off('selectionUpdate', refresh);
      window.removeEventListener('resize', refresh);
    };
  }, [editor]);

  const target = useMemo(() => {
    void refreshKey;
    return getTemplateTarget(editor, runtimeState);
  }, [editor, runtimeState, refreshKey]);

  const addTemplate = useCallback(
    (template: JSONContent) => {
      const currentTarget = getTemplateTarget(editor, runtimeState);
      if (!currentTarget) {
        return;
      }

      // The template JSON is authored in v1 shape (dBlock wrappers) and stays
      // the single source of truth; the flat schema gets it unwrapped at
      // insert time. Insert position: v1's arithmetic lands on the empty
      // wrapper's own position, which is what the flat schema uses directly.
      const hasDBlock = Boolean(editor?.schema.nodes.dBlock);

      editor?.commands.insertContentAt(
        hasDBlock
          ? currentTarget.pos + currentTarget.node.nodeSize - 4
          : currentTarget.pos,
        hasDBlock ? template : unwrapDBlocksInJSON(template),
      );
    },
    [editor, runtimeState],
  );

  const templateButtons = useMemo(
    () =>
      createTemplateButtons(
        addTemplate,
        onApplyTabbedTemplate,
        enableFanficTemplate,
      ),
    [addTemplate, enableFanficTemplate, onApplyTabbedTemplate],
  );
  const moreTemplates = useMemo(
    () => createMoreTemplates(addTemplate, enableFanficTemplate),
    [addTemplate, enableFanficTemplate],
  );

  const toggleAllTemplates = useCallback(() => {
    setIsExpanded((expanded) => {
      setVisibleTemplateCount(expanded ? 2 : moreTemplates.length);
      return !expanded;
    });
  }, [moreTemplates.length]);

  // Same hazard #553 fixed on the old toolbar: the tab-editor cache destroys
  // and recreates editors inside pre-paint layout effects, so this can render
  // with an already-destroyed editor, whose `view` access throws on tiptap v3.
  const panel =
    editor && !editor.isDestroyed
      ? editor.view.dom.closest('[data-ddoc-editor-panel]')
      : null;

  if (!target || isFocusMode || !panel) {
    return null;
  }

  // The editor's first block must be rendered before the overlay is worth
  // portaling. Matched by position rather than by the v1-only
  // `[data-type="d-block"]` marker, which flat blocks do not carry.
  const firstBlock = editor?.view.dom.firstElementChild;
  if (!firstBlock) {
    return null;
  }

  return createPortal(
    <div
      data-template-overlay="true"
      contentEditable={false}
      className="top-[66px] right-20 w-max absolute z-10 max-md:right-[unset] max-md:left-9"
    >
      {renderTemplateButtons(
        templateButtons,
        moreTemplates,
        visibleTemplateCount,
        toggleAllTemplates,
        isExpanded,
        runtimeState.isCollaboratorsDoc,
        runtimeState.isPreviewMode,
        isFocusMode,
      )}
    </div>,
    panel,
  );
};

export const DBlockToolbarProvider = ({
  children,
  editor,
  enableFanficTemplate = false,
  runtimeState = DEFAULT_DBLOCK_RUNTIME_STATE,
  isPreviewEditor = false,
  onApplyTabbedTemplate,
  onCopyHeadingLink,
}: {
  children: React.ReactNode;
  editor: Editor | null;
  enableFanficTemplate?: boolean;
  runtimeState?: DBlockRuntimeState;
  // Feeds the cluster's copy-link slot, which covers the editable-preview
  // states (comment & suggest); the CSS-gated node-view/decoration controls
  // cover the non-editable ones. See DBlockDragHandle.
  onCopyHeadingLink?: (link: string) => void;
  onApplyTabbedTemplate?: (template: TabbedJSONContent) => void;
  // Statically read-only surfaces (PreviewDdocEditor: blog preview, version
  // history) must never mount block chrome. The read-only heading
  // affordances live inside the node view, and the upstream DragHandle
  // plugin relocates its DOM element outside React's tree — so when a
  // late-arriving blob flips the schema marker and the editor rebuilds,
  // React re-commits EditorContent against that relocated `.drag-handle`
  // anchor and insertBefore throws NotFoundError, killing the preview
  // (TEC-2679 blog publish modal on v2 docs). Never mounted = never a
  // stale anchor, and no relocated element leaked per version switch.
  isPreviewEditor?: boolean;
}) => {
  if (isPreviewEditor) {
    return <>{children}</>;
  }
  return (
    <>
      {children}
      {/* The drag-handle plugin reads editor.view, so a destroyed editor
          would throw here too — see the note in DBlockTemplateOverlay. */}
      {editor && !editor.isDestroyed ? (
        <DBlockDragHandle
          editor={editor}
          runtimeState={runtimeState}
          onCopyHeadingLink={onCopyHeadingLink}
        />
      ) : null}
      <DBlockTemplateOverlay
        editor={editor}
        enableFanficTemplate={enableFanficTemplate}
        runtimeState={runtimeState}
        onApplyTabbedTemplate={onApplyTabbedTemplate}
      />
    </>
  );
};
