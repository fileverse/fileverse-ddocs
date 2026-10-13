import type { Editor } from '@tiptap/core';
import type { SuggestionBreak, SuggestionLineInsertion } from '../../types';

export function validLineInsertion(
  content: string | undefined,
  value: SuggestionLineInsertion | undefined,
): value is SuggestionLineInsertion {
  return (
    value?.version === 1 &&
    Array.isArray(value.parts) &&
    Array.isArray(value.breaks) &&
    value.parts.every((part) => typeof part === 'string') &&
    value.breaks.every((kind) =>
      ['block', 'listItem', 'listExit', 'soft', 'text'].includes(kind),
    ) &&
    value.breaks.length === value.parts.length - 1 &&
    value.parts.join('\n') === content
  );
}

/** Resolve the next key against the proposed cursor context, not just the
 * unchanged document. A list exit changes the context for later breaks. */
export function resolveSuggestionBreak(
  editor: Editor,
  position: number,
  existing: SuggestionLineInsertion | undefined,
  shift: boolean,
  context?: { from: number; to: number; insertedText: string },
): SuggestionBreak {
  const $pos = editor.state.doc.resolve(position);
  if ($pos.parent.type.name === 'codeBlock') return 'text';
  if (shift) return 'soft';

  let listDepth = 0;
  for (let depth = $pos.depth; depth >= 0; depth--) {
    if (['listItem', 'taskItem'].includes($pos.node(depth).type.name)) {
      listDepth++;
    }
  }
  for (const kind of existing?.breaks ?? []) {
    if (kind === 'listExit') listDepth = Math.max(0, listDepth - 1);
  }
  if (listDepth === 0) return 'block';

  if (!context) {
    return $pos.parent.content.size === 0 ? 'listExit' : 'listItem';
  }
  const $start = editor.state.doc.resolve(context.from);
  const $end = editor.state.doc.resolve(context.to);
  if (!$start.sameParent($end)) return 'listItem';
  const parts = existing?.parts ?? [context.insertedText];
  const breaks = existing?.breaks ?? [];
  let lastStructuralBreak = -1;
  breaks.forEach((kind, index) => {
    if (kind === 'block' || kind === 'listItem' || kind === 'listExit') {
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
  const proposed = parts.slice(lastStructuralBreak + 1).join('');
  const hasSoftBreak = breaks
    .slice(lastStructuralBreak + 1)
    .some((kind) => kind === 'soft');
  return prefix || proposed || suffix || hasSoftBreak ? 'listItem' : 'listExit';
}

export function appendSuggestionText(
  content: string,
  lineInsertion: SuggestionLineInsertion | undefined,
  text: string,
): { content: string; lineInsertion?: SuggestionLineInsertion } {
  if (!lineInsertion) return { content: content + text };
  const parts = [...lineInsertion.parts];
  parts[parts.length - 1] += text;
  return {
    content: parts.join('\n'),
    lineInsertion: { ...lineInsertion, parts },
  };
}

export function appendSuggestionBreak(
  content: string,
  lineInsertion: SuggestionLineInsertion | undefined,
  kind: SuggestionBreak,
): { content: string; lineInsertion: SuggestionLineInsertion } {
  const parts = [...(lineInsertion?.parts ?? [content]), ''];
  return {
    content: parts.join('\n'),
    lineInsertion: {
      version: 1,
      parts,
      breaks: [...(lineInsertion?.breaks ?? []), kind],
    },
  };
}

export function undoSuggestionInput(
  content: string,
  lineInsertion: SuggestionLineInsertion | undefined,
  lastInput: string,
): { content: string; lineInsertion?: SuggestionLineInsertion } {
  if (!lineInsertion) return { content: content.slice(0, -lastInput.length) };
  const parts = [...lineInsertion.parts];
  if (parts[parts.length - 1]) {
    parts[parts.length - 1] = parts[parts.length - 1].slice(
      0,
      -lastInput.length,
    );
    return {
      content: parts.join('\n'),
      lineInsertion: { ...lineInsertion, parts },
    };
  }
  parts.pop();
  const breaks = lineInsertion.breaks.slice(0, -1);
  return breaks.length
    ? {
        content: parts.join('\n'),
        lineInsertion: { ...lineInsertion, parts, breaks },
      }
    : { content: parts[0] };
}
