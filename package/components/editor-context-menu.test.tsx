import { act, fireEvent, render, screen } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { EditingProvider } from '../hooks/use-editing-context';
import { EditorContextMenu } from './editor-context-menu';

describe.each([1, 2])('context menu (schema v%s)', (schemaVersion) => {
  let editor: Editor;
  let start: number;
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    editor = new Editor({
      extensions: getHeadlessExtensions({ schemaVersion }),
    });
    editor.commands.setContent('<p>hello world</p>');
    editor.state.doc.descendants((node, pos) => {
      if (node.isText) start = pos;
    });
    document.body.appendChild(editor.view.dom);
    vi.spyOn(editor.view, 'posAtCoords').mockImplementation(() => ({
      pos: start + 2,
      inside: start - 1,
    }));
  });
  afterEach(() => {
    editor.view.dom.remove();
    editor.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  const open = () =>
    fireEvent.contextMenu(editor.view.dom, { clientX: 100, clientY: 100 });

  it('keeps the selection when right-clicking within selected text', () => {
    editor.commands.setTextSelection({ from: start, to: start + 5 });
    render(<EditorContextMenu editor={editor} />);
    open();
    expect(screen.getByRole('menu', { name: 'Document editing' })).toBeTruthy();
    expect(editor.state.selection.from).toBe(start);
    expect(editor.state.selection.to).toBe(start + 5);
    expect(
      screen
        .getByRole('menuitem', { name: /^Cut/ })
        .getAttribute('aria-disabled'),
    ).not.toBe('true');
  });

  it('moves the caret to a right-click outside the selection', () => {
    editor.commands.setTextSelection({ from: start + 6, to: start + 11 });
    render(<EditorContextMenu editor={editor} />);
    open();
    expect(editor.state.selection.from).toBe(start + 2);
    expect(editor.state.selection.empty).toBe(true);
    expect(
      screen
        .getByRole('menuitem', { name: /^Cut/ })
        .getAttribute('aria-disabled'),
    ).toBe('true');
  });

  it('offers copy and select all without mutation actions in preview/suggestion mode', () => {
    render(
      <EditingProvider isPreviewMode isSuggestionMode>
        <EditorContextMenu editor={editor} />
      </EditingProvider>,
    );
    open();
    expect(screen.getByRole('menuitem', { name: /^Copy/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /^Select all/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /^Paste/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Cut/ })).toBeNull();
  });

  it('leaves embedded input context menus alone', () => {
    render(<EditorContextMenu editor={editor} />);
    const input = document.createElement('input');
    editor.view.dom.appendChild(input);
    expect(fireEvent.contextMenu(input, { clientX: 100, clientY: 100 })).toBe(
      true,
    );
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('shows table operations only when the caret is inside a table', () => {
    render(<EditorContextMenu editor={editor} />);
    open();
    expect(
      screen.queryByRole('menuitem', { name: 'Insert row above' }),
    ).toBeNull();
    act(() => {
      editor.commands.insertTable({ rows: 2, cols: 2, withHeaderRow: false });
      let cellPos = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableCell' && !cellPos) cellPos = pos + 2;
      });
      editor.commands.setTextSelection(cellPos);
    });
    expect(
      screen.getByRole('menuitem', { name: 'Insert row above' }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Insert row above' }));
    let rows = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'tableRow') rows++;
    });
    expect(rows).toBe(3);
  });
});
