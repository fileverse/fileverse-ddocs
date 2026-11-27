import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';
import { ySyncPluginKey } from '@tiptap/y-tiptap';
import {
  destroyTracked,
  endOf,
  makeEditor,
  track,
  type,
  undoManager,
} from '../extensions/caret-marks/test-helpers';
import { destroyEditorWithYSyncCleanup } from './y-prosemirror-cleanup';

afterEach(destroyTracked);

// dblock-media-plugin, suggestion tracking and undo-selection match this name.
it("registers y-tiptap's sync plugin under 'y-sync$'", () => {
  expect(ySyncPluginKey.key).toBe('y-sync$');
  const editor = track(makeEditor(2));
  expect(ySyncPluginKey.getState(editor.state)?.binding).toBeTruthy();
});

/** Listener counts on the shared Y.Doc and the tab's fragment. */
const listeners = (ydoc: Y.Doc, fragment: Y.XmlFragment) => {
  const counts: Record<string, number> = {};
  (
    ydoc as unknown as { _observers: Map<string, Set<unknown>> }
  )._observers.forEach((set, name) => {
    if (set.size > 0) counts[name] = set.size;
  });
  const deep = (fragment as unknown as { _dEH: { l: unknown[] } })._dEH.l;
  return { ...counts, observeDeep: deep.length };
};

describe.each([1, 2])(
  'destroyEditorWithYSyncCleanup (schema v%i)',
  (version) => {
    // A tab editor evicted from the warm cache must leave nothing on the Y.Doc
    // the other tabs share, and the tab must edit and undo when it comes back.
    it('leaves the shared Y.Doc as it found it', () => {
      const ydoc = new Y.Doc();
      const fragment = ydoc.getXmlFragment('default');
      const baseline = listeners(ydoc, fragment);
      const evicted = makeEditor(version, '<p>abc</p>', { ydoc });
      destroyEditorWithYSyncCleanup(evicted);
      (evicted.options.element as Element).remove();
      expect(listeners(ydoc, fragment)).toEqual(baseline);

      const editor = track(makeEditor(version, null, { ydoc }));
      expect(editor.state.doc.textContent).toBe('abc');
      editor.commands.setTextSelection(endOf(editor, 'abc'));
      undoManager(editor).stopCapturing();
      type(editor, ' more');
      expect(editor.state.doc.textContent).toBe('abc more');
      expect(editor.commands.undo()).toBe(true);
      expect(editor.state.doc.textContent).toBe('abc');
    });
  },
);

// Documents saved on Tiptap 3.11 (one per schema): opening one must not
// write to the Y.Doc or add a root (no migration maps, no repair writes).
describe.each([1, 2])('opening a stored document (schema v%i)', (version) => {
  it('writes nothing to the Y.Doc', async () => {
    const stored = fs
      .readFileSync(
        path.resolve(
          __dirname,
          `../__fixtures__/stored-docs/v${version}-doc.b64`,
        ),
        'utf8',
      )
      .trim();
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, toUint8Array(stored));
    const roots = [...ydoc.share.keys()].sort();
    let updates = 0;
    ydoc.on('update', () => {
      updates += 1;
    });

    const editor = track(makeEditor(version, null, { ydoc }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(editor.state.doc.textContent.length).toBeGreaterThan(0);
    expect(updates).toBe(0);
    expect([...ydoc.share.keys()].sort()).toEqual(roots);
  });
});
