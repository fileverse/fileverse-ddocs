import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ParagraphSpacing } from './paragraph-spacing';

// A minimal schema-only editor: this exercises the extension itself, not its
// registration in default-extension.ts (covered by default-extension.test.ts).
const makeEditor = (content: string) => {
  const editor = new Editor({
    // trailingNode would append a stray <p> after a trailing heading and make
    // the getHTML() assertions harder to read; it is not under test here.
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      ParagraphSpacing,
    ] as AnyExtension[],
    content,
  });
  return editor;
};

describe('paragraphSpacing', () => {
  const editors: Editor[] = [];
  const track = (editor: Editor) => {
    editors.push(editor);
    return editor;
  };

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('renders no margin style on an untouched block', () => {
    const editor = track(makeEditor('<p>one</p>'));

    expect(editor.getHTML()).toBe('<p>one</p>');
  });

  it('sets space before on the block under a collapsed cursor', () => {
    const editor = track(makeEditor('<p>one</p>'));
    editor.commands.setTextSelection(2);

    editor.commands.setParagraphSpacing({ spaceBefore: 12 });

    expect(editor.getHTML()).toBe('<p style="margin-top: 12pt;">one</p>');
  });

  it('renders both margins when both are set', () => {
    const editor = track(makeEditor('<p>one</p>'));
    editor.commands.setTextSelection(2);

    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });

    expect(editor.getHTML()).toBe(
      '<p style="margin-top: 12pt; margin-bottom: 8pt;">one</p>',
    );
  });

  it('treats 0 as an explicit value, not as unset', () => {
    const editor = track(makeEditor('<p>one</p>'));
    editor.commands.setTextSelection(2);

    editor.commands.setParagraphSpacing({ spaceBefore: 0 });

    expect(editor.getHTML()).toBe('<p style="margin-top: 0pt;">one</p>');
  });

  it('applies to headings as well as paragraphs', () => {
    const editor = track(makeEditor('<h2>one</h2>'));
    editor.commands.setTextSelection(2);

    editor.commands.setParagraphSpacing({ spaceBefore: 24 });

    expect(editor.getHTML()).toBe('<h2 style="margin-top: 24pt;">one</h2>');
  });

  it('applies to every block in a selection', () => {
    const editor = track(makeEditor('<p>one</p><p>two</p>'));
    editor.commands.selectAll();

    editor.commands.setParagraphSpacing({ spaceAfter: 6 });

    expect(editor.getHTML()).toBe(
      '<p style="margin-bottom: 6pt;">one</p>' +
        '<p style="margin-bottom: 6pt;">two</p>',
    );
  });

  it('leaves blocks outside the selection untouched', () => {
    const editor = track(makeEditor('<p>one</p><p>two</p>'));
    // inside the first paragraph only
    editor.commands.setTextSelection({ from: 1, to: 4 });

    editor.commands.setParagraphSpacing({ spaceBefore: 12 });

    expect(editor.getHTML()).toBe(
      '<p style="margin-top: 12pt;">one</p><p>two</p>',
    );
  });

  it('spaces the list item itself, not the paragraph inside it', () => {
    const editor = track(makeEditor('<ul><li><p>one</p></li></ul>'));
    editor.commands.setTextSelection(4);

    editor.commands.setParagraphSpacing({ spaceBefore: 12 });

    expect(editor.getHTML()).toBe(
      '<ul><li style="margin-top: 12pt;"><p>one</p></li></ul>',
    );
  });

  // nodesBetween reports every ancestor spanning the selection. A list item
  // wraps its sublist, so a cursor in a sub-bullet reports the parent item too
  // — and one "add space" used to put the gap on every bullet up the chain.
  it('spaces only the sub-bullet the cursor is in, not its parent item', () => {
    const editor = track(
      makeEditor(
        '<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>',
      ),
    );
    editor.commands.setTextSelection(13); // inside "inner"

    editor.commands.setParagraphSpacing({ spaceAfter: 12 });

    expect(editor.getHTML()).toBe(
      '<ul><li><p>outer</p><ul><li style="margin-bottom: 12pt;">' +
        '<p>inner</p></li></ul></li></ul>',
    );
  });

  // The parent is skipped for being a mere container, not for being a parent:
  // once the selection reaches its own paragraph, it is a target again.
  it('spaces both items when the selection covers both levels', () => {
    const editor = track(
      makeEditor(
        '<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>',
      ),
    );
    editor.commands.selectAll();

    editor.commands.setParagraphSpacing({ spaceAfter: 12 });

    expect(editor.getHTML()).toBe(
      '<ul><li style="margin-bottom: 12pt;"><p>outer</p>' +
        '<ul><li style="margin-bottom: 12pt;"><p>inner</p></li></ul></li></ul>',
    );
  });

  it('leaves the other attribute alone when only one key is passed', () => {
    const editor = track(makeEditor('<p>one</p>'));
    editor.commands.setTextSelection(2);

    editor.commands.setParagraphSpacing({ spaceBefore: 12 });
    editor.commands.setParagraphSpacing({ spaceAfter: 8 });

    expect(editor.getHTML()).toBe(
      '<p style="margin-top: 12pt; margin-bottom: 8pt;">one</p>',
    );
  });

  it('unsets an attribute when it is passed as null', () => {
    const editor = track(makeEditor('<p>one</p>'));
    editor.commands.setTextSelection(2);
    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });

    editor.commands.setParagraphSpacing({ spaceBefore: null });

    expect(editor.getHTML()).toBe('<p style="margin-bottom: 8pt;">one</p>');
  });

  it('clears both attributes with unsetParagraphSpacing', () => {
    const editor = track(makeEditor('<p>one</p>'));
    editor.commands.setTextSelection(2);
    editor.commands.setParagraphSpacing({ spaceBefore: 12, spaceAfter: 8 });

    editor.commands.unsetParagraphSpacing();

    expect(editor.getHTML()).toBe('<p>one</p>');
  });

  it('parses pt margins back out of HTML', () => {
    const editor = track(
      makeEditor('<p style="margin-top: 12pt; margin-bottom: 8pt;">one</p>'),
    );

    const paragraph = editor.state.doc.firstChild;
    expect(paragraph?.attrs.spaceBefore).toBe(12);
    expect(paragraph?.attrs.spaceAfter).toBe(8);
  });
});

describe('paragraphSpacing value handling', () => {
  const editors: Editor[] = [];
  const track = (editor: Editor) => {
    editors.push(editor);
    return editor;
  };

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  const attrsOf = (editor: Editor) => editor.state.doc.firstChild?.attrs;

  const withSpacing = (style: string) => {
    const editor = track(makeEditor(`<p style="${style}">one</p>`));
    return attrsOf(editor);
  };

  it('parses 0pt back as 0, not as unset', () => {
    expect(withSpacing('margin-top: 0pt')?.spaceBefore).toBe(0);
  });

  it('ignores units it does not store', () => {
    expect(withSpacing('margin-top: 16px')?.spaceBefore).toBeNull();
    expect(withSpacing('margin-top: 2em')?.spaceBefore).toBeNull();
  });

  it('ignores a value it cannot parse', () => {
    expect(withSpacing('margin-top: inherit')?.spaceBefore).toBeNull();
  });

  it('keeps a fractional pt value from a foreign document', () => {
    expect(withSpacing('margin-top: 12.5pt')?.spaceBefore).toBe(12.5);
  });

  it('renders and re-parses the same number', () => {
    const first = track(makeEditor('<p>one</p>'));
    first.commands.setTextSelection(2);
    first.commands.setParagraphSpacing({ spaceBefore: 7, spaceAfter: 0 });

    const second = track(makeEditor(first.getHTML()));

    expect(attrsOf(second)).toMatchObject({ spaceBefore: 7, spaceAfter: 0 });
  });

  it('leaves blocks alone when the selection contains none of its types', () => {
    const editor = track(makeEditor('<hr><p>one</p>'));
    editor.commands.setTextSelection(1);

    expect(() =>
      editor.commands.setParagraphSpacing({ spaceBefore: 12 }),
    ).not.toThrow();
  });
});
