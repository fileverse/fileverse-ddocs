import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LineHeight } from '../../extensions/line-height';
import { ParagraphSpacing } from '../../extensions/paragraph-spacing';
import { SPACING_ADD_PT } from '../../utils/typography';
import { getSpacingToggles } from './spacing-toggles';

const mounted: { editor: Editor; style: HTMLStyleElement }[] = [];

const mountEditor = () => {
  const style = document.createElement('style');
  style.textContent =
    '.ProseMirror > * + * { margin-top: 24px; margin-bottom: 10px; }';
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
    content: '<p>one</p><p>two</p>',
  });
  // second paragraph, which the sibling selector gives a gap
  editor.commands.setTextSelection(editor.state.doc.child(0).nodeSize + 2);
  mounted.push({ editor, style });
  return editor;
};

const second = (editor: Editor) => editor.state.doc.child(1).attrs;

afterEach(() => {
  mounted.splice(0).forEach(({ editor, style }) => {
    editor.destroy();
    style.remove();
  });
});

describe('getSpacingToggles', () => {
  it('offers to remove first, because the stylesheet already gives a gap', () => {
    const toggles = getSpacingToggles(mountEditor());

    expect(toggles.map((t) => t.label)).toEqual([
      'Remove space before paragraph',
      'Remove space after paragraph',
    ]);
  });

  it('removing pins the gap to zero rather than unsetting it', () => {
    const editor = mountEditor();

    getSpacingToggles(editor)[0].onSelect();

    // 0, not null: null would hand the block back to the stylesheet, which is
    // exactly the gap the user asked to remove.
    expect(second(editor).spaceBefore).toBe(0);
  });

  it('then offers to add it back', () => {
    const editor = mountEditor();
    getSpacingToggles(editor)[0].onSelect();

    expect(getSpacingToggles(editor)[0].label).toBe(
      'Add space before paragraph',
    );
  });

  it('adding writes an explicit gap', () => {
    const editor = mountEditor();
    getSpacingToggles(editor)[0].onSelect();

    getSpacingToggles(editor)[0].onSelect();

    expect(second(editor).spaceBefore).toBe(SPACING_ADD_PT);
  });

  // The stylesheet gives the first block no top margin, so "Add" is offered
  // there from the start. Restoring null would leave it at zero, so the toggle
  // has to write a real value or the menu item would do nothing.
  it('adds a gap to a block the stylesheet gives none', () => {
    const editor = mountEditor();
    editor.commands.setTextSelection(1);

    const [before] = getSpacingToggles(editor);
    expect(before.label).toBe('Add space before paragraph');
    before.onSelect();

    expect(editor.state.doc.child(0).attrs.spaceBefore).toBe(SPACING_ADD_PT);
  });
});
