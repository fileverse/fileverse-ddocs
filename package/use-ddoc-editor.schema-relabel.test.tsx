// package/use-ddoc-editor.schema-relabel.test.tsx
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
 * Regression for the 2026-10-13 production wipe. An owner's v1 doc (pre
 * schema-marker, dBlock-wrapped) whose body already sits in the local
 * y-indexeddb store was mounted by the host with an empty initialContent.
 * The package read "owner, no collab, no body" as a brand-new doc, stamped
 * schemaVersion 2 once the store synced, rebuilt as a v2 editor, could not
 * render the replayed dBlocks and wrote the empty doc back: every tab gone.
 *
 * Real editor hook, real y-indexeddb over fake-indexeddb, no mocks.
 */

const TEXT = 'July text that must survive';

const v1Body = () => {
  const doc = new Y.Doc();
  writeJSONContentToYjsField({
    ydoc: doc,
    field: 'default',
    schemaVersion: 1,
    content: {
      type: 'doc',
      content: [
        {
          type: 'dBlock',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: TEXT }] },
          ],
        },
      ],
    },
  });
  return fromUint8Array(Y.encodeStateAsUpdate(doc));
};

// An earlier session left the v1 body in this doc's store.
const seedStore = async (ddocId: string) => {
  const prior = new Y.Doc();
  Y.applyUpdate(prior, toUint8Array(v1Body()));
  const provider = new IndexeddbPersistence(ddocId, prior);
  await provider.whenSynced;
  await provider.destroy();
};

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });

describe('useDdocEditor schema stamp over an existing v1 store', () => {
  it('keeps a v1 doc at schema 1 and intact when the host passes an empty body', async () => {
    const ddocId = `relabel-${Date.now()}`;
    await seedStore(ddocId);
    const onSchemaStampGuard = vi.fn();

    const { result } = renderHook(() =>
      useDdocEditor({
        ddocId,
        isDDocOwner: true,
        enableIndexeddbSync: true,
        preferredSchemaVersion: 2,
        initialContent: '',
        onChange: vi.fn(),
        onSchemaStampGuard,
      }),
    );
    await settle();

    const { ydoc } = result.current;
    expect(ydoc.getMap(DDOC_META_ROOT_KEY).get(SCHEMA_VERSION_META_KEY)).toBe(
      undefined,
    );
    expect(result.current.docSchemaVersion).toBe(1);
    expect(ydoc.getXmlFragment('default').toString()).toContain(TEXT);
    expect(result.current.editor?.getText()).toContain(TEXT);
    // No stamp is requested any more for an unasserted doc, so the block
    // guard has nothing to refuse; the mount is reported instead.
    expect(onSchemaStampGuard).toHaveBeenCalledWith({
      kind: 'unasserted-new',
      preferredSchemaVersion: 2,
    });
    expect(onSchemaStampGuard).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'blocked' }),
    );

    // One ordinary edit: the body must still be there afterwards.
    await act(async () => {
      result.current.editor?.commands.focus('end');
      result.current.editor?.commands.insertContent(' more');
    });
    await settle();
    expect(ydoc.getXmlFragment('default').toString()).toContain(TEXT);
  }, 20000);

  it('still stamps a genuinely new doc (empty store, empty body, host asserts isNewDocument) with the preferred version', async () => {
    const { result } = renderHook(() =>
      useDdocEditor({
        ddocId: `fresh-${Date.now()}`,
        isDDocOwner: true,
        enableIndexeddbSync: true,
        preferredSchemaVersion: 2,
        initialContent: '',
        isNewDocument: true,
        onChange: vi.fn(),
      }),
    );
    await settle();
    expect(
      result.current.ydoc
        .getMap(DDOC_META_ROOT_KEY)
        .get(SCHEMA_VERSION_META_KEY),
    ).toBe(2);
    expect(result.current.docSchemaVersion).toBe(2);
  }, 20000);
});
