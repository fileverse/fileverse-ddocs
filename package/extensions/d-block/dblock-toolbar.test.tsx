import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { Editor } from '@tiptap/react';
import { makeEditor } from '../../utils/make-editor';
import { DBlockToolbarProvider } from './dblock-toolbar';
import { DEFAULT_DBLOCK_RUNTIME_STATE } from './dblock-runtime';

beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

// TEC-2679 blog-preview crash: PreviewDdocEditor is statically read-only,
// but it still mounted the DragHandle chrome. The upstream DragHandle
// plugin relocates its rendered element outside React's tree, so when a
// late-arriving blob flips the schema marker and the editor rebuilds,
// React re-commits EditorContent against the relocated `.drag-handle`
// anchor and insertBefore throws NotFoundError — killing the preview.
// Preview editors must never mount block chrome: the read-only heading
// affordances live inside the node view, and the cluster is hard-hidden
// for non-editable editors anyway.
describe('DBlockToolbarProvider in preview editors', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('mounts no block chrome when isPreviewEditor', () => {
    editor = makeEditor('<p>hello</p>');
    document.body.appendChild(editor.view.dom);
    const { container, unmount } = render(
      <DBlockToolbarProvider
        editor={editor}
        runtimeState={DEFAULT_DBLOCK_RUNTIME_STATE}
        isPreviewEditor
      >
        <span data-test="preview-child" />
      </DBlockToolbarProvider>,
    );

    // children still render
    expect(container.querySelector('[data-test="preview-child"]')).toBeTruthy();
    // no drag-handle cluster, no template overlay — anywhere in the document
    // (the DragHandle plugin relocates its element outside the React root,
    // so the query must be document-wide)
    expect(document.querySelector('[aria-label="block-controls"]')).toBeNull();
    expect(document.querySelector('[data-template-overlay]')).toBeNull();

    // With no chrome mounted, unmount must be clean — no try/catch needed.
    unmount();
  });

  it('keeps mounting the chrome for regular editors', () => {
    editor = makeEditor('<p>hello</p>');
    document.body.appendChild(editor.view.dom);
    const { unmount } = render(
      <DBlockToolbarProvider
        editor={editor}
        runtimeState={DEFAULT_DBLOCK_RUNTIME_STATE}
      >
        <span />
      </DBlockToolbarProvider>,
    );

    expect(
      document.querySelector('[aria-label="block-controls"]'),
    ).toBeTruthy();

    // Same jsdom/React DOM-ownership limitation as dblock-drag-handle.test:
    // the DragHandle plugin relocates its element outside React's root.
    try {
      unmount();
    } catch {
      // expected — see dblock-drag-handle.test.tsx
    }
  });
});
