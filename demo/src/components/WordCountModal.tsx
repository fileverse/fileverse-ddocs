import { DynamicModal, LucideIcon } from '@fileverse/ui';
import { useMediaQuery } from 'usehooks-ts';

// Tools ▸ Word count modal (TEC-2705) — demo analog of the consumer app's
// components/word-count-modal/word-count-modal.tsx. Counts come from
// App.tsx's local state (fed by DdocEditor's setCharacterCount/setWordCount/
// setPageCount), so the values stay live while the modal is open.
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageCount: number;
  wordCount: number;
  characterCount: number;
};

const CountRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex justify-between items-center py-3 border-b color-border-default">
    <p>{label}</p>
    <span className="color-text-secondary tabular-nums">{value}</span>
  </div>
);

export const WordCountModal = ({
  open,
  onOpenChange,
  pageCount,
  wordCount,
  characterCount,
}: Props) => {
  // Same breakpoint DynamicModal itself switches to the bottom-sheet at: the
  // sheet variant has no OK button (Figma), dismissal is the X / swipe-down.
  const isMobile = useMediaQuery('(max-width: 768px)');

  return (
    <DynamicModal
      open={open}
      onOpenChange={(o: boolean) => !o && onOpenChange(false)}
      title="Word count"
      hasCloseIcon
      className="md:!max-w-[360px]"
      content={
        <div className="flex flex-col w-full">
          <CountRow label="Pages" value={pageCount} />
          <CountRow label="Words" value={wordCount} />
          <CountRow label="Characters" value={characterCount} />
          <div className="flex gap-2 pt-3 pb-1 color-text-secondary">
            <LucideIcon name="Info" size="sm" className="shrink-0 mt-[1px]" />
            <p className="text-helper-sm">
              Word count is displayed bottom right of your documents
            </p>
          </div>
        </div>
      }
      primaryAction={
        isMobile
          ? undefined
          : {
              label: 'OK',
              onClick: () => onOpenChange(false),
              className: 'min-w-[80px]',
            }
      }
    />
  );
};
