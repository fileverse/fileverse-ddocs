import { DocumentTabsSidebar } from '../tabs/document-tabs-sidebar';
import { DocumentMobileTabPanel } from '../tabs/document-mobile-tab-panel';
import { DocumentOutlineProps } from './types';
import { useMediaQuery } from 'usehooks-ts';
import { DocumentOutlineTOCPanel } from './document-outline-toc-panel';

export const DocumentOutline = ({
  editor,
  hasToC,
  items,
  setItems,
  showTOC,
  setShowTOC,
  isPreviewMode,
  orientation,
  tabs,
  setTabs,
  activeTabId,
  setActiveTabId,
  createTab,
  renameTab,
  duplicateTab,
  orderTab,
  ydoc,
  tabCommentCounts,
  tabSectionContainer,
  isVersionHistoryMode,
  tabConfig,
  deleteTab,
  isConnected,
  isFocusMode,
}: DocumentOutlineProps) => {
  const isMediaMax1280px = useMediaQuery('(max-width:1280px)');

  if (!tabs.length) {
    return (
      <DocumentOutlineTOCPanel
        editor={editor}
        hasToC={hasToC}
        items={items}
        setItems={setItems}
        showTOC={showTOC}
        setShowTOC={setShowTOC}
        isPreviewMode={isPreviewMode}
        orientation={orientation}
      />
    );
  }

  return !isMediaMax1280px ? (
    <DocumentTabsSidebar
      tabs={tabs}
      setTabs={setTabs}
      activeTabId={activeTabId}
      setActiveTabId={setActiveTabId}
      showTOC={showTOC}
      setShowTOC={setShowTOC}
      hasToC={hasToC}
      isPreviewMode={isPreviewMode}
      editor={editor}
      items={items}
      setItems={setItems}
      orientation={orientation}
      createTab={createTab}
      renameTab={renameTab}
      duplicateTab={duplicateTab}
      orderTab={orderTab}
      deleteTab={deleteTab}
      ydoc={ydoc}
      tabCommentCounts={tabCommentCounts}
      tabSectionContainer={tabSectionContainer}
      isVersionHistoryMode={isVersionHistoryMode}
      tabConfig={tabConfig}
      isConnected={isConnected}
      isFocusMode={isFocusMode}
    />
  ) : (
    <DocumentMobileTabPanel
      tabs={tabs}
      setTabs={setTabs}
      activeTabId={activeTabId}
      setActiveTabId={setActiveTabId}
      editor={editor}
      items={items}
      setItems={setItems}
      orientation={orientation}
      renameTab={renameTab}
      createTab={createTab}
      duplicateTab={duplicateTab}
      orderTab={orderTab}
      deleteTab={deleteTab}
      tabCommentCounts={tabCommentCounts}
      isPreviewMode={isPreviewMode}
      tabConfig={tabConfig}
      isVersionHistoryMode={!!isVersionHistoryMode}
      isConnected={isConnected}
      isFocusMode={isFocusMode}
    />
  );
};
