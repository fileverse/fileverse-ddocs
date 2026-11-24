import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import Document from '@tiptap/extension-document';
import Heading from '@tiptap/extension-heading';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import { transactionCouldTouchHeading } from './table-of-contents';
import {
  destroyTracked,
  endOf,
  makeEditor,
  track,
} from './caret-marks/test-helpers';

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

// Our wrapper re-wraps upstream's appendTransaction (id assignment and
// duplicate repair); every heading keeps one unique, stable `data-toc-id`.
describe.each([1, 2])('heading toc ids (schema v%i)', (version) => {
  afterEach(destroyTracked);

  const ids = (editor: Editor) => {
    const found: unknown[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') found.push(node.attrs['data-toc-id']);
    });
    return found;
  };

  it('keeps ids through edits and gives a new heading its own', () => {
    const editor = track(
      makeEditor(version, '<h1>one</h1><p>body</p><h2>two</h2>'),
    );
    const before = ids(editor);
    expect(before.every((id) => typeof id === 'string' && id)).toBe(true);
    expect(new Set(before).size).toBe(2);

    editor.view.dispatch(editor.state.tr.insertText('!', endOf(editor, 'two')));
    expect(ids(editor)).toEqual(before);

    editor.commands.setTextSelection(endOf(editor, 'body'));
    editor.commands.setNode('heading', { level: 2 });
    const after = ids(editor);
    expect(after).toHaveLength(3);
    expect(after.every((id) => typeof id === 'string' && id)).toBe(true);
    expect(new Set(after).size).toBe(3);
    expect(after.filter((id) => before.includes(id))).toEqual(before);
  });
});
