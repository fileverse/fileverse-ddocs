import {
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  onTestFinished,
} from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';
import type { Editor } from '@tiptap/react';
import {
  absolutePositionToRelativePosition,
  yCursorPlugin,
  yCursorPluginKey,
  ySyncPluginKey,
} from '@tiptap/y-tiptap';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import type { DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { renderHook } from '@testing-library/react';
import { NodeRangeSelection } from '@tiptap/extension-node-range';
import {
  caretTo,
  destroyTracked,
  endOf,
  makeEditor,
  nativeDelete,
  pressEnter,
  stampOf,
  startOf,
  textblocks,
  track,
  type,
  undoManager,
} from './extensions/caret-marks/test-helpers';
import {
  addComment,
  resolvedAnchors,
  setAttrs,
  type ListHarness,
} from './extensions/list-toggle/test-helpers';
import {
  CommentDecorationExtension,
  type CommentAnchor,
} from './extensions/comment/comment-decoration-plugin';
import { BLOCK_ID_ATTR } from './extensions/block-id';
import { dispatchMeta } from './extensions/pagination/meta';
import { getTabsYdocNodes } from './components/tabs/utils/tab-utils';
import {
  getTabTree,
  insertSiblingTabsInDoc,
} from './components/tabs/utils/tab-operations';
import { destroyEditorWithYSyncCleanup } from './utils/y-prosemirror-cleanup';
import { useExtensionSyncWithCollaboration } from './hooks/use-tab-editor';
import type { CollaborationProps } from './sync-local/types';

// Probes for TIPTAP_UPGRADE.md §5.10 (y-tiptap 3.0.1 -> 3.3.0) and Review
// Focus 3. Undo grouping uses a one-minute captureTimeout (lib0 reads a
// Date.now captured at import, so fake timers cannot move it): only
// stopCapturing() splits a group.

afterEach(destroyTracked);

beforeAll(() => {
  // v1's dBlock Enter chains focus(), which scrolls from a rAF.
  window.scrollBy = () => {};
});

/** Forwards updates both ways; updates that arrived from the peer are not echoed. */
const connect = (a: Y.Doc, b: Y.Doc): (() => void) => {
  const forward = (to: Y.Doc) => (update: Uint8Array, origin: unknown) => {
    if (origin !== 'remote') Y.applyUpdate(to, update, 'remote');
  };
  const toB = forward(b);
  const toA = forward(a);
  a.on('update', toB);
  b.on('update', toA);
  return () => {
    a.off('update', toB);
    b.off('update', toA);
  };
};

const mod = (editor: Editor, key: string) => {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  return (
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
  );
};

const quietUndo = (editor: Editor) => {
  const um = undoManager(editor);
  um.captureTimeout = 60_000;
  um.stopCapturing();
  um.clear();
  return um;
};

const blockTexts = (editor: Editor) =>
  textblocks(editor)
    .map(({ node }) => node.textContent)
    .join(' / ');

const caretText = (editor: Editor) => {
  const { $from } = editor.state.selection;
  return `${$from.parent.textContent}@${$from.parentOffset}`;
};

/** Delete the top-level block holding `text` and insert it at the top, one transaction. */
const moveBlockToTop = (editor: Editor, text: string) => {
  const $pos = editor.state.doc.resolve(startOf(editor, text));
  const from = $pos.before(1);
  const node = $pos.node(1);
  editor.view.dispatch(
    editor.state.tr.delete(from, from + node.nodeSize).insert(0, node),
  );
};

/** What prosemirror-view's drop does for a moved NodeRangeSelection. */
const dragBlocksToEnd = (editor: Editor, count: number) => {
  const { doc } = editor.state;
  let to = 0;
  for (let index = 0; index < count; index++) to += doc.child(index).nodeSize;
  const selection = NodeRangeSelection.create(doc, 0, to);
  editor.view.dispatch(editor.state.tr.setSelection(selection));
  const slice = selection.content();
  const tr = editor.state.tr.deleteSelection();
  const at = tr.mapping.map(doc.content.size);
  tr.replaceRange(at, at, slice).setMeta('uiEvent', 'drop');
  editor.view.dispatch(tr);
};

const countUpdates = (ydoc: Y.Doc, act: () => void) => {
  let updates = 0;
  const onUpdate = () => {
    updates += 1;
  };
  ydoc.on('update', onUpdate);
  act();
  ydoc.off('update', onUpdate);
  return updates;
};

const commentHarness = (
  version: number,
  html: string | null,
  ydoc: Y.Doc,
): ListHarness => {
  const anchors: CommentAnchor[] = [];
  const editor = track(
    makeEditor(version, html, {
      ydoc,
      extensions: [
        CommentDecorationExtension.configure({
          getAnchors: () => anchors,
          getActiveCommentId: () => null,
        }),
      ],
    }),
  );
  return { editor, anchors };
};

const HTML = '<p>Alpha</p><p>Beta</p><p>Gamma</p><p>Delta</p>';

const twoClients = (version: number) => {
  const docA = new Y.Doc();
  const hA = commentHarness(version, HTML, docA);
  const docB = new Y.Doc();
  Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
  connect(docA, docB);
  const b = track(makeEditor(version, null, { ydoc: docB }));
  const umA = quietUndo(hA.editor);
  const umB = quietUndo(b);
  return { hA, a: hA.editor, b, umA, umB };
};

describe('key name', () => {
  it('registers y-sync under y-sync$', () => {
    expect(ySyncPluginKey.key).toBe('y-sync$');
    const editor = track(makeEditor(2));
    expect(ySyncPluginKey.getState(editor.state)?.binding).toBeTruthy();
  });
});

describe.each([1, 2])('schema v%i', (version) => {
  describe('two clients', () => {
    it('converge; pins A’s caret and anchors through remote edits, moves and undo', () => {
      const { hA, a, b, umA, umB } = twoClients(version);
      expect(b.getJSON()).toEqual(a.getJSON());
      addComment(hA, 'c1', 'Alpha');
      addComment(hA, 'c2', 'Gamma');
      caretTo(a, endOf(a, 'Gamma'));

      const log: string[] = [];
      const step = (name: string, act: () => void) => {
        act();
        umA.stopCapturing();
        umB.stopCapturing();
        expect(a.getJSON()).toEqual(b.getJSON());
        log.push(
          `${name}: ${blockTexts(a)} | A caret ${caretText(a)} | ${resolvedAnchors(hA)}`,
        );
      };

      step('B types', () => {
        caretTo(b, endOf(b, 'Alpha'));
        type(b, ' plus');
      });
      step('A types', () => type(a, '!'));
      step('B moves Delta above A’s caret', () => moveBlockToTop(b, 'Delta'));
      step('A undo', () => mod(a, 'z'));
      step('A redo', () => mod(a, 'y'));
      step('B undo', () => mod(b, 'z'));
      step('B redo', () => mod(b, 'y'));
      expect(log).toMatchSnapshot();
    });
  });

  describe('remote caret', () => {
    /** Two clients whose awareness flows B -> A, as sync-local relays it. */
    const awarenessPair = (version: number) => {
      const clients = twoClients(version);
      const { a, b } = clients;
      const docOf = (editor: Editor) =>
        ySyncPluginKey.getState(editor.state).doc as Y.Doc;
      const awA = new Awareness(docOf(a));
      const awB = new Awareness(docOf(b));
      onTestFinished(() => {
        awA.destroy();
        awB.destroy();
      });
      awB.on(
        'update',
        ({ added, updated, removed }: Record<string, number[]>) => {
          const changed = [...added, ...updated, ...removed];
          applyAwarenessUpdate(
            awA,
            encodeAwarenessUpdate(awB, changed),
            'remote',
          );
        },
      );
      // What B's yCursorPlugin publishes while B has focus (jsdom has none).
      const publishCaret = (pos: number) => {
        const sync = ySyncPluginKey.getState(b.state);
        const rel = absolutePositionToRelativePosition(
          pos,
          sync.type,
          sync.binding.mapping,
        );
        awB.setLocalStateField('cursor', { anchor: rel, head: rel });
      };
      const caretsOnA = () =>
        (yCursorPluginKey.getState(a.state) as DecorationSet)
          .find(undefined, undefined, (spec) => spec.key === `${awB.clientID}`)
          .map((decoration) => decoration.from);
      return { ...clients, awA, awB, publishCaret, caretsOnA };
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    // §5.10.1: B's caret right after "A" is item-based; deleting "A" leaves
    // it at the first text position (2 in v1, 1 in v2), which 3.0.6-3.0.9
    // resolved to null.
    it('renders B’s caret on A at the first text position', async () => {
      const { a, b, awA, awB, publishCaret, caretsOnA } =
        awarenessPair(version);
      a.registerPlugin(yCursorPlugin(awA));

      const first = startOf(b, 'Alpha');
      awB.setLocalStateField('user', { name: 'B', color: '#30bced' });
      publishCaret(first + 1);
      // y-tiptap batches awareness re-renders into a setTimeout(0).
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(caretsOnA()).toEqual([first + 1]);

      nativeDelete(b, first, first + 1);
      expect(blockTexts(a)).toBe('lpha / Beta / Gamma / Delta');
      expect(caretsOnA()).toEqual([first]);
    });

    // §5.10.3 cursor rebuild: use-tab-editor rebuilds yCursorPlugin from its
    // spec.state.init/apply, props and view and only re-runs apply when a
    // remote cursor changed (awarenessUpdated meta).
    it('renders B’s caret through use-tab-editor’s rebuilt cursor plugin', async () => {
      const { a, b, umA, awA, awB, publishCaret, caretsOnA } =
        awarenessPair(version);
      const observers = (awareness: Awareness) =>
        (awareness as unknown as { _observers: Map<string, Set<unknown>> })
          ._observers;
      const changeListeners = () => observers(awA).get('change')?.size ?? 0;
      const baseline = changeListeners();
      const cleanupRef = { current: () => {} };
      const collaboration = {
        enabled: true,
        session: { username: 'A' },
      } as unknown as CollaborationProps;
      const { unmount } = renderHook(() =>
        useExtensionSyncWithCollaboration({
          editor: a,
          isReady: true,
          awareness: awA,
          collaboration,
          collaborationCleanupRef: cleanupRef,
        }),
      );
      const cursorPlugins = () =>
        a.state.plugins.filter((plugin) =>
          String((plugin as unknown as { key: string }).key).startsWith(
            'yjs-cursor$',
          ),
        ).length;
      expect(cursorPlugins()).toBe(1);
      expect(changeListeners()).toBe(baseline + 1);
      expect(awA.getLocalState()?.user?.name).toBe('A');

      const first = startOf(b, 'Alpha');
      awB.setLocalStateField('user', { name: 'B', color: '#30bced' });
      publishCaret(first + 1);
      await tick();
      expect(caretsOnA()).toEqual([first + 1]);
      const caret = a.view.dom.querySelector('.collaboration-cursor__caret');
      expect(caret?.textContent).toBe('B');

      // An awareness change that moves no cursor keeps the same decorations.
      const before = yCursorPluginKey.getState(a.state);
      awB.setLocalStateField('socketId', 'probe');
      await tick();
      expect(yCursorPluginKey.getState(a.state)).toBe(before);

      // Remote edits only map the decorations (our apply skips the
      // isChangeOrigin re-render), so a caret inside a replaced range is
      // dropped until B's cursor moves.
      const shown: string[] = [];
      nativeDelete(b, first, first + 1);
      shown.push(`B deletes the char before its caret: ${caretsOnA()}`);
      const gamma = endOf(b, 'Gamma');
      publishCaret(gamma);
      await tick();
      shown.push(`B moves to the end of Gamma (${gamma}): ${caretsOnA()}`);
      caretTo(b, endOf(b, 'Beta'));
      type(b, 'x');
      shown.push(`B types in Beta: ${caretsOnA()}`);
      expect(shown).toMatchSnapshot();

      // registerPlugin re-created every plugin view; A's undo still works.
      caretTo(a, endOf(a, 'Gamma'));
      type(a, '!');
      umA.stopCapturing();
      expect(blockTexts(a)).toBe('lpha / Betax / Gamma! / Delta');
      mod(a, 'z');
      expect(blockTexts(a)).toBe('lpha / Betax / Gamma / Delta');

      unmount();
      expect(cursorPlugins()).toBe(0);
      expect(changeListeners()).toBe(baseline);
      expect(yCursorPluginKey.getState(a.state)).toBeUndefined();
      // Fields left in A's awareness after the plugin view is destroyed.
      expect(Object.keys(awA.getLocalState() ?? {}).sort()).toMatchSnapshot();
    });
  });

  describe('binding lifecycle', () => {
    const listenerCounts = (ydoc: Y.Doc, fragment: Y.XmlFragment) => {
      const observers = (
        ydoc as unknown as { _observers: Map<string, Set<unknown>> }
      )._observers;
      const counts: Record<string, number> = {};
      observers.forEach((set, name) => {
        if (set.size > 0) counts[name] = set.size;
      });
      const deep = (fragment as unknown as { _dEH: { l: unknown[] } })._dEH.l;
      return { ...counts, observeDeep: deep.length };
    };

    // §5.10.3: our cleanup (tab eviction) must leave no y-tiptap listener on
    // the shared Y.Doc, also after registerPlugin re-created the plugin views.
    it('destroyEditorWithYSyncCleanup returns Y.Doc listeners to baseline', () => {
      const ydoc = new Y.Doc();
      const fragment = ydoc.getXmlFragment('default');
      const baseline = listenerCounts(ydoc, fragment);
      const editor = makeEditor(version, '<p>abc</p>', { ydoc });
      expect(ySyncPluginKey.getState(editor.state).type).toBe(fragment);
      const key = new PluginKey('lifecycleProbe');
      editor.registerPlugin(new Plugin({ key }));
      editor.unregisterPlugin(key);

      destroyEditorWithYSyncCleanup(editor);
      (editor.options.element as Element).remove();
      const after = listenerCounts(ydoc, fragment);
      const names = [
        'beforeAllTransactions',
        'afterAllTransactions',
        'afterTransaction',
        'observeDeep',
      ] as const;
      names.forEach((name) => {
        expect([name, after[name] ?? 0]).toEqual([name, baseline[name] ?? 0]);
      });
      // Any other listener left behind (name: count above baseline).
      const leftover = Object.fromEntries(
        Object.entries(after)
          .map(([name, count]) => [name, count - (baseline[name] ?? 0)])
          .filter(([, delta]) => delta !== 0),
      );
      expect(leftover).toMatchSnapshot();
    });
  });

  describe('undo grouping', () => {
    // Types `one`, runs the write, types `two`: one group unless something
    // between them splits it.
    const around = (editor: Editor, write: () => void) => {
      const um = quietUndo(editor);
      type(editor, 'one');
      write();
      type(editor, 'two');
      return um.undoStack.length;
    };

    it.runIf(version === 2)('a BlockId assignment adds no undo step', () => {
      const editor = track(makeEditor(version, '<p>abc</p>'));
      caretTo(editor, endOf(editor, 'abc'));
      expect(around(editor, () => pressEnter(editor))).toBe(1);
      const ids = editor.state.doc.children.map((n) => n.attrs[BLOCK_ID_ATTR]);
      expect(ids.every(Boolean) && new Set(ids).size === ids.length).toBe(true);
    });

    it('a paragraph-spacing write adds no undo step', () => {
      const editor = track(makeEditor(version, '<ul><li><p>abc</p></li></ul>'));
      caretTo(editor, endOf(editor, 'abc'));
      const length = around(editor, () =>
        setAttrs(editor, 'paragraph', 'abc', { spaceAfter: 12 }),
      );
      expect(length).toBe(1);
      const $pos = editor.state.doc.resolve(startOf(editor, 'abc'));
      // The list-ownership plugin moved the gap onto the item.
      expect([
        $pos.node(-1).attrs.spaceAfter,
        $pos.parent.attrs.spaceAfter,
      ]).toEqual([12, null]);
    });

    it('a caret-marks stamp adds no undo step', () => {
      const editor = track(makeEditor(version, '<p><strong>abc</strong></p>'));
      caretTo(editor, endOf(editor, 'abc'));
      expect(around(editor, () => pressEnter(editor))).toBe(1);
      expect(stampOf(textblocks(editor)[1].node)).toBe('[{"type":"bold"}]');
    });

    it('a pagination meta transaction adds no undo step', () => {
      const editor = track(makeEditor(version, '<p>abc</p>'));
      caretTo(editor, endOf(editor, 'abc'));
      expect(
        around(editor, () => dispatchMeta(editor.view, { spacers: [] })),
      ).toBe(1);
    });

    it('a remote edit leaves A’s undo stack alone', () => {
      const { a, b, umA } = twoClients(version);
      caretTo(a, endOf(a, 'Gamma'));
      type(a, 'one');
      expect(umA.undoStack.length).toBe(1);
      caretTo(b, endOf(b, 'Alpha'));
      type(b, ' plus');
      expect(blockTexts(a)).toContain('Alpha plus');
      expect(umA.undoStack.length).toBe(1);
      type(a, 'two');
      expect(umA.undoStack.length).toBe(1);
      mod(a, 'z');
      expect(blockTexts(a)).toBe('Alpha plus / Beta / Gamma / Delta');
    });

    it('focus then blur between two typed words', () => {
      const editor = track(makeEditor(version, '<p>abc</p>'));
      caretTo(editor, endOf(editor, 'abc'));
      const length = around(editor, () => {
        editor.view.dom.dispatchEvent(new FocusEvent('focus'));
        editor.view.dom.dispatchEvent(new FocusEvent('blur'));
      });
      expect(length).toMatchSnapshot();
    });
  });

  describe('no new Yjs roots', () => {
    const readFixture = () =>
      fs
        .readFileSync(
          path.resolve(
            __dirname,
            '__fixtures__/upgrade',
            `v${version}-doc.b64`,
          ),
          'utf8',
        )
        .trim();

    it('opens the fixture, reorders and drags blocks without adding roots', () => {
      const ydoc = new Y.Doc();
      Y.applyUpdate(ydoc, toUint8Array(readFixture()));
      const keys = [...ydoc.share.keys()].sort();
      const editor = track(makeEditor(version, null, { ydoc }));
      expect([...ydoc.share.keys()].sort()).toEqual(keys);

      const texts = () =>
        editor.state.doc.children
          .map((node) => node.textContent)
          .filter(Boolean);
      const last = texts().pop()!;
      expect(countUpdates(ydoc, () => moveBlockToTop(editor, last))).toBe(1);
      expect([...ydoc.share.keys()].sort()).toEqual(keys);
      expect(editor.state.doc.firstChild!.textContent).toBe(last);

      const before = texts();
      expect(countUpdates(ydoc, () => dragBlocksToEnd(editor, 2))).toBe(1);
      expect(texts()).toEqual([...before.slice(2), ...before.slice(0, 2)]);
      expect([...ydoc.share.keys()].sort()).toEqual(keys);
      expect(
        [...ydoc.share.keys()].filter((key) =>
          key.startsWith('__tiptap_position_migrations:'),
        ),
      ).toEqual([]);
    });
  });

  describe('tab eviction', () => {
    const CACHE_LIMIT = 4; // PREVIOUS_TAB_CACHE_LIMIT in use-tab-editor-cache.ts

    const fiveTabs = () => {
      const ydoc = new Y.Doc();
      const nodes = getTabsYdocNodes(ydoc);
      const ids = ['default', 'tab2', 'tab3', 'tab4', 'tab5'];
      // Same writes as use-tab-manager's default tab and createTab.
      ydoc.transact(() => {
        nodes.nameById.set('default', 'Tab 1');
        nodes.emojiById.set('default', null);
        nodes.order.push(['default']);
      });
      ids.slice(1).forEach((id, index) => {
        ydoc.transact(() => {
          nodes.nameById.set(id, `Tab ${index + 2}`);
          nodes.emojiById.set(id, null);
          ydoc.getXmlFragment(id);
          insertSiblingTabsInDoc(ydoc, ids[index], [id]);
        });
      });
      expect(getTabTree(ydoc).map((tab) => tab.id)).toEqual(ids);
      return { ydoc, ids };
    };

    it('undoes typing in a tab editor re-created after eviction', () => {
      const { ydoc, ids } = fiveTabs();
      const warm = new Map<string, Editor>();
      let recent: string[] = [];
      const visit = (id: string) => {
        let editor = warm.get(id);
        if (!editor) {
          editor = makeEditor(version, null, { ydoc, field: id });
          warm.set(id, editor);
        }
        recent = [id, ...recent.filter((other) => other !== id)].slice(
          0,
          CACHE_LIMIT,
        );
        warm.forEach((entry, tabId) => {
          if (recent.includes(tabId)) return;
          destroyEditorWithYSyncCleanup(entry);
          warm.delete(tabId);
        });
        return editor;
      };

      ids.forEach((id, index) => {
        visit(id).commands.setContent(`<p>Text ${index + 1}</p>`);
      });
      expect([...warm.keys()]).toEqual(ids.slice(1));

      const editor = track(visit('default'));
      expect(warm.has('tab2')).toBe(false);
      expect(blockTexts(editor)).toBe('Text 1');
      quietUndo(editor);
      caretTo(editor, endOf(editor, 'Text 1'));
      type(editor, ' more');
      expect(blockTexts(editor)).toBe('Text 1 more');
      mod(editor, 'z');
      expect(blockTexts(editor)).toBe('Text 1');

      const tab3 = visit('tab3');
      expect(blockTexts(tab3)).toBe('Text 3');
      warm.forEach((entry) => entry !== editor && track(entry));
    });
  });
});
