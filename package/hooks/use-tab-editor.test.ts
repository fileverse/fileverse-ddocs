import { describe, it, expect, vi, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import {
  absolutePositionToRelativePosition,
  yCursorPluginKey,
  ySyncPluginKey,
} from '@tiptap/y-tiptap';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import { getHeadlessExtensions } from './use-headless-editor';
import {
  TAB_EDITOR_ATTRIBUTES,
  printTab,
  useExtensionSyncWithCollaboration,
} from './use-tab-editor';
import type { CollaborationProps } from '../sync-local/types';
import {
  destroyTracked,
  makeEditor,
  startOf,
  track,
} from '../extensions/caret-marks/test-helpers';
import { printPagesTab } from '../extensions/pagination/print';
import { handleContentPrint } from '../utils/handle-print';

vi.mock('../extensions/pagination/print', () => ({
  printPagesTab: vi.fn(),
}));
vi.mock('../utils/handle-print', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/handle-print')>()),
  handleContentPrint: vi.fn(),
}));

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

describe('printTab', () => {
  const fake = { getHTML: () => '<p>x</p>' } as unknown as Editor;

  it('falls back to the plain print and logs when Pages print rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(handleContentPrint).mockClear();
    vi.mocked(printPagesTab).mockRejectedValue(new Error('boom'));
    await printTab(fake, false, []);
    expect(err).toHaveBeenCalled();
    expect(handleContentPrint).toHaveBeenCalledWith('<p>x</p>');
    err.mockRestore();
  });

  it('does not run the plain print twice when it throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(handleContentPrint).mockClear();
    vi.mocked(handleContentPrint).mockImplementationOnce(() => {
      throw new Error('print blocked');
    });
    vi.mocked(printPagesTab).mockResolvedValue(false);
    await expect(printTab(fake, false, [])).rejects.toThrow('print blocked');
    expect(handleContentPrint).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });
});

// The hook rebuilds y-tiptap's yCursorPlugin from its spec (state.init/apply,
// props, view) and re-runs apply only on its `awarenessUpdated` meta.
describe('useExtensionSyncWithCollaboration', () => {
  afterEach(destroyTracked);

  it("renders a collaborator's caret and removes the plugin on unmount", async () => {
    const docA = new Y.Doc();
    const a = track(makeEditor(2, '<p>Alpha</p><p>Beta</p>', { ydoc: docA }));
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    const b = track(makeEditor(2, null, { ydoc: docB }));
    const awA = new Awareness(docA);
    const awB = new Awareness(docB);
    awB.on('update', ({ added, updated }: Record<string, number[]>) => {
      const changed = [...added, ...updated];
      applyAwarenessUpdate(awA, encodeAwarenessUpdate(awB, changed), 'remote');
    });

    const { unmount } = renderHook(() =>
      useExtensionSyncWithCollaboration({
        editor: a,
        isReady: true,
        awareness: awA,
        collaboration: {
          enabled: true,
          session: { username: 'A' },
        } as unknown as CollaborationProps,
        collaborationCleanupRef: { current: () => {} },
      }),
    );
    // What B's own cursor plugin would publish while B has focus.
    const caret = startOf(b, 'Beta') + 2;
    const sync = ySyncPluginKey.getState(b.state);
    const rel = absolutePositionToRelativePosition(
      caret,
      sync.type,
      sync.binding.mapping,
    );
    awB.setLocalStateField('user', { name: 'B', color: '#30bced' });
    awB.setLocalStateField('cursor', { anchor: rel, head: rel });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const carets = yCursorPluginKey
      .getState(a.state)
      .find(
        undefined,
        undefined,
        (spec: { key: string }) => spec.key === `${awB.clientID}`,
      )
      .map((decoration: { from: number }) => decoration.from);
    expect(carets).toEqual([caret]);
    expect(
      a.view.dom.querySelector('.collaboration-cursor__caret')?.textContent,
    ).toBe('B');

    unmount();
    expect(yCursorPluginKey.getState(a.state)).toBeUndefined();
    awA.destroy();
    awB.destroy();
  });
});
