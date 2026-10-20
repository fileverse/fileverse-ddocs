import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { getTabListFromNodes, getTabsYdocNodes } from '../tab-utils';
import {
  canAddSubtab,
  createSubtabInDoc,
  deleteTabInDoc,
  duplicateTabInDoc,
  getSubtreeIds,
  getTabTree,
  moveTabInDoc,
  restoreDeletedTabsInDoc,
} from '../tab-operations';
import { allStoredText, makeDoc, writeText } from './subtab-test-helpers';

/** Builds a doc from rows of [id, name, parentId?] plus optional deleted ids. */
const buildDoc = (
  rows: [string, string, string?][],
  deleted: string[] = [],
): Y.Doc => {
  const doc = makeDoc(1);
  const nodes = getTabsYdocNodes(doc);
  doc.transact(() => {
    rows.forEach(([id, name, parentId]) => {
      nodes.order.push([id]);
      nodes.nameById.set(id, name);
      nodes.emojiById.set(id, null);
      if (parentId) nodes.parentById.set(id, parentId);
    });
    deleted.forEach((id) => {
      nodes.nameById.delete(id);
      nodes.deletedById.set(id, true);
    });
  });
  return doc;
};

const outline = (doc: Y.Doc) =>
  getTabTree(doc).map(
    (tab) => `${'  '.repeat((tab.depth ?? 1) - 1)}${tab.name}`,
  );

describe('reading the tree', () => {
  it('a doc without subtabs gets exactly the old flat list', () => {
    const doc = buildDoc([
      ['a', 'A'],
      ['b', 'B'],
    ]);
    expect(getTabTree(doc)).toEqual([
      { id: 'a', name: 'A', emoji: null },
      { id: 'b', name: 'B', emoji: null },
    ]);
  });

  it('places subtabs under their parent in reading order', () => {
    const doc = buildDoc([
      ['r', 'Research'],
      ['plan', 'Plan'],
      ['i', 'Interviews', 'r'],
      ['r1', 'Round 1', 'i'],
      ['s', 'Survey', 'r'],
    ]);
    expect(outline(doc)).toEqual([
      'Research',
      '  Interviews',
      '    Round 1',
      '  Survey',
      'Plan',
    ]);
    const research = getTabTree(doc)[0];
    expect(research.hasChildren).toBe(true);
    expect(research.parentId).toBeNull();
  });

  it('T2: hides tabs under a deleted tab, keeps their text', () => {
    const doc = buildDoc(
      [
        ['a', 'A'],
        ['old', 'Old'],
        ['child', 'Child', 'old'],
        ['grand', 'Grandchild', 'child'],
      ],
      ['old'],
    );
    writeText(doc, 'grand', 'still here');
    expect(outline(doc)).toEqual(['A']);
    expect(allStoredText(doc)).toContain('still here');
  });

  it('T3: siblings follow their first appearance in the order list', () => {
    const doc = buildDoc([
      ['p', 'Parent'],
      ['c2', 'Second', 'p'],
      ['c1', 'First', 'p'],
    ]);
    getTabsYdocNodes(doc).order.push(['c2']); // duplicate left by a race
    expect(outline(doc)).toEqual(['Parent', '  Second', '  First']);
  });

  it('T4: an unknown parent shows the tab at the top level', () => {
    const doc = buildDoc([
      ['a', 'A'],
      ['stray', 'Stray', 'not-synced-yet'],
    ]);
    expect(outline(doc)).toEqual(['A', 'Stray']);
  });

  it('T4: a parent loop shows the tabs at the top level', () => {
    const doc = buildDoc([
      ['x', 'X', 'y'],
      ['y', 'Y', 'x'],
      ['z', 'Z', 'x'],
    ]);
    expect(outline(doc)).toEqual(['X', '  Z', 'Y']);
  });

  it('T5: deeper data than three levels is still shown', () => {
    const doc = buildDoc([
      ['1', 'L1'],
      ['2', 'L2', '1'],
      ['3', 'L3', '2'],
      ['4', 'L4', '3'],
    ]);
    expect(outline(doc)).toHaveLength(4);
    expect(getTabTree(doc)[3].depth).toBe(4);
  });
});

describe('writing', () => {
  const base = () =>
    buildDoc([
      ['r', 'Research'],
      ['i', 'Interviews', 'r'],
      ['r1', 'Round 1', 'i'],
      ['r2', 'Round 2', 'i'],
      ['plan', 'Plan'],
    ]);

  it('adds a subtab last under its parent, named by sibling count', () => {
    const doc = base();
    createSubtabInDoc(doc, 'i', 'r3', false);
    createSubtabInDoc(doc, 'plan', 'p1', false);
    expect(outline(doc)).toEqual([
      'Research',
      '  Interviews',
      '    Round 1',
      '    Round 2',
      '    Subtab 3',
      'Plan',
      '  Subtab 1',
    ]);
    // Stored order stays in reading order for older apps.
    expect(getTabsYdocNodes(doc).order.toArray()).toEqual([
      'r',
      'i',
      'r1',
      'r2',
      'r3',
      'plan',
      'p1',
    ]);
  });

  it('refuses a subtab under a level-3 tab', () => {
    const doc = base();
    const level3 = getTabTree(doc).find((tab) => tab.id === 'r1');
    expect(canAddSubtab(level3)).toBe(false);
    expect(createSubtabInDoc(doc, 'r1', 'deep', false)).toBeNull();
  });

  it('moves a tab with its subtabs among siblings only', () => {
    const doc = base();
    expect(moveTabInDoc(doc, 'r', 'plan')).toBe(true); // Plan above Research
    expect(outline(doc)).toEqual([
      'Plan',
      'Research',
      '  Interviews',
      '    Round 1',
      '    Round 2',
    ]);
    expect(moveTabInDoc(doc, 'r1', 'r2')).toBe(true); // Round 2 up
    expect(outline(doc).slice(3)).toEqual(['    Round 2', '    Round 1']);
    // Across groups: ignored.
    expect(moveTabInDoc(doc, 'plan', 'r1')).toBe(false);
  });

  it('duplicates the whole group right after the original', () => {
    const doc = base();
    writeText(doc, 'r1', 'round one notes');
    let n = 0;
    duplicateTabInDoc(doc, 'i', () => `copy${++n}`, false);
    expect(outline(doc)).toEqual([
      'Research',
      '  Interviews',
      '    Round 1',
      '    Round 2',
      '  Interviews (Copy)',
      '    Round 1',
      '    Round 2',
      'Plan',
    ]);
    expect(doc.getXmlFragment('copy2').toString()).toContain('round one notes');
  });

  it('deletes the whole group, keeps the text, and undo brings it back', () => {
    const doc = base();
    writeText(doc, 'r2', 'keep me');
    const { snapshots, fallbackId } = deleteTabInDoc(doc, 'i', 'r2', false);
    expect(fallbackId).toBe('r'); // open subtab falls back to the parent
    expect(outline(doc)).toEqual(['Research', 'Plan']);
    expect(allStoredText(doc)).toContain('keep me');

    restoreDeletedTabsInDoc(doc, snapshots, false);
    expect(outline(doc)).toEqual([
      'Research',
      '  Interviews',
      '    Round 1',
      '    Round 2',
      'Plan',
    ]);
  });

  it('will not delete the last top-level tab', () => {
    const doc = buildDoc([
      ['only', 'Only'],
      ['sub', 'Sub', 'only'],
    ]);
    expect(() => deleteTabInDoc(doc, 'only', 'only', false)).toThrow();
    expect(() => deleteTabInDoc(doc, 'sub', 'sub', false)).not.toThrow();
  });

  it('getSubtreeIds returns the tab and everything under it', () => {
    const tabs = getTabListFromNodes(getTabsYdocNodes(base()));
    expect(getSubtreeIds(tabs, 'i')).toEqual(['i', 'r1', 'r2']);
    expect(getSubtreeIds(tabs, 'plan')).toEqual(['plan']);
  });
});
