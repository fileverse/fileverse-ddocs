import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { Editor, EditorContent, type JSONContent } from '@tiptap/react';
import { AllSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { unwrapDBlocksInJSON } from '../utils/block-schema';
import { EditingProvider } from '../hooks/use-editing-context';
import { AIWriter } from './ai-writer';

// A selection covering a media, embed, AI writer or table cell node view
// selects it (ProseMirror-selectednode, `selected`), as on Tiptap 3.11; 3.31+
// does that only for a NodeSelection.

const p = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const block = (node: JSONContent) => ({ type: 'dBlock', content: [node] });
const v1Doc: JSONContent = {
  type: 'doc',
  content: [
    block(p('before')),
    block({
      type: 'resizableMedia',
      attrs: { src: 'https://example.com/a.png', 'media-type': 'img' },
    }),
    block({ type: 'iframe', attrs: { src: 'https://example.com/embed' } }),
    block({ type: 'aiWriter', attrs: { prompt: '', content: '' } }),
    block({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [{ type: 'tableCell', content: [p('cell')] }],
        },
      ],
    }),
    block(p('after')),
  ],
};

const VIEWS = ['.node-resizableMedia', '.node-iframe', '.node-aiWriter', 'td'];

let editor: Editor | null = null;
afterEach(() => {
  cleanup();
  editor?.destroy();
  editor = null;
});

const mount = async (version: number) => {
  editor = new Editor({
    extensions: [
      ...getHeadlessExtensions({ schemaVersion: version }),
      AIWriter,
    ],
    textDirection: 'auto',
  });
  editor.commands.setContent(
    version === 1 ? v1Doc : unwrapDBlocksInJSON(v1Doc),
  );
  const { container } = render(
    <EditingProvider isPreviewMode={false} isSuggestionMode={false}>
      <EditorContent editor={editor} />
    </EditingProvider>,
  );
  await waitFor(() =>
    VIEWS.forEach((selector) =>
      expect(container.querySelector(selector)).toBeTruthy(),
    ),
  );
  return { editor, container };
};

const selected = (container: HTMLElement) =>
  VIEWS.map((selector) => {
    const el = container.querySelector(selector)!;
    return (
      el.classList.contains('ProseMirror-selectednode') ||
      !!el.querySelector('.ProseMirror-selectednode')
    );
  });

const select = async (editor: Editor, make: (editor: Editor) => Selection) => {
  await act(async () => {
    editor.view.dispatch(editor.state.tr.setSelection(make(editor)));
  });
};

describe.each([1, 2])(
  'selection covering a node view (schema v%i)',
  (version) => {
    it.each([
      ['select all', (e: Editor) => new AllSelection(e.state.doc)],
      [
        'a text selection from the first to the last line',
        (e: Editor) =>
          TextSelection.create(
            e.state.doc,
            Selection.atStart(e.state.doc).from,
            Selection.atEnd(e.state.doc).to,
          ),
      ],
    ])('%s selects every node view it covers', async (_name, make) => {
      const { editor, container } = await mount(version);
      expect(selected(container)).toEqual([false, false, false, false]);
      await select(editor, make);
      expect(selected(container)).toEqual([true, true, true, true]);
      await select(editor, (e) => Selection.atStart(e.state.doc));
      expect(selected(container)).toEqual([false, false, false, false]);
    });
  },
);
