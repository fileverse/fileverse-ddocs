import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/react';
import {
  makeEditor,
  destroyTracked,
  track,
  pressKey,
  selectText,
  typedRun,
  storedMarkNames,
  stampOf,
  caretBlock,
} from './test-helpers';

// Probe for TIPTAP_UPGRADE.md §5.5: Tiptap 3.33.1 appends
// `tr.setStoredMarks(null)` after deleting a whole-document selection, which
// could overwrite Rule A3 (an emptied line keeps the deleted text's marks).
// It pins 3.11; a bump that changes it is decided in the spec, never by `vitest -u`.

afterEach(destroyTracked);

const STYLED =
  '<span style="color: rgb(255, 0, 0); font-family: Georgia; font-size: 24px">hello world</span>';
const PLAIN_CONTENT = `<p><strong>${STYLED}</strong></p>`;
const LINK_CONTENT = `<p><strong><a href="https://a.dev">${STYLED}</a></strong></p>`;

const mount = (schemaVersion: number, html: string) => {
  const ydoc = new Y.Doc();
  const editor = track(makeEditor(schemaVersion, html, { ydoc }));
  return { editor, ydoc };
};

/** The delete, then what the emptied line carries; types one `x`. */
const afterDelete = (editor: Editor, ydoc: Y.Doc, select: () => void) => {
  select();
  let updates = 0;
  const count = () => {
    updates += 1;
  };
  ydoc.on('update', count);
  const handled = pressKey(editor, 'Backspace');
  ydoc.off('update', count);
  return {
    handled,
    updates,
    text: editor.state.doc.textContent,
    storedMarks: storedMarkNames(editor),
    stampBeforeTyping: stampOf(caretBlock(editor).node),
    typed: typedRun(editor),
    stampAfterTyping: stampOf(caretBlock(editor).node),
  };
};

describe.each([1, 2])('select all + delete, §5.5 (schema v%i)', (version) => {
  it('control: the content carries every mark before the delete', () => {
    const { editor } = mount(version, PLAIN_CONTENT);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(typedRun(editor)).toMatchSnapshot();
  });

  it('control: selecting only the text and deleting keeps the marks (Rule A3)', () => {
    const { editor, ydoc } = mount(version, PLAIN_CONTENT);
    expect(
      afterDelete(editor, ydoc, () => selectText(editor, 'hello world')),
    ).toMatchSnapshot();
  });

  it('bold + colour + font + size, Cmd-A then Backspace', () => {
    const { editor, ydoc } = mount(version, PLAIN_CONTENT);
    expect(
      afterDelete(editor, ydoc, () => editor.commands.selectAll()),
    ).toMatchSnapshot();
  });

  it('a link in the deleted text must not carry', () => {
    const { editor, ydoc } = mount(version, LINK_CONTENT);
    const result = afterDelete(editor, ydoc, () => editor.commands.selectAll());
    expect(result.typed.names).not.toContain('link');
    expect(result).toMatchSnapshot();
  });

  it('control: a link in a text-only selection (pinned as-is)', () => {
    const { editor, ydoc } = mount(version, LINK_CONTENT);
    expect(
      afterDelete(editor, ydoc, () => selectText(editor, 'hello world')),
    ).toMatchSnapshot();
  });
});
