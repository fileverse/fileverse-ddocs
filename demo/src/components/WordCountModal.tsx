import { Button, DynamicModal, LucideIcon } from '@fileverse/ui';
import { useMediaQuery } from 'usehooks-ts';

// Tools ▸ Word count modal (TEC-2705) — demo analog of the consumer app's
// components/word-count-modal/word-count-modal.tsx. Counts come from
// App.tsx's local state (fed by DdocEditor's setCharacterCount/setWordCount/
// setPageCount), so the values stay live while the modal is open.
//
// Styling follows the Figma DS modal (node 20937:452105) rather than
// DynamicModal's defaults: 12px radius, 330px width, and the OK action on a
// bg-secondary strip with a top border — DynamicModal's own DialogFooter
// renders on plain white, so the footer lives inside `content` and
// primaryAction is unused. The strip (and OK) is desktop-only: the mobile
// bottom sheet has no OK in the design, dismissal is the X / swipe-down.
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageCount: number;
  wordCount: number;
  characterCount: number;
};

const CountRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex justify-between items-center p-2 w-full">
    <p className="leading-5">{label}</p>
    <span className="text-[12px] leading-4 font-medium color-text-disabled tabular-nums">
      {value}
    </span>
  </div>
);

// Border, not a filled div: borders pixel-snap the same way as the modal's
// other hairlines (header border-t), while a 1px background rect can round
// to 2 physical px at some zoom/DPR combos — which is exactly how it
// shipped and got flagged by design.
const RowDivider = () => (
  <div className="py-1 w-full">
    <div className="w-full border-t color-border-default" />
  </div>
);

export const WordCountModal = ({
  open,
  onOpenChange,
  pageCount,
  wordCount,
  characterCount,
}: Props) => {
  // Same breakpoint DynamicModal itself switches to the bottom-sheet at.
  const isMobile = useMediaQuery('(max-width: 768px)');

  return (
    <DynamicModal
      open={open}
      onOpenChange={(o: boolean) => !o && onOpenChange(false)}
      title={<span className="text-heading-sm">Word count</span>}
      hasCloseIcon
      // !pb-0 lets the footer strip sit flush with the dialog's bottom edge
      // (DialogContent's own pb-4 would leave a white band under it).
      className="md:!max-w-[330px] md:!rounded-[12px] md:!pb-0 md:overflow-hidden"
      contentClassName="!p-0"
      content={
        <div className="flex flex-col w-full">
          <div className="flex flex-col gap-4 p-4 w-full">
            <div className="flex flex-col gap-[2px] w-full">
              <CountRow label="Pages" value={pageCount} />
              <RowDivider />
              <CountRow label="Words" value={wordCount} />
              <RowDivider />
              <CountRow label="Characters" value={characterCount} />
              <RowDivider />
            </div>
            <div className="flex gap-2 items-start w-full">
              <LucideIcon name="Info" size="sm" className="shrink-0 mt-[2px]" />
              <p className="leading-5">
                Word count is displayed bottom right of your documents
              </p>
            </div>
          </div>
          {!isMobile && (
            <div className="w-full color-bg-secondary border-t color-border-default px-4 py-3 flex justify-end">
              <Button
                onClick={() => onOpenChange(false)}
                className="min-w-[80px]"
              >
                OK
              </Button>
            </div>
          )}
        </div>
      }
    />
  );
};
