import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';
import {
  deriveTabsFromEncodedState,
  getTabsYdocNodes,
  PARENT_ROOT_KEY,
  syncTabState,
} from '../tab-utils';
import {
  deleteTabInDoc,
  duplicateTabInDoc,
  moveTabInDoc,
  restoreDeletedTabsInDoc,
} from '../tab-operations';
import { buildVersionDiffSnapshot } from '../version-diff-snapshot';
import { describeDdocContent } from '../../../../persistence/content-fingerprint';
import {
  deriveTabsFromEncodedState as v7Derive,
  syncTabState as v7Sync,
} from './v7/v7-tab-utils';
import {
  v7CreateTab,
  v7DeleteTab,
  v7DuplicateTab,
  v7OrderTab,
  v7RestoreDeletedTab,
} from './v7/v7-tab-ops';
import {
  copyDoc,
  encode,
  existingDocFixtures,
  makeDoc,
} from './subtab-test-helpers';

/*
 * An existing document must behave exactly as on 7.0.0 until someone adds a
 * subtab to it. Every check runs the 7.0.0 tab code and the new code on the
 * same document and compares the results byte for byte.
 */

const openNew = (content: string) => {
  const doc = makeDoc(99);
  const result = deriveTabsFromEncodedState(content, doc);
  syncTabState(doc); // what the tab manager runs again once mounted
  return { doc, result };
};

const openOld = (content: string) => {
  const doc = makeDoc(99);
  const result = v7Derive(content, doc);
  v7Sync(doc);
  return { doc, result };
};

const decode = (content: string) => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, toUint8Array(content));
  return doc;
};

describe.each(Object.entries(existingDocFixtures))(
  'existing doc: %s',
  (_name, buildFixture) => {
    const content = buildFixture();

    it('opens to the same tab list and open tab as 7.0.0', () => {
      const fresh = openNew(content);
      const old = openOld(content);
      expect(fresh.result.tabList).toEqual(old.result.tabList);
      expect(fresh.result.activeTabId).toBe(old.result.activeTabId);
      expect(fresh.result.didWrite).toBe(old.result.didWrite);
    });

    it('writes exactly the same bytes as 7.0.0 when opened', () => {
      expect(encode(openNew(content).doc)).toBe(encode(openOld(content).doc));
    });

    it('keeps the same content fingerprint as 7.0.0 when opened', () => {
      expect(describeDdocContent(openNew(content).doc)).toBe(
        describeDdocContent(openOld(content).doc),
      );
    });

    it('never stores the subtab record just by opening', () => {
      const reopened = decode(encode(openNew(content).doc));
      expect(reopened.share.has(PARENT_ROOT_KEY)).toBe(false);
    });

    it('shows the same tabs in version history as 7.0.0', () => {
      const snapshot = buildVersionDiffSnapshot(content);
      const old = v7Derive(content, makeDoc(98), {
        createDefaultTabIfMissing: false,
      });
      expect(snapshot.tabs).toEqual(
        old.tabList.map((tab) => ({ id: tab.id, name: tab.name })),
      );
    });

    it.each([false, true])(
      'every tab action writes the same bytes as 7.0.0 (owner sync: %s)',
      (shouldSyncActiveTab) => {
        const opened = openOld(content).doc;
        const oldDoc = copyDoc(opened, 7);
        const newDoc = copyDoc(opened, 7);

        const ids = openOld(content).result.tabList.map((tab) => tab.id);
        const first = ids[0];
        const last = ids[ids.length - 1];

        // Duplicate the first tab.
        v7DuplicateTab(oldDoc, first, 'DUP0001', shouldSyncActiveTab);
        duplicateTabInDoc(newDoc, first, () => 'DUP0001', shouldSyncActiveTab);
        expect(encode(newDoc)).toBe(encode(oldDoc));

        // Move the last tab to the top, then the top tab down one.
        v7OrderTab(oldDoc, first, last);
        moveTabInDoc(newDoc, first, last);
        v7OrderTab(oldDoc, 'DUP0001', last);
        moveTabInDoc(newDoc, 'DUP0001', last);
        expect(encode(newDoc)).toBe(encode(oldDoc));

        // Add a tab (unchanged code), delete it, undo, delete it again.
        v7CreateTab(oldDoc, 'NEW0001', shouldSyncActiveTab);
        v7CreateTab(newDoc, 'NEW0001', shouldSyncActiveTab);
        const oldDelete = v7DeleteTab(oldDoc, 'NEW0001', shouldSyncActiveTab);
        const newDelete = deleteTabInDoc(
          newDoc,
          'NEW0001',
          'NEW0001',
          shouldSyncActiveTab,
        );
        expect(newDelete.fallbackId).toBe(oldDelete.fallbackId);
        expect(encode(newDoc)).toBe(encode(oldDoc));

        v7RestoreDeletedTab(oldDoc, oldDelete.snapshot!, shouldSyncActiveTab);
        restoreDeletedTabsInDoc(
          newDoc,
          newDelete.snapshots,
          shouldSyncActiveTab,
        );
        expect(encode(newDoc)).toBe(encode(oldDoc));

        v7DeleteTab(oldDoc, first, shouldSyncActiveTab);
        deleteTabInDoc(newDoc, first, first, shouldSyncActiveTab);
        expect(encode(newDoc)).toBe(encode(oldDoc));

        // And the subtab record was never written.
        expect(getTabsYdocNodes(newDoc).parentById.size).toBe(0);
        expect(decode(encode(newDoc)).share.has(PARENT_ROOT_KEY)).toBe(false);
      },
    );
  },
);

describe('existing doc fingerprint', () => {
  it('does not change when a clean current doc is opened', () => {
    const content =
      existingDocFixtures['current doc with several tabs (schema 2)']();
    expect(describeDdocContent(openNew(content).doc)).toBe(
      describeDdocContent(decode(content)),
    );
  });
});
