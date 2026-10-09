// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { readDdocContent, repairDdocContent } from './ddoc-persistence';

// In this environment, rows read from IndexedDB are Uint8Arrays from another
// global (the same happens with workers and iframes), so `instanceof
// Uint8Array` is false for them. A healthy store must still read as healthy,
// and repair must not drop its rows.
describe('rows from another realm', () => {
  it('reads a healthy store as available and repairs nothing', async () => {
    const doc = new Y.Doc();
    doc.getText('body').insert(0, 'realm check');
    const persistence = new IndexeddbPersistence('realm-doc', doc);
    await persistence.whenSynced;
    await persistence.destroy();

    const read = await readDdocContent('realm-doc');
    expect(read.status).toBe('available');
    expect(await repairDdocContent('realm-doc')).toMatchObject({
      status: 'healthy',
      droppedRows: 0,
    });
  });
});
