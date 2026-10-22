// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { applyTabbedTemplate } from './apply-tabbed-template';
import { FANFIC_TEMPLATE } from './fanfic-template';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import {
  ACTIVE_TAB_STATE_KEY,
  DEFAULT_TAB_ID,
  getActiveTabIdFromNodes,
  getTabListFromNodes,
  getTabsYdocNodes,
} from '../components/tabs/utils/tab-utils';

describe('applyTabbedTemplate', () => {
  let editor: Editor | null = null;
  let ydoc: Y.Doc | null = null;

  afterEach(() => {
    editor?.destroy();
    ydoc?.destroy();
  });

  it('reuses the active empty tab, appends three tabs, and preserves siblings', () => {
    ydoc = new Y.Doc();
    const tabNodes = getTabsYdocNodes(ydoc);
    ydoc.transact(() => {
      tabNodes.order.insert(0, [DEFAULT_TAB_ID, 'existing-tab']);
      tabNodes.nameById.set(DEFAULT_TAB_ID, 'Tab 1');
      tabNodes.emojiById.set(DEFAULT_TAB_ID, null);
      tabNodes.nameById.set('existing-tab', 'Existing');
      tabNodes.emojiById.set('existing-tab', '📌');
      tabNodes.tabState.set(ACTIVE_TAB_STATE_KEY, DEFAULT_TAB_ID);
      ydoc?.getXmlFragment('existing-tab');
    });
    editor = new Editor({
      extensions: getHeadlessExtensions({ ydoc, field: DEFAULT_TAB_ID }),
    });
    const flushPendingUpdate = vi.fn();

    applyTabbedTemplate({
      activeTabId: DEFAULT_TAB_ID,
      editor,
      flushPendingUpdate,
      template: FANFIC_TEMPLATE,
      ydoc,
    });

    const tabs = getTabListFromNodes(tabNodes);
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toMatchObject({ name: 'Ship Basis', emoji: '🥐' });
    expect(tabs[1]).toMatchObject({ name: 'Existing', emoji: '📌' });
    expect(tabs.slice(2).map((tab) => tab.name)).toEqual([
      'Plot & Outline',
      'Characters',
      'World & Canon',
    ]);
    expect(getActiveTabIdFromNodes(tabNodes)).toBe(DEFAULT_TAB_ID);
    expect(editor.getText()).toContain('Fanfic Planner');
    expect(flushPendingUpdate).toHaveBeenCalledOnce();
    // A doc without subtabs never gets a parent record.
    expect(tabNodes.parentById.size).toBe(0);
  });

  describe('with subtabs', () => {
    const TEMPLATE_REST = ['Plot & Outline', 'Characters', 'World & Canon'];

    // `tabs` in reading order; `parentOf` holds only subtabs.
    const applyIn = (
      activeTabId: string,
      tabs: string[],
      parentOf: Record<string, string>,
    ) => {
      ydoc = new Y.Doc();
      const tabNodes = getTabsYdocNodes(ydoc);
      ydoc.transact(() => {
        tabNodes.order.insert(0, tabs);
        tabs.forEach((id) => {
          tabNodes.nameById.set(id, id);
          tabNodes.emojiById.set(id, null);
          ydoc?.getXmlFragment(id);
        });
        Object.entries(parentOf).forEach(([id, parent]) =>
          tabNodes.parentById.set(id, parent),
        );
        tabNodes.tabState.set(ACTIVE_TAB_STATE_KEY, activeTabId);
      });
      editor = new Editor({
        extensions: getHeadlessExtensions({ ydoc, field: activeTabId }),
      });
      applyTabbedTemplate({
        activeTabId,
        editor,
        template: FANFIC_TEMPLATE,
        ydoc,
      });
      return getTabListFromNodes(tabNodes).map((tab) => ({
        name: tab.name,
        depth: tab.depth,
      }));
    };

    it('adds the other tabs as siblings, right after the subtab', () => {
      const tree = applyIn('S1', ['R', 'S1', 'S2', 'P'], { S1: 'R', S2: 'R' });

      expect(tree).toEqual([
        { name: 'R', depth: 1 },
        { name: 'Ship Basis', depth: 2 },
        ...TEMPLATE_REST.map((name) => ({ name, depth: 2 })),
        { name: 'S2', depth: 2 },
        { name: 'P', depth: 1 },
      ]);
      expect(getActiveTabIdFromNodes(getTabsYdocNodes(ydoc!))).toBe('S1');
    });

    it('keeps a level-3 subtab template at level 3', () => {
      const tree = applyIn('L3', ['R', 'S1', 'L3', 'S2'], {
        S1: 'R',
        L3: 'S1',
        S2: 'R',
      });

      expect(tree).toEqual([
        { name: 'R', depth: 1 },
        { name: 'S1', depth: 2 },
        { name: 'Ship Basis', depth: 3 },
        ...TEMPLATE_REST.map((name) => ({ name, depth: 3 })),
        { name: 'S2', depth: 2 },
      ]);
    });

    it('puts them after the subtab’s own subtabs', () => {
      const tree = applyIn('S1', ['R', 'S1', 'L3', 'S2'], {
        S1: 'R',
        L3: 'S1',
        S2: 'R',
      });

      expect(tree.map((tab) => tab.name)).toEqual([
        'R',
        'Ship Basis',
        'L3',
        ...TEMPLATE_REST,
        'S2',
      ]);
    });

    it('appends top-level tabs at the end, as before', () => {
      const tree = applyIn('P', ['R', 'S1', 'P', 'Q'], { S1: 'R' });

      expect(tree).toEqual([
        { name: 'R', depth: 1 },
        { name: 'S1', depth: 2 },
        { name: 'Ship Basis', depth: 1 },
        { name: 'Q', depth: 1 },
        ...TEMPLATE_REST.map((name) => ({ name, depth: 1 })),
      ]);
      expect(getTabsYdocNodes(ydoc!).parentById.size).toBe(1);
    });
  });
});
