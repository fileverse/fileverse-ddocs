import cn from 'classnames';
import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { LucideIcon, TextField } from '@fileverse/ui';
import { DocumentOutlineProps } from '../toc/types';
import { MemorizedToC } from '../toc/memorized-toc';
import { TabContextMenu, TabItem } from './tab-item';
import { ConfirmDeleteModal } from './confirm-delete-modal';
import { TabEmojiPicker } from './tab-emoji-picker';
import { Tab } from './utils/tab-utils';

export interface DocumentMobileTabPanelProps {
  tabs: Tab[];
  setTabs: Dispatch<SetStateAction<Tab[]>>;
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  editor: DocumentOutlineProps['editor'];
  items: DocumentOutlineProps['items'];
  setItems: DocumentOutlineProps['setItems'];
  orientation?: DocumentOutlineProps['orientation'];
  renameTab: (
    tabId: string,
    payload: { newName?: string; emoji?: string },
  ) => void;
  createTab: () => void;
  duplicateTab: (tabId: string) => void;
  deleteTab?: (tabId: string) => void;
  tabCommentCounts: Record<string, number>;
  isPreviewMode: boolean;
  tabConfig?: DocumentOutlineProps['tabConfig'];
  isVersionHistoryMode: boolean;
  isConnected?: boolean;
  isFocusMode?: boolean;
}

export const DocumentMobileTabPanel = ({
  tabs,
  activeTabId,
  setActiveTabId,
  editor,
  items,
  setItems,
  orientation,
  renameTab,
  createTab,
  duplicateTab,
  deleteTab,
  tabCommentCounts,
  isPreviewMode,
  tabConfig,
  isVersionHistoryMode,
  isConnected,
  isFocusMode,
}: DocumentMobileTabPanelProps) => {
  const [showContent, setShowContent] = useState(false);
  const [pendingDeleteTab, setPendingDeleteTab] = useState<Tab | null>(null);
  const [isEditingActiveTab, setIsEditingActiveTab] = useState(false);
  const [activeTabTitle, setActiveTabTitle] = useState('');
  const originalActiveTabTitleRef = useRef('');
  const isEditingActiveTabRef = useRef(false);
  const activeTabInputRef = useRef<HTMLInputElement | null>(null);
  const activeTabIndex = tabs.findIndex((tab) => tab.id === activeTabId);
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  const canDeleteTab = tabs.length > 1;
  const canNavigatePrev = activeTabIndex > 0;
  const canNavigateNext =
    activeTabIndex >= 0 && activeTabIndex < tabs.length - 1;

  useEffect(() => {
    isEditingActiveTabRef.current = isEditingActiveTab;
  }, [isEditingActiveTab]);

  useEffect(() => {
    if (isEditingActiveTabRef.current) return;
    const nextTitle = activeTab?.name ?? '';
    setActiveTabTitle(nextTitle);
    originalActiveTabTitleRef.current = nextTitle;
  }, [activeTab?.id, activeTab?.name]);

  useEffect(() => {
    if (isEditingActiveTab && activeTabInputRef.current) {
      activeTabInputRef.current.select();
    }
  }, [isEditingActiveTab]);

  const handleNameChange = (
    tabId: string,
    nextName: string,
    nextEmoji?: string,
  ) => {
    renameTab(tabId, {
      newName: nextName,
      ...(nextEmoji !== undefined ? { emoji: nextEmoji } : {}),
    });
  };

  const handleEmojiChange = (tabId: string, nextEmoji: string) => {
    renameTab(tabId, { emoji: nextEmoji });
  };

  const handleGoToPreviousTab = () => {
    if (!canNavigatePrev) return;
    const previousTab = tabs[activeTabIndex - 1];
    if (!previousTab) return;
    setActiveTabId(previousTab.id);
  };

  const handleGoToNextTab = () => {
    if (!canNavigateNext) return;
    const nextTab = tabs[activeTabIndex + 1];
    if (!nextTab) return;
    setActiveTabId(nextTab.id);
  };

  const startEditingActiveTab = () => {
    if (!activeTab || isPreviewMode || isVersionHistoryMode) return;
    const currentTitle = activeTab.name;
    originalActiveTabTitleRef.current = currentTitle;
    setActiveTabTitle(currentTitle);
    setIsEditingActiveTab(true);
  };

  const stopEditingActiveTab = (nextTitleFromInput?: string) => {
    if (!activeTab) {
      setIsEditingActiveTab(false);
      return;
    }

    const nextTitle =
      (nextTitleFromInput ?? activeTabTitle).trim() ||
      originalActiveTabTitleRef.current;
    setActiveTabTitle(nextTitle);
    handleNameChange(activeTab.id, nextTitle);
    setIsEditingActiveTab(false);
  };

  const cancelEditingActiveTab = () => {
    setActiveTabTitle(originalActiveTabTitleRef.current);
    setIsEditingActiveTab(false);
  };

  const menuSections = [
    [
      {
        id: 'new-tab',
        label: 'New tab',
        icon: 'Plus' as const,
        onSelect: createTab,
      },
    ],
    [
      {
        id: 'rename',
        label: 'Rename',
        icon: 'SquarePen' as const,
        onSelect: startEditingActiveTab,
        visible: Boolean(activeTab),
      },
      {
        id: 'duplicate',
        label: 'Duplicate',
        icon: 'Copy' as const,
        onSelect: () => {
          if (!activeTab) return;
          duplicateTab(activeTab.id);
        },
        visible: Boolean(activeTab),
      },
    ],
    [
      {
        id: 'copy-link',
        label: 'Copy link',
        icon: 'Share2' as const,
        onSelect: () => {
          if (!activeTab) return;
          tabConfig?.onCopyTabLink?.(activeTab.id);
        },
        visible: Boolean(activeTab && tabConfig?.onCopyTabLink),
      },
    ],
    [
      {
        id: 'delete',
        label: 'Delete',
        icon: 'Trash2' as const,
        textClassName: 'color-text-danger',
        iconStroke: 'hsl(var(--color-icon-danger))',
        onSelect: () => {
          if (!activeTab || !deleteTab || !canDeleteTab) return;
          setPendingDeleteTab(activeTab);
        },
        visible: Boolean(activeTab && deleteTab && canDeleteTab),
      },
    ],
  ];

  const shouldShowTabNav = isVersionHistoryMode || isPreviewMode;
  const showTabList = showContent && !isVersionHistoryMode;

  return (
    <div
      data-testid="mobile-tab-panel"
      className={cn('fixed w-full flex flex-col z-[9]')}
      style={{
        // 24px = the consumer app's footer height; the env() term keeps the
        // panel above the iOS home indicator in home-screen (standalone)
        // installs, where the footer grows by the same inset (0 elsewhere).
        bottom: isVersionHistoryMode
          ? 'var(--version-sheet-bottom, 24px)'
          : isFocusMode
            ? 'env(safe-area-inset-bottom, 0px)'
            : 'calc(24px + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        className={cn(
          'rounded-t-[12px] color-bg-default flex flex-col w-full gap-[8px] overflow-hidden',
          showTabList
            ? 'h-[300px] space-md shadow-[0_-12px_32px_rgba(0,0,0,0.18)]'
            : ' px-[8px] py-[2px] border color-bg-secondary shadow-none',
        )}
        style={isVersionHistoryMode ? { borderBottom: 'none' } : undefined}
      >
        {showTabList ? (
          <>
            <div
              className={cn('gap-xsm flex items-center justify-between w-full')}
            >
              <h2 className="text-heading-xsm color-text-default">
                Document tabs
              </h2>
              <LucideIcon
                data-testid="mobile-tab-close"
                onClick={() => setShowContent(false)}
                name="X"
                className="w-[16px] h-[16px] cursor-pointer transition-transform duration-200 hover:scale-110 active:scale-95"
              />
            </div>

            <div
              className={cn(
                'w-full no-scrollbar overflow-y-auto flex-1',
                'min-h-0',
                'transition-opacity duration-300',
              )}
            >
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className="w-full flex mt-[8px] flex-col gap-[8px]"
                >
                  <TabItem
                    tabId={tab.id}
                    hideContentMenu={true}
                    name={tab.name}
                    emoji={tab.emoji || ''}
                    onNameChange={(nextName: string, nextEmoji?: string) =>
                      handleNameChange(tab.id, nextName, nextEmoji)
                    }
                    onEmojiChange={(nextEmoji: string) =>
                      handleEmojiChange(tab.id, nextEmoji)
                    }
                    onDuplicate={() => duplicateTab(tab.id)}
                    isActive={tab.id === activeTabId}
                    onClick={() => setActiveTabId(tab.id)}
                    commentCount={tabCommentCounts[tab.id] || 0}
                    isPreviewMode={isPreviewMode}
                    onCopyLink={() => tabConfig?.onCopyTabLink?.(tab.id)}
                    isConnected={isConnected}
                  />
                  <div
                    className={cn(
                      'table-of-contents transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                      tab.id === activeTabId
                        ? 'opacity-100 translate-x-0'
                        : 'opacity-0 -translate-x-2 h-0 overflow-hidden',
                    )}
                  >
                    <MemorizedToC
                      editor={editor}
                      items={items}
                      setItems={setItems}
                      orientation={orientation}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : shouldShowTabNav ? (
          <div
            id="tab-nav"
            className={cn(
              'flex justify-between items-center w-full',
              'transition-all duration-300 animate-in fade-in slide-in-from-bottom-1',
            )}
          >
            <button
              type="button"
              onClick={handleGoToPreviousTab}
              disabled={!canNavigatePrev}
              aria-label="Go to previous tab"
              className={cn(
                'h-[36px] w-[36px] flex items-center justify-center transition-opacity duration-200',
                canNavigatePrev
                  ? 'cursor-pointer'
                  : 'opacity-40 cursor-not-allowed',
              )}
            >
              <LucideIcon name={'ChevronLeft'} className="w-[20px] h-[20px]" />
            </button>
            <div
              onClick={() => !isVersionHistoryMode && setShowContent(true)}
              className="flex flex-col px-[12px] items-center cursor-pointer transition-opacity duration-200 hover:opacity-80"
            >
              <div className="flex items-center gap-[8px] justify-center py-[4px]">
                <TabEmojiPicker
                  emoji={activeTab?.emoji || ''}
                  setEmoji={() => {}}
                  disableEmoji={true}
                  isEditing={false}
                />
                <p
                  data-testid="mobile-tab-active-name"
                  className="text-heading-xsm max-w-[150px] truncate"
                >
                  {tabs.find((t) => t.id === activeTabId)?.name ?? 'Tab name'}
                </p>
              </div>
              {!isVersionHistoryMode && (
                <div className="h-[16px] flex items-center">
                  <span className="text-helper-text-sm color-text-secondary">
                    {tabs.length} tabs.
                  </span>
                  <span className="text-helper-text-sm color-text-secondary ml-[4px]">
                    Tap to see all
                  </span>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={handleGoToNextTab}
              disabled={!canNavigateNext}
              aria-label="Go to next tab"
              className={cn(
                'h-[36px] w-[36px] flex items-center justify-center transition-opacity duration-200',
                canNavigateNext
                  ? 'cursor-pointer'
                  : 'opacity-40 cursor-not-allowed',
              )}
            >
              <LucideIcon name={'ChevronRight'} className="w-[20px] h-[20px]" />
            </button>
          </div>
        ) : (
          <div
            className={cn(
              'flex justify-between items-center w-full',
              'transition-all duration-300 animate-in fade-in slide-in-from-bottom-1',
            )}
          >
            <div
              onClick={() => {
                if (isEditingActiveTab) return;
                if (!isVersionHistoryMode) setShowContent(true);
              }}
              className="flex flex-grow flex-col px-[12px] cursor-pointer transition-opacity duration-200 hover:opacity-80"
            >
              <div id="pp" className="flex items-center gap-[8px] py-[4px]">
                <div onClick={(e) => e.stopPropagation()}>
                  <TabEmojiPicker
                    emoji={activeTab?.emoji || ''}
                    setEmoji={(nextEmoji) => {
                      if (!activeTab) return;
                      handleEmojiChange(activeTab.id, nextEmoji);
                    }}
                    disableEmoji={Boolean(
                      isPreviewMode || isVersionHistoryMode,
                    )}
                    isEditing={isEditingActiveTab}
                  />
                </div>
                {!isEditingActiveTab ? (
                  <p
                    data-testid="mobile-tab-active-name"
                    className="text-heading-xsm max-w-[200px] truncate"
                  >
                    {activeTabTitle || 'Tab name'}
                  </p>
                ) : (
                  <TextField
                    data-testid="mobile-tab-rename-input"
                    ref={activeTabInputRef}
                    autoFocus
                    value={activeTabTitle}
                    onChange={(e) => setActiveTabTitle(e.target.value)}
                    onBlur={(e) => stopEditingActiveTab(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        stopEditingActiveTab(e.currentTarget.value);
                      }
                      if (e.key === 'Escape') cancelEditingActiveTab();
                    }}
                    className="h-[24px] max-w-[200px] px-[6px] py-0 rounded-[6px] text-heading-xsm border-transparent focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-border-focused))]"
                  />
                )}
              </div>
              <div className="h-[16px] flex items-center">
                <span className="text-helper-text-sm color-text-secondary">
                  {tabs.length} tabs.
                </span>
                <span className="text-helper-text-sm color-text-secondary ml-[4px]">
                  Tap to see all
                </span>
              </div>
            </div>

            <TabContextMenu
              sections={menuSections}
              popoverSide="top"
              popoverClassName="z-[1000]"
            />
          </div>
        )}
      </div>
      <ConfirmDeleteModal
        isOpen={Boolean(pendingDeleteTab)}
        onClose={() => setPendingDeleteTab(null)}
        onConfirm={() => {
          if (!pendingDeleteTab) return;
          try {
            deleteTab?.(pendingDeleteTab.id);
          } catch (error) {
            console.error(error);
          } finally {
            setPendingDeleteTab(null);
          }
        }}
        documentTitle={pendingDeleteTab?.name || ''}
        isLoading={false}
        primaryLabel="Delete tab"
      />
    </div>
  );
};
