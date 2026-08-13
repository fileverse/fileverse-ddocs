import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { makeEditor } from '../../utils/make-editor';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { createDBlockExtension } from './dblock';
import {
  DEFAULT_DBLOCK_RUNTIME_STATE,
  type DBlockRuntimeState,
} from './dblock-runtime';

// makeEditor's headless stack builds dBlock with default options; preview
// chrome needs a runtime state + copy-link callback, so swap in a configured
// dBlock extension.
const makePreviewEditor = (
  content: string,
  runtime: Partial<DBlockRuntimeState>,
  onCopyHeadingLink?: (link: string) => void,
) => {
  const state = { ...DEFAULT_DBLOCK_RUNTIME_STATE, ...runtime };
  const extensions = getHeadlessExtensions().map((extension) =>
    extension.name === 'dBlock'
      ? (createDBlockExtension({
          getRuntimeState: () => state,
          onCopyHeadingLink,
        }) as unknown as AnyExtension)
      : extension,
  );
  const editor = new Editor({ extensions });
  editor.commands.setContent(content);
  return editor;
};

describe('DBlockNodeView (simplified chrome-less wrapper)', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('renders no gutter and no per-block padding classes', () => {
    editor = makeEditor('<p>hello</p>');
    const block = editor.view.dom.querySelector('[data-type="d-block"]')!;
    expect(block).toBeTruthy();
    expect(block.querySelector('[data-dblock-gutter]')).toBeNull();
    expect(block.className).not.toMatch(
      /px-4|pl-2|pr-8|pr-\[80px\]|pl-\[8px\]/,
    );
    // contentDOM is the direct (and only) element child
    expect(block.children.length).toBe(1);
    expect(
      (block.firstElementChild as HTMLElement).dataset.nodeViewContent,
    ).toBe('true');
  });

  it('keeps the is-table marker class for table blocks', () => {
    editor = makeEditor(
      '<table><tbody><tr><td><p>x</p></td></tr></tbody></table>',
    );
    const block = editor.view.dom.querySelector('[data-type="d-block"]')!;
    expect(block.className).toMatch(/is-table/);
  });
});

describe('DBlockNodeView preview heading chrome', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  const HEADING_DOC = '<h2>Section</h2><p>body</p>';
  const controlsIn = (root: Element | Document) =>
    root.querySelectorAll('[data-preview-controls]');

  it('renders collapse + copy-link controls on heading blocks in read-only preview', () => {
    editor = makePreviewEditor(
      HEADING_DOC,
      { isPreviewMode: true },
      () => {},
    );
    editor.setEditable(false);

    const controls = controlsIn(editor.view.dom);
    // heading block only — not the paragraph block
    expect(controls.length).toBe(1);
    const heading = editor.view.dom.querySelector('h2');
    expect(controls[0].closest('[data-type="d-block"]')!.contains(heading)).toBe(
      true,
    );
    expect(
      controls[0].querySelector('[data-test="preview-collapse-button"]'),
    ).toBeTruthy();
    expect(
      controls[0].querySelector('[data-test="preview-copy-link-button"]'),
    ).toBeTruthy();
  });

  it('keeps the chrome mounted in editable mode (CSS gates visibility, not JS)', () => {
    // Mode switches (owner → view-only) flip contenteditable WITHOUT any
    // transaction, so vanilla node views never re-run syncDOM. The DOM must
    // therefore carry the controls in every mode, with
    // `.ProseMirror[contenteditable='false']` scoping when they can show —
    // a JS gate on runtime.isPreviewMode froze the initial mode's decision.
    editor = makePreviewEditor(HEADING_DOC, {});
    expect(controlsIn(editor.view.dom).length).toBe(1);
  });

  it('renders no chrome in presentation mode or split view (separate editor instances)', () => {
    editor = makePreviewEditor(HEADING_DOC, {
      isPreviewMode: true,
      isPresentationMode: true,
    });
    expect(controlsIn(editor.view.dom).length).toBe(0);
    editor.destroy();

    editor = makePreviewEditor(HEADING_DOC, {
      isPreviewMode: true,
      isSplitView: true,
    });
    expect(controlsIn(editor.view.dom).length).toBe(0);
  });

  it('omits the copy-link button when no callback is wired', () => {
    editor = makePreviewEditor(HEADING_DOC, { isPreviewMode: true });
    expect(
      editor.view.dom.querySelector('[data-test="preview-copy-link-button"]'),
    ).toBeNull();
    expect(
      editor.view.dom.querySelector('[data-test="preview-collapse-button"]'),
    ).toBeTruthy();
  });

  it('toggles heading collapse from a NON-EDITABLE view and reflects it on the controls', () => {
    editor = makePreviewEditor(HEADING_DOC, { isPreviewMode: true });
    editor.setEditable(false);

    const button = editor.view.dom.querySelector<HTMLButtonElement>(
      '[data-test="preview-collapse-button"]',
    )!;
    button.click();

    let heading: { attrs: Record<string, unknown> } | null = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') heading = node;
    });
    expect(heading!.attrs.isCollapsed).toBe(true);
    expect(
      editor.view.dom
        .querySelector('[data-preview-controls]')!
        .className.includes('is-collapsed'),
    ).toBe(true);

    // and back
    editor.view.dom
      .querySelector<HTMLButtonElement>(
        '[data-test="preview-collapse-button"]',
      )!
      .click();
    heading = null;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') heading = node;
    });
    expect(heading!.attrs.isCollapsed).toBe(false);
  });

  it('invokes onCopyHeadingLink with the heading slug', () => {
    const onCopyHeadingLink = vi.fn();
    editor = makePreviewEditor(
      HEADING_DOC,
      { isPreviewMode: true },
      onCopyHeadingLink,
    );
    editor.setEditable(false);

    editor.view.dom
      .querySelector<HTMLButtonElement>(
        '[data-test="preview-copy-link-button"]',
      )!
      .click();

    expect(onCopyHeadingLink).toHaveBeenCalledTimes(1);
    expect(typeof onCopyHeadingLink.mock.calls[0][0]).toBe('string');
    expect(onCopyHeadingLink.mock.calls[0][0].length).toBeGreaterThan(0);
  });
});
