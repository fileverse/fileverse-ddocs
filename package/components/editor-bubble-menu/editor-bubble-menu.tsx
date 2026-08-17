/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { BubbleMenu } from '@tiptap/react/menus';
import React, { useCallback, useEffect, useMemo } from 'react';
import { NodeSelector } from './node-selector';
import {
  LinkPopup,
  useEditorToolbar,
  TextHighlighter,
  EditorAlignment,
  TextColor,
  ScriptsPopup,
  getCurrentFontSize,
  FontSizePicker,
  LineHeightPicker,
} from '../editor-utils';
import { IEditorTool } from '../../hooks/use-visibility';
import ToolbarButton from '../../common/toolbar-button';
import { DynamicDropdown, cn, LucideIcon } from '@fileverse/ui';
import { CommentDropdown } from '../inline-comment/comment-dropdown';
import { EditorBubbleMenuProps, BubbleMenuItem } from './types';
import { useResponsive } from '../../utils/responsive';
import {
  isSelectionInsideEditor,
  shouldShow,
  shouldShowIgnoringFocus,
} from './props';
import { useCommentStore } from '../../stores/comment-store';
import { useCommentRefs } from '../../stores/comment-store-provider';
import { useEditorStates } from '../../hooks/use-editor-states';
import { CustomSpacingDialog } from '../editor-toolbar/custom-spacing-dialog';
import { Editor } from '@tiptap/react';

const MemoizedFontSizePicker = React.memo(FontSizePicker);
const MemoizedLineHeightPicker = React.memo(LineHeightPicker);
const BUBBLE_MENU_Z_INDEX = '61';

const EditorBubbleMenuComponent = (props: EditorBubbleMenuProps) => {
  const {
    editor,
    zoomLevel,
    onError,
    isPreviewMode,
    setCommentDrawerOpen,
    activeCommentId,
    isCollabDocumentPublished,
    disableInlineComment,
    ipfsImageUploadFn,
    ipfsImageFetchFn,
    enableCollaboration,
    fetchV1ImageFn,
  } = props;
  const editorStates = useEditorStates(editor as Editor);
  const currentSize = editor ? editorStates.currentSize : undefined;
  const currentLineHeight = editor ? editorStates.currentLineHeight : undefined;
  const onSetFontSize = editor ? editorStates.onSetFontSize : () => {};

  const onSetLineHeight = editor ? editorStates.onSetLineHeight : () => {};
  const [isCustomSpacingOpen, setIsCustomSpacingOpen] = React.useState(false);
  const { isBelow1280px, isNativeMobile } = useResponsive();
  const shouldUseFloatingComments = !isBelow1280px && !isNativeMobile;
  const { toolRef, setToolVisibility, toolVisibility } = useEditorToolbar({
    editor: editor ?? null,
    onError,
    ipfsImageUploadFn,
    ipfsImageFetchFn,
    fetchV1ImageFn,
  });

  const activeComment = useCommentStore((s) => s.activeComment);
  const isCommentOpen = useCommentStore((s) => s.isCommentOpen);
  const handleInlineComment = useCommentStore((s) => s.handleInlineComment);
  const isCommentActive = useCommentStore((s) => s.isCommentActive);
  const isCommentResolved = useCommentStore((s) => s.isCommentResolved);
  const isBubbleMenuSuppressed = useCommentStore(
    (s) => s.isBubbleMenuSuppressed,
  );
  const setIsBubbleMenuSuppressed = useCommentStore(
    (s) => s.setIsBubbleMenuSuppressed,
  );
  const { buttonRef } = useCommentRefs();

  useEffect(() => {
    if (!editor || !isBubbleMenuSuppressed) {
      return;
    }

    const handleSelectionUpdate = () => {
      setIsBubbleMenuSuppressed(false);
    };

    editor.on('selectionUpdate', handleSelectionUpdate);

    return () => {
      editor.off('selectionUpdate', handleSelectionUpdate);
    };
  }, [editor, isBubbleMenuSuppressed, setIsBubbleMenuSuppressed]);

  const handleBubbleMenuRef = useCallback((node: HTMLDivElement | null) => {
    node?.style.setProperty('z-index', BUBBLE_MENU_Z_INDEX);
  }, []);

  // In preview mode the bubble menu only hosts the Comment button, so it's
  // pointless when commenting isn't available for this viewer.
  const canComment =
    !!isCollabDocumentPublished &&
    !disableInlineComment &&
    !isCommentResolved &&
    !enableCollaboration;

  // Mobile text selection can survive an editor blur, so retry the same
  // visibility checks without the focus requirement when selection stays in-editor.
  const handleBubbleMenuShouldShow = useCallback(
    ({ editor }: { editor: Editor }) => {
      if (shouldShow({ editor })) {
        return true;
      }

      // Mobile native selection and preview-mode selection can both survive an
      // editor blur, so ignore focus when the selection still belongs to the
      // editor. In preview mode, only show when the Comment button is usable.
      return (
        (isNativeMobile || (isPreviewMode && canComment)) &&
        isSelectionInsideEditor(editor) &&
        shouldShowIgnoringFocus(editor)
      );
    },
    [isNativeMobile, isPreviewMode, canComment],
  );

  const items: BubbleMenuItem[] = useMemo(() => {
    return [
      {
        name: 'Bold',
        isActive: () => editor?.isActive('bold') ?? false,
        command: () => editor?.chain().focus().toggleBold().run(),
        icon: 'Bold',
      },
      {
        name: 'Italic',
        isActive: () => editor?.isActive('italic') ?? false,
        command: () => editor?.chain().focus().toggleItalic().run(),
        icon: 'Italic',
      },
      {
        name: 'Underline',
        isActive: () => editor?.isActive('underline') ?? false,
        command: () => editor?.chain().focus().toggleUnderline().run(),
        icon: 'Underline',
      },
      {
        name: 'Strikethrough',
        isActive: () => editor?.isActive('strike') ?? false,
        command: () => editor?.chain().focus().toggleStrike().run(),
        icon: 'Strikethrough',
      },
      {
        name: 'Alignment',
        isActive: () => toolVisibility === IEditorTool.ALIGNMENT,
        command: () => setToolVisibility(IEditorTool.ALIGNMENT),
        icon: 'AlignLeft',
      },
      {
        name: 'Code',
        isActive: () => editor?.isActive('code') ?? false,
        command: () => editor?.chain().focus().toggleCode().run(),
        icon: 'Code',
      },
      {
        name: 'Link',
        isActive: () => editor?.isActive('link') ?? false,
        command: () => setToolVisibility(IEditorTool.LINK_POPUP),
        icon: 'Link',
      },
      {
        name: 'Scripts',
        isActive: () => toolVisibility === IEditorTool.SCRIPTS,
        command: () => setToolVisibility(IEditorTool.SCRIPTS),
        icon: 'Superscript',
      },
      {
        name: 'Comment',
        isActive: () => isCommentActive,
        command: () => {},
        icon: 'MessageSquarePlus',
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, isCommentActive, setToolVisibility, toolVisibility]);

  const renderContent = useCallback(
    (item: { name: string; initialComment?: string }) => {
      if (!editor) return null;
      switch (item.name) {
        case 'Alignment':
          return (
            <EditorAlignment
              setToolVisibility={setToolVisibility}
              editor={editor}
              elementRef={toolRef}
            />
          );
        case 'Link':
          return (
            <LinkPopup
              setToolVisibility={setToolVisibility}
              editor={editor}
              elementRef={toolRef}
              bubbleMenu={true}
              onError={onError}
            />
          );
        case 'Comment':
          return (
            <CommentDropdown
              activeCommentId={activeCommentId ?? undefined}
              setCommentDrawerOpen={setCommentDrawerOpen}
              initialComment={item.initialComment}
              isDisabled={
                activeComment && !Object.hasOwn(activeComment, 'commentIndex')
              }
            />
          );
        case 'Scripts':
          return <ScriptsPopup editor={editor} elementRef={toolRef} />;
        default:
          return null;
      }
    },
    [
      activeComment,
      activeCommentId,
      editor,
      onError,
      setCommentDrawerOpen,
      setToolVisibility,
      toolRef,
    ],
  );

  const handleMobileInlineComment = useCallback(() => {
    setCommentDrawerOpen?.(true);
    handleInlineComment();
  }, [handleInlineComment, setCommentDrawerOpen]);

  const mobileCommentButton = (
    <React.Fragment>
      <ToolbarButton
        ref={buttonRef}
        data-testid="inline-comment-btn-mobile"
        icon="MessageSquarePlus"
        size="sm"
        disabled={
          isCommentResolved ||
          !isCollabDocumentPublished ||
          disableInlineComment
        }
        isActive={isCommentActive}
        onClick={handleMobileInlineComment}
        classNames="disabled:!bg-transparent"
      />
    </React.Fragment>
  );

  const isInMediaCaption = useMemo(() => {
    if (!editor) return false;
    const { $from } = editor.state.selection;
    for (let d = $from.depth; d > 0; d--) {
      if ($from.node(d).type.name === 'mediaCaption') return true;
    }
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, editor?.state.selection]);

  if (!editor) {
    return null;
  }

  return (
    <>
      <BubbleMenu
        ref={handleBubbleMenuRef}
        editor={editor}
        appendTo={
          isBelow1280px
            ? undefined
            : () =>
                document.getElementById('editor-canvas') ??
                editor.view.dom.parentElement ??
                document.body
        }
        options={{
          placement: 'top',
          flip: true,
          shift: true,
        }}
        shouldShow={handleBubbleMenuShouldShow}
        className={cn(
          'flex gap-2 overflow-hidden rounded-lg min-w-fit w-full p-1 border color-bg-default items-center shadow-elevation-3',
          isCommentOpen ||
            toolVisibility === IEditorTool.LINK_POPUP ||
            isBubbleMenuSuppressed
            ? '!invisible'
            : '!visible',
          isNativeMobile ? '!-translate-y-[120%]' : '',
        )}
        style={{
          transform: `scale(${1 / parseFloat(zoomLevel)})`,
          transformOrigin: 'center',
        }}
      >
        {isNativeMobile ? (
          <div
            className={cn(
              'relative',
              isCommentOpen ? 'left-1/2 translate-x-1/2' : '',
            )}
          >
            {mobileCommentButton}
          </div>
        ) : (
          <React.Fragment>
            {isPreviewMode ? (
              shouldUseFloatingComments ? (
                <ToolbarButton
                  ref={buttonRef}
                  icon="MessageSquarePlus"
                  variant="ghost"
                  size="sm"
                  tooltip={isCommentResolved ? 'Comment resolved' : ''}
                  disabled={
                    isCommentResolved ||
                    !isCollabDocumentPublished ||
                    disableInlineComment
                  }
                  isActive={isCommentActive}
                  onClick={handleInlineComment}
                  classNames="disabled:!bg-transparent"
                />
              ) : (
                <DynamicDropdown
                  key="Comment"
                  side="bottom"
                  sideOffset={15}
                  alignOffset={-5}
                  align="end"
                  className="!z-[50] shadow-elevation-3"
                  anchorTrigger={
                    <ToolbarButton
                      icon="MessageSquarePlus"
                      variant="ghost"
                      size="sm"
                      tooltip={isCommentResolved ? 'Comment resolved' : ''}
                      disabled={
                        isCommentResolved ||
                        !isCollabDocumentPublished ||
                        disableInlineComment
                      }
                      isActive={isCommentActive}
                      onClick={handleInlineComment}
                      classNames="disabled:!bg-transparent"
                    />
                  }
                  content={
                    !isCommentActive
                      ? renderContent({
                          name: 'Comment',
                          initialComment: activeComment?.content || '',
                        })
                      : null
                  }
                />
              )
            ) : isInMediaCaption ? (
              <React.Fragment>
                <DynamicDropdown
                  sideOffset={15}
                  anchorTrigger={
                    <ToolbarButton
                      icon="Link"
                      variant="ghost"
                      size="sm"
                      onClick={() => setToolVisibility(IEditorTool.LINK_POPUP)}
                    />
                  }
                  className="shadow-elevation-3"
                  content={
                    <LinkPopup
                      setToolVisibility={setToolVisibility}
                      editor={editor}
                      elementRef={toolRef}
                      bubbleMenu={true}
                      onError={onError}
                    />
                  }
                />
              </React.Fragment>
            ) : (
              <React.Fragment>
                <NodeSelector editor={editor} elementRef={toolRef} />

                <div className="w-[1px] h-4 vertical-divider"></div>

                <DynamicDropdown
                  key={IEditorTool.FONT_SIZE}
                  sideOffset={8}
                  anchorTrigger={
                    <button
                      className="bg-transparent hover:!color-bg-default-hover rounded gap-2 py-2 px-1 flex items-center justify-center w-fit max-w-14 min-w-14"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setToolVisibility(IEditorTool.FONT_SIZE)}
                    >
                      <span className="text-body-sm line-clamp-1">
                        {getCurrentFontSize(
                          editor ?? null,
                          currentSize as string,
                        )}
                      </span>
                      <LucideIcon name="ChevronDown" size="sm" />
                    </button>
                  }
                  content={
                    <MemoizedFontSizePicker
                      setVisibility={setToolVisibility}
                      editor={editor as Editor}
                      elementRef={toolRef}
                      currentSize={currentSize}
                      onSetFontSize={onSetFontSize}
                    />
                  }
                />

                <DynamicDropdown
                  key={IEditorTool.LINE_HEIGHT}
                  sideOffset={15}
                  anchorTrigger={
                    <ToolbarButton
                      icon="LineHeight"
                      size="sm"
                      isActive={toolVisibility === IEditorTool.LINE_HEIGHT}
                    />
                  }
                  content={
                    <MemoizedLineHeightPicker
                      setVisibility={setToolVisibility}
                      editor={editor as Editor}
                      elementRef={toolRef}
                      currentLineHeight={currentLineHeight}
                      onSetLineHeight={onSetLineHeight}
                      onOpenCustomSpacing={() => setIsCustomSpacingOpen(true)}
                    />
                  }
                />

                <div className="w-[1px] h-4 vertical-divider"></div>

                {items.map((item, index) => {
                  if (
                    item.name === 'Bold' ||
                    item.name === 'Italic' ||
                    item.name === 'Underline' ||
                    item.name === 'Strikethrough' ||
                    item.name === 'Code'
                  ) {
                    return (
                      <div key={index} className="flex items-center">
                        <ToolbarButton
                          icon={item.icon}
                          size="sm"
                          onClick={item.command}
                          isActive={item.isActive()}
                        />
                        {index === 3 && (
                          <div className="w-[1px] h-4 vertical-divider ml-2"></div>
                        )}
                      </div>
                    );
                  }

                  if (item.name === 'Alignment') {
                    return (
                      <React.Fragment key={index}>
                        <DynamicDropdown
                          key={IEditorTool.TEXT_COLOR}
                          sideOffset={15}
                          anchorTrigger={
                            <ToolbarButton
                              icon="Baseline"
                              size="sm"
                              isActive={
                                toolVisibility === IEditorTool.TEXT_COLOR
                              }
                            />
                          }
                          content={
                            <TextColor
                              setVisibility={setToolVisibility}
                              editor={editor as Editor}
                              elementRef={toolRef}
                            />
                          }
                        />
                        <DynamicDropdown
                          key={IEditorTool.HIGHLIGHT}
                          sideOffset={15}
                          anchorTrigger={
                            <ToolbarButton
                              icon="Highlighter"
                              size="sm"
                              isActive={
                                toolVisibility === IEditorTool.HIGHLIGHT
                              }
                            />
                          }
                          content={
                            <TextHighlighter
                              setVisibility={setToolVisibility}
                              editor={editor as Editor}
                              elementRef={toolRef}
                            />
                          }
                        />
                        <div className="w-[1px] h-4 vertical-divider"></div>
                        <DynamicDropdown
                          key={item.name}
                          sideOffset={15}
                          anchorTrigger={
                            <ToolbarButton
                              icon={item.icon}
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setToolVisibility(IEditorTool.ALIGNMENT)
                              }
                            />
                          }
                          className="shadow-elevation-3"
                          content={renderContent(item)}
                        />
                      </React.Fragment>
                    );
                  }

                  if (item.name === 'Link' || item.name === 'Scripts') {
                    return (
                      <React.Fragment key={item.name}>
                        <DynamicDropdown
                          sideOffset={15}
                          anchorTrigger={
                            <ToolbarButton
                              icon={item.icon}
                              variant="ghost"
                              size="sm"
                              onClick={item.command}
                            />
                          }
                          className="shadow-elevation-3"
                          content={renderContent(item)}
                        />
                      </React.Fragment>
                    );
                  }

                  if (item.name === 'Comment') {
                    if (shouldUseFloatingComments) {
                      return (
                        <ToolbarButton
                          key="Comment"
                          ref={buttonRef}
                          data-testid="inline-comment-btn"
                          icon="MessageSquarePlus"
                          variant="ghost"
                          size="sm"
                          tooltip={isCommentResolved ? 'Comment resolved' : ''}
                          disabled={
                            isCommentResolved ||
                            !isCollabDocumentPublished ||
                            disableInlineComment
                          }
                          isActive={isCommentActive}
                          onClick={handleInlineComment}
                          classNames="disabled:!bg-transparent"
                        />
                      );
                    }

                    return (
                      <DynamicDropdown
                        key="Comment"
                        side="bottom"
                        sideOffset={15}
                        alignOffset={-5}
                        align="end"
                        className="!z-[50] shadow-elevation-3"
                        anchorTrigger={
                          <ToolbarButton
                            ref={buttonRef}
                            data-testid="inline-comment-btn"
                            icon="MessageSquarePlus"
                            variant="ghost"
                            size="sm"
                            tooltip={
                              isCommentResolved ? 'Comment resolved' : ''
                            }
                            disabled={
                              isCommentResolved ||
                              !isCollabDocumentPublished ||
                              disableInlineComment
                            }
                            isActive={isCommentActive}
                            onClick={handleInlineComment}
                            classNames="disabled:!bg-transparent"
                          />
                        }
                        content={
                          !isCommentActive
                            ? renderContent({
                                name: 'Comment',
                                initialComment: activeComment?.content || '',
                              })
                            : null
                        }
                      />
                    );
                  }

                  return null;
                })}
              </React.Fragment>
            )}
          </React.Fragment>
        )}
      </BubbleMenu>

      {/* Sibling of the bubble menu, not a child: the menu unmounts as soon as
        the selection changes, which would tear the dialog down with it. */}
      <CustomSpacingDialog
        editor={editor ?? null}
        open={isCustomSpacingOpen}
        onOpenChange={setIsCustomSpacingOpen}
      />
    </>
  );
};

export const EditorBubbleMenu = React.memo(EditorBubbleMenuComponent);
EditorBubbleMenu.displayName = 'EditorBubbleMenu';
