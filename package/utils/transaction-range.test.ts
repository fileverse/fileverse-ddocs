import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';
import Text from '@tiptap/extension-text';
import CodeBlock from '@tiptap/extension-code-block';
import {
  transactionContainedNodeTypes,
  transactionTouchedNodeTypes,
  transactionTouchesNodeType,
} from './transaction-range';

describe('transactionTouchesNodeType', () => {
  const editors: Editor[] = [];

  const createEditor = (content: string) => {
    const editor = new Editor({
      content,
      extensions: [Document, Paragraph, Heading, Text, CodeBlock],
    });
    editors.push(editor);
    return editor;
  };

  afterEach(() => {
    vi.restoreAllMocks();
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('lists only the text and its enclosing block for typing in a paragraph', () => {
    const editor = createEditor('<p>Paragraph</p><pre><code>code</code></pre>');
    const transaction = editor.state.tr.insertText('x', 2);
    const types = transactionTouchedNodeTypes(transaction);
    expect(types.has('paragraph')).toBe(true);
    expect(types.has('codeBlock')).toBe(false);
    expect(transactionTouchesNodeType(transaction, 'codeBlock')).toBe(false);
    expect(transactionTouchesNodeType(transaction, 'heading')).toBe(false);
  });

  it('is empty for a transaction that does not change the document', () => {
    const editor = createEditor('<pre><code>code</code></pre>');
    const transaction = editor.state.tr.setMeta('pointer', true);
    expect(transaction.docChanged).toBe(false);
    expect(transactionTouchedNodeTypes(transaction).size).toBe(0);
  });

  it('is true for typing inside a code block', () => {
    const editor = createEditor('<p>Paragraph</p><pre><code>code</code></pre>');
    // paragraph is 0..11, the code block opens at 11 and its text starts at 12
    const transaction = editor.state.tr.insertText('x', 13);
    expect(transactionTouchesNodeType(transaction, 'codeBlock')).toBe(true);
  });

  it('is true when a change deletes across a code block', () => {
    const editor = createEditor(
      '<p>One</p><pre><code>code</code></pre><p>Two</p>',
    );
    const transaction = editor.state.tr.delete(
      2,
      editor.state.doc.content.size - 2,
    );
    expect(transactionTouchesNodeType(transaction, 'codeBlock')).toBe(true);
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
    expect(transactionTouchesNodeType(transaction, 'codeBlock')).toBe(true);
  });

  it('reports headings for typing inside one', () => {
    const editor = createEditor('<h2>Heading</h2>');
    const transaction = editor.state.tr.insertText('x', 2);
    expect(transactionTouchesNodeType(transaction, 'heading')).toBe(true);
  });

  it('lists no whole node for typing, even inside a code block', () => {
    const editor = createEditor('<p>Paragraph</p><pre><code>code</code></pre>');
    expect(
      transactionContainedNodeTypes(editor.state.tr.insertText('x', 2)).size,
    ).toBe(0);
    expect(
      transactionContainedNodeTypes(editor.state.tr.insertText('x', 13)).size,
    ).toBe(0);
  });

  it('lists whole nodes that were inserted or deleted', () => {
    const editor = createEditor(
      '<p>One</p><pre><code>code</code></pre><p>Two</p>',
    );
    const deleted = transactionContainedNodeTypes(
      editor.state.tr.delete(2, editor.state.doc.content.size - 2),
    );
    expect(deleted.has('codeBlock')).toBe(true);
    expect(deleted.has('paragraph')).toBe(false);

    const node = editor.state.schema.nodes.heading.create(
      { level: 2 },
      editor.state.schema.text('new'),
    );
    const inserted = transactionContainedNodeTypes(
      editor.state.tr.insert(editor.state.doc.content.size, node),
    );
    expect(inserted.has('heading')).toBe(true);
    expect(inserted.has('text')).toBe(true);
  });

  it('walks each transaction once however many gates ask', () => {
    const editor = createEditor('<p>Paragraph</p>');
    const transaction = editor.state.tr.insertText('x', 2);
    const forEach = vi.spyOn(transaction.mapping.maps[0], 'forEach');

    expect(transactionTouchesNodeType(transaction, 'heading')).toBe(false);
    expect(transactionTouchesNodeType(transaction, 'codeBlock')).toBe(false);
    expect(transactionTouchesNodeType(transaction, 'paragraph')).toBe(true);
    expect(forEach).toHaveBeenCalledTimes(1);
  });
});
