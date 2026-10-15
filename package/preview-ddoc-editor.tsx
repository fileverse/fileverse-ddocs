import { EditorContent } from '@tiptap/react';
import { DdocProps } from './types';
import { EditingProvider } from './hooks/use-editing-context';
import './styles/editor.css';
import 'tippy.js/animations/shift-toward-subtle.css';
import { useDdocEditor } from './use-ddoc-editor';
import './styles/index.css';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  resolveImageFetchFn,
  resolveImageUploadFn,
} from './utils/storage-adapter';
import { Button, Tag, TagType, TagInput, cn, Skeleton } from '@fileverse/ui';
import { useMediaQuery, useOnClickOutside } from 'usehooks-ts';
import { AnimatePresence, motion } from 'framer-motion';
import { EditorProvider } from './context/editor-context';
import { fadeInTransition, slideUpTransition } from './components/motion-div';
import { PreviewContentLoader } from './components/preview-content-loader';
import { DocumentOutline } from './components/toc/document-outline';
import { DBlockToolbarProvider } from './extensions/d-block/dblock-toolbar';

const PreviewDdocEditorContent = forwardRef(
  (
    {
      isPreviewMode = false,
      initialContent,
      username,
      walletAddress,
      onChange,
      onCollaboratorChange,
      onTextSelection,
      onCommentInteraction,
      ensResolutionUrl,
      imageUploadFn,
      ipfsImageUploadFn: ipfsImageUploadFnProp,
      onError,
      setCharacterCount,
      setWordCount,
      setPageCount,
      tags,
      selectedTags,
      setSelectedTags,
      className,
      unFocused,
      imageFetchFn,
      ipfsImageFetchFn: ipfsImageFetchFnProp,
      fetchV1ImageFn,
      contentClassName,
      isLoading,
      versionHistoryState,
      showTOC,
      setShowTOC,
      tabSectionContainer,
      documentStyling,
      theme,
      fonts,
    }: DdocProps & { contentClassName?: string; isLoading?: boolean },
    ref,
  ) => {
    // Resolve the storage-agnostic image fns (preferred) against the
    // deprecated ipfs-prefixed ones; internals keep the legacy interface.
    const ipfsImageUploadFn = useMemo(
      () => resolveImageUploadFn(imageUploadFn, ipfsImageUploadFnProp),
      [imageUploadFn, ipfsImageUploadFnProp],
    );
    const ipfsImageFetchFn = useMemo(
      () => resolveImageFetchFn(imageFetchFn, ipfsImageFetchFnProp),
      [imageFetchFn, ipfsImageFetchFnProp],
    );
    const [isHiddenTagsVisible, setIsHiddenTagsVisible] = useState(false);
    const tagsContainerRef = useRef(null);

    const visibleTags = selectedTags?.slice(0, 4) || [];
    const hiddenTagsCount = selectedTags
      ? Math.max(0, selectedTags.length - 4)
      : 0;

    useOnClickOutside(tagsContainerRef, () => {
      setIsHiddenTagsVisible(false);
    });

    useEffect(() => {
      if (selectedTags && selectedTags.length <= 4) {
        setIsHiddenTagsVisible(false);
      }
    }, [selectedTags]);

    const {
      editor,
      ref: editorRef,
      isContentLoading,
      ydoc,
      dBlockRuntimeState,
      ...rest
    } = useDdocEditor({
      ipfsImageFetchFn,
      fetchV1ImageFn,
      isPreviewMode,
      isPreviewEditor: true,
      initialContent,
      versionHistoryState,
      walletAddress,
      username,
      onChange,
      onCollaboratorChange,
      onCommentInteraction,
      onTextSelection,
      ensResolutionUrl,
      onError,
      setCharacterCount,
      setWordCount,
      setPageCount,
      ipfsImageUploadFn,
      unFocused,
      theme,
      fonts,
    });

    useImperativeHandle(
      ref,
      () => ({
        getEditor: () => editor,
        getYdoc: () => ydoc,
        exportContentAsMarkDown: async (filename: string) => {
          if (editor) {
            const generateDownloadUrl =
              await editor.commands.exportMarkdownFile();
            if (generateDownloadUrl) {
              const url = generateDownloadUrl;
              const link = document.createElement('a');
              link.href = url;
              link.download = filename;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(url);
            }
          }
        },
      }),
      [editor, ydoc],
    );

    const handleAddTag = (tag: TagType) => {
      const newTags = tag.name.split(',').map((name) => {
        const trimmedName = name.trim();
        const existingTag = tags?.find(
          (t) => t.name.toLowerCase() === trimmedName.toLowerCase(),
        );
        return existingTag || { name: trimmedName, color: tag.color };
      });

      setSelectedTags?.((prevTags) => {
        const uniqueTags = [...prevTags];
        newTags.forEach((newTag) => {
          if (
            !uniqueTags.some(
              (t) => t.name.toLowerCase() === newTag.name.toLowerCase(),
            )
          ) {
            uniqueTags.push(newTag);
          }
        });
        return uniqueTags;
      });
    };

    const handleRemoveTag = (tagName: string) => {
      setSelectedTags?.((prevTags) =>
        prevTags.filter((tag) => tag.name !== tagName),
      );
    };

    const isMobile = useMediaQuery('(max-width: 768px)');

    // Newer-schema docs never bind an editor in this build (schema guard in
    // useDdocEditor); show a refresh prompt instead of the preview surface.
    if (rest.isSchemaUnsupported) {
      return (
        <div className="flex flex-col items-center gap-3 text-center p-10">
          <p className="text-heading-sm color-text-default">
            Update needed to open this document
          </p>
          <p className="text-body-sm color-text-secondary">
            This document was created with a newer version of the app. Refresh
            the page to update and open it.
          </p>
          <Button onClick={() => window.location.reload()}>Refresh</Button>
        </div>
      );
    }

    return (
      <>
        {editor && rest.tabs.length > 0 && (
          <DocumentOutline
            editor={editor}
            hasToC={true}
            items={rest.tocItems}
            setItems={rest.setTocItems}
            showTOC={showTOC}
            setShowTOC={setShowTOC}
            isPreviewMode={isPreviewMode}
            tabs={rest.tabs}
            setTabs={rest.setTabs}
            activeTabId={rest.activeTabId}
            setActiveTabId={rest.setActiveTabId}
            createTab={rest.createTab}
            renameTab={rest.renameTab}
            duplicateTab={rest.duplicateTab}
            orderTab={rest.orderTab}
            ydoc={ydoc}
            tabCommentCounts={{}}
            tabSectionContainer={tabSectionContainer}
            isVersionHistoryMode={versionHistoryState?.enabled}
          />
        )}

        {!editor || isContentLoading || isLoading
          ? fadeInTransition(
              <div className={cn('pt-20', !isMobile ? 'mx-20' : 'mx-10 mt-10')}>
                <Skeleton
                  className={`${isPreviewMode ? 'w-full' : isMobile ? 'w-full' : 'w-[400px]'}  h-[32px] rounded-sm mb-4`}
                />
                {isPreviewMode && <PreviewContentLoader />}
              </div>,
              'content-transition',
            )
          : slideUpTransition(
              <EditorProvider
                documentStyling={documentStyling}
                theme={theme ?? 'light'}
              >
                <div
                  ref={editorRef}
                  className={cn('overflow-x-hidden', className)}
                >
                  <EditingProvider
                    isPreviewMode={isPreviewMode}
                    isPreviewEditor={true}
                  >
                    {tags && tags.length > 0 && (
                      <div
                        ref={tagsContainerRef}
                        className="flex flex-wrap px-4 md:px-[80px] lg:!px-[124px] items-center gap-1 mb-4 mt-4 lg:!mt-0"
                      >
                        {visibleTags.map((tag, index) => (
                          <Tag
                            key={index}
                            style={{ backgroundColor: tag?.color }}
                            onRemove={() => handleRemoveTag(tag?.name)}
                            isRemovable={!isPreviewMode}
                            className="!h-6 rounded"
                          >
                            {tag?.name}
                          </Tag>
                        ))}
                        {hiddenTagsCount > 0 && !isHiddenTagsVisible && (
                          <Button
                            variant="ghost"
                            className="!h-6 rounded min-w-fit !px-2 color-bg-secondary text-helper-text-sm"
                            onClick={() => setIsHiddenTagsVisible(true)}
                          >
                            +{hiddenTagsCount}
                          </Button>
                        )}
                        <AnimatePresence>
                          {isHiddenTagsVisible && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3 }}
                              className="flex flex-wrap items-center gap-1"
                            >
                              {selectedTags?.slice(4).map((tag, index) => (
                                <Tag
                                  key={index + 4}
                                  style={{ backgroundColor: tag?.color }}
                                  onRemove={() => handleRemoveTag(tag?.name)}
                                  isRemovable={!isPreviewMode}
                                  className="!h-6 rounded"
                                >
                                  {tag?.name}
                                </Tag>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                        <TagInput
                          tags={tags || []}
                          selectedTags={selectedTags as TagType[]}
                          onAddTag={handleAddTag}
                          isPreviewMode={isPreviewMode}
                        />
                      </div>
                    )}
                    <DBlockToolbarProvider
                      editor={editor}
                      runtimeState={dBlockRuntimeState}
                      isPreviewEditor
                    >
                      <EditorContent
                        editor={editor}
                        data-ddoc-editor-root="true"
                        className={cn('w-full h-auto py-8', contentClassName)}
                      />
                    </DBlockToolbarProvider>
                  </EditingProvider>
                </div>
              </EditorProvider>,
              'editor-transition',
            )}
      </>
    );
  },
);

const PreviewDdocEditor = forwardRef(
  (
    props: DdocProps & { contentClassName?: string; isLoading?: boolean },
    ref,
  ) => {
    const isVersionMode = Boolean(props.versionHistoryState?.enabled);
    const versionId = props.versionHistoryState?.versionId || 'default';
    const editorSessionKey = isVersionMode ? versionId : 'default';

    return (
      <PreviewDdocEditorContent key={editorSessionKey} {...props} ref={ref} />
    );
  },
);

export { PreviewDdocEditor };
