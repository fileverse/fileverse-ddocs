// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Editor, Node } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { AiWriterSpaceTrigger } from './ai-writer-space-trigger';

// A minimal stand-in for the aiWriter node: same name, group, and atom
// shape, no React node view so the editor can run headless.
const AiWriterStub = Node.create({
  name: 'aiWriter',
  group: 'block',
  atom: true,
  addAttributes() {
    return {
      prompt: { default: '' },
      content: { default: '' },
      tone: { default: 'neutral' },
    };
  },
  renderHTML() {
    return ['div', { 'data-type': 'ai-writer-stub' }];
  },
});

const FlatDoc = Document.extend({ content: 'block+' });

const buildEditor = (withAiWriter: boolean, content: string) =>
  new Editor({
    extensions: [
      FlatDoc,
      Paragraph,
      Text,
      ...(withAiWriter ? [AiWriterStub] : []),
      AiWriterSpaceTrigger,
    ],
    content,
  });

// Drives the plugin the way ProseMirror would on a real keystroke.
const typeSpace = (editor: Editor) => {
  const { from, to } = editor.state.selection;
  return Boolean(
    editor.view.someProp('handleTextInput', (handler) =>
      handler(editor.view, from, to, ' '),
    ),
  );
};

const docTypes = (editor: Editor) =>
  (editor.getJSON().content || []).map((node) => node.type);

describe('AiWriterSpaceTrigger', () => {
  it('replaces an empty top-level paragraph with the aiWriter node', () => {
    const editor = buildEditor(true, '<p></p>');
    editor.commands.focus('start');
    expect(typeSpace(editor)).toBe(true);
    expect(docTypes(editor)).toContain('aiWriter');
    editor.destroy();
  });

  it('does nothing in a paragraph that has content', () => {
    const editor = buildEditor(true, '<p>hello</p>');
    editor.commands.focus('end');
    expect(typeSpace(editor)).toBe(false);
    expect(docTypes(editor)).not.toContain('aiWriter');
    editor.destroy();
  });

  it('does not open a second writer while one is active', () => {
    const editor = buildEditor(true, '<p></p><p></p>');
    editor.commands.focus('start');
    expect(typeSpace(editor)).toBe(true);
    editor.commands.focus('end');
    expect(typeSpace(editor)).toBe(false);
    expect(docTypes(editor).filter((type) => type === 'aiWriter')).toHaveLength(
      1,
    );
    editor.destroy();
  });

  it('self-disables when aiWriter is not in the schema', () => {
    const editor = buildEditor(false, '<p></p>');
    editor.commands.focus('start');
    expect(typeSpace(editor)).toBe(false);
    editor.destroy();
  });
});
