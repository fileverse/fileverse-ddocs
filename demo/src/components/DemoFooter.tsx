import { IconButton } from '@fileverse/ui';

// Demo analog of the consumer app's footer: an in-flow row under the editor,
// with the safe-area bottom padding for iOS home-screen installs.
type Props = {
  wordCount: number;
  pageCount: number;
  isPagesMode: boolean;
  onTogglePageMode: () => void;
};

export function DemoFooter({
  wordCount,
  pageCount,
  isPagesMode,
  onTogglePageMode,
}: Props) {
  return (
    <div
      data-testid="demo-footer"
      className="w-full shrink-0 color-bg-secondary border-t-[1px] color-border-default color-text-default text-[12px] leading-[16px] flex justify-end xl:justify-between items-center pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] px-3 md:px-6"
    >
      <p className="hidden xl:block">P2P. Decentralised. Encrypted.</p>
      <div className="flex items-center gap-2 lg:gap-4">
        <div className="flex gap-1 items-center">
          <p>Words:</p>
          <span className="tabular-nums">{wordCount}</span>
        </div>
        <div className="flex gap-1 items-center">
          <p>Pages:</p>
          <span className="tabular-nums">
            {isPagesMode || pageCount <= 1 ? pageCount : `~${pageCount}`}
          </span>
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          className="!h-5 !w-5 !min-w-0 !p-0 -my-0.5"
          icon={isPagesMode ? 'Maximize' : 'File'}
          title={isPagesMode ? 'Switch to pageless mode' : 'Switch to pages mode'}
          aria-label={
            isPagesMode ? 'Switch to pageless mode' : 'Switch to pages mode'
          }
          onClick={onTogglePageMode}
        />
      </div>
    </div>
  );
}
