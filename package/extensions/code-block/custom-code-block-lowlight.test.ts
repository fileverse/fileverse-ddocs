import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import CodeBlock from '@tiptap/extension-code-block';
import { transactionCouldTouchCodeBlock } from './custom-code-block-lowlight';

describe('transactionCouldTouchCodeBlock', () => {
  const editors: Editor[] = [];

  const createEditor = (content: string) => {
    const editor = new Editor({
      content,
      extensions: [Document, Paragraph, Text, CodeBlock],
    });
    editors.push(editor);
    return editor;
  };

  afterEach(() => {
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('is false for typing in a paragraph, even with a code block elsewhere', () => {
    const editor = createEditor('<p>Paragraph</p><pre><code>code</code></pre>');
    const transaction = editor.state.tr.insertText('x', 2);
    expect(transactionCouldTouchCodeBlock(transaction, 'codeBlock')).toBe(
      false,
    );
  });

  it('is false for selection-only transactions', () => {
    const editor = createEditor('<pre><code>code</code></pre>');
    const transaction = editor.state.tr.setMeta('pointer', true);
    expect(transaction.docChanged).toBe(false);
    expect(transactionCouldTouchCodeBlock(transaction, 'codeBlock')).toBe(
      false,
    );
  });

  it('is true for typing inside a code block', () => {
    const editor = createEditor('<p>Paragraph</p><pre><code>code</code></pre>');
    // paragraph occupies 1..10 (open 0, "Paragraph" 1..10, close 11); code block opens at 12
    const transaction = editor.state.tr.insertText('x', 13);
    expect(transactionCouldTouchCodeBlock(transaction, 'codeBlock')).toBe(true);
  });

  it('is true when a change deletes across a code block', () => {
    const editor = createEditor(
      '<p>One</p><pre><code>code</code></pre><p>Two</p>',
    );
    const transaction = editor.state.tr.delete(
      2,
      editor.state.doc.content.size - 2,
    );
    expect(transactionCouldTouchCodeBlock(transaction, 'codeBlock')).toBe(true);
  });

  it('is true when a code block is inserted', () => {
    const editor = createEditor('<p>One</p>');
    const node = editor.state.schema.nodes.codeBlock.create(
      null,
      editor.state.schema.text('new'),
    );
    const transaction = editor.state.tr.insert(
      editor.state.doc.content.size,
      node,
    );
    expect(transactionCouldTouchCodeBlock(transaction, 'codeBlock')).toBe(true);
  });
});
