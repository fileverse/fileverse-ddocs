import type { NodeViewRenderer, NodeViewRendererProps } from '@tiptap/core';
import {
  ReactNodeView,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
  type ReactNodeViewRendererOptions,
} from '@tiptap/react';
import type { ComponentType } from 'react';

// Tiptap 3.31 selects a React node view only for a NodeSelection. Before, a
// selection covering the node (select-all, a drag across it) also set
// `selected` and `ProseMirror-selectednode`; this keeps that.
class CoverSelectionNodeView extends ReactNodeView {
  constructor(
    component: ComponentType<ReactNodeViewProps>,
    props: NodeViewRendererProps,
    options?: Partial<ReactNodeViewRendererOptions>,
  ) {
    super(component, props, options);
    this.editor.on('selectionUpdate', this.syncCoverSelection);
  }

  private syncCoverSelection = () => {
    const pos = this.getPos();
    if (typeof pos !== 'number') return;
    const { from, to } = this.editor.state.selection;
    const covers = from <= pos && to >= pos + this.node.nodeSize;
    if (covers === !!this.renderer.props.selected) return;
    if (covers) this.selectNode();
    else this.deselectNode();
  };

  destroy() {
    this.editor.off('selectionUpdate', this.syncCoverSelection);
    super.destroy();
  }
}

export function CoverSelectionNodeViewRenderer(
  component: ComponentType<ReactNodeViewProps>,
  options?: Partial<ReactNodeViewRendererOptions>,
): NodeViewRenderer {
  const placeholder = ReactNodeViewRenderer(component, options);
  return (props) => {
    if (!('contentComponent' in props.editor && props.editor.contentComponent))
      return placeholder(props);
    return new CoverSelectionNodeView(component, props, options);
  };
}
