import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';

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
