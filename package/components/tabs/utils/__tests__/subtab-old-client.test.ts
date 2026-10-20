import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getTabsYdocNodes, PARENT_ROOT_KEY } from '../tab-utils';
import { createSubtabInDoc, getTabTree } from '../tab-operations';
import {
  deriveTabsFromEncodedState as v7Derive,
  mergeTabAwareYjsUpdates as v7Merge,
  syncTabState as v7Sync,
} from './v7/v7-tab-utils';
import {
  v7CreateTab,
  v7DeleteTab,
  v7DuplicateTab,
  v7OrderTab,
} from './v7/v7-tab-ops';
import {
  allStoredText,
  copyDoc,
  encode,
  makeDoc,
  syncAll,
  writeText,
} from './subtab-test-helpers';
import { toUint8Array } from 'js-base64';

/*
 * Someone still on 7.0.0 (a tab left open across a deploy, or production
 * before the upgrade) edits a doc that has subtabs. Nothing they do may lose
 * text or the subtab record, and the new app must still build the tree.
 */

const withSubtabs = () => {
  const doc = makeDoc(1);
  const nodes = getTabsYdocNodes(doc);
  doc.transact(() => {
    doc.getMap('ddocMeta').set('schemaVersion', 2);
    [
      ['default', 'Research'],
      ['plan', 'Plan'],
    ].forEach(([id, name]) => {
      nodes.order.push([id]);
      nodes.nameById.set(id, name);
      nodes.emojiById.set(id, null);
    });
  });
  createSubtabInDoc(doc, 'plan', 'q4', false);
  createSubtabInDoc(doc, 'q4', 'jan', false);
  writeText(doc, 'q4', 'quarter four');
  writeText(doc, 'jan', 'january');
  return doc;
};

const outline = (doc: Y.Doc) =>
  getTabTree(doc).map((t) => `${'  '.repeat((t.depth ?? 1) - 1)}${t.id}`);

describe('an older app (7.0.0) on a doc with subtabs', () => {
  it('opens it as a flat list in reading order, and its clean-up keeps the subtab record', () => {
    const content = encode(withSubtabs());
    const oldDoc = makeDoc(50);
    const opened = v7Derive(content, oldDoc);
    v7Sync(oldDoc);
    expect(opened.tabList.map((t) => t.id)).toEqual([
      'default',
      'plan',
      'q4',
      'jan',
    ]);
    expect(oldDoc.share.has(PARENT_ROOT_KEY)).toBe(true);
    expect(outline(oldDoc)).toEqual(['default', 'plan', '  q4', '    jan']);
  });

  it('deleting a parent on the old app hides its subtabs on the new app, text kept', () => {
    const fresh = withSubtabs();
    const old = copyDoc(fresh, 50);
    v7DeleteTab(old, 'plan');
    syncAll(fresh, old);
    expect(outline(fresh)).toEqual(['default']);
    expect(allStoredText(fresh)).toContain('january');
  });

  it('reordering a subtab on the old app keeps the tree on the new app', () => {
    const fresh = withSubtabs();
    const old = copyDoc(fresh, 50);
    v7OrderTab(old, 'default', 'jan'); // moved to the very top of the flat list
    syncAll(fresh, old);
    expect(outline(fresh)).toEqual(['default', 'plan', '  q4', '    jan']);
  });

  it('duplicating a subtab on the old app makes a top-level copy, nothing lost', () => {
    const fresh = withSubtabs();
    const old = copyDoc(fresh, 50);
    v7DuplicateTab(old, 'q4', 'q4copy');
    syncAll(fresh, old);
    expect(outline(fresh)).toContain('q4copy');
    expect(outline(fresh)).toContain('  q4');
    expect(allStoredText(fresh)).toContain('quarter four');
  });

  it('adding a tab on the old app adds a top-level tab', () => {
    const fresh = withSubtabs();
    const old = copyDoc(fresh, 50);
    v7CreateTab(old, 'oldnew');
    syncAll(fresh, old);
    expect(outline(fresh)).toEqual([
      'default',
      'plan',
      '  q4',
      '    jan',
      'oldnew',
    ]);
  });

  it("the old app's merge of two copies keeps the subtab record", () => {
    const a = withSubtabs();
    const b = copyDoc(a, 51);
    writeText(b, 'jan', 'from b');
    const merged = v7Merge([encode(a), encode(b)]);
    const doc = makeDoc(52);
    Y.applyUpdate(doc, toUint8Array(merged));
    expect(outline(doc)).toEqual(['default', 'plan', '  q4', '    jan']);
    expect(allStoredText(doc)).toContain('from b');
  });

  it('old and new app editing at the same time end up with the same doc', () => {
    const fresh = withSubtabs();
    const old = copyDoc(fresh, 50);
    createSubtabInDoc(fresh, 'default', 'r1', false);
    v7OrderTab(old, 'default', 'plan');
    writeText(old, 'jan', 'old app typing');
    syncAll(fresh, old);
    v7Sync(old); // the old app's clean-up after receiving the update
    syncAll(fresh, old);
    expect(encode(fresh)).toBe(encode(old));
    expect(outline(fresh)).toEqual(outline(old));
    expect(allStoredText(fresh)).toContain('old app typing');
  });
});
