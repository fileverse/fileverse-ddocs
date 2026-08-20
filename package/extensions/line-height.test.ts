import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LineHeight } from './line-height';

const makeEditor = (content: string) =>
  new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      LineHeight,
    ] as AnyExtension[],
    content,
  });

const lineHeights = (editor: Editor) => {
  const values: unknown[] = [];
  editor.state.doc.forEach((node) => values.push(node.attrs.lineHeight));
  return values;
};

describe('lineHeight scope', () => {
  const editors: Editor[] = [];
  const track = (editor: Editor) => {
    editors.push(editor);
    return editor;
  };

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  // "Custom spacing" now lives in the same dropdown as these presets and is
  // selection-scoped. A collapsed cursor restyling the whole document from one
  // half of that menu and one block from the other is indefensible, so the
  // presets follow the selection too. Whole-document is Cmd+A.
  it('applies to the current block only when the cursor is collapsed', () => {
    const editor = track(makeEditor('<p>one</p><p>two</p>'));
    editor.commands.setTextSelection(2);

    editor.commands.setLineHeight('240%');

    expect(lineHeights(editor)).toEqual(['240%', '138%']);
  });

  it('applies to every block in a selection', () => {
    const editor = track(makeEditor('<p>one</p><p>two</p>'));
    editor.commands.selectAll();

    editor.commands.setLineHeight('240%');

    expect(lineHeights(editor)).toEqual(['240%', '240%']);
  });

  it('unsets the current block only when the cursor is collapsed', () => {
    const editor = track(makeEditor('<p>one</p><p>two</p>'));
    editor.commands.selectAll();
    editor.commands.setLineHeight('240%');
    editor.commands.setTextSelection(2);

    editor.commands.unsetLineHeight();

    expect(lineHeights(editor)).toEqual(['138%', '240%']);
  });
});

// Google Docs pastes `line-height:1.38` — a unitless CSS ratio, not a
// percentage. Storing it verbatim gave the attribute two possible meanings,
// and every helper that converts it assumes percentages.
describe('lineHeight parsing', () => {
  const parse = (style: string) => {
    const editor = new Editor({
      extensions: [
        StarterKit.configure({ trailingNode: false }),
        LineHeight,
      ] as AnyExtension[],
      content: `<p style="${style}">x</p>`,
    });
    const value = editor.state.doc.firstChild?.attrs.lineHeight;
    editor.destroy();
    return value;
  };

  it('normalises a unitless ratio to our percentage representation', () => {
    expect(parse('line-height: 1.38')).toBe('138%');
  });

  it('leaves an existing percentage alone', () => {
    expect(parse('line-height: 240%')).toBe('240%');
  });

  it('leaves units it cannot express as a ratio alone', () => {
    expect(parse('line-height: 20px')).toBe('20px');
  });
});
