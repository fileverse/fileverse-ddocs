import { useRef } from 'react';
import { createPortal } from 'react-dom';
import { CommentDrawerProps } from './types';
import { useCommentStore } from '../../stores/comment-store';
import { useResponsive } from '../../utils/responsive';
import { useCommentRefs } from '../../stores/comment-store-provider';
import { CommentDrawerDesktop } from './comment-drawer-desktop';
import { CommentDrawerMobile } from './comment-drawer-mobile';
import { useCommentDrawerDrafts } from './use-comment-drawer-drafts';
import { useCommentDrawerFilters } from './use-comment-drawer-filters';
import { useCommentDrawerFocus } from './use-comment-drawer-focus';
import { useCommentDrawerLifecycle } from './use-comment-drawer-lifecycle';
import { useMobileCommentNavigation } from './use-mobile-comment-navigation';

export const CommentDrawer = ({
  isOpen,
  onClose,
  isNavbarVisible,
  isPresentationMode,
  activeCommentId,
  activeTabId,
  onTabChange,
  isPreviewMode,
  tabs,
  mobileContainer,
}: CommentDrawerProps) => {
  const comments = useCommentStore((s) => s.initialComments);
  const isConnected = useCommentStore((s) => s.isConnected);
  const focusCommentInEditor = useCommentStore((s) => s.focusCommentInEditor);
  const focusSuggestionDraftInEditor = useCommentStore(
    (s) => s.focusSuggestionDraftInEditor,
  );
  const isCommentOpen = useCommentStore((s) => s.isCommentOpen);
  const openReplyId = useCommentStore((s) => s.openReplyId);
  const setOpenReplyId = useCommentStore((s) => s.setOpenReplyId);
  const setIsCommentOpen = useCommentStore((s) => s.setIsCommentOpen);
  const username = useCommentStore((s) => s.username);
  const { isBelow1280px } = useResponsive();
  const mobileDrawerRef = useRef<HTMLDivElement | null>(null);
  const { mobileDraftRef } = useCommentRefs();
  const isCommentMobileFocused = isBelow1280px && Boolean(openReplyId);
  const {
    closeFilterSelects,
    commentType,
    commentTypeOptions,
    filteredComments,
    handleCommentTypeSelectOpenChange,
    handleTabSelectOpenChange,
    isCommentTypeSelectOpen,
    isTabSelectOpen,
    resetFilters,
    sectionLabel,
    selectedCommentTabId,
    selectedTab,
    selectedTabLabel,
    setCommentType,
    setTab,
    tabList,
    tabNameById,
  } = useCommentDrawerFilters({ activeTabId, comments, tabs });
  const {
    activeDraft,
    activeDraftId,
    activeSuggestionDraftCard,
    handleCreateComment,
    handleDiscardSuggestionDraft,
    handleStartNewMobileComment,
    handleSubmitSuggestionDraft,
    isDiscardCommentOverlayVisible,
    isDiscardSuggestionOverlayVisible,
    isInlineDraftOpen,
    setIsDiscardCommentOverlayVisible,
    setIsDiscardSuggestionOverlayVisible,
    updateInlineDraftText,
  } = useCommentDrawerDrafts({ selectedCommentTabId, setOpenReplyId });
  const isDrawerInlineDraftOpen = isCommentOpen && isInlineDraftOpen;
  const isMobileDrawerVisible = isOpen || activeSuggestionDraftCard !== null;
  const { clearPendingCommentFocus, handleCommentFocus } =
    useCommentDrawerFocus({
      activeTabId,
      comments,
      focusCommentInEditor,
      isBelow1280px,
      onTabChange,
      setOpenReplyId,
    });
  const {
    canGoToNextMobileComment,
    canGoToPreviousMobileComment,
    handleNextMobileComment,
    handlePreviousMobileComment,
    handleViewAllComments,
    mobileActiveCommentsCount,
    mobileFocusedCommentIndex,
  } = useMobileCommentNavigation({
    comments,
    mobileDrawerRef,
    onCommentFocus: handleCommentFocus,
    openReplyId,
    setOpenReplyId,
  });

  useCommentDrawerLifecycle({
    activeSuggestionDraftCard,
    closeFilterSelects,
    isBelow1280px,
    isCommentMobileFocused,
    isInlineDraftOpen: isDrawerInlineDraftOpen,
    isOpen,
    onClose,
    setIsDiscardCommentOverlayVisible,
    setIsDiscardSuggestionOverlayVisible,
  });

  const handleCloseDrawer = () => {
    setOpenReplyId(null);
    setIsDiscardCommentOverlayVisible(false);
    setIsDiscardSuggestionOverlayVisible(false);
    clearPendingCommentFocus();
    setIsCommentOpen(false);
    onClose();
  };

  const drawer = (
    <div ref={mobileDrawerRef} data-testid="comment-drawer">
      {isBelow1280px ? (
        <CommentDrawerMobile
          activeCommentId={activeCommentId}
          activeDraft={activeDraft}
          activeDraftId={activeDraftId}
          activeSuggestionDraftCard={activeSuggestionDraftCard}
          canGoToNextMobileComment={canGoToNextMobileComment}
          canGoToPreviousMobileComment={canGoToPreviousMobileComment}
          comments={comments}
          isCommentMobileFocused={isCommentMobileFocused}
          isConnected={isConnected}
          isDiscardCommentOverlayVisible={isDiscardCommentOverlayVisible}
          isDiscardSuggestionOverlayVisible={isDiscardSuggestionOverlayVisible}
          isInlineDraftOpen={isDrawerInlineDraftOpen}
          isMobileDrawerVisible={isMobileDrawerVisible}
          isNavbarVisible={isNavbarVisible}
          isPresentationMode={isPresentationMode}
          mobileActiveCommentsCount={mobileActiveCommentsCount}
          mobileDraftRef={mobileDraftRef}
          mobileFocusedCommentIndex={mobileFocusedCommentIndex}
          onAttemptCloseNewComment={() =>
            setIsDiscardCommentOverlayVisible(true)
          }
          onAttemptCloseSuggestionDraft={() =>
            setIsDiscardSuggestionOverlayVisible(true)
          }
          onCancelDiscardComment={() =>
            setIsDiscardCommentOverlayVisible(false)
          }
          onCancelDiscardSuggestion={() =>
            setIsDiscardSuggestionOverlayVisible(false)
          }
          onCloseDrawer={handleCloseDrawer}
          onCommentFocus={handleCommentFocus}
          onCreateComment={handleCreateComment}
          onDiscardSuggestionDraft={handleDiscardSuggestionDraft}
          onFocusSuggestionDraft={() => {
            if (activeSuggestionDraftCard) {
              focusSuggestionDraftInEditor(
                activeSuggestionDraftCard.suggestionId,
              );
            }
          }}
          onNextMobileComment={handleNextMobileComment}
          onPreviousMobileComment={handlePreviousMobileComment}
          onStartNewMobileComment={handleStartNewMobileComment}
          onSubmitSuggestionDraft={handleSubmitSuggestionDraft}
          onUpdateInlineDraftText={updateInlineDraftText}
          onViewAllComments={handleViewAllComments}
          tabNameById={tabNameById}
          username={username}
        />
      ) : (
        <CommentDrawerDesktop
          activeCommentId={activeCommentId}
          commentType={commentType}
          commentTypeOptions={commentTypeOptions}
          filteredComments={filteredComments}
          isCommentTypeSelectOpen={isCommentTypeSelectOpen}
          isConnected={isConnected}
          isNavbarVisible={isNavbarVisible}
          isOpen={isOpen}
          isPresentationMode={isPresentationMode}
          isPreviewMode={isPreviewMode}
          isTabSelectOpen={isTabSelectOpen}
          newCommentTabId={selectedCommentTabId}
          onClose={onClose}
          onCommentFocus={handleCommentFocus}
          onCommentTypeChange={setCommentType}
          onCommentTypeSelectOpenChange={handleCommentTypeSelectOpenChange}
          onReset={resetFilters}
          onTabChange={setTab}
          onTabSelectOpenChange={handleTabSelectOpenChange}
          sectionLabel={sectionLabel}
          selectedTab={selectedTab}
          selectedTabLabel={selectedTabLabel}
          tabList={tabList}
          tabNameById={tabNameById}
        />
      )}
    </div>
  );

  return isBelow1280px && mobileContainer
    ? createPortal(drawer, mobileContainer)
    : drawer;
};
