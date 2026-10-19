import { BottomDrawer, cn, IconButton, Tooltip } from '@fileverse/ui';
import { useEditorMediaQuery } from '../../hooks/use-editor-media-query';
import { MemorizedToC } from './memorized-toc';
import { DocumentOutlineProps } from './types';

type DocumentOutlineTOCPanelProps = Pick<
  DocumentOutlineProps,
  | 'editor'
  | 'hasToC'
  | 'items'
  | 'setItems'
  | 'showTOC'
  | 'setShowTOC'
  | 'isPreviewMode'
  | 'orientation'
>;

export const DocumentOutlineTOCPanel = ({
  editor,
  hasToC,
  items,
  setItems,
  showTOC,
  setShowTOC,
  orientation,
}: DocumentOutlineTOCPanelProps) => {
  const isMediaMax1280px = useEditorMediaQuery('(max-width:1280px)');
  const shouldHideToC = items.length < 2;

  if (!isMediaMax1280px) {
    return (
      <div
        className={cn(
          'flex flex-col gap-4 items-start px-3 justify-start z-20 h-full pb-6',
          (!hasToC || shouldHideToC) && 'hidden',
        )}
      >
        <Tooltip
          text={showTOC ? 'Hide document outline' : 'Show document outline'}
          position="right"
        >
          <IconButton
            icon={showTOC ? 'ChevronLeft' : 'List'}
            variant="ghost"
            size="lg"
            onClick={() => setShowTOC?.((prev) => !prev)}
            className="color-text-default min-w-9 h-9"
          />
        </Tooltip>
        <div
          className={cn(
            'table-of-contents animate-in fade-in slide-in-from-left-5 overflow-y-auto h-full',
            showTOC ? 'block' : 'hidden',
          )}
        >
          <MemorizedToC
            editor={editor}
            items={items}
            setItems={setItems}
            orientation={orientation}
          />
        </div>
      </div>
    );
  }

  return (
    <BottomDrawer
      key="mobile-toc"
      open={showTOC!}
      onOpenChange={setShowTOC!}
      className="w-full shadow-elevation-4"
      contentClassName="w-full h-full !border-none !shadow-elevation-4 !gap-2"
      footerClassName="hidden"
      noOverlay
      hasCloseIcon
      content={
        <>
          <div className="flex justify-between items-center p-4">
            <h2 className="text-heading-sm-bold">Document outline</h2>
          </div>
          {showTOC ? (
            <div className={cn('table-of-contents px-4')}>
              <MemorizedToC
                editor={editor}
                items={items}
                setItems={setItems}
                orientation={orientation}
              />
            </div>
          ) : null}
        </>
      }
    />
  );
};
