import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Editor } from '@tiptap/react';
import { useEditorCommands } from './use-editor-commands';
import { makeEditor } from '../utils/make-editor';
import {
  CommentStoreContext,
  createCommentStore,
} from '../stores/comment-store';

describe('useEditorCommands', () => {
  let editor: Editor;
  beforeEach(() => {
    // Collaboration owns the doc — content is set post-construction inside makeEditor.
    editor = makeEditor('<p>hello world</p>');
    editor.commands.selectAll();
  });
  afterEach(() => {
    editor.destroy();
  });

  it('format.bold toggles bold and reports isActive', () => {
    const { result } = renderHook(() => useEditorCommands(editor));
    expect(result.current['format.bold'].isActive).toBe(false);
    act(() => result.current['format.bold'].run());
    expect(editor.isActive('bold')).toBe(true);
    expect(result.current['format.bold'].isActive).toBe(true);
  });

  it('format.heading sets and reports the current level', () => {
    editor.commands.setTextSelection(3); // block commands need a cursor inside the block
    const { result } = renderHook(() => useEditorCommands(editor));
    act(() => result.current['format.heading'].run('2'));
    expect(editor.isActive('heading', { level: 2 })).toBe(true);
    expect(result.current['format.heading'].current).toBe('2');
  });

  it('edit.undo isEnabled mirrors undo depth', () => {
    const { result } = renderHook(() => useEditorCommands(editor));
    expect(result.current['edit.undo'].isEnabled).toBe(editor.can().undo());
    act(() => {
      editor.chain().focus().toggleBold().run();
    });
    expect(editor.can().undo()).toBe(true);
    expect(result.current['edit.undo'].isEnabled).toBe(true);
  });

  it('two hook instances on one editor never diverge (invariant I1/I2)', () => {
    const a = renderHook(() => useEditorCommands(editor));
    const b = renderHook(() => useEditorCommands(editor));
    act(() => a.result.current['format.bold'].run()); // mutate via instance A
    expect(b.result.current['format.bold'].isActive).toBe(true); // B observes it
    expect(a.result.current['format.bold'].isActive).toBe(
      b.result.current['format.bold'].isActive,
    );
  });

  it('insert.quote reports blockquote active state', () => {
    editor.commands.setTextSelection(3);
    const { result } = renderHook(() => useEditorCommands(editor));
    expect(result.current['insert.quote'].isActive).toBe(false);
    act(() => result.current['insert.quote'].run());
    expect(result.current['insert.quote'].isActive).toBe(true);
  });

  it('format.direction sets and reports paragraph direction', () => {
    editor.commands.setTextSelection(3);
    const { result } = renderHook(() => useEditorCommands(editor));
    act(() => result.current['format.direction'].run('rtl'));
    expect(editor.isActive('paragraph', { dir: 'rtl' })).toBe(true);
    expect(result.current['format.direction'].current).toBe('rtl');
  });

  it('keeps list marker direction independent from text alignment', () => {
    editor.commands.setContent('<ul><li><p>hello</p></li></ul>');
    editor.commands.setTextSelection(4);
    const { result } = renderHook(() => useEditorCommands(editor));

    act(() => result.current['format.align'].run('right'));
    expect(editor.isActive('paragraph', { textAlign: 'right' })).toBe(true);
    expect(editor.isActive('listItem', { dir: 'rtl' })).toBe(false);

    act(() => result.current['format.direction'].run('rtl'));
    expect(editor.isActive('listItem', { dir: 'rtl' })).toBe(true);
  });

  it('keeps task checkbox direction independent from text alignment', () => {
    editor.commands.setContent('<p>hello</p>');
    editor.commands.setTextSelection(3);
    editor.commands.toggleTaskList();
    const { result } = renderHook(() => useEditorCommands(editor));

    act(() => result.current['format.align'].run('right'));
    expect(editor.isActive('paragraph', { textAlign: 'right' })).toBe(true);
    expect(editor.isActive('taskItem', { dir: 'rtl' })).toBe(false);

    act(() => result.current['format.direction'].run('rtl'));
    expect(editor.isActive('taskItem', { dir: 'rtl' })).toBe(true);
  });

  it('edit.delete removes the selection and tracks enablement', () => {
    const { result } = renderHook(() => useEditorCommands(editor));
    expect(result.current['edit.delete'].isEnabled).toBe(true); // selectAll in setup
    act(() => result.current['edit.delete'].run());
    expect(editor.getText()).not.toContain('hello world');
  });

  it('table commands enable only inside a table and operate on it', () => {
    editor.commands.setTextSelection(3);
    const { result } = renderHook(() => useEditorCommands(editor));
    expect(result.current['table.addRowBelow'].isEnabled).toBe(false);
    act(() => result.current['insert.table'].run()); // 3x2 with header row
    expect(result.current['table.addRowBelow'].isEnabled).toBe(true);
    const rowsBefore = editor.getHTML().match(/<tr/g)?.length ?? 0;
    act(() => result.current['table.addRowBelow'].run());
    const rowsAfter = editor.getHTML().match(/<tr/g)?.length ?? 0;
    expect(rowsAfter).toBe(rowsBefore + 1);
    act(() => result.current['table.deleteTable'].run());
    expect(result.current['table.deleteTable'].isEnabled).toBe(false);
  });

  it('insert.mermaid creates a mermaid code block', () => {
    editor.commands.setTextSelection(3);
    const { result } = renderHook(() => useEditorCommands(editor));
    act(() => result.current['insert.mermaid'].run());
    expect(editor.isActive('codeBlock', { language: 'mermaid' })).toBe(true);
  });

  it('returns disabled no-op commands for a null editor', () => {
    const { result } = renderHook(() => useEditorCommands(null));
    expect(result.current['format.bold'].isEnabled).toBe(false);
    expect(() => result.current['format.bold'].run()).not.toThrow();
  });

  it('re-renders only when a derived value changes (equality-gated)', () => {
    editor.commands.setTextSelection(3);
    let renders = 0;
    renderHook(() => {
      renders++;
      return useEditorCommands(editor);
    });
    // Plain typing changes no derived field (undo depth already > 0 from
    // setup transactions): no re-renders.
    const before = renders;
    act(() => {
      editor.commands.insertContent('a');
    });
    act(() => {
      editor.commands.insertContent('b');
    });
    expect(renders).toBe(before);
    // A transaction that flips a derived field (bold) re-renders once.
    act(() => {
      editor.chain().focus().selectAll().toggleBold().run();
    });
    expect(renders).toBe(before + 1);
  });
});

describe('useEditorCommands insert.comment', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = makeEditor();
    editor.commands.insertContent('hello world');
  });
  afterEach(() => {
    editor.destroy();
  });

  const wrapperFor = (store: ReturnType<typeof createCommentStore>) => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <CommentStoreContext.Provider value={store}>
        {children}
      </CommentStoreContext.Provider>
    );
    return wrapper;
  };

  it('runs the spy and expands the selection to the word when enabled, cursor mid-word', () => {
    const store = createCommentStore();
    const spy = vi.fn();
    store.setState({
      isInlineCommentAvailable: true,
      handleInlineComment: spy,
    });
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 2); // inside "hello"

    const { result } = renderHook(() => useEditorCommands(editor), {
      wrapper: wrapperFor(store),
    });

    expect(result.current['insert.comment'].isEnabled).toBe(true);
    act(() => result.current['insert.comment'].run());
    expect(spy).toHaveBeenCalledTimes(1);
    const { from, to } = editor.state.selection;
    expect(editor.state.doc.textBetween(from, to)).toBe('hello');
  });

  it('isEnabled is false when rendered without a CommentStoreProvider', () => {
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 2);

    const { result } = renderHook(() => useEditorCommands(editor));

    expect(result.current['insert.comment'].isEnabled).toBe(false);
  });

  it('isEnabled is false when isInlineCommentAvailable is false', () => {
    const store = createCommentStore();
    const spy = vi.fn();
    store.setState({
      isInlineCommentAvailable: false,
      handleInlineComment: spy,
    });
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 2);

    const { result } = renderHook(() => useEditorCommands(editor), {
      wrapper: wrapperFor(store),
    });

    expect(result.current['insert.comment'].isEnabled).toBe(false);
  });

  it('isEnabled is false when the cursor sits in a whitespace run', () => {
    const store = createCommentStore();
    const spy = vi.fn();
    store.setState({
      isInlineCommentAvailable: true,
      handleInlineComment: spy,
    });
    editor.commands.setContent('<p></p>');
    editor.commands.insertContent('hello  world'); // two spaces
    const base = editor.state.selection.$from.start();
    editor.commands.setTextSelection(base + 6); // between the two spaces

    const { result } = renderHook(() => useEditorCommands(editor), {
      wrapper: wrapperFor(store),
    });

    expect(result.current['insert.comment'].isEnabled).toBe(false);
  });

  // NodeSelection hazard (Task 3 review): a node-selected horizontal rule
  // reports non-empty selection but has no text, so the old
  // `!selection.empty` enablement would flip the command on while
  // createFloatingDraft's `textBetween` silently no-ops. The hr's dBlock
  // wrapper (doc.ts: `content: 'dBlock+'`) has empty textContent, so
  // hasTextTargetAtSelection correctly reports false here.
  it('isEnabled is false for a NodeSelection not adjacent to a word (horizontal rule)', () => {
    const store = createCommentStore();
    const spy = vi.fn();
    store.setState({
      isInlineCommentAvailable: true,
      handleInlineComment: spy,
    });
    editor.commands.insertContent('<p>after</p>');
    editor.commands.setHorizontalRule();
    editor.commands.insertContent('<p>trailing</p>');
    let hrPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule') hrPos = pos;
    });
    editor.commands.setNodeSelection(hrPos);
    expect(editor.state.selection.empty).toBe(false);

    const { result } = renderHook(() => useEditorCommands(editor), {
      wrapper: wrapperFor(store),
    });

    expect(result.current['insert.comment'].isEnabled).toBe(false);
  });
});
