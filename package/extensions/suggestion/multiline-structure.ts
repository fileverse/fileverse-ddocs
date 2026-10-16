import type { Editor } from '@tiptap/core';
import type {
  SuggestionMultilineStructure,
  SuggestionStructureType,
} from '../../types';

/** The selected Enter cannot split at its start if only its end is in a list. */
export function crossesStandaloneParagraphAndListItem(
  editor: Editor,
  from: number,
  to: number,
): boolean {
  if (from >= to) return false;
  const doc = editor.state.doc;
  const $from = doc.resolve(from);
  const $to = doc.resolve(to);
  const context = ($pos: typeof $from) => {
    if ($pos.parent.type.name !== 'paragraph' || $pos.depth < 1) return null;
    const parentName = $pos.node($pos.depth - 1).type.name;
    if (parentName === 'doc' || parentName === 'dBlock') return 'standalone';
    if (parentName === 'listItem' || parentName === 'taskItem')
      return 'listItem';
    return null;
  };
  const start = context($from);
  const end = context($to);
  return (
    (start === 'standalone' && end === 'listItem') ||
    (start === 'listItem' && end === 'standalone')
  );
}

export function validMultilineStructure(
  content: string | undefined,
  value: SuggestionMultilineStructure | undefined,
): value is SuggestionMultilineStructure {
  return (
    value?.version === 1 &&
    Array.isArray(value.insertedTexts) &&
    Array.isArray(value.structureType) &&
    value.insertedTexts.every((part) => typeof part === 'string') &&
    value.structureType.every((kind) =>
      ['block', 'listItem', 'soft', 'text'].includes(kind),
    ) &&
    value.structureType.length === value.insertedTexts.length - 1 &&
    value.insertedTexts.join('\n') === content
  );
}

/** Resolve the next key against the proposed cursor context, not just the
 * unchanged document. Enter on an empty list item is blocked. */
export function resolveSuggestionStructureType(
  editor: Editor,
  position: number,
  existing: SuggestionMultilineStructure | undefined,
  shift: boolean,
  context?: { from: number; to: number; insertedText: string },
): SuggestionStructureType | null {
  const $pos = editor.state.doc.resolve(position);
  if ($pos.parent.type.name === 'codeBlock') return 'text';
  if (shift) return 'soft';

  const inList = Array.from({ length: $pos.depth + 1 }, (_, depth) =>
    $pos.node(depth),
  ).some(
    (node) => node.type.name === 'listItem' || node.type.name === 'taskItem',
  );
  if (!inList) return 'block';

  if (!context) {
    return $pos.parent.content.size === 0 ? null : 'listItem';
  }
  const $start = editor.state.doc.resolve(context.from);
  const $end = editor.state.doc.resolve(context.to);
  if (!$start.sameParent($end)) return 'listItem';
  const insertedTexts = existing?.insertedTexts ?? [context.insertedText];
  const structureTypes = existing?.structureType ?? [];
  let lastStructuralBreak = -1;
  structureTypes.forEach((kind, index) => {
    if (kind === 'block' || kind === 'listItem') {
      lastStructuralBreak = index;
    }
  });
  const prefix =
    lastStructuralBreak < 0
      ? $start.parent.textBetween(0, $start.parentOffset, '', '')
      : '';
  const suffix = $end.parent.textBetween(
    $end.parentOffset,
    $end.parent.content.size,
    '',
    '',
  );
  const proposed = insertedTexts.slice(lastStructuralBreak + 1).join('');
  const hasSoftBreak = structureTypes
    .slice(lastStructuralBreak + 1)
    .some((kind) => kind === 'soft');
  return prefix || proposed || suffix || hasSoftBreak ? 'listItem' : null;
}

export function appendSuggestionText(
  content: string,
  multilineStructure: SuggestionMultilineStructure | undefined,
  text: string,
): { content: string; multilineStructure?: SuggestionMultilineStructure } {
  if (!multilineStructure) return { content: content + text };
  const insertedTexts = [...multilineStructure.insertedTexts];
  insertedTexts[insertedTexts.length - 1] += text;
  return {
    content: insertedTexts.join('\n'),
    multilineStructure: { ...multilineStructure, insertedTexts },
  };
}

export function appendSuggestionStructureType(
  content: string,
  multilineStructure: SuggestionMultilineStructure | undefined,
  kind: SuggestionStructureType,
): { content: string; multilineStructure: SuggestionMultilineStructure } {
  const insertedTexts = [
    ...(multilineStructure?.insertedTexts ?? [content]),
    '',
  ];
  return {
    content: insertedTexts.join('\n'),
    multilineStructure: {
      version: 1,
      insertedTexts,
      structureType: [...(multilineStructure?.structureType ?? []), kind],
    },
  };
}

export function undoSuggestionInput(
  content: string,
  multilineStructure: SuggestionMultilineStructure | undefined,
  lastInput: string,
): { content: string; multilineStructure?: SuggestionMultilineStructure } {
  if (!multilineStructure)
    return { content: content.slice(0, -lastInput.length) };
  const insertedTexts = [...multilineStructure.insertedTexts];
  if (insertedTexts[insertedTexts.length - 1]) {
    insertedTexts[insertedTexts.length - 1] = insertedTexts[
      insertedTexts.length - 1
    ].slice(0, -lastInput.length);
    return {
      content: insertedTexts.join('\n'),
      multilineStructure: { ...multilineStructure, insertedTexts },
    };
  }
  insertedTexts.pop();
  const structureTypes = multilineStructure.structureType.slice(0, -1);
  return structureTypes.length
    ? {
        content: insertedTexts.join('\n'),
        multilineStructure: {
          ...multilineStructure,
          insertedTexts,
          structureType: structureTypes,
        },
      }
    : { content: insertedTexts[0] };
}
