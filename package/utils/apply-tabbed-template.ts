import type { Editor } from '@tiptap/react';
import { v4 as uuidv4 } from 'uuid';
import type * as Y from 'yjs';
import {
  ACTIVE_TAB_STATE_KEY,
  getTabsYdocNodes,
} from '../components/tabs/utils/tab-utils';
import {
  setJSONContent,
  type TabbedJSONContent,
  writeJSONContentToYjsField,
} from '../hooks/use-headless-editor';
import { getDocSchemaVersion } from './schema-version';

export const applyTabbedTemplate = ({
  activeTabId,
  editor,
  flushPendingUpdate,
  template,
  ydoc,
}: {
  activeTabId: string;
  editor: Editor;
  flushPendingUpdate?: () => void;
  template: TabbedJSONContent;
  ydoc: Y.Doc;
}) => {
  if (template.tabs.length === 0) {
    return [];
  }

  const schemaVersion = getDocSchemaVersion(ydoc);
  const tabIds = template.tabs.map((_, index) =>
    index === 0 ? activeTabId : uuidv4(),
  );

  template.tabs.slice(1).forEach((tab, index) => {
    writeJSONContentToYjsField({
      content: tab.content,
      field: tabIds[index + 1],
      schemaVersion,
      ydoc,
    });
  });
  setJSONContent(template.tabs[0].content, editor);

  const tabNodes = getTabsYdocNodes(ydoc);
  ydoc.transact(() => {
    template.tabs.forEach((tab, index) => {
      const tabId = tabIds[index];
      tabNodes.nameById.set(tabId, tab.name);
      tabNodes.emojiById.set(tabId, tab.emoji);
    });

    const currentOrder = tabNodes.order.toArray();
    if (!currentOrder.includes(activeTabId)) {
      tabNodes.order.push([activeTabId]);
    }
    if (tabIds.length > 1) {
      tabNodes.order.push(tabIds.slice(1));
    }
    tabNodes.tabState.set(ACTIVE_TAB_STATE_KEY, activeTabId);
  });

  flushPendingUpdate?.();
  return tabIds;
};
