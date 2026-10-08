// @vitest-environment node
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { fromUint8Array } from 'js-base64';
import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import {
  deleteDdocContent,
  getDdocContentFingerprint,
  mergeDdocContent,
  readDdocContent,
} from './ddoc-persistence';
import { watchIndexeddbConnection } from './provider-lifecycle';

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

const ID = 'ddoc-1';

const encode = (doc: Y.Doc) => fromUint8Array(Y.encodeStateAsUpdate(doc));

const docWithText = (value: string) => {
  const doc = new Y.Doc();
  doc.getText('body').insert(0, value);
  return doc;
};

const decodeText = (encodedState: string | null) => {
  const doc = new Y.Doc();
  if (encodedState) {
    Y.applyUpdate(doc, Buffer.from(encodedState, 'base64'));
  }
  return doc.getText('body').toString();
};

/** An editor session: IndexeddbPersistence attached the way the editor does. */
const openEditor = async (name: string, doc = new Y.Doc()) => {
  const persistence = new IndexeddbPersistence(name, doc);
  await persistence.whenSynced;
  return persistence;
};

const databaseNames = async () =>
  (await indexedDB.databases()).map((database) => database.name);

const rawOpen = (name: string, upgrade?: (db: IDBDatabase) => void) =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const rows = async (name: string) => {
  const db = await rawOpen(name);
  return new Promise<unknown[]>((resolve) => {
    const request = db
      .transaction('updates', 'readonly')
      .objectStore('updates')
      .getAll();
    request.onsuccess = () => {
      db.close();
      resolve(request.result);
    };
  });
};

const addRow = async (name: string, value: unknown) => {
  const db = await rawOpen(name);
  await new Promise<void>((resolve) => {
    const tx = db.transaction('updates', 'readwrite');
    tx.objectStore('updates').add(value);
    tx.oncomplete = () => resolve();
  });
  db.close();
};

describe('readDdocContent', () => {
  it('reports missing and creates nothing', async () => {
    const result = await readDdocContent(ID);
    expect(result).toMatchObject({ status: 'missing', encodedState: null });
    expect(await databaseNames()).not.toContain(ID);
  });

  it('reports missing without databases() and still creates nothing', async () => {
    const factory = indexedDB as IDBFactory & { databases?: unknown };
    const databases = factory.databases;
    Object.defineProperty(factory, 'databases', {
      value: undefined,
      configurable: true,
    });
    try {
      expect((await readDdocContent(ID)).status).toBe('missing');
    } finally {
      Object.defineProperty(factory, 'databases', {
        value: databases,
        configurable: true,
      });
    }
    expect(await databaseNames()).not.toContain(ID);
  });

  it('returns what the editor stored', async () => {
    const editor = await openEditor(ID, docWithText('hello'));
    editor.doc.getText('body').insert(5, ' world');
    await editor.destroy();

    const result = await readDdocContent(ID);
    expect(result.status).toBe('available');
    expect(decodeText(result.encodedState)).toBe('hello world');
  });

  it('matches what a fresh editor replays from the same rows', async () => {
    const first = await openEditor(ID, docWithText('one'));
    first.doc.getText('body').insert(3, ' two');
    await first.destroy();
    const second = await openEditor(ID);
    second.doc.getText('body').delete(0, 4);
    await second.destroy();

    const replay = await openEditor(ID);
    const expected = replay.doc.getText('body').toString();
    await replay.destroy();

    const result = await readDdocContent(ID);
    expect(decodeText(result.encodedState)).toBe(expected);
    expect(expected).toBe('two');
  });

  it('reports empty for a database with no content', async () => {
    const editor = await openEditor(ID);
    await editor.destroy();
    expect((await readDdocContent(ID)).status).toBe('empty');
  });

  it('reports corrupt for a database without the y-indexeddb schema', async () => {
    const db = await rawOpen(ID, (upgrade) =>
      upgrade.createObjectStore('updates', { autoIncrement: true }),
    );
    db.close();
    const result = await readDdocContent(ID);
    expect(result.status).toBe('corrupt');
    expect(result.error).toBeInstanceOf(Error);
  });

  it('reports corrupt for a row that is not a Yjs update', async () => {
    const editor = await openEditor(ID, docWithText('hello'));
    await editor.destroy();
    await addRow(ID, 'not an update');
    expect((await readDdocContent(ID)).status).toBe('corrupt');
  });

  it('reports timed-out when the read does not finish in time', async () => {
    const editor = await openEditor(ID, docWithText('hello'));
    await editor.destroy();
    // An open that never completes (another tab holding an upgrade, say).
    const factory = indexedDB;
    const open = factory.open.bind(factory);
    factory.open = () => ({}) as IDBOpenDBRequest;
    try {
      expect((await readDdocContent(ID, { timeoutMs: 20 })).status).toBe(
        'timed-out',
      );
    } finally {
      factory.open = open;
    }
  });

  it('shares one in-flight read per id', async () => {
    const editor = await openEditor(ID, docWithText('hello'));
    await editor.destroy();
    const first = readDdocContent(ID);
    expect(readDdocContent(ID)).toBe(first);
    await first;
    const next = readDdocContent(ID);
    expect(next).not.toBe(first);
    await next;
  });

  it('reports unavailable without IndexedDB', async () => {
    const saved = globalThis.indexedDB;
    // @ts-expect-error simulating an environment without IndexedDB
    delete globalThis.indexedDB;
    try {
      expect((await readDdocContent(ID)).status).toBe('unavailable');
    } finally {
      globalThis.indexedDB = saved;
    }
  });
});

describe('mergeDdocContent', () => {
  it('creates a missing database the editor then opens as its own', async () => {
    const result = await mergeDdocContent(ID, encode(docWithText('seeded')));
    expect(result).toMatchObject({ status: 'available', changed: true });

    const editor = await openEditor(ID);
    expect(editor.doc.getText('body').toString()).toBe('seeded');
    await editor.destroy();
  });

  it('writes nothing when the state is already stored', async () => {
    const source = docWithText('hello');
    await mergeDdocContent(ID, encode(source));
    const before = (await rows(ID)).length;

    const again = await mergeDdocContent(ID, encode(source));
    expect(again).toMatchObject({ status: 'available', changed: false });
    expect((await rows(ID)).length).toBe(before);
  });

  it('writes only the missing part as one row', async () => {
    const source = docWithText('lorem ipsum '.repeat(500));
    await mergeDdocContent(ID, encode(source));
    const fullSize = Y.encodeStateAsUpdate(source).byteLength;

    source.getText('body').insert(0, 'new ');
    const result = await mergeDdocContent(ID, encode(source));
    const stored = (await rows(ID)) as Uint8Array[];

    expect(result.changed).toBe(true);
    expect(stored).toHaveLength(2);
    expect(stored[1].byteLength).toBeLessThan(fullSize / 10);
    expect(decodeText(result.encodedState)).toBe(
      source.getText('body').toString(),
    );
  });

  it('stores a delete-only change', async () => {
    const source = docWithText('hello world');
    await mergeDdocContent(ID, encode(source));
    source.getText('body').delete(0, 6);

    const result = await mergeDdocContent(ID, encode(source));
    expect(result.changed).toBe(true);
    expect(decodeText((await readDdocContent(ID)).encodedState)).toBe('world');
  });

  it('keeps edits written before and after it by an open editor', async () => {
    const editor = await openEditor(ID, docWithText('a'));
    editor.doc.getText('body').insert(1, 'b');

    const published = new Y.Doc();
    published.getMap('meta').set('fromChain', true);
    await mergeDdocContent(ID, encode(published));

    editor.doc.getText('body').insert(2, 'c');
    await editor.destroy();

    const replay = await openEditor(ID);
    expect(replay.doc.getText('body').toString()).toBe('abc');
    expect(replay.doc.getMap('meta').get('fromChain')).toBe(true);
    await replay.destroy();
  });

  it('writes nothing and creates nothing for invalid input', async () => {
    const result = await mergeDdocContent(
      ID,
      fromUint8Array(new Uint8Array([255, 255, 255])),
    );
    expect(result).toMatchObject({ status: 'corrupt', changed: false });
    expect(await databaseNames()).not.toContain(ID);
  });

  it('writes nothing when a stored row is corrupt', async () => {
    const editor = await openEditor(ID, docWithText('hello'));
    await editor.destroy();
    await addRow(ID, 'not an update');
    const before = (await rows(ID)).length;

    const result = await mergeDdocContent(ID, encode(docWithText('other')));
    expect(result).toMatchObject({ status: 'corrupt', changed: false });
    expect((await rows(ID)).length).toBe(before);
  });
});

describe('deleteDdocContent', () => {
  it('deletes the database', async () => {
    await mergeDdocContent(ID, encode(docWithText('hello')));
    expect(await deleteDdocContent(ID)).toEqual({
      ddocId: ID,
      status: 'deleted',
    });
    expect((await readDdocContent(ID)).status).toBe('missing');
  });

  it('treats a missing database as deleted', async () => {
    expect((await deleteDdocContent(ID)).status).toBe('deleted');
  });

  it('reports blocked while another connection holds the database', async () => {
    await mergeDdocContent(ID, encode(docWithText('hello')));
    const held = await rawOpen(ID);

    const result = await deleteDdocContent(ID, { timeoutMs: 50 });
    expect(result.status).toBe('blocked');

    held.close();
    // The browser keeps the delete queued and finishes it now.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await databaseNames()).not.toContain(ID);
  });

  it('is not blocked by a watched editor, which detaches', async () => {
    const editor = await openEditor(ID, docWithText('hello'));
    const errors: Error[] = [];
    let detached = false;
    watchIndexeddbConnection(editor, {
      onError: (error) => errors.push(error),
      onDetached: () => {
        detached = true;
      },
    });

    expect((await deleteDdocContent(ID, { timeoutMs: 500 })).status).toBe(
      'deleted',
    );
    expect(detached).toBe(true);
    expect(errors).toHaveLength(1);
    // Editing continues in memory instead of throwing InvalidStateError.
    expect(() => editor.doc.getText('body').insert(0, 'x')).not.toThrow();
  });
});

describe('getDdocContentFingerprint', () => {
  it('is 44 characters and changes on insert, delete-only and format-only edits', async () => {
    const doc = docWithText('hello world');
    const original = await getDdocContentFingerprint(encode(doc));
    expect(original).toHaveLength(44);

    doc.getText('body').delete(0, 6);
    const afterDelete = await getDdocContentFingerprint(encode(doc));
    expect(afterDelete).not.toBe(original);

    doc.getText('body').format(0, 5, { bold: true });
    const afterFormat = await getDdocContentFingerprint(encode(doc));
    expect(afterFormat).not.toBe(afterDelete);

    doc.getText('body').insert(0, '!');
    expect(await getDdocContentFingerprint(encode(doc))).not.toBe(afterFormat);
  });

  it('is the same for the same state however it was produced', async () => {
    const editor = await openEditor(ID, docWithText('hello'));
    editor.doc.getText('body').insert(5, ' world');
    editor.doc.getText('body').delete(0, 1);
    const live = await getDdocContentFingerprint(encode(editor.doc));
    await editor.destroy();

    const stored = (await readDdocContent(ID)).encodedState as string;
    expect(await getDdocContentFingerprint(stored)).toBe(live);
  });
});
