import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from './use-headless-editor';
import { TAB_EDITOR_ATTRIBUTES } from './use-tab-editor';

/**
 * Regression coverage for a second round of the Task 3 browser-verification
 * bug: `new Editor({ editorProps: { ...DdocEditorProps, ..., attributes: {
 * spellCheck: 'true' } } })` in `createEditorForTab` (use-tab-editor.tsx)
 * placed a local `attributes:` key AFTER `...DdocEditorProps` in the same
 * object literal. In a plain JS object literal, a later duplicate key wins
 * outright — it does not merge with the earlier one — so this silently
 * replaced DdocEditorProps' whole `attributes` record (the
 * `main-doc-editor`/prose classes, `spellcheck`, and
 * `suppressContentEditableWarning`) with just `{ spellCheck: 'true' }`,
 * confirmed live via `editor.options.editorProps.attributes`. This predates
 * Task 3 (it silently dropped the prose classes too) but Task 3's container
 * padding is keyed on `main-doc-editor`, which made it Critical.
 *
 * `TAB_EDITOR_ATTRIBUTES` is the extracted, single source of truth for
 * those attributes, used at the `new Editor(...)` call site instead of a
 * second inline `attributes:` key — this locks in that there's nowhere left
 * for that collision to reappear.
 */
describe('TAB_EDITOR_ATTRIBUTES', () => {
  it('carries DdocEditorProps.attributes forward unclobbered', () => {
    expect(TAB_EDITOR_ATTRIBUTES.class).toMatch(/\bmain-doc-editor\b/);
    expect(TAB_EDITOR_ATTRIBUTES.class).toMatch(/\bprose\b/);
    expect(TAB_EDITOR_ATTRIBUTES.spellcheck).toBe('true');
    expect(TAB_EDITOR_ATTRIBUTES.suppressContentEditableWarning).toBe('true');
    // The construction-site literal used to additionally (and redundantly)
    // set a camelCase duplicate — confirm it's gone now that the merge
    // point is this single constant rather than a second inline key.
    expect(TAB_EDITOR_ATTRIBUTES.spellCheck).toBeUndefined();
  });

  it('smoke test: an Editor constructed with these attributes renders main-doc-editor on its DOM root', () => {
    const editor = new Editor({
      extensions: getHeadlessExtensions(),
      editorProps: { attributes: TAB_EDITOR_ATTRIBUTES },
      textDirection: 'auto',
    });
    try {
      expect(editor.view.dom.className).toMatch(/\bmain-doc-editor\b/);
    } finally {
      editor.destroy();
    }
  });
});
