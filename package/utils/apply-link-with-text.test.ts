import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from './make-editor';
import { applyLinkWithText } from './apply-link-with-text';

const HREF = 'https://example.com';

// Selects `text` within the first textblock, across runs.
const selectText = (editor: Editor, text: string) => {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from >= 0 || !node.isTextblock) return from < 0;
    from = pos + 1 + node.textContent.indexOf(text);
    return false;
  });
  editor.commands.setTextSelection({ from, to: from + text.length });
};

const runs = (editor: Editor) => {
  const out: { text: string; marks: Record<string, unknown> }[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const marks: Record<string, unknown> = {};
    node.marks.forEach((mark) => {
      marks[mark.type.name] =
        mark.type.name === 'link' ? mark.attrs.href : mark.attrs;
    });
    out.push({ text: node.text!, marks });
  });
  return out;
};

describe('applyLinkWithText', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('keeps every run formatted as before when only the URL is set', () => {
    editor = makeEditor(
      '<p>a <span style="font-size: 24px">big <strong>bold</strong></span> b</p>',
    );
    selectText(editor, 'big bold');
    applyLinkWithText(editor, 'big bold', HREF);
    const linked = runs(editor).filter((run) => run.marks.link === HREF);
    expect(linked.map((run) => run.text)).toEqual(['big ', 'bold']);
    linked.forEach((run) =>
      expect(run.marks.textStyle).toMatchObject({ fontSize: '24px' }),
    );
    expect(linked[1].marks.bold).toBeDefined();
  });

  it('keeps the replaced text formatting when the link text changes', () => {
    editor = makeEditor(
      '<p>a <span style="font-size: 24px; color: rgb(255, 0, 0)">big</span> b</p>',
    );
    selectText(editor, 'big');
    applyLinkWithText(editor, 'huge', HREF);
    const linked = runs(editor).find((run) => run.text === 'huge');
    expect(linked?.marks.link).toBe(HREF);
    expect(linked?.marks.textStyle).toMatchObject({
      fontSize: '24px',
      color: null,
    });
    expect(editor.state.selection.empty).toBe(true);
  });

  it('inserts link text at the caret with the caret formatting', () => {
    editor = makeEditor('<p><span style="font-size: 24px">big</span></p>');
    selectText(editor, 'big');
    editor.commands.setTextSelection(editor.state.selection.to);
    applyLinkWithText(editor, ' site', HREF);
    const linked = runs(editor).find((run) => run.text === ' site');
    expect(linked?.marks.link).toBe(HREF);
    expect(linked?.marks.textStyle).toMatchObject({ fontSize: '24px' });
  });

  it('removes the link when the URL is cleared', () => {
    editor = makeEditor(
      `<p><a href="${HREF}"><span style="font-size: 24px">big</span></a></p>`,
    );
    selectText(editor, 'big');
    applyLinkWithText(editor, 'big', '');
    const [run] = runs(editor);
    expect(run.marks.link).toBeUndefined();
    expect(run.marks.textStyle).toMatchObject({ fontSize: '24px' });
  });
});
