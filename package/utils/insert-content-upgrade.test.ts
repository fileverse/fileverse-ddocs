import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import * as Y from 'yjs';
import {
  destroyTracked,
  markNames,
  textblocks,
  track,
} from '../extensions/caret-marks/test-helpers';
import {
  applyAcceptedSuggestion,
  createCommentAnchorFromEditor,
  createCommentAnchorPointFromEditor,
} from '../extensions/comment/comment-decoration-plugin';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { useEditorCommands } from '../hooks/use-editor-commands';

// Probes for TIPTAP_UPGRADE.md §5.18 (insertContentAt, 3.22.3: no more
// `from - 1` shift for inline content at the start of a non-empty paragraph).
//
// The four real inline call sites are driven through their own code:
// applyAcceptedSuggestion (add, replace), the Emoji suggestion command and
// useEditorCommands' edit.pasteWithoutFormatting. They all insert PLAIN,
// UNMARKED text, which insertContentAt sends through tr.insertText: the
// branch 3.22.3 changed is replaceWith, so they are expected NOT to flip.
// The control probes insert marked text and an inline node (hardBreak)
// straight through insertContentAt; those reach the replaceWith branch.
// The call sites that insert blocks are out of scope.

afterEach(destroyTracked);

const FIXTURES = {
  'first paragraph': '<p>hello</p>',
  'second paragraph': '<p>one</p><p>hello</p>',
  'list item paragraph': '<ul><li><p>hello</p></li></ul>',
  'bold paragraph': '<p><strong>hello</strong></p>',
} as const;

const shapeOf = (node: ProseMirrorNode): string => {
  if (node.isText) {
    const marks = markNames(node.marks).join('+');
    return `"${node.text}"${marks ? `[${marks}]` : ''}`;
  }
  const kids: string[] = [];
  node.forEach((child) => kids.push(shapeOf(child)));
  return `${node.type.name}(${kids.join(' ')})`;
};

const setup = (version: number, html: string, prefix = '') => {
  // No `element`: with a mounted view, focus()'s scrollIntoView throws in jsdom.
  const editor = track(
    new Editor({
      extensions: getHeadlessExtensions({
        ydoc: new Y.Doc(),
        schemaVersion: version,
      }) as AnyExtension[],
      textDirection: 'auto',
    }),
  );
  editor.commands.setContent(html);
  const target = textblocks(editor).find(({ node }) =>
    node.textContent.endsWith('hello'),
  )!;
  const start = target.pos + 1;
  if (prefix) editor.view.dispatch(editor.state.tr.insertText(prefix, start));
  return { editor, start };
};

const outcome = (editor: Editor, start: number) => ({
  doc: shapeOf(editor.state.doc),
  selection: {
    from: editor.state.selection.from - start,
    to: editor.state.selection.to - start,
  },
});

const suggestion = (
  editor: Editor,
  suggestionType: 'add' | 'replace',
  from: number,
  to: number,
) => {
  const relative =
    suggestionType === 'add'
      ? createCommentAnchorPointFromEditor(editor, from)
      : createCommentAnchorFromEditor(editor, from, to);
  if (!relative) throw new Error('no anchor');
  return applyAcceptedSuggestion(editor, {
    id: 'suggestion-1',
    ...relative,
    resolved: false,
    deleted: false,
    isSuggestion: true,
    suggestionType,
    originalContent: '',
    suggestedContent: 'XY',
  });
};

const emojiCommand = (editor: Editor, range: { from: number; to: number }) => {
  const emoji = editor.extensionManager.extensions.find(
    (extension) => extension.name === 'emoji',
  )!;
  emoji.options.suggestion.command({
    editor,
    range,
    props: { emoji: '😀' },
  });
};

const pasteWithoutFormatting = async (editor: Editor, text: string) => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { readText: vi.fn().mockResolvedValue(text) },
  });
  const { result, unmount } = renderHook(() => useEditorCommands(editor));
  await act(async () => {
    await result.current['edit.pasteWithoutFormatting'].run();
  });
  unmount();
};

const body = (version: number) =>
  describe.each(Object.entries(FIXTURES))('%s', (_name, html) => {
    it("suggestion 'add' (applyAcceptedSuggestion)", () => {
      const { editor, start } = setup(version, html);
      const ok = suggestion(editor, 'add', start, start);
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it("suggestion 'replace' (applyAcceptedSuggestion)", () => {
      const { editor, start } = setup(version, html);
      const ok = suggestion(editor, 'replace', start, start + 2);
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it('emoji command at a collapsed range', () => {
      const { editor, start } = setup(version, html);
      emojiCommand(editor, { from: start, to: start });
      expect(outcome(editor, start)).toMatchSnapshot();
    });

    it('emoji command over a typed `::` range', () => {
      const { editor, start } = setup(version, html, '::');
      emojiCommand(editor, { from: start, to: start + 2 });
      expect(outcome(editor, start)).toMatchSnapshot();
    });

    it('edit.pasteWithoutFormatting over a caret', async () => {
      const { editor, start } = setup(version, html);
      editor.commands.setTextSelection(start);
      await pasteWithoutFormatting(editor, 'XY');
      expect(outcome(editor, start)).toMatchSnapshot();
    });

    it('edit.pasteWithoutFormatting over a range', async () => {
      const { editor, start } = setup(version, html);
      editor.commands.setTextSelection({ from: start, to: start + 2 });
      await pasteWithoutFormatting(editor, 'XY');
      expect(outcome(editor, start)).toMatchSnapshot();
    });

    it('control: marked text node (replaceWith branch)', () => {
      const { editor, start } = setup(version, html);
      const ok = editor.commands.insertContentAt(start, {
        type: 'text',
        text: 'XY',
        marks: [{ type: 'italic' }],
      });
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it('control: inline node, hardBreak (replaceWith branch)', () => {
      const { editor, start } = setup(version, html);
      const ok = editor.commands.insertContentAt(start, { type: 'hardBreak' });
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });
  });

describe('schema v1 (dBlock)', () => body(1));
describe('schema v2 (flat)', () => body(2));
