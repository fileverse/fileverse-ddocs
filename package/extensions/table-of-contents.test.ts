import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Heading from '@tiptap/extension-heading';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { transactionCouldTouchHeading } from './table-of-contents';

describe('transactionCouldTouchHeading', () => {
  const editors: Editor[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    editors.splice(0).forEach((editor) => editor.destroy());
  });

  it('inspects each transaction once and reuses both cached results', () => {
    const cases = [
      { content: '<p>Paragraph</p>', expected: false },
      { content: '<h2>Heading</h2>', expected: true },
    ];

    cases.forEach(({ content, expected }) => {
      const editor = new Editor({
        content,
        extensions: [Document, Paragraph, Heading, Text],
      });
      editors.push(editor);

      const transaction = editor.state.tr.insertText('x', 2);
      const changedRange = transaction.mapping.maps[0];
      const forEach = vi.spyOn(changedRange, 'forEach');

      expect(transactionCouldTouchHeading(transaction)).toBe(expected);
      expect(transactionCouldTouchHeading(transaction)).toBe(expected);
      expect(transactionCouldTouchHeading(transaction)).toBe(expected);
      expect(forEach).toHaveBeenCalledTimes(1);
    });
  });
});
