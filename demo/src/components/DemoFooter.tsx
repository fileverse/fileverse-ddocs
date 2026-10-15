// Demo analog of the consumer app's footer: an in-flow row under the editor,
// with the safe-area bottom padding for iOS home-screen installs.
type Props = {
  wordCount: number;
  pageCount: number;
};

export function DemoFooter({ wordCount, pageCount }: Props) {
  return (
    <div
      data-testid="demo-footer"
      className="w-full shrink-0 color-bg-secondary border-t-[1px] color-border-default color-text-default text-[12px] leading-[16px] flex justify-end xl:justify-between items-start pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] px-3 md:px-6"
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
            {pageCount <= 1 ? pageCount : `~${pageCount}`}
          </span>
        </div>
      </div>
    </div>
  );
}
