// Demo analog of the consumer app's footer (ddocs.new
// components/footer/footer.tsx) — same 24px bar, same classes, including the
// safe-area bottom padding that grows by the iOS home-indicator inset in
// home-screen (standalone) installs. Exists so the footer ↔ mobile-tab-panel
// pairing (panel fixed at calc(24px + env(safe-area-inset-bottom)))
// can be tested against the package alone, without running the app.
type Props = {
  wordCount: number;
  pageCount: number;
};

export function DemoFooter({ wordCount, pageCount }: Props) {
  return (
    <div
      data-testid="demo-footer"
      className="w-full color-bg-secondary fixed border-t-[1px] color-border-default color-text-default text-[12px] leading-[16px] right-0 bottom-0 flex justify-end xl:!justify-between items-start pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom,0px))] px-3 md:!px-6 z-40"
    >
      <p className="hidden xl:!block">P2P. Decentralised. Encrypted.</p>
      <div className="flex items-center gap-2 lg:!gap-4">
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
