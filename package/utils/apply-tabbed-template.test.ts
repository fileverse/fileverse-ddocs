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
  });
});
