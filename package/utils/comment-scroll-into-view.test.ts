import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { scrollCommentSelectionRangeIntoView } from './comment-scroll-into-view';

const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height }) as DOMRect;

const setup = () => {
  const scroller = document.createElement('div');
  scroller.setAttribute('data-editor-scroll-container', 'true');
  Object.defineProperty(scroller, 'clientHeight', { value: 800 });
  Object.defineProperty(scroller, 'scrollHeight', { value: 3000 });
  scroller.getBoundingClientRect = () => rect(0, 800);
  const scrollTo = vi.fn();
  scroller.scrollTo = scrollTo;
  const dom = document.createElement('div');
  scroller.appendChild(dom);
  document.body.appendChild(scroller);

  const editor = {
    view: { dom, coordsAtPos: () => ({ top: 600, bottom: 620 }) },
  } as unknown as Editor;

  return { editor, scrollTo };
};

const addSheet = () => {
  const sheet = document.createElement('div');
  sheet.setAttribute('data-mobile-comment-drawer-sheet', '');
  sheet.getBoundingClientRect = () => rect(400, 400);
  document.body.appendChild(sheet);
};

afterEach(() => {
  document.body.innerHTML = '';
});

// vitest.setup.ts stubs matchMedia to never match: the window is "wide" here.
describe('scrollCommentSelectionRangeIntoView', () => {
  it('centres the comment when no mobile sheet is shown', () => {
    const { editor, scrollTo } = setup();
    scrollCommentSelectionRangeIntoView({
      editor,
      selectionRange: { from: 1, to: 5 },
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 210, behavior: 'smooth' });
  });

  // A narrow editor on a wide screen shows the sheet (docs/DROP_IN_EDITOR.md §2.9).
  it('lifts the comment above the sheet whatever the window width', () => {
    const { editor, scrollTo } = setup();
    addSheet();
    scrollCommentSelectionRangeIntoView({
      editor,
      selectionRange: { from: 1, to: 5 },
    });
    // 620 (comment bottom) - (400 sheet top - 16 clearance)
    expect(scrollTo).toHaveBeenCalledWith({ top: 236, behavior: 'smooth' });
  });
});
