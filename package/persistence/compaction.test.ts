// @vitest-environment node
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { compactDdocPersistence } from './compaction';

// Ported from fileverse-dsheet src/persistence-compaction.test.ts (c6f5179),
// plus the dDoc editor's own open sequence.

let dbCounter = 0;
const nextName = () => `ddoc-compaction-test-${++dbCounter}`;

const open = async (name: string, doc = new Y.Doc()) => {
  const persistence = new IndexeddbPersistence(name, doc);
  await persistence.whenSynced;
  return persistence;
};

const readRows = (name: string) =>
  new Promise<Uint8Array[]>((resolve, reject) => {
    const req = indexedDB.open(name);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const getAll = db
        .transaction('updates', 'readonly')
        .objectStore('updates')
        .getAll();
      getAll.onsuccess = () => {
        db.close();
        resolve(getAll.result as Uint8Array[]);
      };
      getAll.onerror = () => reject(getAll.error);
    };
  });

const bytes = (rows: Uint8Array[]) =>
  rows.reduce((total, row) => total + row.byteLength, 0);

const loadFromStore = async (name: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.mergeUpdates(await readRows(name)));
  return doc;
};

const text = (doc: Y.Doc) => doc.getText('body').toString();

// Reproduces today's store: each open applies the consumer's initialContent
// BEFORE attaching, so y-indexeddb stores a full copy per open. The body is
// rewritten between opens, so old copies carry content that is now deleted.
const buildBloatedStore = async (name: string, copies = 8, words = 300) => {
  const source = new Y.Doc();
  for (let copy = 0; copy < copies; copy++) {
    const body = source.getText('body');
    source.transact(() => {
      body.delete(0, body.length);
      body.insert(0, `copy ${copy} `.concat('lorem ipsum '.repeat(words)));
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
    const persistence = await open(name, doc);
    await persistence.destroy();
  }
  return source;
};

const restore: Array<() => void> = [];
afterEach(() => {
  while (restore.length) restore.pop()?.();
});

describe('compactDdocPersistence', () => {
  it('collapses a bloated store to one row the size of the live doc', async () => {
    const name = nextName();
    const source = await buildBloatedStore(name);
    const before = await readRows(name);

    const persistence = await open(name);
    const replaced = await compactDdocPersistence(persistence);
    const after = await readRows(name);
    const docBytes = Y.encodeStateAsUpdate(persistence.doc).byteLength;
    await persistence.destroy();

    // 8 full copies + this open's attach row.
    expect(replaced).toBe(before.length + 1);
    expect(after).toHaveLength(1);
    expect(bytes(after)).toBe(docBytes);
    expect(bytes(after) * 4).toBeLessThan(bytes(before));
    expect(text(await loadFromStore(name))).toBe(text(source));
  });

  it('keeps the store at about one copy across opens in the editor order', async () => {
    const name = nextName();
    // What the consumer hands back as initialContent: the last full state.
    let initialContent: Uint8Array | null = null;
    let expected = '';
    const sizes: number[] = [];

    for (let openCount = 1; openCount <= 5; openCount++) {
      const doc = new Y.Doc();
      if (initialContent) Y.applyUpdate(doc, initialContent, 'self');
      const persistence = await open(name, doc);
      await compactDdocPersistence(persistence);
      const body = doc.getText('body');
      body.insert(
        body.length,
        openCount === 1 ? 'lorem ipsum '.repeat(2000) : ` edit ${openCount}`,
      );
      initialContent = Y.encodeStateAsUpdate(doc);
      expected = text(doc);
      await persistence.destroy();
      sizes.push(bytes(await readRows(name)));
    }

    const rows = await readRows(name);
    expect(rows.length).toBeLessThanOrEqual(3);
    // Without compaction every open adds a full copy (~5x after 5 opens).
    expect(sizes[4]).toBeLessThan(sizes[0] * 1.5);
    expect(text(await loadFromStore(name))).toBe(expected);
  });

  it('leaves a normal open alone', async () => {
    const name = nextName();
    await buildBloatedStore(name, 3, 20);
    const first = await open(name);
    await compactDdocPersistence(first);
    await first.destroy();

    // Previous compacted row + this open's small attach row.
    const second = await open(name);
    expect(await compactDdocPersistence(second)).toBe(0);
    await second.destroy();
    expect(await readRows(name)).toHaveLength(2);
  });

  it('compacts again after a session of edits and stays at doc size', async () => {
    const name = nextName();
    await buildBloatedStore(name, 3, 50);
    const first = await open(name);
    await compactDdocPersistence(first);
    for (let i = 0; i < 50; i++) {
      first.doc.getText('body').insert(0, `edited-${i} `);
    }
    const expected = text(first.doc);
    await first.destroy();

    const second = await open(name);
    expect(await compactDdocPersistence(second)).toBeGreaterThan(0);
    const docBytes = Y.encodeStateAsUpdate(second.doc).byteLength;
    await second.destroy();

    const rows = await readRows(name);
    expect(rows).toHaveLength(1);
    expect(bytes(rows)).toBe(docBytes);
    expect(text(await loadFromStore(name))).toBe(expected);
  });

  it('keeps rows another tab writes after this provider synced', async () => {
    const name = nextName();
    await buildBloatedStore(name, 3, 20);
    const tabA = await open(name);
    const tabB = await open(name);
    tabB.doc.getMap('meta').set('fromOtherTab', 'kept');

    await compactDdocPersistence(tabA);
    await tabA.destroy();
    await tabB.destroy();

    expect((await loadFromStore(name)).getMap('meta').get('fromOtherTab')).toBe(
      'kept',
    );
  });

  it('keeps _dbsize equal to the real row count, edits included', async () => {
    const name = nextName();
    await buildBloatedStore(name, 4, 20);
    const persistence = await open(name);
    // y-indexeddb sets _dbref/_dbsize after emitting 'synced'; a read
    // transaction queues behind its sync transaction.
    await readRows(name);
    expect(persistence._dbsize).toBe(5);

    const compaction = compactDdocPersistence(persistence);
    persistence.doc.getText('body').insert(0, 'during compaction ');
    expect(await compaction).toBe(5);

    const rows = await readRows(name);
    expect(rows).toHaveLength(2);
    expect(persistence._dbsize).toBe(rows.length);
    await persistence.destroy();
  });

  it('rolls back and rejects with the original error', async () => {
    const name = nextName();
    await buildBloatedStore(name, 3, 20);
    const persistence = await open(name);
    const before = await readRows(name);

    const originalDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function () {
      throw new Error('boom');
    };
    restore.push(() => {
      IDBObjectStore.prototype.delete = originalDelete;
    });

    await expect(compactDdocPersistence(persistence)).rejects.toThrow('boom');
    restore.pop()?.();
    await persistence.destroy();

    const after = await readRows(name);
    expect(after).toHaveLength(before.length);
    expect(bytes(after)).toBe(bytes(before));
  });

  it('clamps minRows so a tiny store is never rewritten', async () => {
    const name = nextName();
    const persistence = await open(name);
    await expect(compactDdocPersistence(persistence, 0)).resolves.toBe(0);
    await persistence.destroy();
    expect(await readRows(name)).toHaveLength(1);
  });

  it('does nothing once the provider is destroyed', async () => {
    const name = nextName();
    await buildBloatedStore(name, 3, 20);
    const persistence = await open(name);
    await persistence.destroy();
    expect(await compactDdocPersistence(persistence)).toBe(0);
  });
});
