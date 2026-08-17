import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LineHeight } from '../extensions/line-height';
import { ParagraphSpacing } from '../extensions/paragraph-spacing';
import { readSpacingSelection } from './typography';

const makeEditor = (content: string) =>
  new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      LineHeight,
      ParagraphSpacing,
    ] as AnyExtension[],
    content,
  });

describe('readSpacingSelection', () => {
  const editors: Editor[] = [];
  const track = (editor: Editor) => {
    editors.push(editor);
    return editor;
  };

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('reports null for a block with no spacing set', () => {
    const editor = track(makeEditor('<p>one</p>'));
    editor.commands.setTextSelection(2);

    expect(readSpacingSelection(editor)).toEqual({
      spaceBefore: null,
      spaceAfter: null,
      lineHeight: '138%',
    });
  });

  it('reports the shared value when every block agrees', () => {
    const editor = track(
      makeEditor(
        '<p style="margin-top: 12pt">one</p>' +
          '<p style="margin-top: 12pt">two</p>',
      ),
    );
    editor.commands.selectAll();

    expect(readSpacingSelection(editor).spaceBefore).toBe(12);
  });

  it('reports mixed when blocks disagree', () => {
    const editor = track(
      makeEditor(
        '<p style="margin-top: 12pt">one</p>' +
          '<p style="margin-top: 4pt">two</p>',
      ),
    );
    editor.commands.selectAll();

    expect(readSpacingSelection(editor).spaceBefore).toBe('mixed');
  });

  it('treats an unset block against a set one as mixed', () => {
    const editor = track(
      makeEditor('<p style="margin-top: 12pt">one</p><p>two</p>'),
    );
    editor.commands.selectAll();

    expect(readSpacingSelection(editor).spaceBefore).toBe('mixed');
  });

  // Same rule the command applies: the list item owns the spacing, so the
  // paragraph inside it must not drag the reading to "mixed".
  it('ignores the paragraph nested inside a list item', () => {
    const editor = track(makeEditor('<ul><li><p>one</p></li></ul>'));
    editor.commands.selectAll();
    editor.commands.setParagraphSpacing({ spaceBefore: 12 });

    expect(readSpacingSelection(editor).spaceBefore).toBe(12);
  });

  it('reports mixed line heights', () => {
    const editor = track(makeEditor('<p>one</p><p>two</p>'));
    editor.commands.setTextSelection(2);
    editor.commands.setLineHeight('240%');
    editor.commands.selectAll();

    expect(readSpacingSelection(editor).lineHeight).toBe('mixed');
  });
});
