import { act, cleanup, render } from '@testing-library/react';
import { describe, it, expect, afterEach } from 'vitest';
import { Profiler } from 'react';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { DBlockTemplateOverlay, getTemplateTarget } from './dblock-toolbar';
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

describe.each([1, 2])(
  'DBlockTemplateOverlay cached state (v%i)',
  (schemaVersion) => {
    let editor: Editor;
    let panel: HTMLElement;

    const mountOverlay = (content?: string, onRender?: () => void) => {
      editor = new Editor({
        content,
        extensions: getHeadlessExtensions({ schemaVersion }),
        textDirection: 'auto',
      });
      editor.commands.focus('start');
      panel = document.createElement('div');
      panel.dataset.ddocEditorPanel = 'true';
      panel.appendChild(editor.view.dom);
      document.body.appendChild(panel);

      render(
        <Profiler id="template-overlay" onRender={onRender ?? (() => {})}>
          <DBlockTemplateOverlay
            editor={editor}
            enableFanficTemplate={false}
            runtimeState={DEFAULT_DBLOCK_RUNTIME_STATE}
          />
        </Profiler>,
      );
    };

    const overlay = () =>
      document.querySelector('[data-template-overlay="true"]');

    afterEach(() => {
      cleanup();
      editor?.destroy();
      panel?.remove();
    });

    it('tracks blank and non-blank content transitions', () => {
      mountOverlay();
      expect(overlay()).not.toBeNull();

      act(() => editor.commands.insertContent('content'));
      expect(overlay()).toBeNull();

      act(() => editor.chain().selectAll().deleteSelection().run());
      expect(overlay()).not.toBeNull();
    });

    it('tracks first-block focus without changing content', () => {
      mountOverlay();
      act(() => editor.commands.setContent('<p></p><p></p>'));
      const paragraphPositions: number[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph') {
          paragraphPositions.push(pos + 1);
        }
      });

      act(() => editor.commands.setTextSelection(paragraphPositions[1]));
      expect(overlay()).toBeNull();

      act(() => editor.commands.setTextSelection(paragraphPositions[0]));
      expect(overlay()).not.toBeNull();
    });

    it('does not rerender repeatedly when edits keep cached state unchanged', () => {
      let commitCount = 0;
      mountOverlay('<p>content</p>', () => {
        commitCount += 1;
      });

      act(() => editor.commands.insertContent('more '));
      const commitsAfterFirstEdit = commitCount;

      act(() => editor.commands.insertContent('text '));
      act(() => editor.commands.insertContent('here'));

      // React may attempt one same-state render before bailing out. The
      // regression was a committed render for every separate transaction.
      expect(commitCount - commitsAfterFirstEdit).toBeLessThan(2);
    });
  },
);
