import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getTabsYdocNodes } from '../tab-utils';
import {
  createSubtabInDoc,
  deleteTabInDoc,
  duplicateTabInDoc,
  getTabTree,
  moveTabInDoc,
  restoreDeletedTabsInDoc,
} from '../tab-operations';
import {
  allStoredText,
  copyDoc,
  makeDoc,
  syncAll,
  writeText,
} from './subtab-test-helpers';

/*
 * Two or three people edit the same doc at the same moment, offline from each
 * other, then sync. Every test checks that all devices end with the same tree
 * and that every word anyone typed is still stored in the doc.
 */

const start = () => {
  const doc = makeDoc(1);
  const nodes = getTabsYdocNodes(doc);
  doc.transact(() => {
    [
      ['r', 'Research'],
      ['plan', 'Plan'],
      ['notes', 'Notes'],
    ].forEach(([id, name]) => {
      nodes.order.push([id]);
      nodes.nameById.set(id, name);
      nodes.emojiById.set(id, null);
    });
  });
  createSubtabInDoc(doc, 'r', 'i', false);
  createSubtabInDoc(doc, 'i', 'r1', false);
  createSubtabInDoc(doc, 'i', 'r2', false);
  createSubtabInDoc(doc, 'plan', 'q4', false);
  writeText(doc, 'r1', 'round one');
  writeText(doc, 'q4', 'quarter four');
  return doc;
};

const people = (count: number) => {
  const origin = start();
  return Array.from({ length: count }, (_, i) => copyDoc(origin, 100 + i));
};

const ids = (doc: Y.Doc) => getTabTree(doc).map((tab) => tab.id);

const expectSameTree = (...docs: Y.Doc[]) => {
  const first = JSON.stringify(getTabTree(docs[0]));
  docs.forEach((doc) => expect(JSON.stringify(getTabTree(doc))).toBe(first));
  const list = ids(docs[0]);
  expect(new Set(list).size).toBe(list.length); // no tab twice
};

const expectTextKept = (doc: Y.Doc, words: string[]) =>
  words.forEach((word) => expect(allStoredText(doc)).toContain(word));

describe('two people at once', () => {
  it('both reorder the same tab: same order everywhere, nothing doubled', () => {
    const [a, b] = people(2);
    moveTabInDoc(a, 'r', 'notes'); // Notes to the top
    moveTabInDoc(b, 'plan', 'notes'); // Notes between Research and Plan
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a).filter((id) => id === 'notes')).toHaveLength(1);
    expectTextKept(a, ['round one', 'quarter four']);
  });

  it('both reorder siblings under one parent', () => {
    const [a, b] = people(2);
    moveTabInDoc(a, 'r1', 'r2');
    moveTabInDoc(b, 'r2', 'r1');
    syncAll(a, b);
    expectSameTree(a, b);
    const tree = getTabTree(a);
    expect(
      tree
        .filter((t) => t.parentId === 'i')
        .map((t) => t.id)
        .sort(),
    ).toEqual(['r1', 'r2']);
  });

  it('A deletes a tab while B adds a subtab under it', () => {
    const [a, b] = people(2);
    deleteTabInDoc(a, 'plan', 'plan', false);
    createSubtabInDoc(b, 'plan', 'late', false);
    writeText(b, 'late', 'typed by B');
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a)).not.toContain('late'); // hidden with its parent
    expectTextKept(a, ['typed by B', 'quarter four']);
    expectTextKept(b, ['typed by B', 'quarter four']);
  });

  it('A deletes a tab while B types in one of its subtabs', () => {
    const [a, b] = people(2);
    deleteTabInDoc(a, 'i', 'i', false);
    writeText(b, 'r1', 'B kept typing');
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a)).not.toContain('r1');
    expectTextKept(a, ['round one', 'B kept typing']);
  });

  it('A duplicates a group while B edits inside it', () => {
    const [a, b] = people(2);
    let n = 0;
    duplicateTabInDoc(a, 'i', () => `dup${++n}`, false);
    writeText(b, 'r2', 'edit during copy');
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a)).toContain('dup1');
    expectTextKept(a, ['round one', 'edit during copy']);
  });

  it('both add a subtab under the same tab: both kept', () => {
    const [a, b] = people(2);
    createSubtabInDoc(a, 'notes', 'na', false);
    createSubtabInDoc(b, 'notes', 'nb', false);
    syncAll(a, b);
    expectSameTree(a, b);
    expect(getTabTree(a).filter((t) => t.parentId === 'notes')).toHaveLength(2);
  });

  it('A deletes a subtab while B moves it', () => {
    const [a, b] = people(2);
    deleteTabInDoc(a, 'r2', 'r2', false);
    moveTabInDoc(b, 'r1', 'r2');
    syncAll(a, b);
    expectSameTree(a, b);
    // The move wrote a fresh copy of the id into the order; the deleted mark
    // still hides it.
    expect(ids(a)).not.toContain('r2');
  });

  it('three people, three different changes, in every delivery order', () => {
    const orders = [
      [0, 1, 2],
      [2, 1, 0],
      [1, 0, 2],
    ];
    const results = orders.map((order) => {
      const docs = people(3);
      deleteTabInDoc(docs[0], 'plan', 'plan', false);
      createSubtabInDoc(docs[1], 'i', 'r3', false);
      writeText(docs[1], 'r3', 'third round');
      moveTabInDoc(docs[2], 'r', 'notes');
      const [x, y, z] = order.map((i) => docs[i]);
      syncAll(x, y);
      syncAll(y, z);
      syncAll(x, y, z);
      expectSameTree(...docs);
      expectTextKept(docs[0], ['round one', 'quarter four', 'third round']);
      return JSON.stringify(getTabTree(docs[0]));
    });
    expect(new Set(results).size).toBe(1);
  });

  it('both delete the same group: deleted once, text kept', () => {
    const [a, b] = people(2);
    deleteTabInDoc(a, 'i', '', false);
    deleteTabInDoc(b, 'i', '', false);
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a)).not.toContain('i');
    expectTextKept(a, ['round one']);
  });

  it('A deletes a group while B duplicates it: the copy survives', () => {
    const [a, b] = people(2);
    deleteTabInDoc(a, 'i', '', false);
    let n = 0;
    duplicateTabInDoc(b, 'i', () => `dup${++n}`, false);
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a)).not.toContain('i');
    expect(ids(a)).toContain('dup1');
    expect(a.getXmlFragment('dup2').toString()).toContain('round one');
  });

  it('A undoes a delete while B edits inside the group', () => {
    const [a, b] = people(2);
    const { snapshots } = deleteTabInDoc(a, 'i', '', false);
    syncAll(a, b);
    writeText(b, 'r1', 'typed while deleted');
    restoreDeletedTabsInDoc(a, snapshots, false);
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a)).toEqual(expect.arrayContaining(['i', 'r1', 'r2']));
    expectTextKept(a, ['round one', 'typed while deleted']);
  });

  it('A undoes a delete while B moves a sibling of the group', () => {
    const [a, b] = people(2);
    const { snapshots } = deleteTabInDoc(a, 'plan', '', false);
    syncAll(a, b);
    moveTabInDoc(b, 'r', 'notes');
    restoreDeletedTabsInDoc(a, snapshots, false);
    syncAll(a, b);
    expectSameTree(a, b);
    expect(ids(a)).toEqual(expect.arrayContaining(['plan', 'q4']));
  });
});
