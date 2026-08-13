/* eslint-disable @typescript-eslint/no-explicit-any */

import { JSONContent } from '@tiptap/core';

/**
 * Extract title from document content (JSON structure from editor)
 * Looks for H1 headings first, then any text content
 */
// v1 wraps every top-level block in a dBlock whose single child is the real
// node; the flat v2 schema puts that node at the top level. Yield the real
// node(s) either way, so the same walk serves both shapes.
const realBlocks = (block: JSONContent): JSONContent[] =>
  block?.type === 'dBlock' && Array.isArray(block.content)
    ? block.content
    : [block];

const joinTextPieces = (node: JSONContent | undefined): string => {
  if (!node?.content || !Array.isArray(node.content)) {
    return '';
  }
  return node.content
    .filter((piece: any) => piece.type === 'text')
    .map((piece: any) => piece.text)
    .filter(Boolean)
    .join('')
    .trim();
};

export const extractTitleFromContent = (changes: {
  content: JSONContent;
}): string | null => {
  try {
    if (!changes || !Array.isArray(changes.content)) {
      return null;
    }

    let firstNonEmptyLine = '';

    // First try to find H1 headings
    for (const block of changes.content) {
      for (const node of realBlocks(block)) {
        if (node?.type === 'heading' && node?.attrs?.level === 1) {
          // Headings can hold several text nodes when marks split them.
          firstNonEmptyLine = joinTextPieces(node);
          if (firstNonEmptyLine) break;
        }
      }
      if (firstNonEmptyLine) break;
    }

    // If no H1 found, look for any text content
    if (!firstNonEmptyLine) {
      for (const block of changes.content) {
        for (const node of realBlocks(block)) {
          firstNonEmptyLine = joinTextPieces(node);
          if (firstNonEmptyLine) break;
        }
        if (firstNonEmptyLine) break;
      }
    }

    if (firstNonEmptyLine) {
      // Truncate to 50 characters to prevent overly long titles
      return firstNonEmptyLine.slice(0, 50);
    }

    return null;
  } catch (error) {
    console.error('Error extracting title from content:', error);
    return null;
  }
};
