// package/use-ddoc-editor.store-first.test.tsx
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
 * A doc whose body sits only in its y-indexeddb store, mounted without that
 * body (no initialContent, or ''). Before the store loads the editor cannot
 * see the doc's schema marker; if it binds anyway it binds with the wrong
 * schema and the replayed content is rewritten and deleted, then saved back
 * into the store. Every combination of what the store holds and what the
 * host passes must keep the text: the editor waits for its store first.
 *
 * Real editor hook, real y-indexeddb over fake-indexeddb, no mocks.
 */

const TEXT = 'text that must survive the mount';

const bodyFor = (schemaVersion: 1 | 2) => {
  const doc = new Y.Doc();
  writeJSONContentToYjsField({
    ydoc: doc,
    field: 'default',
    schemaVersion,
    content:
      schemaVersion === 1
        ? {
            type: 'doc',
            content: [
              {
                type: 'dBlock',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: TEXT }],
                  },
                ],
              },
            ],
          }
        : {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: TEXT }] },
            ],
          },
  });
  if (schemaVersion === 2) {
    doc.getMap(DDOC_META_ROOT_KEY).set(SCHEMA_VERSION_META_KEY, 2);
  }
  return fromUint8Array(Y.encodeStateAsUpdate(doc));
};

// An earlier session left this body in the doc's store.
const seedStore = async (ddocId: string, body: string) => {
  const prior = new Y.Doc();
  Y.applyUpdate(prior, toUint8Array(body));
  const provider = new IndexeddbPersistence(ddocId, prior);
  await provider.whenSynced;
  await provider.destroy();
};

// What the store holds now, read fresh.
const readStore = async (ddocId: string) => {
  const doc = new Y.Doc();
  const provider = new IndexeddbPersistence(ddocId, doc);
  await provider.whenSynced;
  const result = {
    text: doc.getXmlFragment('default').toString(),
    marker: doc.getMap(DDOC_META_ROOT_KEY).get(SCHEMA_VERSION_META_KEY),
  };
  await provider.destroy();
  return result;
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

type HostProps = {
  initialContent?: string;
  isNewDocument?: boolean;
  isDDocOwner: boolean;
};

const HOSTS: [string, HostProps][] = [
  [
    "'' and no isNewDocument (a body-less row)",
    { initialContent: '', isDDocOwner: true },
  ],
  [
    'no body, isNewDocument false (store-only mount)',
    { initialContent: undefined, isNewDocument: false, isDDocOwner: true },
  ],
  [
    "'' and isNewDocument false",
    { initialContent: '', isNewDocument: false, isDDocOwner: true },
  ],
  ['no body, not the owner', { initialContent: undefined, isDDocOwner: false }],
];

describe('useDdocEditor mounted without the body its store holds', () => {
  describe.each([1, 2] as const)('store holds a schema-%s doc', (schema) => {
    it.each(HOSTS)(
      '%s: the text survives, the schema stays',
      async (_label, host) => {
        const ddocId = `store-first-${schema}-${Math.random()}`;
        await seedStore(ddocId, bodyFor(schema));

        const { result, unmount } = renderHook(() =>
          useDdocEditor({
            ddocId,
            enableIndexeddbSync: true,
            preferredSchemaVersion: 2,
            onChange: vi.fn(),
            ...host,
          }),
        );
        await settle();
        await settle();

        expect(result.current.docSchemaVersion).toBe(schema);
        expect(result.current.editor?.getText()).toContain(TEXT);

        if (host.isDDocOwner) {
          // One ordinary edit: the text must still be there afterwards.
          await act(async () => {
            result.current.editor?.commands.focus('end');
            result.current.editor?.commands.insertContent(' more');
          });
          await settle();
        }
        unmount();
        await settle();

        const stored = await readStore(ddocId);
        expect(stored.text).toContain(TEXT);
        expect(stored.marker).toBe(schema === 2 ? 2 : undefined);
      },
      20000,
    );
  });

  it('still opens a genuinely new doc (empty store, empty body, host asserts isNewDocument) at the preferred schema', async () => {
    const ddocId = `store-first-new-${Math.random()}`;
    const { result } = renderHook(() =>
      useDdocEditor({
        ddocId,
        isDDocOwner: true,
        enableIndexeddbSync: true,
        preferredSchemaVersion: 2,
        initialContent: '',
        isNewDocument: true,
        onChange: vi.fn(),
      }),
    );
    await settle();
    expect(result.current.docSchemaVersion).toBe(2);
    expect(result.current.editor).toBeTruthy();
    await act(async () => {
      result.current.editor?.commands.insertContent('new text');
    });
    await settle();
    expect(result.current.editor?.getText()).toContain('new text');
  }, 20000);

  // TEC-3272. A stale draft flag made the host mount an existing v1 doc with
  // '' in preview mode (row not loaded yet), then remount it for real. The
  // first mount used to infer "new", stamp schema 2 on the empty Y.Doc, and
  // y-indexeddb persisted that stamp ahead of the replay; the second mount
  // then bound the v1 body with the v2 schema and deleted it.
  it("an early preview mount with '' over a v1 store does not stamp, and the real mount keeps the text", async () => {
    const ddocId = `store-first-tec3272-${Math.random()}`;
    await seedStore(ddocId, bodyFor(1));
    const guard = vi.fn();
    const preview = renderHook(() =>
      useDdocEditor({
        ddocId,
        isDDocOwner: true,
        enableIndexeddbSync: true,
        preferredSchemaVersion: 2,
        initialContent: '',
        isPreviewMode: true,
        onChange: vi.fn(),
        onSchemaStampGuard: guard,
      }),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });
    expect(
      preview.result.current.ydoc
        .getMap(DDOC_META_ROOT_KEY)
        .get(SCHEMA_VERSION_META_KEY),
    ).toBeUndefined();
    preview.unmount();
    expect((await readStore(ddocId)).marker).toBeUndefined();

    const { result } = renderHook(() =>
      useDdocEditor({
        ddocId,
        isDDocOwner: true,
        enableIndexeddbSync: true,
        preferredSchemaVersion: 2,
        initialContent: '',
        onChange: vi.fn(),
        onSchemaStampGuard: guard,
      }),
    );
    await settle();
    expect(result.current.docSchemaVersion).toBe(1);
    expect(result.current.editor?.getText()).toContain(TEXT);
    await act(async () => {
      result.current.editor?.commands.focus('end');
      result.current.editor?.commands.insertContent(' more');
    });
    await settle();
    const stored = await readStore(ddocId);
    expect(stored.text).toContain(TEXT);
    expect(stored.marker).toBeUndefined();
    expect(guard).toHaveBeenCalledWith({
      kind: 'unasserted-new',
      preferredSchemaVersion: 2,
    });
  }, 30000);

  it('reports unasserted-new once when mounted as owner with no body and no isNewDocument, not when asserted', async () => {
    const guard = vi.fn();
    const a = renderHook(() =>
      useDdocEditor({
        ddocId: `store-first-unasserted-${Math.random()}`,
        isDDocOwner: true,
        enableIndexeddbSync: true,
        preferredSchemaVersion: 2,
        initialContent: '',
        onChange: vi.fn(),
        onSchemaStampGuard: guard,
      }),
    );
    await settle();
    a.rerender();
    await settle();
    expect(
      guard.mock.calls.filter(([e]) => e.kind === 'unasserted-new'),
    ).toHaveLength(1);
    expect(a.result.current.docSchemaVersion).toBe(1);

    const asserted = vi.fn();
    renderHook(() =>
      useDdocEditor({
        ddocId: `store-first-asserted-${Math.random()}`,
        isDDocOwner: true,
        enableIndexeddbSync: true,
        preferredSchemaVersion: 2,
        initialContent: '',
        isNewDocument: true,
        onChange: vi.fn(),
        onSchemaStampGuard: asserted,
      }),
    );
    await settle();
    expect(asserted).not.toHaveBeenCalled();
  }, 30000);
});
