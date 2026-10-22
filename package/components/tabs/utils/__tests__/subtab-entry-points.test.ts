import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { toUint8Array } from 'js-base64';
import {
  deriveTabsFromEncodedState,
  getTabsYdocNodes,
  mergeTabAwareYjsUpdates,
  syncTabState,
} from '../tab-utils';
import { createSubtabInDoc, getTabTree } from '../tab-operations';
import { buildVersionDiffSnapshot } from '../version-diff-snapshot';
import { describeDdocContent } from '../../../../persistence/content-fingerprint';
import { docHasBlockContent } from '../../../../utils/schema-version';
import { copyDoc, encode, makeDoc, writeText } from './subtab-test-helpers';

/*
 * Every other way a doc reaches the tab code, checked with subtabs present:
 * opening, the clean-up pass, merging copies, version history, format
 * detection and the publish fingerprint.
 */

const withSubtabs = () => {
  const doc = makeDoc(1);
  const nodes = getTabsYdocNodes(doc);
  doc.transact(() => {
    doc.getMap('ddocMeta').set('schemaVersion', 2);
    nodes.order.push(['default', 'plan']);
    nodes.nameById.set('default', 'Research');
    nodes.nameById.set('plan', 'Plan');
    nodes.emojiById.set('default', null);
    nodes.emojiById.set('plan', null);
    nodes.tabState.set('activeTabId', 'default');
  });
  createSubtabInDoc(doc, 'plan', 'q4', false);
  createSubtabInDoc(doc, 'q4', 'jan', false);
  writeText(doc, 'default', 'research text');
  writeText(doc, 'jan', 'january text');
  return doc;
};

const outline = (doc: Y.Doc) =>
  getTabTree(doc).map((t) => `${'  '.repeat((t.depth ?? 1) - 1)}${t.id}`);

describe('opening a doc with subtabs', () => {
  it('returns the tree in reading order', () => {
    const doc = makeDoc(2);
    const { tabList } = deriveTabsFromEncodedState(encode(withSubtabs()), doc);
    expect(tabList.map((t) => [t.id, t.depth])).toEqual([
      ['default', 1],
      ['plan', 1],
      ['q4', 2],
      ['jan', 3],
    ]);
  });

  it('writes nothing when the doc is already clean', () => {
    const content = encode(withSubtabs());
    const doc = makeDoc(2);
    const { didWrite } = deriveTabsFromEncodedState(content, doc);
    expect(didWrite).toBe(false);
    expect(syncTabState(doc)).toBe(false);
    expect(encode(doc)).toBe(content);
  });
});

describe('the clean-up pass with subtabs', () => {
  it('leaves the subtab record alone', () => {
    const doc = withSubtabs();
    const before = getTabsYdocNodes(doc).parentById.toJSON();
    getTabsYdocNodes(doc).order.push(['plan']); // a duplicate to clean up
    syncTabState(doc);
    expect(getTabsYdocNodes(doc).parentById.toJSON()).toEqual(before);
    expect(outline(doc)).toEqual(['default', 'plan', '  q4', '    jan']);
  });

  it('puts back a subtab missing from the order, under its parent', () => {
    const doc = withSubtabs();
    const order = getTabsYdocNodes(doc).order;
    order.delete(order.toArray().indexOf('q4'), 1);
    expect(outline(doc)).not.toContain('  q4'); // q4 dropped, jan floats up
    syncTabState(doc);
    expect(outline(doc)).toEqual(['default', 'plan', '  q4', '    jan']);
  });
});

describe('merging two copies of a doc', () => {
  it('keeps the tree and every edit from both copies', () => {
    const a = withSubtabs();
    const b = copyDoc(a, 3);
    createSubtabInDoc(a, 'default', 'r1', false);
    writeText(b, 'jan', 'edited on b');
    const merged = makeDoc(4);
    Y.applyUpdate(
      merged,
      toUint8Array(mergeTabAwareYjsUpdates([encode(a), encode(b)])),
    );
    expect(outline(merged)).toEqual([
      'default',
      '  r1',
      'plan',
      '  q4',
      '    jan',
    ]);
    expect(merged.getXmlFragment('jan').toString()).toContain('edited on b');
  });
});

describe('version history', () => {
  it('lists subtabs in reading order with their text', () => {
    const snapshot = buildVersionDiffSnapshot(encode(withSubtabs()));
    expect(snapshot.tabs.map((t) => t.id)).toEqual([
      'default',
      'plan',
      'q4',
      'jan',
    ]);
    expect(JSON.stringify(snapshot.docByTabId.jan)).toContain('january text');
  });
});

describe('format detection', () => {
  it('sees text that lives only in a subtab', () => {
    const doc = makeDoc(1);
    const nodes = getTabsYdocNodes(doc);
    doc.transact(() => {
      nodes.order.push(['default']);
      nodes.nameById.set('default', 'Tab 1');
    });
    createSubtabInDoc(doc, 'default', 'only', false);
    expect(docHasBlockContent(doc)).toBe(false);
    writeText(doc, 'only', 'the only words');
    expect(docHasBlockContent(doc)).toBe(true);
  });
});

describe('publish fingerprint', () => {
  it('changes when a subtab is added, so the change gets published', () => {
    const doc = withSubtabs();
    const before = describeDdocContent(doc);
    createSubtabInDoc(doc, 'default', 'new1', false);
    expect(describeDdocContent(doc)).not.toBe(before);
  });

  it('does not change when the open tab changes', () => {
    const doc = withSubtabs();
    const before = describeDdocContent(doc);
    getTabsYdocNodes(doc).tabState.set('activeTabId', 'jan');
    expect(describeDdocContent(doc)).toBe(before);
  });
});
