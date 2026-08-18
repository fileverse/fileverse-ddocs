import React, { useCallback, useMemo } from 'react';
import { useEditorToolbar } from './editor-utils';
import { Editor } from '@tiptap/react';
import { useEditorStates } from '../hooks/use-editor-states';
import {
  Tooltip,
  IconButton,
  Skeleton,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@fileverse/ui';
import ToolbarButton from '../common/toolbar-button';
import { useMediaQuery } from 'usehooks-ts';
import { AnimatePresence } from 'framer-motion';
import { fadeInTransition, slideUpTransition } from './motion-div';
import {
  FontDescriptor,
  IpfsImageFetchPayload,
  IpfsImageUploadResponse,
} from '../types';
import { ImportExportButton } from './import-export-button';
import { Tab } from './tabs/utils/tab-utils';
import * as Y from 'yjs';
import { ZoomLevelDropdown } from './editor-toolbar/zoom-level';
import { FontFamilyDropdown } from './editor-toolbar/font-family';
import { HeadingDropdown } from './editor-toolbar/heading';
import { FontSizeDropdown } from './editor-toolbar/font-size';
import { LineHeightDropdown } from './editor-toolbar/line-height';
import { HighlightDropdown } from './editor-toolbar/highlight';
import { TextColorDropdown } from './editor-toolbar/text-color';
import { AlignmentDropdown } from './editor-toolbar/alignment';
import { LinkPopover } from './editor-toolbar/link';

const TiptapToolBar = ({
  editor,
  onError,
  isPresentationMode,
  setIsPresentationMode,
  enableCollaboration,
  zoomLevel,
  setZoomLevel,
  isNavbarVisible,
  setIsNavbarVisible,
  ipfsImageUploadFn,
  onMarkdownExport,
  onMarkdownImport,
  onPdfExport,
  onHtmlExport,
  onTxtExport,
  onOdtExport,
  onDocxImport,
  isLoading,
  ipfsImageFetchFn,
  fetchV1ImageFn,
  isConnected,
  tabs,
  ydoc,
  onRegisterExportTrigger,
  toggleFocusMode,
  isSplitView,
  onToggleSplitView,
  fonts: consumerFonts,
}: {
  editor: Editor | null;
  onError?: (errorString: string) => void;
  isPresentationMode?: boolean;
  setIsPresentationMode: () => void;
  enableCollaboration?: boolean;
  zoomLevel: string;
  setZoomLevel: (zoom: string) => void;
  isNavbarVisible: boolean;
  setIsNavbarVisible: React.Dispatch<React.SetStateAction<boolean>>;
  ipfsImageUploadFn?: (file: File) => Promise<IpfsImageUploadResponse>;
  onMarkdownExport?: () => void;
  onMarkdownImport?: () => void;
  onPdfExport?: () => void;
  onHtmlExport?: () => void;
  onTxtExport?: () => void;
  onOdtExport?: () => void;
  onDocxImport?: () => void;
  isLoading: boolean;
  fetchV1ImageFn?: (url: string) => Promise<ArrayBuffer | undefined>;
  ipfsImageFetchFn?: (
    _data: IpfsImageFetchPayload,
  ) => Promise<{ url: string; file: File }>;
  isConnected?: boolean;
  tabs: Tab[];
  ydoc: Y.Doc;
  toggleFocusMode?: () => void;
  isSplitView?: boolean;
  onToggleSplitView?: () => void;
  onRegisterExportTrigger?:
    | ((trigger: ((format?: string, name?: string) => void) | null) => void)
    | undefined;
  fonts?: FontDescriptor[];
}) => {
  const {
    toolbar,
    undoRedoTools,
    importOptions,
    exportOptions,
    fileExportsOpen,
    setFileExportsOpen,
  } = useEditorToolbar({
    editor,
    isPresentationMode,
    setIsPresentationMode,
    enableCollaboration,
    onError,
    ipfsImageUploadFn,
    onMarkdownExport,
    onMarkdownImport,
    onPdfExport,
    onHtmlExport,
    onTxtExport,
    onOdtExport,
    ipfsImageFetchFn,
    onDocxImport,
    fetchV1ImageFn,
    isConnected,
  });

  const editorStates = useEditorStates(editor as Editor);
  const noopSetEditorValue = useCallback(() => {}, []);
  const currentSize = editor ? editorStates.currentSize : undefined;
  const onSetFontSize = editor
    ? editorStates.onSetFontSize
    : noopSetEditorValue;
  const currentLineHeight = editor ? editorStates.currentLineHeight : undefined;
  const onSetLineHeight = editor
    ? editorStates.onSetLineHeight
    : noopSetEditorValue;

  const isBelow1560px = useMediaQuery('(max-width: 1560px)');
  const isBelow1370px = useMediaQuery('(max-width: 1370px)');
  const isBelow1270px = useMediaQuery('(max-width: 1270px)');
  const isBelow1160px = useMediaQuery('(max-width: 1160px)');
  const isBelow1030px = useMediaQuery('(max-width: 1030px)');

  const toolbarBreakpoint = useMemo(() => {
    switch (true) {
      case isBelow1030px:
        return 1030;
      case isBelow1160px:
        return 1160;
      case isBelow1270px:
        return 1270;
      case isBelow1370px:
        return 1370;
      case isBelow1560px:
        return 1560;
      default:
        return 3120;
    }
  }, [
    isBelow1030px,
    isBelow1160px,
    isBelow1270px,
    isBelow1370px,
    isBelow1560px,
  ]);
  const handleNavbarVisibilityToggle = useCallback(
    () => setIsNavbarVisible((prev) => !prev),
    [setIsNavbarVisible],
  );

  if (!editor) return null;

  return (
    <AnimatePresence mode="wait">
      <div
        onKeyDown={(e) => {
          // Escape from anywhere in the toolbar returns focus to the editor,
          // letting keyboard users leave the toolbar's tabbing order.
          if (e.key === 'Escape') {
            e.preventDefault();
            editor.commands.focus();
          }
        }}
        className="w-full bg-transparent px-2 py-1 items-center h-9 flex justify-between relative"
      >
        <div className="flex h-9 items-center gap-1 justify-center">
          {/* Export/Import Dropdown */}

          {isLoading
            ? fadeInTransition(
                <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                'markdown-transition',
              )
            : slideUpTransition(
                <ImportExportButton
                  fileExportsOpen={fileExportsOpen}
                  setFileExportsOpen={setFileExportsOpen}
                  exportOptions={exportOptions}
                  importOptions={importOptions}
                  editor={editor}
                  tabs={tabs}
                  ydoc={ydoc}
                  onRegisterExportTrigger={onRegisterExportTrigger}
                />,
                'markdown-dropdown-transition',
              )}

          <div className="w-[1px] h-4 vertical-divider mx-1"></div>

          {/* Undo/Redo Tools */}
          <div className="flex gap-1 justify-center items-center">
            {undoRedoTools.map((tool, _index) => {
              if (tool) {
                return (
                  <Tooltip key={tool.title} text={tool.title} asTriggerChild>
                    {isLoading
                      ? fadeInTransition(
                          <Skeleton
                            className={`w-[30px] h-[30px] rounded-sm`}
                          />,
                          'redo-skeleton-transition',
                        )
                      : slideUpTransition(
                          <IconButton
                            className="disabled:bg-transparent"
                            variant={'ghost'}
                            icon={tool.icon}
                            onClick={() => tool.onClick()}
                            size="sm"
                            disabled={!tool.isActive}
                          />,
                          'redo-tool-transition',
                        )}
                  </Tooltip>
                );
              } else {
                return (
                  <div
                    key={_index}
                    className="w-[1px] h-4 vertical-divider mx-1"
                  ></div>
                );
              }
            })}
          </div>

          {/* Zoom Levels Dropdown */}

          {isLoading
            ? fadeInTransition(
                <Skeleton className={`w-[80px] h-[36px] rounded-sm`} />,
                'zoom-skeleton-transition',
              )
            : slideUpTransition(
                <ZoomLevelDropdown
                  zoomLevel={zoomLevel}
                  setZoomLevel={setZoomLevel}
                />,
                'zoom-dropdown-transition',
              )}

          <div className="w-[1px] h-4 vertical-divider mx-1"></div>

          {/* Font Family Dropdown */}
          {isLoading
            ? fadeInTransition(
                <Skeleton className={`w-[96px] h-[36px] rounded-sm`} />,
                'font-family-skeleton',
              )
            : slideUpTransition(
                <FontFamilyDropdown
                  editor={editor}
                  consumerFonts={consumerFonts}
                />,
                'font-dropdown-transiton',
              )}
          <div className="w-[1px] h-4 vertical-divider mx-1"></div>

          {/* Heading Dropdown */}
          {isLoading
            ? fadeInTransition(
                <Skeleton className={`w-[112px] h-[36px] rounded-sm`} />,
                'heading-skeleton',
              )
            : slideUpTransition(
                <HeadingDropdown editor={editor} />,
                'heading-dropdown',
              )}
          <div className="w-[1px] h-4 vertical-divider mx-1"></div>
          {/* Text Size Dropdown */}
          {isLoading
            ? fadeInTransition(
                <Skeleton className={`w-[112px] h-[36px] rounded-sm`} />,
                'font-size-skeleton',
              )
            : slideUpTransition(
                <FontSizeDropdown
                  editor={editor}
                  currentSize={currentSize}
                  onSetFontSize={onSetFontSize}
                />,
                'font-size-dropdown',
              )}

          <div className="w-[1px] h-4 vertical-divider mx-1"></div>

          {/* Toolbar Items */}
          <div className="flex gap-2 justify-center items-center">
            {toolbar.map((tool, index) => {
              const breakpoint = toolbarBreakpoint;

              if (!tool) {
                if (
                  isBelow1560px &&
                  (toolbar[index - 1]?.notVisible ?? 0) >= breakpoint
                ) {
                  return null;
                }
                return (
                  <div
                    key={index}
                    className="w-[1px] h-4 vertical-divider mx-1"
                  ></div>
                );
              }

              if (
                tool.group === 'More' &&
                (tool.notVisible ?? 0) >= breakpoint
              ) {
                const firstCollapsedItem =
                  toolbar.findIndex(
                    (t) =>
                      t?.group === 'More' && (t?.notVisible ?? 0) >= breakpoint,
                  ) === index;
                if (!firstCollapsedItem) return null;

                return !isLoading
                  ? slideUpTransition(
                      <Popover>
                        <PopoverTrigger asChild>
                          <IconButton
                            id="more-dropdown"
                            icon="Ellipsis"
                            variant="ghost"
                            size="sm"
                          />
                        </PopoverTrigger>
                        <PopoverContent>
                          <div className="flex p-1 gap-1">
                            {toolbar
                              .filter(
                                (t) =>
                                  t?.group === 'More' &&
                                  (t?.notVisible ?? 0) >= breakpoint,
                              )
                              .map((moreTool) => {
                                if (moreTool === null) return;
                                if (moreTool.title === 'Line Height') {
                                  return (
                                    <LineHeightDropdown
                                      key={moreTool.title}
                                      tool={moreTool}
                                      currentLineHeight={currentLineHeight}
                                      onSetLineHeight={onSetLineHeight}
                                    />
                                  );
                                }
                                if (moreTool.title === 'Highlight') {
                                  return (
                                    <HighlightDropdown
                                      key={moreTool.title}
                                      tool={moreTool}
                                      editor={editor}
                                    />
                                  );
                                }
                                if (moreTool.title === 'Text Color') {
                                  return (
                                    <TextColorDropdown
                                      key={moreTool.title}
                                      tool={moreTool}
                                      editor={editor}
                                    />
                                  );
                                }
                                if (moreTool.title === 'Alignment') {
                                  return (
                                    <AlignmentDropdown
                                      key={moreTool.title}
                                      tool={moreTool}
                                      editor={editor}
                                    />
                                  );
                                }
                                if (moreTool.title === 'Link') {
                                  return (
                                    <LinkPopover
                                      key={moreTool.title}
                                      tool={moreTool}
                                      editor={editor}
                                      onError={onError}
                                    />
                                  );
                                }
                                return (
                                  <ToolbarButton
                                    key={moreTool.title}
                                    size="sm"
                                    icon={moreTool.icon}
                                    onClick={moreTool.onClick || (() => {})}
                                    isActive={moreTool.isActive || false}
                                    disabled={moreTool.disabled}
                                  />
                                );
                              })}
                          </div>
                        </PopoverContent>
                      </Popover>,
                      tool.title,
                    )
                  : fadeInTransition(
                      <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                      tool.title + 'loader',
                    );
              }

              if (tool.title === 'Line Height') {
                return !isLoading
                  ? slideUpTransition(
                      <LineHeightDropdown
                        tool={tool}
                        currentLineHeight={currentLineHeight}
                        onSetLineHeight={onSetLineHeight}
                      />,
                      tool.title,
                    )
                  : fadeInTransition(
                      <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                      tool.title + 'skeleton',
                    );
              }

              if (tool.title === 'Highlight') {
                return !isLoading
                  ? slideUpTransition(
                      <HighlightDropdown tool={tool} editor={editor} />,
                      tool.title,
                    )
                  : fadeInTransition(
                      <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                      tool.title + 'skeleton',
                    );
              }

              if (tool.title === 'Text Color') {
                return !isLoading
                  ? slideUpTransition(
                      <TextColorDropdown tool={tool} editor={editor} />,
                      tool.title,
                    )
                  : fadeInTransition(
                      <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                      tool.title + 'skeleton',
                    );
              }

              if (tool.title === 'Alignment') {
                return !isLoading
                  ? slideUpTransition(
                      <AlignmentDropdown tool={tool} editor={editor} />,
                      tool.title,
                    )
                  : fadeInTransition(
                      <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                      tool.title + 'skeleton',
                    );
              }

              if (tool.title === 'Link') {
                return !isLoading
                  ? slideUpTransition(
                      <LinkPopover
                        tool={tool}
                        editor={editor}
                        onError={onError}
                      />,
                      tool.title,
                    )
                  : fadeInTransition(
                      <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                      tool.title + 'skeleton',
                    );
              }

              // Regular toolbar button
              return !isLoading
                ? slideUpTransition(
                    <Tooltip key={tool.title} text={tool.title} asTriggerChild>
                      <ToolbarButton
                        icon={tool.icon}
                        onClick={tool.onClick}
                        size="sm"
                        isActive={tool.isActive}
                        disabled={tool.disabled}
                      />
                    </Tooltip>,
                    tool.title,
                  )
                : fadeInTransition(
                    <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                    tool.title + 'skeleton',
                  );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-[1px] h-4 vertical-divider mx-2"></div>
          {onToggleSplitView && (
            <Tooltip
              text={isSplitView ? 'Back to editor' : 'Markdown view'}
              asTriggerChild
            >
              <IconButton
                // Icon swaps to signal the action: split icon → enter markdown
                // view; pencil → return to the normal editor.
                icon={isSplitView ? 'PenLine' : 'SquareSplitHorizontal'}
                size="sm"
                variant="ghost"
                onClick={onToggleSplitView}
                id="split-view-button"
              />
            </Tooltip>
          )}
          <Tooltip text="Enter focus mode" asTriggerChild>
            <IconButton
              icon={'Focus'}
              size="sm"
              variant="ghost"
              onClick={toggleFocusMode}
              id="focus-mode-button"
            />
          </Tooltip>
          {isLoading
            ? fadeInTransition(
                <Skeleton className={`w-[36px] h-[36px] rounded-sm`} />,
                'chevronUp-skeleton',
              )
            : slideUpTransition(
                <IconButton
                  size="sm"
                  variant="ghost"
                  icon={isNavbarVisible ? 'ChevronUp' : 'ChevronDown'}
                  onClick={handleNavbarVisibilityToggle}
                />,
                'chevronUp',
              )}
        </div>
      </div>
    </AnimatePresence>
  );
};

const MemoizedTiptapToolBar = React.memo(TiptapToolBar);
MemoizedTiptapToolBar.displayName = 'TiptapToolBar';

export default MemoizedTiptapToolBar;
