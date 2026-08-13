import type { JSONContent } from '@tiptap/core';
import type { Schema } from '@tiptap/pm/model';

// v1 wraps every top-level block in a dBlock; the flat v2 schema does not.
// Detecting from the live schema keeps call sites version-agnostic.
export const schemaHasDBlock = (schema: Schema): boolean =>
  Boolean(schema.nodes.dBlock);

// Returns content shaped for insertion at the top level of the doc:
// dBlock-wrapped under v1, the bare block under v2.
export const wrapBlockNode = (
  schema: Schema,
  content: JSONContent,
): JSONContent =>
  schemaHasDBlock(schema) ? { type: 'dBlock', content: [content] } : content;

// Recursively removes dBlock wrappers from v1-shaped JSON (templates,
// persisted legacy JSON) so it can load into a flat v2 doc. The v1 JSON
// sources stay untouched as the single source of truth; this transform is
// the only supported path, never hand-rewritten copies.
export const unwrapDBlocksInJSON = (node: JSONContent): JSONContent => {
  if (node.type === 'dBlock') {
    // dBlock wraps exactly one (block|columns); hoist it. An empty wrapper
    // degrades to an empty paragraph.
    const child = node.content?.[0];
    return child ? unwrapDBlocksInJSON(child) : { type: 'paragraph' };
  }
  if (!node.content) {
    return node;
  }
  return { ...node, content: node.content.map(unwrapDBlocksInJSON) };
};
