import { Editor } from '@tiptap/react';
import React, { Dispatch, SetStateAction } from 'react';
import { Tab } from '../tabs/utils/tab-utils';
import * as Y from 'yjs';

export interface ToCItemType {
  id: string;
  level: number;
  textContent: string;
  itemIndex: number;
  isActive?: boolean;
}

export type ToCProps = {
  items: ToCItemType[];
  setItems: (
    items: ToCItemType[] | ((prev: ToCItemType[]) => ToCItemType[]),
  ) => void;
  editor: Editor;
  orientation?: 'portrait' | 'landscape';
};

export type ToCItemProps = {
  item: ToCItemType;
  onItemClick: (e: React.MouseEvent, id: string) => void;
  onItemRemove: (e: React.MouseEvent, id: string) => void;
  index: number;
  orientation?: 'portrait' | 'landscape';
  /** At or below 1280px: the item is in the mobile list. */
  isMobile?: boolean;
  /** At or above 1280px: the item takes the rail's width caps. */
  isWide?: boolean;
};

export interface DocumentOutlineProps {
  editor: Editor;
  hasToC: boolean;
  items: ToCItemType[];
  setItems: (
    items: ToCItemType[] | ((prev: ToCItemType[]) => ToCItemType[]),
  ) => void;
  showTOC: boolean | undefined;
  setShowTOC: Dispatch<SetStateAction<boolean>> | undefined;
  isPreviewMode: boolean;
  orientation?: 'portrait' | 'landscape';
  tabs: Tab[];
  setTabs: Dispatch<SetStateAction<Tab[]>>;
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  createTab: () => void;
  renameTab: (
    tabId: string,
    payload: { newName?: string; emoji?: string },
  ) => void;
  duplicateTab: (tabId: string) => void;
  orderTab: (destinationTabId: string, activeTabId: string) => void;
  ydoc: Y.Doc;
  tabCommentCounts: Record<string, number>;
  tabSectionContainer?: HTMLElement;
  isVersionHistoryMode?: boolean;
  tabConfig?: {
    onCopyTabLink?: (tabId: string) => void;
    defaultTabId?: string;
  };
  deleteTab?: (tabId: string) => void;
  isConnected?: boolean;
  isFocusMode?: boolean;
  /** 'contained': sized from the editor canvas. Only DdocEditor passes it. */
  layout?: 'viewport' | 'contained';
  tabPanelSlot?: HTMLElement | null;
}
