import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { mergeEditorProps } from './editor-utils';

/**
 * Regression coverage for the bug found in browser verification of Task 3:
 * `editor.setOptions({ editorProps })` replaces the whole `editorProps`
 * object instead of merging it (tiptap's `setOptions` only shallow-merges
 * top-level keys — see `Editor#setOptions` in `@tiptap/core`). Calling it
 * directly with a partial patch (e.g. just `{ handleKeyDown }`, as
 * `useEditorToolbar` in `editor-utils.tsx` used to) silently discarded
 * `attributes` (including the `main-doc-editor` class added in Task 3),
 * `clipboardTextSerializer`, and `handleDOMEvents` set at construction
 * time. `mergeEditorProps` fixes this by spreading `editor.options.editorProps`
 * before applying the patch; both call sites in `editor-utils.tsx` now go
 * through it exclusively.
 */
const makeEditorWithProps = (editorProps: {
  attributes?: Record<string, string>;
  clipboardTextSerializer?: () => string;
  handleDOMEvents?: Record<string, () => boolean>;
}) =>
  new Editor({
    extensions: getHeadlessExtensions(),
    textDirection: 'auto',
    editorProps,
  });

describe('mergeEditorProps', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('preserves construction-time attributes/clipboardTextSerializer when patching in a new key', () => {
    const clipboardTextSerializer = () => 'serialized';
    editor = makeEditorWithProps({
      attributes: { class: 'main-doc-editor' },
      clipboardTextSerializer,
    });

    mergeEditorProps(editor, { handleKeyDown: () => true });

    // The exact regression: construction-time attributes must survive a
    // later editorProps patch, not get wiped by a wholesale replace.
    expect(editor.view.dom.classList.contains('main-doc-editor')).toBe(true);
    expect(editor.options.editorProps.clipboardTextSerializer).toBe(
      clipboardTextSerializer,
    );
    expect(editor.options.editorProps.handleKeyDown).toBeTypeOf('function');
  });

  it('removing a previously-patched key (handleKeyDown: undefined) does not disturb sibling keys', () => {
    const clipboardTextSerializer = () => 'serialized';
    editor = makeEditorWithProps({
      attributes: { class: 'main-doc-editor' },
      clipboardTextSerializer,
    });

    mergeEditorProps(editor, { handleKeyDown: () => true });
    mergeEditorProps(editor, { handleKeyDown: undefined });

    expect(editor.view.dom.classList.contains('main-doc-editor')).toBe(true);
    expect(editor.options.editorProps.clipboardTextSerializer).toBe(
      clipboardTextSerializer,
    );
    expect(editor.options.editorProps.handleKeyDown).toBeUndefined();
  });

  it('repeated patch/unpatch cycles (effect re-run simulation) neither duplicate nor lose sibling keys', () => {
    const clipboardTextSerializer = () => 'serialized';
    const handleDOMEvents = { click: () => false };
    editor = makeEditorWithProps({
      attributes: { class: 'main-doc-editor' },
      clipboardTextSerializer,
      handleDOMEvents,
    });

    const handlerA = () => true;
    const handlerB = () => true;
    const handlerC = () => true;

    // Simulates the toolbar effect's cleanup -> setup cycle firing several
    // times (e.g. on every re-render that changes `buttonRef`).
    mergeEditorProps(editor, { handleKeyDown: handlerA });
    mergeEditorProps(editor, { handleKeyDown: undefined });
    mergeEditorProps(editor, { handleKeyDown: handlerB });
    mergeEditorProps(editor, { handleKeyDown: undefined });
    mergeEditorProps(editor, { handleKeyDown: handlerC });

    expect(editor.view.dom.classList.contains('main-doc-editor')).toBe(true);
    expect(editor.options.editorProps.clipboardTextSerializer).toBe(
      clipboardTextSerializer,
    );
    expect(editor.options.editorProps.handleDOMEvents).toBe(handleDOMEvents);
    // Only the latest patch's handler is active — no stacking/duplication.
    expect(editor.options.editorProps.handleKeyDown).toBe(handlerC);
  });
});
