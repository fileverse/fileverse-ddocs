import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  useLayoutEffect,
} from 'react';
import { JSONContent, NodeViewProps, NodeViewWrapper } from '@tiptap/react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import wizardLogo from '../../assets/wizard.svg';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Button,
  LucideIcon,
  Select,
  SelectItem,
  SelectContent,
  SelectGroup,
  SelectTrigger,
  SelectValue,
  cn,
  Checkbox,
} from '@fileverse/ui';
import styles from './ai-writer-node-view.module.css';
import { useResponsive } from '../../utils/responsive';
import { useEditingContext } from '../../hooks/use-editing-context';
import { TextSelection } from 'prosemirror-state';
import { SuperchargedTableExtensions } from '../supercharged-table/supercharged-table-kit';
import { ModelOption, WindowWithModelContext, ModelService } from './types';
import { getLoadingMessageInOrder, md } from './utils';

export const AIWriterNodeView = memo(
  ({
    node,
    editor: parentEditor,
    getPos,
    updateAttributes,
    deleteNode,
  }: NodeViewProps) => {
    const [isLoading, setIsLoading] = useState(false);
    const [isStreaming, setIsStreaming] = useState(false);
    const [localPrompt, setLocalPrompt] = useState(node.attrs.prompt);
    const [hasGenerated, setHasGenerated] = useState(!!node.attrs.content);
    const [streamingContent, setStreamingContent] = useState('');
    const [isRemoving, setIsRemoving] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [availableModels, setAvailableModels] = useState<ModelOption[]>([]);
    const [includeContext, setIncludeContext] = useState<boolean>(
      !!localStorage.getItem('include-ddoc-context'),
    );
    const [isInitialRender, setIsInitialRender] = useState(true);
    const { prompt, content } = node.attrs;
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const selectContentRef = useRef<HTMLDivElement>(null);
    const { isSuggestionMode } = useEditingContext();
    const isPreviewMode = !parentEditor.isEditable || !!isSuggestionMode;
    // Add platform detection
    const { isWindows } = useResponsive();
    const shortcutKey = isWindows ? 'Ctrl' : 'Cmd';
    // Get the model context from window
    const modelContext = (window as WindowWithModelContext).__MODEL_CONTEXT__;
    // Add ref for abort controller
    const abortControllerRef = useRef<AbortController | null>(null);
    const [currentLoadingMessage, setCurrentLoadingMessage] = useState(
      getLoadingMessageInOrder(),
    );

    // Create a new editor instance for editing
    const editEditor = useEditor({
      extensions: [StarterKit, ...SuperchargedTableExtensions],
      content: '',
      editable: true,
      immediatelyRender: false,
      shouldRerenderOnTransaction: false,
    });

    // Handle initial render animation
    useEffect(() => {
      if (isInitialRender) {
        const timer = setTimeout(() => {
          setIsInitialRender(false);
        }, 50);
        return () => clearTimeout(timer);
      }
    }, [isInitialRender]);

    // Immediate focus attempt using useLayoutEffect
    useLayoutEffect(() => {
      if (!isPreviewMode && textareaRef.current) {
        textareaRef.current.focus();
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      }
    }, [isPreviewMode]);

    // Delayed focus attempts using useEffect
    useEffect(() => {
      if (!isPreviewMode && textareaRef.current) {
        const focusTimeout = setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const len = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(len, len);
            textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
          }
        }, 100);

        return () => clearTimeout(focusTimeout);
      }
    }, [isPreviewMode]);

    // Load available models and set initial selected model on mount
    useEffect(() => {
      const loadModels = async () => {
        if (modelContext?.defaultModels) {
          try {
            const models = modelContext.defaultModels.map((model) => ({
              value: model.modelName,
              label: model.label,
            }));
            setAvailableModels(models);
          } catch (error) {
            console.error('Error loading available models:', error);
          }
        }
      };
      loadModels();
    }, [modelContext?.defaultModels]);

    // Update textarea height when content changes
    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.style.height = '0px';
        textareaRef.current.style.height =
          textareaRef.current.scrollHeight + 'px';
      }
    }, [localPrompt]);

    // Combine effects for updating localPrompt and hasGenerated
    useEffect(() => {
      setLocalPrompt(prompt);
      setHasGenerated(!!content);
    }, [prompt, content]);

    // Get document context
    const getDocumentContext = useCallback(() => {
      if (!includeContext) return '';

      const doc = parentEditor.getJSON();
      const currentPos = getPos();
      if (typeof currentPos !== 'number') return '';

      const contextWindow = 2000; // Characters to include before and after

      // Get text content from the document
      let context = '';

      // Helper to get text from a node
      const getNodeText = (node: {
        text?: string;
        content?: Array<{ text?: string; content?: JSONContent[] }>;
      }): string => {
        if (!node) return '';
        if (node.text) return node.text;
        if (node.content) {
          return node.content.map((content) => getNodeText(content)).join(' ');
        }
        return '';
      };

      // Get nodes before current position
      let beforeContext = '';
      let beforeLength = 0;
      const beforeNodes = doc.content?.slice(0, -1) || [];
      for (let i = beforeNodes.length - 1; i >= 0; i--) {
        const nodeText = getNodeText(beforeNodes[i]);
        if (beforeLength + nodeText.length > contextWindow) {
          beforeContext =
            nodeText.slice(-(contextWindow - beforeLength)) + beforeContext;
          break;
        }
        beforeContext = nodeText + '\n' + beforeContext;
        beforeLength += nodeText.length;
      }

      // Get nodes after current position
      let afterContext = '';
      let afterLength = 0;
      const afterNodes = doc.content?.slice(-1) || [];
      for (const node of afterNodes) {
        const nodeText = getNodeText(node);
        if (afterLength + nodeText.length > contextWindow) {
          afterContext += nodeText.slice(0, contextWindow - afterLength);
          break;
        }
        afterContext += nodeText + '\n';
        afterLength += nodeText.length;
      }

      // Combine contexts
      context = (beforeContext + afterContext).trim();

      // Add metadata about context
      if (context) {
        context = `Document context (${beforeLength} chars before, ${afterLength} chars after):\n${context}`;
      }

      return context;
    }, [parentEditor, getPos, includeContext]);

    // Update handleGenerate to use modelContext and handle streaming
    const handleGenerate = useCallback(async () => {
      if (!localPrompt.trim()) return;
      try {
        setIsLoading(true);
        setIsStreaming(true);
        setStreamingContent('');
        setHasGenerated(false);
        modelContext?.onPromptUsage?.();

        const context = getDocumentContext();
        const fullPrompt = includeContext
          ? `Context from document:\n${context}\n\nUser prompt: ${localPrompt} /no_think`
          : `${localPrompt} /no_think`;

        if (modelContext?.activeModel) {
          const modelService = (
            window as Window & { modelService?: ModelService }
          ).modelService;

          // Create new AbortController for this request
          abortControllerRef.current = new AbortController();

          if (modelService?.streamModel) {
            let fullContent = '';
            try {
              await modelService.streamModel(
                fullPrompt,
                modelContext.activeModel.modelName,
                (chunk: string) => {
                  fullContent += chunk;
                  setStreamingContent(fullContent);
                },
                abortControllerRef.current.signal,
              );
              // Only update attributes if streaming completed successfully
              updateAttributes?.({
                content: fullContent,
                prompt: localPrompt,
              });
              setHasGenerated(true);
            } catch (error: unknown) {
              if (error instanceof Error && error.name === 'AbortError') {
                // If aborted, keep the partial content
                updateAttributes?.({
                  content: fullContent,
                  prompt: localPrompt,
                });
                setHasGenerated(true);
              } else {
                throw error;
              }
            }
          } else if (modelService?.callModel) {
            const newContent = await modelService.callModel(
              fullPrompt,
              modelContext.activeModel.modelName,
            );
            updateAttributes?.({
              content: newContent,
              prompt: localPrompt,
            });
            setHasGenerated(true);
          }
        } else {
          console.error('No active model selected');
        }
      } catch (error) {
        console.error('Error generating text:', error);
      } finally {
        setIsLoading(false);
        setIsStreaming(false);
        abortControllerRef.current = null;
      }
    }, [
      localPrompt,
      modelContext,
      getDocumentContext,
      includeContext,
      updateAttributes,
    ]);

    // Add stop streaming handler
    const handleStopStreaming = useCallback(() => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        setIsStreaming(false);
        setIsLoading(false);
        // Use setTimeout to ensure focus happens after state updates
        const timeout = setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.focus();
            const len = textareaRef.current.value.length;
            textareaRef.current.setSelectionRange(len, len);
            textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
          }
        }, 0);
        return () => clearTimeout(timeout);
      }
    }, []);

    const handleInsert = useCallback(() => {
      if (typeof getPos === 'function') {
        setIsRemoving(true);
        const timeout = setTimeout(() => {
          parentEditor.commands.command(({ tr, dispatch }) => {
            if (dispatch) {
              const pos = getPos();
              if (pos !== undefined) {
                tr.delete(pos, pos + node.nodeSize);
                // Set selection to the position where content will be inserted
                const resolvedPos = tr.doc.resolve(pos);
                tr.setSelection(TextSelection.near(resolvedPos));
              } else {
                deleteNode();
              }
            }
            return true;
          });
          parentEditor.commands.focus();
          parentEditor.commands.insertContent(content);
        }, 150);
        return () => clearTimeout(timeout);
      }
    }, [getPos, parentEditor, node.nodeSize, content, deleteNode]);

    const handleDiscard = useCallback(() => {
      if (typeof getPos === 'function') {
        setIsRemoving(true);
        const timeout = setTimeout(() => {
          parentEditor.commands.command(({ tr, dispatch }) => {
            if (dispatch) {
              const pos = getPos();
              if (pos !== undefined) {
                tr.delete(pos, pos + node.nodeSize);
                // Set selection to the position where the node was
                const resolvedPos = tr.doc.resolve(pos);
                tr.setSelection(TextSelection.near(resolvedPos));
              } else {
                deleteNode();
              }
            }
            return true;
          });
          parentEditor.commands.focus();
        }, 150);
        return () => clearTimeout(timeout);
      }
    }, [getPos, parentEditor, node.nodeSize, deleteNode]);

    const handlePromptChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setLocalPrompt(e.target.value);
      },
      [],
    );

    const handlePromptBlur = useCallback(() => {
      if (updateAttributes && localPrompt !== prompt) {
        updateAttributes({ prompt: localPrompt });
      }
    }, [updateAttributes, localPrompt, prompt]);

    const handleModelChange = useCallback(
      (newModel: string) => {
        updateAttributes?.({ model: newModel });
        // Find the corresponding CustomModel from defaultModels
        const selectedCustomModel = modelContext?.defaultModels.find(
          (model) => model.modelName === newModel,
        );
        // Update the active model in ModelContext
        if (selectedCustomModel && modelContext?.setActiveModel) {
          modelContext.setActiveModel(selectedCustomModel);
        }
      },
      [updateAttributes, modelContext],
    );

    const handleTryAgain = useCallback(() => {
      updateAttributes?.({ content: '' });
      setHasGenerated(false);
      setStreamingContent('');
      if (!textareaRef.current) return;
      textareaRef.current?.focus();
      const len = textareaRef.current.value.length;
      textareaRef.current?.setSelectionRange(len, len);
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
    }, [updateAttributes]);

    const handleEdit = useCallback(() => {
      setIsEditing(true);
    }, []);

    const handleSaveEdit = useCallback(() => {
      if (editEditor) {
        const htmlContent = editEditor.getHTML();
        setIsEditing(false);
        updateAttributes?.({ content: htmlContent });
        setStreamingContent(htmlContent);
      }
    }, [editEditor, updateAttributes]);

    const handleCancelEdit = useCallback(() => {
      setIsEditing(false);
      if (editEditor) {
        editEditor.commands.setContent(streamingContent || content || '');
      }
    }, [editEditor, streamingContent, content]);

    const handlePromptKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          if (hasGenerated) {
            handleInsert();
          }
        } else if (e.key === 'Enter' && !e.shiftKey && !isEditing) {
          e.preventDefault();
          if (localPrompt.trim()) {
            handleGenerate();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (isStreaming) {
            handleStopStreaming();
          } else if (hasGenerated) {
            handleDiscard();
          } else {
            handleDiscard();
          }
        } else if (e.key === ' ' && !localPrompt.trim()) {
          e.preventDefault();
          handleDiscard();
        } else if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleTryAgain();
        } else if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleEdit();
        }
      },
      [
        isEditing,
        localPrompt,
        handleGenerate,
        hasGenerated,
        handleInsert,
        handleDiscard,
        handleTryAgain,
        handleEdit,
        isStreaming,
        handleStopStreaming,
      ],
    );

    const handleIncludeContextChange = useCallback((checked: boolean) => {
      if (checked) {
        localStorage.setItem('include-ddoc-context', 'true');
      } else {
        localStorage.removeItem('include-ddoc-context');
      }
    }, []);

    // Add global keyboard shortcuts
    useEffect(() => {
      const handleGlobalKeyDown = (e: KeyboardEvent) => {
        // Handle Esc key for stopping streaming
        if (e.key === 'Escape' && isStreaming) {
          e.preventDefault();
          handleStopStreaming();
          return;
        }

        // Only handle other shortcuts when content has been generated
        if (!hasGenerated) return;

        // Enter to insert
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
          e.preventDefault();
          handleInsert();
        }
        // Escape to discard
        else if (e.key === 'Escape') {
          e.preventDefault();
          handleDiscard();
        }
        // Option + Command + R to retry (Mac)
        else if (e.key === 'r' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleTryAgain();
        }
        // Option + Command + E to edit (Mac)
        else if (e.key === 'e' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          handleEdit();
        }
      };

      window.addEventListener('keydown', handleGlobalKeyDown);
      return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [
      hasGenerated,
      handleInsert,
      handleDiscard,
      handleTryAgain,
      parentEditor,
      handleEdit,
      isStreaming,
      handleStopStreaming,
    ]);

    // Update editor content when entering edit mode
    useEffect(() => {
      if (isEditing && editEditor) {
        const markdown = streamingContent || content || '';
        const html = md.render(markdown);
        editEditor.commands.setContent(html);
      }
    }, [isEditing, editEditor, streamingContent, content]);

    // Add effect to change loading message
    useEffect(() => {
      if (isLoading) {
        const interval = setInterval(() => {
          setCurrentLoadingMessage(getLoadingMessageInOrder());
        }, 3000); // Change message every 2 seconds

        return () => clearInterval(interval);
      }
    }, [isLoading]);

    // Update renderLoading function
    const renderLoading = useCallback(
      () => (
        <span className="text-body-sm color-text-secondary pt-1 flex items-center gap-1">
          <AnimatePresence mode="wait">
            <span
              className="flex items-center gap-1"
              key={currentLoadingMessage}
            >
              <motion.span
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3, ease: 'easeInOut' }}
                className="inline-block"
              >
                {currentLoadingMessage}
              </motion.span>
              <span className="animate-loading-dots">...</span>
            </span>
          </AnimatePresence>
        </span>
      ),
      [currentLoadingMessage],
    );

    if (isPreviewMode) return null;

    return (
      <NodeViewWrapper className="min-w-[calc(100%+1rem)] translate-x-[-0.5rem]">
        <div
          ref={containerRef}
          className={cn(
            'color-bg-default overflow-hidden flex flex-col rounded-lg w-full',
            isInitialRender
              ? 'opacity-0'
              : isRemoving
                ? 'animate-aiwriter-scale-out'
                : 'animate-aiwriter-scale-in',
          )}
        >
          {/* Preview Section */}
          {(hasGenerated || streamingContent) && (
            <div className="flex w-full flex-row items-center justify-center">
              <div className="animate-border inline-block rounded-lg p-0.5 w-full mx-1 mb-3 mt-2 transition-all">
                {isEditing ? (
                  <div className="w-full color-bg-default p-4 rounded-lg shadow-elevation-3">
                    <div className="ai-preview-editor">
                      <EditorContent
                        editor={editEditor}
                        className="prose prose-sm max-w-none min-h-[200px] color-text-default"
                      />
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                      <Button
                        variant="ghost"
                        onClick={handleCancelEdit}
                        className="text-body-sm"
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="default"
                        onClick={handleSaveEdit}
                        className="text-body-sm"
                      >
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`w-full text-base color-text-default whitespace-pre-line color-bg-default p-4 rounded-lg shadow-elevation-3 overflow-auto select-text ${styles.previewContent}`}
                    dangerouslySetInnerHTML={{
                      __html: md.render(streamingContent || content || ''),
                    }}
                  />
                )}
              </div>
            </div>
          )}

          {/* Prompt Bar */}
          <div
            className={cn(
              'flex items-center flex-col justify-between border color-border-default rounded-lg mb-4 mx-3 flex-1 shadow-elevation-3 ',
              !hasGenerated && 'px-3 py-2',
            )}
          >
            <div
              className={cn(
                'flex items-start gap-2 w-full',
                hasGenerated && 'px-3 py-2',
              )}
            >
              <img src={wizardLogo} alt="AI Writer" className="w-5 h-5" />
              {isLoading && !streamingContent ? (
                renderLoading()
              ) : (
                <div className="flex flex-col w-full">
                  <textarea
                    ref={textareaRef}
                    value={localPrompt}
                    onChange={handlePromptChange}
                    onBlur={handlePromptBlur}
                    onKeyDown={handlePromptKeyDown}
                    placeholder="Ask your Wizard anything..."
                    className="w-full pt-1 bg-transparent outline-none text-body-sm color-text-default px-1 resize-none min-h-[24px]"
                    disabled={isLoading}
                    autoFocus
                  />
                </div>
              )}
            </div>
            <div
              className={cn(
                'flex justify-between gap-2 w-full',
                hasGenerated && 'px-3 pb-2',
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <Select
                  value={modelContext?.activeModel?.modelName ?? ''}
                  onValueChange={handleModelChange}
                  disabled={isLoading}
                >
                  <SelectTrigger className="max-w-32 bg-transparent border-none">
                    <div className="flex items-center gap-1 truncate">
                      <SelectValue placeholder="Select model" />
                    </div>
                  </SelectTrigger>
                  <SelectContent ref={selectContentRef}>
                    <SelectGroup className="ddoc-scrollbar">
                      {availableModels.map((modelOption: ModelOption) => (
                        <SelectItem
                          key={modelOption.value}
                          value={modelOption.value}
                        >
                          {modelOption.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-2 min-w-fit">
                  <Checkbox
                    key="include-context"
                    checked={includeContext}
                    disabled={isLoading}
                    onCheckedChange={() =>
                      setIncludeContext((prev) => {
                        const value = !prev;
                        handleIncludeContextChange(value);
                        return value;
                      })
                    }
                    className="border text-body-sm scale-[.8]"
                  />
                  <label
                    htmlFor="include-context"
                    className={cn(
                      'text-xs md:text-sm color-text-default',
                      isLoading && 'color-text-disabled',
                    )}
                  >
                    Include context from this dDocs
                  </label>
                </div>
              </div>
              <Button
                onClick={isStreaming ? handleStopStreaming : handleGenerate}
                disabled={!localPrompt.trim() || (isLoading && !isStreaming)}
                className={cn('p-2 min-w-0 rounded-full w-8 h-8')}
              >
                {isStreaming ? (
                  <LucideIcon name="Square" size="sm" />
                ) : (
                  <LucideIcon name="ArrowUp" size="sm" />
                )}
              </Button>
            </div>
            {/* Action Bar */}
            {hasGenerated && (
              <div className="flex flex-row gap-2 w-full border-t color-border-default py-2 justify-between">
                <Button
                  variant="ghost"
                  onClick={handleDiscard}
                  className="min-w-fit gap-2 !bg-transparent color-text-secondary text-body-sm !px-3"
                >
                  <span className="text-helper-text-sm border color-border-default rounded-lg px-1.5 py-1 hidden sm:block">
                    Esc
                  </span>
                  Discard
                </Button>
                <div className="flex gap-0">
                  {!isEditing && (
                    <Button
                      variant="ghost"
                      onClick={handleEdit}
                      className="min-w-fit gap-2 !bg-transparent color-text-secondary text-body-sm !px-3"
                    >
                      <span className="text-helper-text-sm border color-border-default rounded-lg px-1.5 py-1 hidden sm:block">
                        {shortcutKey} + E
                      </span>
                      Edit
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    onClick={handleTryAgain}
                    className="min-w-fit gap-2 !bg-transparent color-text-secondary text-body-sm !px-3"
                    disabled={isLoading || isEditing}
                  >
                    <span className="text-helper-text-sm border color-border-default rounded-lg px-1.5 py-1 hidden sm:block">
                      {shortcutKey} + R
                    </span>
                    Try again
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={handleInsert}
                    className="min-w-fit gap-2 !bg-transparent color-text-secondary text-body-sm !px-3"
                    disabled={isEditing}
                  >
                    <span className="text-helper-text-sm border color-border-default rounded-lg px-1.5 py-1 hidden sm:block">
                      {shortcutKey} + Enter
                    </span>
                    Accept
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </NodeViewWrapper>
    );
  },
);
