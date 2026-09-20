import type { Editor } from '@tiptap/core';
import { useSearchReplaceStore } from '../../stores/search-replace-store';

export function setShowReplacePopoverWithData(
  editor: Editor,
  meta?: {
    withReplaceOpen: boolean;
  },
) {
  const { from, to } = editor.state.selection;

  const selectedText = editor.state.doc.textBetween(from, to, ' ');
  const { getState, setState } = useSearchReplaceStore;
  const prevSearchTerm = getState().searchTerm;

  if (selectedText === '') {
    editor.commands.setSearchTerm(prevSearchTerm);
    editor.commands.resetIndex();
  } else {
    setState({
      searchTerm: selectedText,
    });
    editor.commands.setSearchTerm(selectedText);
    editor.commands.resetIndex();
  }
  if (meta?.withReplaceOpen) {
    setState({
      showSearchReplacePopover: true,
      showReplace: true,
    });
  } else {
    setState({
      showSearchReplacePopover: true,
    });
  }
}
