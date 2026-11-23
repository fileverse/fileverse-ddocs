import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import * as Y from 'yjs';
import {
  destroyTracked,
  makeEditor,
  markNames,
  textblocks,
  track,
} from '../extensions/caret-marks/test-helpers';

// Probes for TIPTAP_UPGRADE.md §5.18 (insertContentAt, 3.22.3: no more
// `from - 1` shift for inline content at the start of a non-empty paragraph).
//
// Call sites that insert INLINE content (grep "insertContentAt", non-test):
//   comment-decoration-plugin.ts  suggestion 'add'     text node at `from`
//   comment-decoration-plugin.ts  suggestion 'replace' deleteRange then text node
//   emoji.tsx                     suggestion command   string `${emoji} ` over `range`
//   use-editor-commands.ts        pasteWithoutFormatting text node over the selection
// The others insert blocks (dBlock/paragraph/page break/mediaCaption/template/
// duplicate) and are out of this probe. Their `.focus()` is left out: jsdom
// cannot run it, and it only restores the caret.

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
  const editor = track(makeEditor(version, html, { ydoc: new Y.Doc() }));
  const target = textblocks(editor).find(({ node }) =>
    node.textContent.endsWith('hello'),
  )!;
  const start = target.pos + 1;
  if (prefix)
    editor.commands.insertContentAt(start, { type: 'text', text: prefix });
  return { editor, start };
};

const outcome = (editor: Editor, start: number) => ({
  doc: shapeOf(editor.state.doc),
  selection: {
    from: editor.state.selection.from - start,
    to: editor.state.selection.to - start,
  },
});

const body = (version: number) =>
  describe.each(Object.entries(FIXTURES))('%s', (_name, html) => {
    it("suggestion 'add': text node at the start", () => {
      const { editor, start } = setup(version, html);
      const ok = editor.commands.insertContentAt(start, {
        type: 'text',
        text: 'XY',
      });
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it("suggestion 'replace': deleteRange then text node", () => {
      const { editor, start } = setup(version, html);
      const ok = editor
        .chain()
        .deleteRange({ from: start, to: start + 2 })
        .insertContentAt(start, { type: 'text', text: 'XY' })
        .run();
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it('emoji: string at a collapsed range', () => {
      const { editor, start } = setup(version, html);
      const ok = editor.commands.insertContentAt(
        { from: start, to: start },
        '😀 ',
      );
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it('emoji: string over a typed `::` range', () => {
      const { editor, start } = setup(version, html, '::');
      const ok = editor.commands.insertContentAt(
        { from: start, to: start + 2 },
        '😀 ',
      );
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it('paste without formatting: text node over a caret', () => {
      const { editor, start } = setup(version, html);
      editor.commands.setTextSelection(start);
      const ok = editor.commands.insertContentAt(editor.state.selection, {
        type: 'text',
        text: 'XY',
      });
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });

    it('paste without formatting: text node over a range', () => {
      const { editor, start } = setup(version, html);
      editor.commands.setTextSelection({ from: start, to: start + 2 });
      const ok = editor.commands.insertContentAt(editor.state.selection, {
        type: 'text',
        text: 'XY',
      });
      expect({ ok, ...outcome(editor, start) }).toMatchSnapshot();
    });
  });

describe('schema v1 (dBlock)', () => body(1));
describe('schema v2 (flat)', () => body(2));
