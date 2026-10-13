import { isFocusModeCanvasClick } from './focus-mode-canvas-click';

describe('isFocusModeCanvasClick', () => {
  let canvas: HTMLDivElement;
  let editorContent: HTMLDivElement;

  beforeEach(() => {
    canvas = document.createElement('div');
    editorContent = document.createElement('div');
    canvas.appendChild(editorContent);
    document.body.appendChild(canvas);
  });

  afterEach(() => {
    canvas.remove();
  });

  const append = (parent: Element, html: string) => {
    parent.insertAdjacentHTML('beforeend', html);
    return parent.querySelector('[data-target]') as HTMLElement;
  };

  it('treats the bare canvas as a canvas click', () => {
    expect(isFocusModeCanvasClick(canvas, editorContent)).toBe(true);
  });

  it('ignores clicks inside the editor content', () => {
    const target = append(editorContent, '<p data-target>text</p>');
    expect(isFocusModeCanvasClick(target, editorContent)).toBe(false);
  });

  // The bubble menu is appended to #editor-canvas, a sibling of the content.
  it('ignores clicks on the bubble menu', () => {
    const target = append(
      canvas,
      '<div><div data-editor-bubble-menu><button data-target>B</button></div></div>',
    );
    expect(isFocusModeCanvasClick(target, editorContent)).toBe(false);
  });

  it('ignores clicks inside dialogs and popovers', () => {
    const dialog = append(
      canvas,
      '<div role="dialog"><i data-target></i></div>',
    );
    expect(isFocusModeCanvasClick(dialog, editorContent)).toBe(false);
    dialog.closest('[role="dialog"]')?.remove();

    const popover = append(
      canvas,
      '<div data-radix-popper-content-wrapper><i data-target></i></div>',
    );
    expect(isFocusModeCanvasClick(popover, editorContent)).toBe(false);
  });
});
