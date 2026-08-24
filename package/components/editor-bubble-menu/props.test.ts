import { describe, it, expect } from 'vitest';
import { isBubbleMenuHidden } from './props';

const nothingOpen = {
  isCommentOpen: false,
  isLinkPopupOpen: false,
  isBubbleMenuSuppressed: false,
  isCustomSpacingOpen: false,
};

describe('isBubbleMenuHidden', () => {
  it('shows the menu when nothing else owns the screen', () => {
    expect(isBubbleMenuHidden(nothingOpen)).toBe(false);
  });

  // The bug this guards: the bubble menu carries an inline z-index of 61 and
  // @fileverse/ui dialogs stack at z-50, so a modal cannot paint over it —
  // the menu has to take itself out of the way.
  it('hides the menu while the custom spacing dialog is open', () => {
    expect(
      isBubbleMenuHidden({ ...nothingOpen, isCustomSpacingOpen: true }),
    ).toBe(true);
  });

  it('still hides for the cases that already suppressed it', () => {
    expect(isBubbleMenuHidden({ ...nothingOpen, isCommentOpen: true })).toBe(
      true,
    );
    expect(isBubbleMenuHidden({ ...nothingOpen, isLinkPopupOpen: true })).toBe(
      true,
    );
    expect(
      isBubbleMenuHidden({ ...nothingOpen, isBubbleMenuSuppressed: true }),
    ).toBe(true);
  });
});
