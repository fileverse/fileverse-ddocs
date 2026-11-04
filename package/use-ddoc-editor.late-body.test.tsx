// package/use-ddoc-editor.late-body.test.tsx
// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { fromUint8Array, toUint8Array } from 'js-base64';
import { useDdocEditor } from './use-ddoc-editor';
import { writeJSONContentToYjsField } from './hooks/use-headless-editor';
import {
  DDOC_META_ROOT_KEY,
  SCHEMA_VERSION_META_KEY,
} from './utils/schema-version';

/**
 * TEC-3321. A body the host hands over after the editor mounts (null, then
 * the body; or a Version History preview's '' placeholder, then the version)
 * must keep its `columns` blocks: the one node whose content rule differs
 * between the schemas, so a body bound with the wrong schema loses exactly
 * its columns. Run for a v1 and a v2 doc, two tabs each; every tab must come
 * out node for node as it went in, and the open tab must show its columns.
 *
 * Real editor hook, real y-indexeddb over fake-indexeddb. Only the collab
 * transport is faked: the test decides when a hydrate lands and when the
 * session reports ready, as the server would.
 */

const collab = vi.hoisted(() => ({ ready: false }));
vi.mock('./sync-local/useSyncManager', async () => {
  const { Awareness } = await import('y-protocols/awareness');
  const Yjs = await import('yjs');
  const awareness = new Awareness(new Yjs.Doc());
  return {
    useSyncManager: () => ({
      state: { status: collab.ready ? 'ready' : 'connecting' },
      connect: () => {},
      disconnect: () => {},
      terminateSession: () => {},
      updateTitle: () => {},
      isReady: collab.ready,
      isSyncing: false,
      awareness,
      hasCollabContentInitialised: collab.ready,
    }),
  };
});

const COLLAB_ON = {
  enabled: true as const,
  connection: {
    roomKey: 'room-key',
    roomId: 'room-id',
    wsUrl: 'ws://collab.invalid',
    isOwner: true,
    connectOnOpen: true,
  },
  session: { username: 'owner' },
  services: {},
};
const COLLAB_OFF = { enabled: false as const };

const TABS = ['default', 'tab-2'] as const;
const LEFT = 'left column text';
const RIGHT = 'right column text';
const TOP = 'top level text';

const para = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const tabContent = (schemaVersion: 1 | 2, tab: string) => {
  const wrap = (node: object) =>
    schemaVersion === 1 ? { type: 'dBlock', content: [node] } : node;
  return {
    type: 'doc',
    content: [
      {
        type: 'columns',
        content: [
          { type: 'column', content: [wrap(para(`${tab} ${LEFT}`))] },
          { type: 'column', content: [wrap(para(`${tab} ${RIGHT}`))] },
        ],
      },
      wrap(para(`${tab} ${TOP}`)),
    ],
  };
};

const bodyFor = (schemaVersion: 1 | 2) => {
  const doc = new Y.Doc();
  if (schemaVersion === 2) {
    doc.getMap(DDOC_META_ROOT_KEY).set(SCHEMA_VERSION_META_KEY, 2);
  }
  for (const tab of TABS) {
    writeJSONContentToYjsField({
      ydoc: doc,
      field: tab,
      schemaVersion,
      content: tabContent(schemaVersion, tab),
    });
  }
  doc.transact(() => {
    doc.getArray('tabs_order').push([...TABS]);
    doc.getMap('tabs_name_registry').set('default', 'Tab 1');
    doc.getMap('tabs_name_registry').set('tab-2', 'Tab 2');
  });
  return fromUint8Array(Y.encodeStateAsUpdate(doc));
};

// Each tab's fragment exactly as the body carries it.
const fragmentsOf = (doc: Y.Doc) =>
  Object.fromEntries(
    TABS.map((tab) => [tab, doc.getXmlFragment(tab).toString()]),
  );
const expectedFragments = (body: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, toUint8Array(body));
  return fragmentsOf(doc);
};

const columnsIn = (xml: string) => (xml.match(/<columns[ >]/g) ?? []).length;

const seedStore = async (ddocId: string, body: string) => {
  const prior = new Y.Doc();
  Y.applyUpdate(prior, toUint8Array(body));
  const provider = new IndexeddbPersistence(ddocId, prior);
  await provider.whenSynced;
  await provider.destroy();
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

type Seed = string | null | undefined;
type Door = {
  // What the host passes at mount.
  seed: Seed;
  // How the body arrives afterwards.
  then: 'nothing' | 'initialContent' | 'sync';
  // The body sits in the doc's store before mount.
  inStore?: boolean;
  isDDocOwner?: boolean;
  // Collab is turned on after mount (RTC builds its config once the doc
  // page is ready) and hydrates before the host's body arrives: with an
  // empty room, or with the doc itself.
  collabHydrates?: 'empty' | 'body';
};

const DOORS: [string, Door][] = [
  ['control: body at mount', { seed: 'body', then: 'nothing' }],
  [
    'null, then the body as initialContent (published doc, no local body)',
    { seed: null, then: 'initialContent' },
  ],
  [
    'null, then the body as initialContent, not the owner',
    { seed: null, then: 'initialContent', isDDocOwner: false },
  ],
  [
    'null, collab turned on and hydrates an empty room, then the body as initialContent',
    { seed: null, then: 'initialContent', collabHydrates: 'empty' },
  ],
  [
    'null, collab turned on and hydrates the doc, then the body as initialContent',
    { seed: null, then: 'initialContent', collabHydrates: 'body' },
  ],
  ['null, then the body by sync', { seed: null, then: 'sync' }],
  [
    "'' over a store holding the body",
    { seed: '', then: 'nothing', inStore: true },
  ],
  [
    'no body over a store holding the body',
    { seed: undefined, then: 'nothing', inStore: true },
  ],
];

describe('TEC-3321: a body that reaches the editor late keeps its columns', () => {
  describe.each([1, 2] as const)('schema-%s doc with columns', (schema) => {
    it.each(DOORS)(
      '%s',
      async (_label, door) => {
        collab.ready = false;
        const body = bodyFor(schema);
        const expected = expectedFragments(body);
        const ddocId = `late-body-${schema}-${Math.random()}`;
        if (door.inStore) await seedStore(ddocId, body);
        const seed = door.seed === 'body' ? body : door.seed;

        const { result, rerender, unmount } = renderHook(
          ({
            initialContent,
            collabOn,
          }: {
            initialContent: Seed;
            collabOn: boolean;
          }) =>
            useDdocEditor({
              ddocId,
              isDDocOwner: door.isDDocOwner ?? true,
              enableIndexeddbSync: true,
              preferredSchemaVersion: 2,
              initialContent: initialContent as string,
              onChange: vi.fn(),
              collaboration: collabOn ? COLLAB_ON : COLLAB_OFF,
            }),
          { initialProps: { initialContent: seed, collabOn: false } },
        );
        await settle();

        if (door.collabHydrates) {
          rerender({ initialContent: seed, collabOn: true });
          await settle();
          act(() => {
            if (door.collabHydrates === 'body') {
              Y.applyUpdate(result.current.ydoc, toUint8Array(body), 'self');
            }
            collab.ready = true;
          });
          rerender({ initialContent: seed, collabOn: true });
          await settle();
        }

        const collabOn = Boolean(door.collabHydrates);
        if (door.then === 'initialContent') {
          rerender({ initialContent: body, collabOn });
        } else if (door.then === 'sync') {
          act(() => {
            Y.applyUpdate(result.current.ydoc, toUint8Array(body), 'remote');
          });
        }
        await settle();
        await settle();

        const actual = fragmentsOf(result.current.ydoc);
        const text = result.current.editor?.getText() ?? '';
        const isContentLoading = result.current.isContentLoading;
        unmount();

        expect(result.current.docSchemaVersion).toBe(schema);
        expect(TABS.map((tab) => columnsIn(actual[tab]))).toEqual(
          TABS.map((tab) => columnsIn(expected[tab])),
        );
        expect(actual).toEqual(expected);
        if (door.seed === null && door.then === 'sync') {
          // null means "wait for my body": until the host hands it over the
          // doc stays loading (as it always has), whatever a sync brought.
          expect(isContentLoading).toBe(true);
          return;
        }
        expect(text).toContain(LEFT);
        expect(text).toContain(RIGHT);
      },
      20000,
    );

    describe('Version History preview', () => {
      const VH_DOORS: [string, string][] = [
        ['control: version content at mount', 'at-mount'],
        ["'' placeholder, then the content under the same versionId", 'late'],
      ];
      it.each(VH_DOORS)(
        '%s',
        async (_label, mode) => {
          const body = bodyFor(schema);
          const expected = expectedFragments(body);
          const vh = (content: string) => ({
            enabled: true,
            versionId: 'cid-1',
            content,
          });

          const { result, rerender } = renderHook(
            ({ content }: { content: string }) =>
              useDdocEditor({
                isPreviewMode: true,
                isPreviewEditor: true,
                versionHistoryState: vh(content),
                onChange: vi.fn(),
              }),
            { initialProps: { content: mode === 'late' ? '' : body } },
          );
          await settle();
          if (mode === 'late') rerender({ content: body });
          await settle();
          await settle();

          const actual = fragmentsOf(result.current.ydoc);
          const text = result.current.editor?.getText() ?? '';
          expect(result.current.docSchemaVersion).toBe(schema);
          expect(TABS.map((tab) => columnsIn(actual[tab]))).toEqual(
            TABS.map((tab) => columnsIn(expected[tab])),
          );
          expect(actual).toEqual(expected);
          expect(text).toContain(LEFT);
          expect(text).toContain(RIGHT);
        },
        20000,
      );
    });
  });
});
