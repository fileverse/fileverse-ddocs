import {
  DynamicDrawerV2,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@fileverse/ui';
import cn from 'classnames';
import { CommentSection } from './comment-section';
import type { IComment } from '../../extensions/comment';

interface DrawerSelectOption {
  id: string;
  label: string;
}

interface CommentDrawerDesktopProps {
  activeCommentId: string | null;
  commentType: string;
  commentTypeOptions: DrawerSelectOption[];
  filteredComments: IComment[];
  isCommentTypeSelectOpen: boolean;
  isConnected: boolean;
  isNavbarVisible: boolean;
  isOpen: boolean;
  isPresentationMode: boolean;
  isPreviewMode: boolean;
  isTabSelectOpen: boolean;
  newCommentTabId: string;
  onClose: () => void;
  onCommentFocus: (commentId: string, tabId?: string) => void;
  onCommentTypeChange: (commentType: string) => void;
  onCommentTypeSelectOpenChange: (open: boolean) => void;
  onReset: () => void;
  onTabChange: (tabId: string) => void;
  onTabSelectOpenChange: (open: boolean) => void;
  sectionLabel: string;
  selectedTab: string;
  selectedTabLabel: string;
  tabList: DrawerSelectOption[];
  tabNameById: Record<string, string>;
}

export const CommentDrawerDesktop = ({
  activeCommentId,
  commentType,
  commentTypeOptions,
  filteredComments,
  isCommentTypeSelectOpen,
  isConnected,
  isNavbarVisible,
  isOpen,
  isPresentationMode,
  isPreviewMode,
  isTabSelectOpen,
  newCommentTabId,
  onClose,
  onCommentFocus,
  onCommentTypeChange,
  onCommentTypeSelectOpenChange,
  onReset,
  onTabChange,
  onTabSelectOpenChange,
  sectionLabel,
  selectedTab,
  selectedTabLabel,
  tabList,
  tabNameById,
}: CommentDrawerDesktopProps) => (
  <DynamicDrawerV2
    open={isOpen}
    onOpenChange={onClose}
    side="right"
    rounded={true}
    dismissible
    className={cn(
      'w-[336px] shadow-elevation-4 rounded-lg border color-border-default',
      isPresentationMode
        ? cn(
            '!z-[60] right-0 top-[4rem] h-[calc(100vh-5rem)]',
            isOpen && 'right-2 md:!right-4',
          )
        : cn(
            '!absolute !z-40 !bottom-auto top-2 h-[calc(var(--ddoc-canvas-h)-16px)]',
            // Closed, it must sit flush so the anchor's clip hides all of it.
            isOpen ? 'right-2 ddoc-md:!right-4' : 'right-0',
          ),
    )}
    headerClassName="border-b color-border-default !color-bg-default px-4 pb-[12px] !rounded-t-lg"
    contentClassName="!rounded-lg !px-0 !h-full !pb-5 select-text"
    title="Comments"
    content={
      <div
        className={cn(
          'pt-4',
          !isConnected && isPreviewMode && 'flex items-center h-[77dvh]',
        )}
      >
        {isConnected && (
          <div className="flex mb-[16px] px-4 gap-[8px]">
            <Select
              value={commentType}
              open={isCommentTypeSelectOpen}
              onOpenChange={onCommentTypeSelectOpenChange}
              onValueChange={onCommentTypeChange}
            >
              <SelectTrigger className="w-[148px]">
                <SelectValue placeholder="Active" />
              </SelectTrigger>
              <SelectContent>
                {commentTypeOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={selectedTab}
              open={isTabSelectOpen}
              onOpenChange={onTabSelectOpenChange}
              onValueChange={onTabChange}
            >
              <SelectTrigger className="w-[148px]">
                <SelectValue placeholder="All tabs" />
              </SelectTrigger>
              <SelectContent>
                {tabList.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <CommentSection
          activeCommentId={activeCommentId}
          isNavbarVisible={isNavbarVisible}
          isPresentationMode={isPresentationMode}
          comments={filteredComments}
          commentType={commentType as 'all' | 'active' | 'resolved'}
          sectionLabel={sectionLabel}
          tabNameById={tabNameById}
          selectedTabLabel={selectedTabLabel}
          newCommentTabId={newCommentTabId}
          onCommentFocus={onCommentFocus}
          onReset={onReset}
        />
      </div>
    }
  />
);
