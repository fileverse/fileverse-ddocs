import { Editor } from '@tiptap/react';
import { Divider, IconButton, Tooltip } from '@fileverse/ui';

interface SplitViewRightHeaderProps {
  editor: Editor;
  /** Whether the Document-tabs overlay panel is open. */
  showTabsPanel: boolean;
  /** Toggle the Document-tabs overlay panel (the List button). */
  onToggleTabsPanel: () => void;

  /** Exit Split View (back to the normal editor). */
  onExitSplitView?: () => void;
}

const getDocTitle = (editor: Editor) =>
  editor.state.doc.firstChild?.textContent?.trim().slice(0, 80) || 'Untitled';

const triggerDownload = (url: string, filename: string) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Split View RIGHT-pane header bar: the Document-tabs toggle (left) and the
 * download actions (right). Sits above the real ddoc editor in the right pane.
 */
export const SplitViewRightHeader = ({
  editor,
  onExitSplitView,
  showTabsPanel,
  onToggleTabsPanel,
}: SplitViewRightHeaderProps) => {
  // Download markdown — carries the inline-style "CSS" spans we preserve for
  // fidelity (color/font/size/highlight/underline).
  const handleDownloadMarkdown = async () => {
    const title = getDocTitle(editor);
    const url = await editor.commands.exportMarkdownFile({
      title,
      includeStyles: true,
    });
    if (typeof url === 'string') triggerDownload(url, `${title}.md`);
  };

  const handleDownloadHtml = async () => {
    const title = getDocTitle(editor);
    const url = await editor.commands.exportHtmlFile({ title });
    if (typeof url === 'string') triggerDownload(url, `${title}.html`);
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b color-border-default shrink-0 z-30">
      <IconButton
        variant={showTabsPanel ? 'secondary' : 'ghost'}
        icon="List"
        size="sm"
        title="Document tabs"
        onClick={onToggleTabsPanel}
      />
      <div className="flex items-center gap-1">
        <IconButton
          variant="ghost"
          icon="Sparkles"
          size="sm"
          title="BYOM (coming soon)"
          disabled
        />
        <IconButton
          variant="ghost"
          icon="FileCode"
          size="sm"
          title="Download Markdown (with CSS)"
          onClick={handleDownloadMarkdown}
        />
        <IconButton
          variant="ghost"
          icon="FileCode2"
          size="sm"
          title="Download HTML"
          onClick={handleDownloadHtml}
        />
        <div className="flex items-center pl-1 shrink-0">
          <Divider className="mr-1" direction="vertical" />
          <Tooltip text="Back to editor" asTriggerChild>
            <IconButton
              variant="ghost"
              size="sm"
              icon="PenLine"
              onClick={onExitSplitView}
            />
          </Tooltip>
        </div>
      </div>
    </div>
  );
};
