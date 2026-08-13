import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  type Transaction,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { headingToSlug } from '../../utils/heading-to-slug';
import { CHEVRON_SVG, LINK_SVG } from './heading-chrome-icons';
import { HEADING_COLLAPSE_TOGGLE_META } from '../suggestion/suggestion-tracking-extension';

export const DBLOCK_HIDDEN_CLASS = 'd-block-hidden';
const DBLOCK_COLLAPSE_META = 'dblock-collapse';

export interface HeadingLookup {
  id: string;
  level: number;
  position: number;
  children: string[];
  parent?: string;
}

export type HeadingLookupMap = Map<string, HeadingLookup>;

export interface DBlockRenderMeta {
  isHeading: boolean;
  headingId: string | null;
  isThisHeadingCollapsed: boolean;
  headingAlignment?: string;
  isTable: boolean;
}

interface DBlockCollapsePluginState {
  decorations: DecorationSet;
  structureSignature: string;
}

const getFirstChild = (node: ProseMirrorNode) => node.content.firstChild;

// v1 wraps each block in a dBlock whose first child is the real node; the
// flat v2 schema puts the block itself at the top level. These resolvers let
// the same collapse engine serve both shapes, keyed off the doc's own schema.
const docHasDBlock = (doc: ProseMirrorNode) =>
  Boolean(doc.type.schema.nodes.dBlock);

// The heading of a top-level block, or null when the block is not a heading.
const getBlockHeading = (
  doc: ProseMirrorNode,
  node: ProseMirrorNode | null | undefined,
): ProseMirrorNode | null => {
  if (!node) return null;
  if (docHasDBlock(doc)) {
    const firstChild = node.type.name === 'dBlock' ? getFirstChild(node) : null;
    return firstChild?.type.name === 'heading' ? firstChild : null;
  }
  return node.type.name === 'heading' ? node : null;
};

// Position of the heading node given its top-level block position.
const headingPosAt = (doc: ProseMirrorNode, blockPos: number) =>
  blockPos + (docHasDBlock(doc) ? 1 : 0);

// Schema-agnostic: in v1 the meaningful node is the dBlock's first child, in
// the flat v2 schema the top-level node IS the block. Resolved from the node's
// own schema so callers (node view, floating drag-handle cluster) need no
// version awareness.
export const getDBlockRenderMeta = (
  node: ProseMirrorNode,
  pos: number,
): DBlockRenderMeta => {
  const block =
    node.type.name === 'dBlock' ? getFirstChild(node) : (node ?? null);
  const isHeading = block?.type.name === 'heading';

  return {
    isHeading,
    headingId: isHeading ? block?.attrs.id || `heading-${pos}` : null,
    isThisHeadingCollapsed: Boolean(isHeading && block?.attrs.isCollapsed),
    headingAlignment: isHeading ? block?.attrs.textAlign : undefined,
    isTable: block?.type.name === 'table',
  };
};

export const getHeadingLinkSlug = (
  node: ProseMirrorNode,
  pos: number,
): string | null => {
  // Same shape-agnostic resolution as getDBlockRenderMeta: v1 passes the
  // dBlock wrapper, the flat schema passes the heading itself.
  const headingNode =
    node.type.name === 'dBlock' ? getFirstChild(node) : (node ?? null);
  if (headingNode?.type.name !== 'heading') {
    return null;
  }

  const id = headingNode.attrs.id || `heading-${pos}`;
  const title = headingNode.textContent;
  if (!title) {
    return null;
  }

  const heading = headingToSlug(title);
  const uuid = String(id).replace(/-/g, '').substring(0, 8);
  return `heading=${heading}-${uuid}`;
};

export const buildHeadingMap = (doc: ProseMirrorNode): HeadingLookupMap => {
  const headingMap: HeadingLookupMap = new Map();
  const parentStack: Array<{ id: string; level: number }> = [];

  doc.forEach((node, position) => {
    const headingNode = getBlockHeading(doc, node);
    if (!headingNode) {
      return;
    }

    const level = headingNode.attrs.level || 1;
    const id = headingNode.attrs.id || `heading-${position}`;

    while (
      parentStack.length > 0 &&
      parentStack[parentStack.length - 1].level >= level
    ) {
      parentStack.pop();
    }

    const parent =
      parentStack.length > 0
        ? parentStack[parentStack.length - 1].id
        : undefined;

    headingMap.set(id, {
      id,
      level,
      position,
      children: [],
      parent,
    });

    if (parent) {
      headingMap.get(parent)?.children.push(id);
    }

    parentStack.push({ id, level });
  });

  return headingMap;
};

const isHeadingCollapsed = (
  doc: ProseMirrorNode,
  heading: HeadingLookup | undefined,
) => {
  if (!heading) {
    return false;
  }

  const node = doc.nodeAt(heading.position);
  const headingNode = getBlockHeading(doc, node);
  return Boolean(headingNode?.attrs.isCollapsed);
};

export const shouldHideDBlock = (
  doc: ProseMirrorNode,
  node: ProseMirrorNode,
  position: number,
  headingMap: HeadingLookupMap,
) => {
  const blockHeading = getBlockHeading(doc, node);

  if (blockHeading) {
    const headingId = blockHeading.attrs.id || `heading-${position}`;
    const heading = headingMap.get(headingId);

    if (!heading || heading.level === 1 || !heading.parent) {
      return false;
    }

    let currentParentId: string | undefined = heading.parent;
    while (currentParentId) {
      const parentHeading = headingMap.get(currentParentId);
      if (isHeadingCollapsed(doc, parentHeading)) {
        return true;
      }
      currentParentId = parentHeading?.parent;
    }

    return false;
  }

  let previousHeadingId: string | null = null;
  headingMap.forEach((heading, id) => {
    if (
      heading.position < position &&
      (!previousHeadingId ||
        headingMap.get(previousHeadingId)!.position < heading.position)
    ) {
      previousHeadingId = id;
    }
  });

  let currentId: string | undefined = previousHeadingId ?? undefined;
  while (currentId) {
    const heading = headingMap.get(currentId);
    if (isHeadingCollapsed(doc, heading)) {
      return true;
    }
    currentId = heading?.parent;
  }

  return false;
};

const collectDescendantHeadingIds = (
  headingMap: HeadingLookupMap,
  headingId: string,
) => {
  const result: string[] = [];
  const visit = (id: string) => {
    const heading = headingMap.get(id);
    if (!heading) {
      return;
    }

    heading.children.forEach((childId) => {
      result.push(childId);
      visit(childId);
    });
  };

  visit(headingId);
  return result;
};

const setHeadingCollapsed = (
  tr: Transaction,
  dBlockPos: number,
  isCollapsed: boolean,
) => {
  const headingPos = headingPosAt(tr.doc, dBlockPos);
  const headingNode = tr.doc.nodeAt(headingPos);

  if (headingNode?.type.name !== 'heading') {
    return false;
  }

  tr.setNodeMarkup(
    headingPos,
    undefined,
    {
      ...headingNode.attrs,
      isCollapsed,
    },
    headingNode.marks,
  );

  return true;
};

const markCollapseTransaction = (tr: Transaction) => {
  tr.setMeta(DBLOCK_COLLAPSE_META, true);
  tr.setMeta(HEADING_COLLAPSE_TOGGLE_META, true);
};

const findHeadingAtSelectionEnd = (
  state: EditorState,
): { node: ProseMirrorNode; position: number } | null => {
  const { selection, doc } = state;
  if (!selection.empty) {
    return null;
  }

  // Caret max position inside the heading text: block end minus the closing
  // heading token, minus one more for the dBlock wrapper when present.
  const endOffset = docHasDBlock(doc) ? 2 : 1;
  let position = 0;
  while (position < doc.content.size) {
    const node = doc.nodeAt(position);
    if (!node) {
      break;
    }

    const headingNode = getBlockHeading(doc, node);
    if (headingNode?.attrs.isCollapsed) {
      const end = position + node.nodeSize;
      if (selection.from >= end - endOffset && selection.from <= end) {
        return { node, position };
      }
    }

    position += node.nodeSize;
  }

  return null;
};

export const findEndOfCollapsedContent = (
  doc: ProseMirrorNode,
  headingPos: number,
) => {
  const blockNode = doc.nodeAt(headingPos);
  const headingNode = getBlockHeading(doc, blockNode);

  if (!blockNode || !headingNode) {
    return headingPos + (blockNode?.nodeSize ?? 0);
  }

  const headingLevel = headingNode.attrs.level || 1;
  let position = headingPos + blockNode.nodeSize;

  while (position < doc.content.size) {
    const node = doc.nodeAt(position);
    if (!node) {
      break;
    }

    const nextHeading = getBlockHeading(doc, node);
    if (nextHeading && (nextHeading.attrs.level || 1) <= headingLevel) {
      break;
    }

    position += node.nodeSize;
  }

  return position;
};

const isEmptyBlock = (
  doc: ProseMirrorNode,
  node: ProseMirrorNode | null | undefined,
) => {
  if (!node) return false;
  if (docHasDBlock(doc)) {
    const firstChild = getFirstChild(node);
    return (
      node.type.name === 'dBlock' &&
      firstChild?.type.name === 'paragraph' &&
      firstChild.content.size === 0
    );
  }
  return node.type.name === 'paragraph' && node.content.size === 0;
};

const getEmptyTrailingDBlockPosition = (doc: ProseMirrorNode) => {
  const lastChild = doc.lastChild;
  if (!isEmptyBlock(doc, lastChild)) {
    return null;
  }

  return doc.content.size - lastChild!.nodeSize;
};

export const buildToggleHeadingCollapseTransaction = (
  state: EditorState,
  position: number,
) => {
  const node = state.doc.nodeAt(position);
  const headingNode = getBlockHeading(state.doc, node);

  if (!node || !headingNode) {
    return null;
  }

  const headingMap = buildHeadingMap(state.doc);
  const headingId = headingNode.attrs.id || `heading-${position}`;
  const heading = headingMap.get(headingId);
  if (!heading) {
    return null;
  }

  const wasCollapsed = Boolean(headingNode.attrs.isCollapsed);
  const tr = state.tr;

  setHeadingCollapsed(tr, position, !wasCollapsed);

  if (!wasCollapsed) {
    collectDescendantHeadingIds(headingMap, headingId).forEach((childId) => {
      const childHeading = headingMap.get(childId);
      if (childHeading) {
        setHeadingCollapsed(tr, childHeading.position, true);
      }
    });

    const hiddenEnd = findEndOfCollapsedContent(state.doc, position);
    if (state.selection.from > position && state.selection.from < hiddenEnd) {
      const headingEnd = Math.min(
        position + node.nodeSize - 1,
        tr.doc.content.size,
      );
      tr.setSelection(TextSelection.create(tr.doc, headingEnd));
    }
  } else {
    heading.children.forEach((childId) => {
      const childHeading = headingMap.get(childId);
      const shouldExpand =
        heading.level === 1 || childHeading?.level === heading.level + 1;
      if (childHeading && shouldExpand) {
        setHeadingCollapsed(tr, childHeading.position, false);
      }
    });
  }

  markCollapseTransaction(tr);
  return tr;
};

// Toggling collapse must leave the viewport where it is. The caret is
// usually somewhere else entirely (often the document start, from autofocus),
// and scrolling to an untouched selection drags the reader away from the
// heading they just clicked. Only the case where the transaction itself
// relocated the caret — it sat inside the region being hidden — is worth
// scrolling to.
const dispatchCollapseToggle = (
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  previousSelection: EditorState['selection'],
  tr: Transaction,
) => {
  view.dispatch(tr.selection.eq(previousSelection) ? tr : tr.scrollIntoView());
};

export const toggleHeadingCollapse = (editor: Editor, position: number) => {
  const tr = buildToggleHeadingCollapseTransaction(editor.state, position);
  if (!tr) {
    return false;
  }

  dispatchCollapseToggle(editor.view, editor.state.selection, tr);
  editor.view.focus();
  return true;
};

export const expandHeadingContent = (editor: Editor, nodePos: number) => {
  const node = editor.state.doc.nodeAt(nodePos);
  const headingNode = getBlockHeading(editor.state.doc, node);

  if (!node || !headingNode || !headingNode.attrs.isCollapsed) {
    return false;
  }

  const headingLevel = headingNode.attrs.level || 1;
  const tr = editor.state.tr;
  let changed = setHeadingCollapsed(tr, nodePos, false);
  let position = nodePos + node.nodeSize;

  while (position < editor.state.doc.content.size) {
    const nextNode = editor.state.doc.nodeAt(position);
    if (!nextNode) {
      break;
    }

    const nextHeading = getBlockHeading(editor.state.doc, nextNode);
    if (nextHeading) {
      const nextLevel = nextHeading.attrs.level || 1;
      if (nextLevel <= headingLevel) {
        break;
      }

      if (nextHeading.attrs.isCollapsed) {
        changed = setHeadingCollapsed(tr, position, false) || changed;
      }
    }

    position += nextNode.nodeSize;
  }

  if (changed) {
    markCollapseTransaction(tr);
    editor.view.dispatch(tr);
  }

  return changed;
};

const buildExpandCollapsedHeadingAtSelectionTransaction = (
  state: EditorState,
): { transaction: Transaction; insertPos: number } | null => {
  const headingAtSelection = findHeadingAtSelectionEnd(state);
  if (!headingAtSelection) {
    return null;
  }

  const { node, position } = headingAtSelection;
  const blockHeading = getBlockHeading(state.doc, node);
  const headingLevel = blockHeading?.attrs.level || 1;
  const insertPos = findEndOfCollapsedContent(state.doc, position);
  const tr = state.tr;

  setHeadingCollapsed(tr, position, false);

  let scanPos = position + node.nodeSize;
  while (scanPos < state.doc.content.size) {
    const nextNode = state.doc.nodeAt(scanPos);
    if (!nextNode) {
      break;
    }

    const nextHeading = getBlockHeading(state.doc, nextNode);
    if (nextHeading) {
      const nextLevel = nextHeading.attrs.level || 1;
      if (nextLevel <= headingLevel) {
        break;
      }

      if (nextHeading.attrs.isCollapsed) {
        setHeadingCollapsed(tr, scanPos, false);
      }
    }

    scanPos += nextNode.nodeSize;
  }

  markCollapseTransaction(tr);
  return {
    transaction: tr.scrollIntoView(),
    insertPos,
  };
};

const buildCollapsedHeadingEnterFollowUpTransaction = (
  state: EditorState,
  insertPos: number,
) => {
  const tr = state.tr;
  const nodeAtInsert = state.doc.nodeAt(insertPos);
  const trailingPos = getEmptyTrailingDBlockPosition(state.doc);
  // Caret goes inside the paragraph: +1 into it, +1 more through the dBlock
  // wrapper when the schema has one.
  const intoParagraph = docHasDBlock(state.doc) ? 2 : 1;
  const focusPos =
    isEmptyBlock(state.doc, nodeAtInsert) &&
    insertPos + nodeAtInsert!.nodeSize >= state.doc.content.size
      ? insertPos + intoParagraph
      : trailingPos !== null && insertPos >= state.doc.content.size
        ? trailingPos + intoParagraph
        : null;

  if (focusPos !== null) {
    tr.setSelection(TextSelection.create(tr.doc, focusPos));
  } else {
    const dBlockType = state.schema.nodes.dBlock;
    const newBlock = dBlockType
      ? dBlockType.create(null, [state.schema.nodes.paragraph.create()])
      : state.schema.nodes.paragraph.create();
    tr.insert(insertPos, newBlock);
    tr.setSelection(TextSelection.create(tr.doc, insertPos + intoParagraph));
  }

  return tr.scrollIntoView();
};

// Read-only-preview heading chrome for the FLAT schema. v1 renders these
// buttons from the dBlock node view; flat blocks have no node view, so the
// same controls (same classes, same icons) are supplied as a widget
// decoration instead.
//
// Rendered in every mode and gated by CSS on `[contenteditable='false']`,
// exactly like the v1 node view: switching owner -> view-only flips
// editability without dispatching a transaction, so a JS-side gate here
// would keep a stale decision. The widget sits at the heading's inline
// start, is `contenteditable=false`, and is excluded from copied slices.
const buildHeadingPreviewControls = (
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  getPos: () => number | undefined,
  node: ProseMirrorNode,
  onCopyHeadingLink?: (link: string) => void,
) => {
  const controls = document.createElement('span');
  controls.className = 'd-block-preview-controls d-block-preview-controls-flat';
  controls.contentEditable = 'false';
  controls.dataset.previewControls = 'true';

  const isCollapsed = Boolean(node.attrs.isCollapsed);
  controls.classList.toggle('is-collapsed', isCollapsed);

  // The widget lives at the heading's inline start, so getPos() is one past
  // the heading's own position — which is what both helpers below expect.
  const resolveHeadingPos = () => {
    const widgetPos = getPos();
    if (widgetPos == null) return null;
    const $pos = view.state.doc.resolve(widgetPos);
    return $pos.depth > 0 ? $pos.before() : widgetPos;
  };

  const makeButton = (extraClass: string, svg: string, label: string) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `d-block-button d-block-preview-button ${extraClass} color-text-default hover:color-bg-default-hover`;
    button.setAttribute('aria-label', label);
    button.innerHTML = svg;
    // Keep the click from moving the selection into the read-only surface.
    button.addEventListener('mousedown', (event) => event.preventDefault());
    return button;
  };

  const collapse = makeButton(
    '',
    CHEVRON_SVG,
    isCollapsed ? 'Expand heading' : 'Collapse heading',
  );
  collapse.dataset.test = 'preview-collapse-button';
  collapse.classList.toggle('is-collapsed', isCollapsed);
  collapse.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const position = resolveHeadingPos();
    if (position == null) return;
    const tr = buildToggleHeadingCollapseTransaction(view.state, position);
    if (tr) dispatchCollapseToggle(view, view.state.selection, tr);
  });
  controls.appendChild(collapse);

  if (onCopyHeadingLink) {
    const copyLink = makeButton(
      'd-block-preview-copy-link',
      LINK_SVG,
      'Copy heading link',
    );
    copyLink.dataset.test = 'preview-copy-link-button';
    copyLink.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const position = resolveHeadingPos();
      if (position == null) return;
      const link = getHeadingLinkSlug(node, position);
      if (link) onCopyHeadingLink(link);
    });
    controls.appendChild(copyLink);
  }

  return controls;
};

const buildHiddenDecorationSet = (
  doc: ProseMirrorNode,
  onCopyHeadingLink?: (link: string) => void,
) => {
  const decorations: Decoration[] = [];
  const headingStack: Array<{ level: number; isCollapsed: boolean }> = [];
  let collapsedHeadingDepth = 0;
  const hasDBlock = docHasDBlock(doc);

  doc.forEach((node, position) => {
    // v1 quirk preserved: non-dBlock top nodes (columns, pageBreak) are never
    // hidden. In flat v2, every top-level block participates.
    if (hasDBlock && node.type.name !== 'dBlock') {
      return;
    }

    const blockHeading = getBlockHeading(doc, node);

    if (blockHeading) {
      const level = blockHeading.attrs.level || 1;
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= level
      ) {
        const popped = headingStack.pop();
        if (popped?.isCollapsed) {
          collapsedHeadingDepth -= 1;
        }
      }
    }

    if (collapsedHeadingDepth > 0) {
      decorations.push(
        Decoration.node(position, position + node.nodeSize, {
          class: DBLOCK_HIDDEN_CLASS,
        }),
      );
    }

    if (blockHeading) {
      const isCollapsed = Boolean(blockHeading.attrs.isCollapsed);

      // Flat schema only: v1 gets these controls from its node view.
      if (!hasDBlock) {
        decorations.push(
          Decoration.widget(
            position + 1,
            (view, getPos) =>
              buildHeadingPreviewControls(
                view,
                getPos,
                blockHeading,
                onCopyHeadingLink,
              ),
            {
              side: -1,
              // Re-render only when the rendered state actually changes.
              key: `heading-preview-${isCollapsed ? 'collapsed' : 'open'}`,
              ignoreSelection: true,
            },
          ),
        );
      }

      headingStack.push({
        level: blockHeading.attrs.level || 1,
        isCollapsed,
      });
      if (isCollapsed) {
        collapsedHeadingDepth += 1;
      }
    }
  });

  return DecorationSet.create(doc, decorations);
};

const getDBlockCollapseStructureSignature = (doc: ProseMirrorNode) => {
  const parts: string[] = [];
  const hasDBlock = docHasDBlock(doc);

  doc.forEach((node) => {
    const blockHeading = getBlockHeading(doc, node);
    if (blockHeading) {
      parts.push(
        [
          'heading',
          blockHeading.attrs.id ?? '',
          blockHeading.attrs.level ?? '',
          blockHeading.attrs.isCollapsed ? '1' : '0',
        ].join(':'),
      );
      return;
    }

    if (hasDBlock && node.type.name === 'dBlock') {
      parts.push(getFirstChild(node)?.type.name ?? 'empty');
      return;
    }

    parts.push(node.type.name);
  });

  return parts.join('|');
};

const isTopLevelBoundaryPosition = (doc: ProseMirrorNode, position: number) => {
  if (position < 0 || position > doc.content.size) {
    return false;
  }

  return doc.resolve(position).depth === 0;
};

const transactionTouchesTopLevelStructure = (tr: Transaction) => {
  let touchesTopLevelStructure = false;

  tr.mapping.maps.forEach((stepMap, index) => {
    if (touchesTopLevelStructure) {
      return;
    }

    const oldDoc = tr.docs[index] ?? tr.before;
    const newDoc = tr.docs[index + 1] ?? tr.doc;

    stepMap.forEach((oldStart, oldEnd, newStart, newEnd) => {
      if (touchesTopLevelStructure) {
        return;
      }

      const deletedTopLevelContent =
        oldStart !== oldEnd &&
        (isTopLevelBoundaryPosition(oldDoc, oldStart) ||
          isTopLevelBoundaryPosition(oldDoc, oldEnd));
      const insertedTopLevelContent =
        newStart !== newEnd &&
        (isTopLevelBoundaryPosition(newDoc, newStart) ||
          isTopLevelBoundaryPosition(newDoc, newEnd));

      touchesTopLevelStructure =
        deletedTopLevelContent || insertedTopLevelContent;
    });
  });

  return touchesTopLevelStructure;
};

const buildCollapsePluginState = (
  doc: ProseMirrorNode,
  onCopyHeadingLink?: (link: string) => void,
): DBlockCollapsePluginState => ({
  decorations: buildHiddenDecorationSet(doc, onCopyHeadingLink),
  structureSignature: getDBlockCollapseStructureSignature(doc),
});

export const dBlockCollapsePluginKey = new PluginKey<DBlockCollapsePluginState>(
  'dblock-collapse',
);

// v2 registration point: v1 gets this plugin from createDBlockExtension, the
// flat schema has no dBlock extension, so the same (schema-aware) plugin is
// registered through this wrapper instead.
export interface FlatHeadingCollapseOptions {
  // Enables the copy-link button in read-only preview; omitted means the
  // host has nowhere to put the link, so the button is not rendered.
  onCopyHeadingLink?: (link: string) => void;
}

export const FlatHeadingCollapse = Extension.create<FlatHeadingCollapseOptions>({
  name: 'flatHeadingCollapse',
  addOptions() {
    return { onCopyHeadingLink: undefined };
  },
  addProseMirrorPlugins() {
    return [createDBlockCollapsePlugin(this.options.onCopyHeadingLink)];
  },
});

export const createDBlockCollapsePlugin = (
  onCopyHeadingLink?: (link: string) => void,
) =>
  new Plugin<DBlockCollapsePluginState>({
    key: dBlockCollapsePluginKey,
    state: {
      init: (_config, state) =>
        buildCollapsePluginState(state.doc, onCopyHeadingLink),
      apply: (tr, previousState) => {
        if (!tr.docChanged) {
          return {
            ...previousState,
            decorations: previousState.decorations.map(tr.mapping, tr.doc),
          };
        }

        const structureSignature = getDBlockCollapseStructureSignature(tr.doc);
        if (
          tr.getMeta(DBLOCK_COLLAPSE_META) ||
          tr.getMeta(HEADING_COLLAPSE_TOGGLE_META) ||
          structureSignature !== previousState.structureSignature ||
          transactionTouchesTopLevelStructure(tr)
        ) {
          return {
            decorations: buildHiddenDecorationSet(tr.doc, onCopyHeadingLink),
            structureSignature,
          };
        }

        return {
          structureSignature: previousState.structureSignature,
          decorations: previousState.decorations.map(tr.mapping, tr.doc),
        };
      },
    },
    props: {
      decorations: (state) =>
        dBlockCollapsePluginKey.getState(state)?.decorations ??
        DecorationSet.empty,
      handleKeyDown: (view, event) => {
        if (event.key !== 'Enter') {
          return false;
        }

        const expandResult = buildExpandCollapsedHeadingAtSelectionTransaction(
          view.state,
        );
        if (!expandResult) {
          return false;
        }

        event.preventDefault();
        view.dispatch(expandResult.transaction);
        const followUpTransaction =
          buildCollapsedHeadingEnterFollowUpTransaction(
            view.state,
            expandResult.insertPos,
          );
        view.dispatch(followUpTransaction);
        return true;
      },
    },
  });
