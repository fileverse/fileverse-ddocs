import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';
import { autoLinkCandidate } from '.';

const textStyleOf = (editor: Editor, text: string) => {
  let attrs: Record<string, unknown> | undefined;
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text === text) {
      attrs = node.marks.find((m) => m.type.name === 'textStyle')?.attrs;
    }
  });
  return attrs;
};

describe('CustomLink setLink', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('drops the text colour so the link shows the link colour, keeping size', () => {
    editor = makeEditor(
      '<p>a <span style="font-size: 24px; color: rgb(255, 0, 0)">big</span> b</p>',
    );
    editor.commands.setTextSelection({ from: 4, to: 7 });
    editor.chain().setLink({ href: 'https://example.com' }).run();
    expect(editor.isActive('link')).toBe(true);
    expect(textStyleOf(editor, 'big')).toMatchObject({
      fontSize: '24px',
      color: null,
    });
  });

  it('leaves text outside the link coloured', () => {
    editor = makeEditor(
      '<p><span style="color: rgb(255, 0, 0)">red text</span></p>',
    );
    editor.commands.setTextSelection({ from: 2, to: 5 });
    editor.chain().setLink({ href: 'https://example.com' }).run();
    expect(textStyleOf(editor, 'red')).toBeUndefined();
    expect(textStyleOf(editor, ' text')).toMatchObject({
      color: 'rgb(255, 0, 0)',
    });
  });

  it('can be recoloured after linking', () => {
    editor = makeEditor('<p>link</p>');
    editor.commands.setTextSelection({ from: 2, to: 6 });
    editor.chain().setLink({ href: 'https://example.com' }).run();
    editor.chain().setColor('rgb(0, 0, 255)').run();
    expect(textStyleOf(editor, 'link')).toMatchObject({
      color: 'rgb(0, 0, 255)',
    });
  });
});

describe('CustomLink paste over a selection', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).ClipboardEvent ??= Event;
  });

  const pasteOverWords = (text: string) => {
    editor = makeEditor('<p>some words</p>');
    editor.commands.setTextSelection({ from: 6, to: 11 });
    editor.view.pasteText(text);
    const hrefs: string[] = [];
    editor.state.doc.descendants((node) =>
      node.marks.forEach((mark) => {
        if (mark.type.name === 'link') hrefs.push(mark.attrs.href);
      }),
    );
    return hrefs;
  };

  it('links a bare domain with the default protocol, as Tiptap 3.11 did', () => {
    expect(pasteOverWords('example.com/path')).toEqual([
      'http://example.com/path',
    ]);
  });

  it('does not link an email or a non-http URL', () => {
    expect(pasteOverWords('a@b.com')).toEqual([]);
    editor.destroy();
    expect(pasteOverWords('ftp://x.com')).toEqual([]);
  });

  it('leaves autolink checks outside a paste unchanged', () => {
    expect(autoLinkCandidate('example.com')).toBe('example.com');
  });
});
