import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Decoration, NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import {
  DBLOCK_HIDDEN_CLASS,
  getDBlockRenderMeta,
  getHeadingLinkSlug,
  toggleHeadingCollapse,
} from './dblock-collapse';
import type { DBlockRenderMeta } from './dblock-collapse';
import { CHEVRON_SVG, LINK_SVG } from './heading-chrome-icons';
import type { DBlockRuntimeState } from './dblock-runtime';
import { getDBlockRuntimeState } from './dblock-runtime';

interface DBlockNodeViewOptions {
  editor: Editor;
  node: ProseMirrorNode;
  getPos: () => number;
  decorations: readonly Decoration[];
  HTMLAttributes: Record<string, unknown>;
  getRuntimeState?: () => DBlockRuntimeState;
  onCopyHeadingLink?: (link: string) => void;
}

const joinClasses = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

const hasHiddenDecoration = (decorations: readonly Decoration[]) =>
  decorations.some((decoration) =>
    String(
      (decoration as { type?: { attrs?: { class?: string } } }).type?.attrs
        ?.class ?? '',
    )
      .split(/\s+/)
      .includes(DBLOCK_HIDDEN_CLASS),
  );

const setAttributes = (
  element: HTMLElement,
  attributes: Record<string, unknown>,
) => {
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'class' || value === undefined || value === null) return;
    element.setAttribute(key, String(value));
  });
};

export class DBlockNodeView implements NodeView {
  node: ProseMirrorNode;
  editor: Editor;
  getPos: () => number;
  dom: HTMLDivElement;
  contentDOM: HTMLDivElement;
  private decorations: readonly Decoration[];
  private getRuntimeState?: () => DBlockRuntimeState;
  private onCopyHeadingLink?: (link: string) => void;
  private previewControls: HTMLDivElement | null = null;
  private collapseButton: HTMLButtonElement | null = null;

  constructor({
    editor,
    node,
    getPos,
    decorations,
    HTMLAttributes,
    getRuntimeState,
    onCopyHeadingLink,
  }: DBlockNodeViewOptions) {
    this.editor = editor;
    this.node = node;
    this.getPos = getPos;
    this.decorations = decorations;
    this.getRuntimeState = getRuntimeState;
    this.onCopyHeadingLink = onCopyHeadingLink;

    this.dom = document.createElement('div');
    this.dom.dataset.type = 'd-block';
    setAttributes(this.dom, HTMLAttributes);

    this.contentDOM = document.createElement('div');
    this.contentDOM.dataset.nodeViewContent = 'true';
    this.dom.appendChild(this.contentDOM);

    this.syncDOM();
  }

  update(node: ProseMirrorNode, decorations: readonly Decoration[]) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.decorations = decorations;
    this.syncDOM();
    return true;
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    if (mutation.type === 'selection') return false;
    return !this.contentDOM.contains(mutation.target);
  }

  private syncDOM() {
    const runtime = getDBlockRuntimeState(this.getRuntimeState);
    const isPresentationPreview =
      runtime.isPresentationMode && runtime.isPreviewMode;
    const position = this.safeGetPos();
    const meta = getDBlockRenderMeta(this.node, position ?? 0);
    const shouldHide =
      !isPresentationPreview && hasHiddenDecoration(this.decorations);

    this.dom.className = joinClasses(
      'd-block w-full relative',
      meta.isTable && 'is-table pointer-events-auto',
      this.node.attrs?.isCorrupted && 'invalid-content',
      isPresentationPreview && 'pointer-events-none',
      shouldHide && DBLOCK_HIDDEN_CLASS,
    );

    this.syncPreviewControls(runtime, meta);
  }

  // Read-only preview never shows the floating DragHandle cluster — the
  // upstream plugin hard-hides its element whenever `!editor.isEditable`
  // (`showHandle()` bails into `hideHandle()`). Heading affordances viewers
  // need (expand a collapsed heading, copy its link) therefore live INSIDE
  // the node view, shown via CSS :hover — no floating positioning involved.
  //
  // The controls are rendered for headings in EVERY mode and gated by CSS
  // on `.ProseMirror[contenteditable='false']` (the exact condition under
  // which the cluster cannot appear). Gating on runtime.isPreviewMode here
  // would freeze the initial mode: switching owner → view-only flips
  // editable/runtime state but dispatches no transaction, so vanilla node
  // views never re-run syncDOM and would keep the stale decision.
  // Presentation and split-view are separate editor instances whose runtime
  // flags are fixed at construction, so excluding them here is safe.
  private shouldShowPreviewControls(
    runtime: DBlockRuntimeState,
    meta: DBlockRenderMeta,
  ) {
    return (
      !runtime.isPresentationMode && !runtime.isSplitView && meta.isHeading
    );
  }

  private syncPreviewControls(
    runtime: DBlockRuntimeState,
    meta: DBlockRenderMeta,
  ) {
    if (!this.shouldShowPreviewControls(runtime, meta)) {
      if (this.previewControls) {
        this.previewControls.remove();
        this.previewControls = null;
        this.collapseButton = null;
      }
      return;
    }

    if (!this.previewControls) {
      this.previewControls = this.buildPreviewControls();
      this.dom.appendChild(this.previewControls);
    }

    const isCollapsed = Boolean(meta.isThisHeadingCollapsed);
    this.previewControls.classList.toggle('is-collapsed', isCollapsed);
    if (this.collapseButton) {
      this.collapseButton.classList.toggle('is-collapsed', isCollapsed);
      this.collapseButton.setAttribute(
        'aria-label',
        isCollapsed ? 'Expand heading' : 'Collapse heading',
      );
    }
  }

  private buildPreviewControls(): HTMLDivElement {
    const controls = document.createElement('div');
    controls.className = 'd-block-preview-controls';
    controls.contentEditable = 'false';
    controls.dataset.previewControls = 'true';

    const collapse = document.createElement('button');
    collapse.type = 'button';
    collapse.className =
      'd-block-button d-block-preview-button color-text-default hover:color-bg-default-hover';
    collapse.dataset.test = 'preview-collapse-button';
    collapse.innerHTML = CHEVRON_SVG;
    collapse.addEventListener('mousedown', (event) => event.preventDefault());
    collapse.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const position = this.safeGetPos();
      if (position != null) toggleHeadingCollapse(this.editor, position);
    });
    this.collapseButton = collapse;
    controls.appendChild(collapse);

    if (this.onCopyHeadingLink) {
      const copyLink = document.createElement('button');
      copyLink.type = 'button';
      copyLink.className =
        'd-block-button d-block-preview-button d-block-preview-copy-link color-text-default hover:color-bg-default-hover';
      copyLink.dataset.test = 'preview-copy-link-button';
      copyLink.setAttribute('aria-label', 'Copy heading link');
      copyLink.innerHTML = LINK_SVG;
      copyLink.addEventListener('mousedown', (event) => event.preventDefault());
      copyLink.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const position = this.safeGetPos();
        if (position == null) return;
        const link = getHeadingLinkSlug(this.node, position);
        if (link) this.onCopyHeadingLink?.(link);
      });
      controls.appendChild(copyLink);
    }

    return controls;
  }

  private safeGetPos() {
    try {
      const position = this.getPos();
      return typeof position === 'number' ? position : null;
    } catch {
      return null;
    }
  }
}
