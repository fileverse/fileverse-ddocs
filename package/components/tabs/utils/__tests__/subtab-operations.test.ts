import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getTabsYdocNodes } from '../tab-utils';
import {
  canAddSubtab,
  createSubtabInDoc,
  deleteTabInDoc,
  duplicateTabInDoc,
  getTabTree,
  moveTabInDoc,
  restoreDeletedTabsInDoc,
} from '../tab-operations';
import { allStoredText, makeDoc, writeText } from './subtab-test-helpers';

/*
 * Edge cases of every subtab action, one behaviour per test. The shared
 * starting doc:
 *
 *   Research (r)
 *     Interviews (i)
 *       Round 1 (r1)
 *       Round 2 (r2)
 *     Survey (s)
 *   Plan (plan)
 *   Notes (notes)
 */

const start = () => {
  const doc = makeDoc(1);
  const nodes = getTabsYdocNodes(doc);
  doc.transact(() => {
    [
      ['r', 'Research', null],
      ['i', 'Interviews', 'r'],
      ['r1', 'Round 1', 'i'],
      ['r2', 'Round 2', 'i'],
      ['s', 'Survey', 'r'],
      ['plan', 'Plan', null],
      ['notes', 'Notes', null],
    ].forEach(([id, name, parentId]) => {
      nodes.order.push([id!]);
      nodes.nameById.set(id!, name!);
      nodes.emojiById.set(id!, null);
      if (parentId) nodes.parentById.set(id!, parentId);
    });
  });
  return doc;
};

const outline = (doc: Y.Doc) =>
  getTabTree(doc).map((t) => `${'  '.repeat((t.depth ?? 1) - 1)}${t.id}`);
const order = (doc: Y.Doc) => getTabsYdocNodes(doc).order.toArray();
const ids = (doc: Y.Doc) => getTabTree(doc).map((t) => t.id);

describe('add subtab', () => {
  it('names it after the number of subtabs its parent will have', () => {
    const doc = start();
    createSubtabInDoc(doc, 'i', 'r3', false);
    createSubtabInDoc(doc, 'notes', 'n1', false);
    const names = getTabsYdocNodes(doc).nameById;
    expect(names.get('r3')).toBe('Subtab 3');
    expect(names.get('n1')).toBe('Subtab 1');
  });

  it('can repeat a name after a sibling is deleted, as tabs do today', () => {
    const doc = start();
    deleteTabInDoc(doc, 'r1', '', false);
    createSubtabInDoc(doc, 'i', 'again', false);
    expect(getTabsYdocNodes(doc).nameById.get('again')).toBe('Subtab 2');
  });

  it('opens the new subtab for the owner', () => {
    const doc = start();
    createSubtabInDoc(doc, 'plan', 'p1', true);
    expect(getTabsYdocNodes(doc).tabState.get('activeTabId')).toBe('p1');
  });

  it('refuses a parent that is deleted, hidden, missing or at level 3', () => {
    const doc = start();
    deleteTabInDoc(doc, 'notes', '', false);
    expect(createSubtabInDoc(doc, 'notes', 'x1', false)).toBeNull();
    expect(createSubtabInDoc(doc, 'nope', 'x2', false)).toBeNull();
    expect(createSubtabInDoc(doc, 'r1', 'x3', false)).toBeNull();
    expect(canAddSubtab(getTabTree(doc).find((t) => t.id === 'r1'))).toBe(
      false,
    );
    expect(getTabsYdocNodes(doc).nameById.has('x1')).toBe(false);
  });

  it('writes the new record only once a subtab exists', () => {
    const doc = makeDoc(1);
    const nodes = getTabsYdocNodes(doc);
    doc.transact(() => {
      nodes.order.push(['a']);
      nodes.nameById.set('a', 'A');
    });
    expect(nodes.parentById.size).toBe(0);
    createSubtabInDoc(doc, 'a', 'a1', false);
    expect(nodes.parentById.toJSON()).toEqual({ a1: 'a' });
  });
});

describe('move', () => {
  it('moves down past a sibling group, keeping both groups whole', () => {
    const doc = start();
    moveTabInDoc(doc, 'plan', 'r'); // Research below Plan
    expect(outline(doc)).toEqual([
      'plan',
      'r',
      '  i',
      '    r1',
      '    r2',
      '  s',
      'notes',
    ]);
    expect(order(doc)).toEqual(['plan', 'r', 'i', 'r1', 'r2', 's', 'notes']);
  });

  it('moves a subtab group up among its siblings', () => {
    const doc = start();
    moveTabInDoc(doc, 'i', 's'); // Survey above Interviews
    expect(outline(doc)).toEqual([
      'r',
      '  s',
      '  i',
      '    r1',
      '    r2',
      'plan',
      'notes',
    ]);
  });

  it('refuses moves that are not between siblings', () => {
    const doc = start();
    const before = order(doc);
    expect(moveTabInDoc(doc, 'plan', 'i')).toBe(false); // into another group
    expect(moveTabInDoc(doc, 'r1', 's')).toBe(false); // different parents
    expect(moveTabInDoc(doc, 'r', 'r')).toBe(false); // onto itself
    expect(moveTabInDoc(doc, 'r', 'ghost')).toBe(false); // unknown tab
    expect(order(doc)).toEqual(before);
  });

  it('copes with a duplicated id left in the order by an earlier race', () => {
    const doc = start();
    getTabsYdocNodes(doc).order.push(['r1']);
    moveTabInDoc(doc, 'r1', 'r2');
    expect(outline(doc).slice(2, 4)).toEqual(['    r2', '    r1']);
    expect(new Set(ids(doc)).size).toBe(ids(doc).length);
  });
});

describe('duplicate', () => {
  const counter = () => {
    let n = 0;
    return () => `c${++n}`;
  };

  it('copies a level-3 subtab next to itself, under the same parent', () => {
    const doc = start();
    duplicateTabInDoc(doc, 'r1', counter(), false);
    expect(outline(doc).slice(2, 5)).toEqual(['    r1', '    c1', '    r2']);
  });

  it('copies a top-level group after the whole group', () => {
    const doc = start();
    duplicateTabInDoc(doc, 'r', counter(), false);
    expect(outline(doc)).toEqual([
      'r',
      '  i',
      '    r1',
      '    r2',
      '  s',
      'c1',
      '  c2',
      '    c3',
      '    c4',
      '  c5',
      'plan',
      'notes',
    ]);
  });

  it('keeps names and emojis; only the top copy is marked (Copy)', () => {
    const doc = start();
    getTabsYdocNodes(doc).emojiById.set('r1', '🎯');
    duplicateTabInDoc(doc, 'i', counter(), false);
    const { nameById, emojiById } = getTabsYdocNodes(doc);
    expect(nameById.get('c1')).toBe('Interviews (Copy)');
    expect(nameById.get('c2')).toBe('Round 1');
    expect(emojiById.get('c2')).toBe('🎯');
  });

  it('copies the text and leaves the original untouched', () => {
    const doc = start();
    writeText(doc, 'r2', 'original words');
    duplicateTabInDoc(doc, 'i', counter(), false);
    writeText(doc, 'c3', 'only in the copy');
    expect(doc.getXmlFragment('r2').toString()).toContain('original words');
    expect(doc.getXmlFragment('r2').toString()).not.toContain(
      'only in the copy',
    );
    expect(doc.getXmlFragment('c3').toString()).toContain('original words');
  });

  it('opens the copy for the owner', () => {
    const doc = start();
    duplicateTabInDoc(doc, 'i', counter(), true);
    expect(getTabsYdocNodes(doc).tabState.get('activeTabId')).toBe('c1');
  });
});

describe('delete and undo', () => {
  it('open tab deep inside the group falls back to the group parent', () => {
    const doc = start();
    expect(deleteTabInDoc(doc, 'i', 'r2', false).fallbackId).toBe('r');
  });

  it('open tab outside the group does not move', () => {
    const doc = start();
    expect(deleteTabInDoc(doc, 'i', 'plan', false).fallbackId).toBeNull();
  });

  it('open top-level group falls back to the next, else previous, top-level tab', () => {
    const doc = start();
    expect(deleteTabInDoc(doc, 'r', 'r1', false).fallbackId).toBe('plan');
    expect(deleteTabInDoc(doc, 'notes', 'notes', false).fallbackId).toBe(
      'plan',
    );
  });

  it('writes the fallback for the owner', () => {
    const doc = start();
    deleteTabInDoc(doc, 'i', 'r1', true);
    expect(getTabsYdocNodes(doc).tabState.get('activeTabId')).toBe('r');
  });

  it('never deletes the last top-level tab, even with subtabs under it', () => {
    const doc = start();
    deleteTabInDoc(doc, 'plan', '', false);
    deleteTabInDoc(doc, 'notes', '', false);
    expect(() => deleteTabInDoc(doc, 'r', '', false)).toThrow(
      'Cannot delete the last remaining tab',
    );
    expect(() => deleteTabInDoc(doc, 'i', '', false)).not.toThrow();
  });

  it('keeps every word of every deleted tab in the doc', () => {
    const doc = start();
    ['r', 'i', 'r1', 'r2', 's'].forEach((id) =>
      writeText(doc, id, `text-${id}`),
    );
    deleteTabInDoc(doc, 'r', '', false);
    ['r', 'i', 'r1', 'r2', 's'].forEach((id) =>
      expect(allStoredText(doc)).toContain(`text-${id}`),
    );
  });

  it('undo puts the group back exactly where it was', () => {
    const doc = start();
    const before = { outline: outline(doc), order: order(doc) };
    const { snapshots } = deleteTabInDoc(doc, 'i', '', false);
    restoreDeletedTabsInDoc(doc, snapshots, false);
    expect(outline(doc)).toEqual(before.outline);
    expect(order(doc)).toEqual(before.order);
  });

  it('undo after someone already restored part of it adds no duplicates', () => {
    const doc = start();
    const { snapshots } = deleteTabInDoc(doc, 'i', '', false);
    restoreDeletedTabsInDoc(doc, [snapshots[0]], false); // a peer restored i
    expect(restoreDeletedTabsInDoc(doc, snapshots, false)).toBe(true);
    expect(new Set(order(doc)).size).toBe(order(doc).length);
    expect(outline(doc)).toContain('    r2');
  });

  it('undo with nothing left to restore does nothing', () => {
    const doc = start();
    const { snapshots } = deleteTabInDoc(doc, 'r2', '', false);
    restoreDeletedTabsInDoc(doc, snapshots, false);
    const bytes = Y.encodeStateAsUpdate(doc);
    expect(restoreDeletedTabsInDoc(doc, snapshots, false)).toBe(false);
    expect(Y.encodeStateAsUpdate(doc)).toEqual(bytes);
  });
});

describe('a subtab whose parent has not arrived yet', () => {
  it('shows at the top level and can be used normally', () => {
    const doc = start();
    getTabsYdocNodes(doc).parentById.set('notes', 'not-synced-yet');
    expect(outline(doc)).toContain('notes');
    // It looks top-level, so it can get a subtab; once its parent arrives it
    // may sit one level deeper than three. It is still shown (rule T5).
    expect(createSubtabInDoc(doc, 'notes', 'n1', false)).toBe('n1');
  });
});
