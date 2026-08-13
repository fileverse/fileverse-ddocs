import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';

const countActionButtons = (editor: Editor) => {
  let count = 0;
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'actionButton') count += 1;
  });
  return count;
};

describe('setActionButton', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('leaves the selection in a valid textblock (not at the dBlock boundary)', () => {
    editor = makeEditor('<p></p>');
    editor.commands.setTextSelection(2);

    editor.commands.setActionButton('iframe-video');

    expect(countActionButtons(editor)).toBe(1);
    // The old behavior parked the selection at pos 1 with the dBlock as
    // parent — an invalid resting place that made the cursor render at the
    // block edge and broke subsequent inserts.
    expect(editor.state.selection.$from.parent.type.name).not.toBe('dBlock');
    // The empty host paragraph is consumed — no blank line left above.
    expect(editor.state.doc.firstChild?.firstChild?.type.name).toBe(
      'actionButton',
    );
  });

  it('supports inserting two action buttons back to back (TEC-2539 repro)', () => {
    editor = makeEditor('<p></p>');
    editor.commands.setTextSelection(2);

    editor.commands.setActionButton('iframe-video');
    editor.commands.setActionButton('iframe-soundcloud');

    // The JAM flow: insert video input, then soundcloud input — both must
    // exist. The old code silently dropped the second insert because the
    // selection was stranded at the dBlock boundary.
    expect(countActionButtons(editor)).toBe(2);
  });
});
