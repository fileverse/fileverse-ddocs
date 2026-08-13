import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';
import { getTemplateTarget } from './dblock-toolbar';
import { DEFAULT_DBLOCK_RUNTIME_STATE } from './dblock-runtime';

describe('getTemplateTarget', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('targets a single empty dBlock', () => {
    editor = makeEditor('<p></p>');
    editor.commands.setTextSelection(2);
    const target = getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE);
    expect(target).not.toBeNull();
    expect(target!.pos).toBe(0);
  });

  it('returns null once the doc has content', () => {
    editor = makeEditor('<p>hello</p>');
    const target = getTemplateTarget(editor, DEFAULT_DBLOCK_RUNTIME_STATE);
    expect(target).toBeNull();
  });

  it('returns null in preview mode', () => {
    editor = makeEditor('<p></p>');
    const target = getTemplateTarget(editor, {
      ...DEFAULT_DBLOCK_RUNTIME_STATE,
      isPreviewMode: true,
    });
    expect(target).toBeNull();
  });
});
