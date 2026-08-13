import { Plugin, PluginKey } from 'prosemirror-state';
import { Fragment, Slice, Node as PMNode } from '@tiptap/pm/model';

/**
 * Rewraps pasted top-level bare blocks in dBlocks (v1 schema only).
 *
 * Slices copied from a flat v2 doc (or parsed from external HTML) carry
 * bare blocks at the top level: `<heading, paragraph, ...>` with
 * openStart/openEnd 1. The v1 doc only accepts `(dBlock|columns|pageBreak)+`
 * and dBlock holds exactly one `(block|columns)`, so prosemirror's
 * `replaceRange` finds no legal placement for a closed bare heading:
 * `doc.canReplaceWith(..., heading)` fails (no wrapping is considered) and
 * `dBlock.canReplaceWith(0, 0, heading)` fails (the wrapper already holds
 * the target paragraph and its content expression allows only one child).
 * The fitter then falls back to leaving the heading open and merging its
 * inline content into the destination paragraph — the heading silently
 * demotes to plain text. v1-native copies never hit this because their
 * slices carry the dBlock wrappers, which fit at doc level as closed nodes.
 *
 * The fix: make foreign slices look exactly like v1-native ones before
 * fitting — wrap every doc-illegal top-level block in a dBlock and grow the
 * open depths across the added wrapper. PM's own defining-node machinery
 * (heading has `defining: true`) then preserves headings, while partial
 * inline pastes still merge into the caret block exactly as before.
 */
export const createDBlockPasteNormalizerPlugin = () =>
  new Plugin({
    key: new PluginKey('dblock-paste-normalizer'),
    props: {
      transformPasted: (slice, view) => {
        const schema = view.state.schema;
        const dBlock = schema.nodes.dBlock;
        if (!dBlock) return slice;

        const docType = view.state.doc.type;
        const total = slice.content.childCount;
        if (total === 0) return slice;

        // An inline child at the top level means this is an inline paste
        // (text fragments); those must keep merging into the caret block.
        let hasInline = false;
        slice.content.forEach((child) => {
          if (child.isInline) hasInline = true;
        });
        if (hasInline) return slice;

        let wrappedFirst = false;
        let wrappedLast = false;
        let changed = false;
        const children: PMNode[] = [];
        slice.content.forEach((child, _offset, index) => {
          // Blocks the doc accepts directly (dBlock, columns, pageBreak)
          // are already v1-shaped; leave them alone.
          if (docType.contentMatch.matchType(child.type)) {
            children.push(child);
            return;
          }
          children.push(dBlock.create(null, child));
          changed = true;
          if (index === 0) wrappedFirst = true;
          if (index === total - 1) wrappedLast = true;
        });

        if (!changed) return slice;
        return new Slice(
          Fragment.fromArray(children),
          // An open edge that gained a wrapper is now one level deeper;
          // closed edges (openStart/openEnd 0) stay closed.
          slice.openStart > 0 && wrappedFirst
            ? slice.openStart + 1
            : slice.openStart,
          slice.openEnd > 0 && wrappedLast ? slice.openEnd + 1 : slice.openEnd,
        );
      },
    },
  });
