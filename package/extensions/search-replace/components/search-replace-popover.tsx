import {
  Button,
  IconButton,
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  TextField,
  Tooltip,
} from '@fileverse/ui';
import { useShallow } from 'zustand/shallow';
import { useSearchReplaceStore } from '../../../../package/stores/search-replace-store';
import { useState, useMemo, useCallback } from 'react';
import { debounce } from '../../../utils/debounce';
import { AnimatePresence, motion } from 'framer-motion';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { scrollIntoView } from '../../../utils/get-editor-scroll-container';
import { setShowReplacePopoverWithData } from '../utils';
import { useEventListener } from 'usehooks-ts';

const SearchReplace = ({
  editor,
  viewerMode,
}: {
  editor: Editor | null;
  viewerMode?: 'suggest' | 'view-only';
}) => {
  const [showReplace, setShowReplace] = useState(false);
  const isNonOwner = typeof viewerMode !== 'undefined';
  const { searchTerm, replaceTerm, showSearchReplacePopover } =
    useSearchReplaceStore(
      useShallow((s) => ({
        searchTerm: s.searchTerm,
        replaceTerm: s.replaceTerm,
        showSearchReplacePopover: s.showSearchReplacePopover,
      })),
    );
  // Result count and current match live in editor.storage. Select them
  // through useEditorState so the popover re-renders only when they change,
  // not on every transaction (this used to force a render per keystroke,
  // open or closed).
  const searchState = useEditorState({
    editor,
    selector: ({ editor: e }: { editor: Editor | null }) => ({
      resultCount: e ? e.storage.searchAndReplace.results.length : undefined,
      resultIndex: e ? e.storage.searchAndReplace.resultIndex : undefined,
    }),
  });
  const resultCount = searchState?.resultCount;
  const resultIndex = searchState?.resultIndex;

  const { setShowReplacePopover, setSearchTerm, setReplaceTerm } =
    useSearchReplaceStore((s) => s.actions);

  const gotoSelection = useCallback(
    function gotoSelection() {
      if (!editor) return;
      const { results, resultIndex } = editor.storage.searchAndReplace;
      const current = results[resultIndex];
      if (!current) return;

      const { node } = editor.view.domAtPos(current.from);

      if (node instanceof HTMLElement) {
        scrollIntoView({
          el: node,
          editorRoot: editor.view.dom as HTMLElement,
          isNativeMobile: false,
        });
      }
    },
    [editor],
  );

  const pushSearchToEditor = useMemo(
    () =>
      debounce((value: string) => {
        if (!editor) return;
        editor.commands.setSearchTerm(value);
        editor.commands.resetIndex();
        gotoSelection();
      }, 350),
    [editor, gotoSelection],
  );

  function hidePopover() {
    pushSearchToEditor.cancel();
    if (editor) {
      editor.commands.setSearchTerm('');
      editor.commands.setReplaceTerm('');
    }
    setReplaceTerm('');
    setShowReplace(false);
    setShowReplacePopover(false);
  }

  const handleSearchReplaceOnKeydown = (ev: KeyboardEvent) => {
    if (ev.code === 'KeyF' && ev.metaKey && !ev.shiftKey) {
      ev.preventDefault();
      if (editor) {
        setShowReplacePopoverWithData(editor);
      }
    }
    return;
  };

  //opens popover on cmd+f across the editor
  useEventListener<'keydown'>('keydown', handleSearchReplaceOnKeydown);

  function toggleReplace() {
    if (isNonOwner) {
      setShowReplace(false);
    }
    setShowReplace((s) => !s);
  }

  function handleSearchTerm(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editor) return;
    const { value } = e.target;
    setSearchTerm(value);
    pushSearchToEditor(value);
  }

  function handleReplaceTerm(e: React.ChangeEvent<HTMLInputElement>) {
    if (!editor) return;
    const { value } = e.target;
    setReplaceTerm(value);
    editor.commands.setReplaceTerm(value);
    editor.commands.resetIndex();
  }

  function handleReplace() {
    if (!editor) return;
    pushSearchToEditor.flush();
    editor.commands.replace();
  }

  function handleReplaceAll() {
    if (!editor) return;
    pushSearchToEditor.flush();
    editor.commands.replaceAll();
  }

  function handleNext() {
    if (!editor) return;
    pushSearchToEditor.flush();
    editor.commands.nextSearchResult();
    gotoSelection();
  }

  function handlePrevious() {
    if (!editor) return;
    pushSearchToEditor.flush();
    editor.commands.previousSearchResult();
    gotoSelection();
  }

  function handleSearchInputKeydown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.code === 'Enter') {
      if (e.shiftKey) {
        handlePrevious();
        return;
      }
      handleNext();
    }
    return;
  }

  return (
    <Popover open={showSearchReplacePopover} onOpenChange={hidePopover}>
      <PopoverAnchor className="absolute right-0" />
      <PopoverContent
        sideOffset={12}
        alignOffset={12}
        align="start"
        side="left"
        arrowPadding={12}
        container={document.querySelector<HTMLDivElement>('#editor-canvas')}
        className="pt-2 border-none bg-transparent"
      >
        <motion.div className="p-2 border color-border-default w-80 max-w-full rounded-lg space-y-2 color-bg-default">
          {/* Search */}
          <div className="flex items-center gap-2 pr-1 pl-2 border rounded-md">
            <TextField
              placeholder="Search text..."
              value={searchTerm}
              className="border-none p-0"
              onChange={handleSearchTerm}
              onKeyDown={handleSearchInputKeydown}
            />
            {resultCount !== undefined && (
              <>
                {resultCount > 0 ? (
                  <span className="color-text-secondary text-sm">
                    {`${typeof resultIndex === 'number' ? resultIndex + 1 : '?'}/${resultCount}`}
                  </span>
                ) : searchTerm !== '' ? (
                  <span className="color-text-secondary text-xs shrink-0">
                    No results found.
                  </span>
                ) : null}
              </>
            )}
            {resultCount !== undefined && resultCount > 0 && (
              <div className="flex items-center">
                <div className="flex items-center">
                  <Tooltip text="Previous">
                    <IconButton
                      icon={'ArrowUp'}
                      variant={'ghost'}
                      size="sm"
                      onClick={handlePrevious}
                    />
                  </Tooltip>
                  <Tooltip text="Next">
                    <IconButton
                      icon={'ArrowDown'}
                      variant={'ghost'}
                      size="sm"
                      onClick={handleNext}
                    />
                  </Tooltip>
                </div>
                {!isNonOwner && (
                  <Tooltip text="Replace">
                    <IconButton
                      icon={'Replace'}
                      variant={'ghost'}
                      size="sm"
                      disabled={isNonOwner}
                      onClick={toggleReplace}
                    />
                  </Tooltip>
                )}
              </div>
            )}
            <PopoverClose asChild onClick={hidePopover}>
              <IconButton icon={'X'} variant={'ghost'} size="sm" />
            </PopoverClose>
          </div>
          {/* Replace */}
          <AnimatePresence>
            {showReplace && !isNonOwner && (
              <motion.div
                className="space-y-2 overflow-clip"
                key={'replace'}
                initial={{ height: 0 }}
                animate={{ height: 'auto' }}
                exit={{ height: 0 }}
                layout="size"
              >
                <div className="flex items-center gap-2 px-2 border rounded-md">
                  <TextField
                    placeholder="Replace with..."
                    value={replaceTerm}
                    onChange={handleReplaceTerm}
                    className="border-none p-0"
                  />
                </div>
                <div className="flex justify-end items-center gap-2">
                  <Button
                    variant={'secondary'}
                    size={'sm'}
                    className="min-w-0 text-body-sm-bold"
                    onClick={handleReplaceAll}
                  >
                    Replace All
                  </Button>
                  <Button
                    variant={'default'}
                    size={'sm'}
                    className="min-w-0 text-body-sm-bold"
                    onClick={handleReplace}
                  >
                    Replace
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
};

export default SearchReplace;
