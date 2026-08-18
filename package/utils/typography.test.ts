import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LineHeight } from '../extensions/line-height';
import { ParagraphSpacing } from '../extensions/paragraph-spacing';
import {
  percentageToUiValue,
  readEffectiveSpacing,
  readSpacingSelection,
  spacingToggleAction,
} from './typography';

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

describe('percentageToUiValue', () => {
  it('converts our stored percentage to the UI multiplier', () => {
    expect(percentageToUiValue('138%')).toBe('1.15');
  });

  // Defence in depth: documents pasted before line-height normalisation still
  // hold a bare ratio, and round-tripping it as a percentage collapsed it to 1%.
  it('treats a bare ratio as CSS, not as a percentage', () => {
    expect(percentageToUiValue('1.38')).toBe('1.15');
  });

  it('gives up on units it cannot express, rather than inventing a number', () => {
    expect(percentageToUiValue('20px')).toBe('');
  });
});

// What a block actually renders with, which is not the same as what the
// attribute says: unset spacing falls through to a stylesheet whose value
// depends on viewport, element type and sibling position. The menu labels and
// the dialog both need the real number, so it is read from the rendered DOM.
describe('readEffectiveSpacing', () => {
  const mounted: { editor: Editor; style: HTMLStyleElement }[] = [];

  const makeMountedEditor = (content: string, css: string) => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const element = document.createElement('div');
    document.body.appendChild(element);

    const editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({ trailingNode: false }),
        LineHeight,
        ParagraphSpacing,
      ] as AnyExtension[],
      content,
    });
    mounted.push({ editor, style });
    return editor;
  };

  afterEach(() => {
    mounted.splice(0).forEach(({ editor, style }) => {
      editor.destroy();
      style.remove();
    });
  });

  const CSS = '.ProseMirror > * + * { margin-top: 24px; margin-bottom: 10px; }';

  it('reports the stylesheet value when nothing is set, converted to pt', () => {
    const editor = makeMountedEditor('<p>one</p><p>two</p>', CSS);
    // second paragraph: the sibling selector applies to it
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 2);

    expect(readEffectiveSpacing(editor)).toEqual({
      spaceBefore: 18,
      spaceAfter: 8,
    });
  });

  it('reports zero where the stylesheet gives the block no margin', () => {
    const editor = makeMountedEditor('<p>one</p><p>two</p>', CSS);
    editor.commands.setTextSelection(1);

    expect(readEffectiveSpacing(editor).spaceBefore).toBe(0);
  });

  it('prefers an explicit attribute over the stylesheet', () => {
    const editor = makeMountedEditor(
      '<p>one</p><p style="margin-top: 30pt">two</p>',
      CSS,
    );
    editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 2);

    expect(readEffectiveSpacing(editor).spaceBefore).toBe(30);
  });

  it('reports mixed when the selected blocks differ', () => {
    const editor = makeMountedEditor('<p>one</p><p>two</p>', CSS);
    editor.commands.selectAll();

    expect(readEffectiveSpacing(editor).spaceBefore).toBe('mixed');
  });
});

describe('spacingToggleAction', () => {
  it('offers to remove when the block has a gap', () => {
    expect(spacingToggleAction(18)).toBe('remove');
  });

  it('offers to add when the block has none', () => {
    expect(spacingToggleAction(0)).toBe('add');
  });

  // Some of the selection has a gap, so "remove" is the action that changes
  // every block to the same state; "add" would leave it mixed.
  it('treats a mixed selection as having a gap', () => {
    expect(spacingToggleAction('mixed')).toBe('remove');
  });
});
