import { describe, it, expect, afterEach } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { Editor, EditorContent } from '@tiptap/react';
import { makeEditor } from '../../../utils/make-editor';
import { EditingProvider } from '../../../hooks/use-editing-context';

const TABLE =
  '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>';

// TEC-3374: the package's `.trigger-button { display: flex }` loads after the
// consumer's Tailwind, so a `hidden` class never hid the menu from viewers.
describe('TableCellNodeView menu trigger', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  const renderAndHover = async (
    isPreviewMode: boolean,
    isSuggestionMode = false,
  ) => {
    editor = makeEditor();
    editor.commands.setContent(TABLE);
    const { container } = render(
      <EditingProvider
        isPreviewMode={isPreviewMode}
        isSuggestionMode={isSuggestionMode}
      >
        <EditorContent editor={editor} />
      </EditingProvider>,
    );
    const cell = await waitFor(() => {
      const el = container.querySelector('[data-node-view-wrapper]');
      expect(el).toBeTruthy();
      return el;
    });
    act(() => {
      fireEvent.mouseEnter(cell!);
    });
    return container;
  };

  it('renders the trigger for editors', async () => {
    const container = await renderAndHover(false);
    expect(container.querySelector('.trigger-button')).toBeTruthy();
  });

  it('renders no trigger in view mode', async () => {
    const container = await renderAndHover(true);
    expect(container.querySelector('.trigger-button')).toBeNull();
  });

  it('renders no trigger in suggestion mode', async () => {
    const container = await renderAndHover(true, true);
    expect(container.querySelector('.trigger-button')).toBeNull();
  });
});
