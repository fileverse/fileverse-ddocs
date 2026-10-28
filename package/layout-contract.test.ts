import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'ddoc-editor.tsx'), 'utf8');

// The editor is sized by its parent (AGENTS.md, Layout contract).
describe('DdocEditor layout contract', () => {
  it.each([
    '100dvh',
    '100vh',
    '100vw',
    'w-screen',
    'var(--navbar)',
    'var(--toolbar)',
    'bottomInset',
    'focusHeight',
    'window.innerWidth',
  ])('does not use %s', (token) => {
    expect(source).not.toContain(token);
  });

  // Effects keyed on the ref (floating comments' scroll listener) re-bind
  // only if the ref object changes with the scroller.
  it('switches the scroll container ref object with Split View', () => {
    expect(source.replace(/\s+/g, ' ')).toContain(
      'const editorScrollContainerRef = isSplitViewActive ? contentWrapperRef : canvasRef;',
    );
    expect(source).not.toContain('editorScrollContainerRef.current =');
  });

  // A % basis is content-sized in an auto-height parent: the canvas would
  // feed its own measured height back into the content and keep growing.
  it('gives the canvas a zero-length flex basis', () => {
    expect(source).toContain("'flex-[1_1_0px] min-h-0 w-full flex flex-col");
    expect(source).not.toContain("'flex-1 min-h-0 w-full flex flex-col");
  });

  // The wrapper reserves the scaled height (use-zoomed-page.ts), not the layer.
  it('does not give the scaled layer a percentage height', () => {
    expect(source).not.toContain('`${100 / zoom}%`');
  });

  // The wrapper's px height is rewritten as content grows; animating it
  // would leave new lines below the page for 300ms. Fit follows the window
  // directly, so it does not animate at all.
  it('animates only the wrapper width, and not at Fit', () => {
    expect(source).not.toContain(
      'rounded transition-all mx-auto duration-300 ease-in-out',
    );
    expect(source).toMatch(
      /!isFit &&\s+'transition-\[width,max-width\] duration-300 ease-in-out'/,
    );
  });

  // Hidden cards keep their box (visibility: hidden); without the clip the
  // empty column scrolls the canvas sideways once Fit drops its margin.
  it('clips the floating comment column while it is hidden', () => {
    // classnames does not merge, so overflow-visible must not sit beside it.
    expect(source).toMatch(
      /isFloatingCommentHidden\s*\?\s*'w-0 overflow-hidden'\s*:\s*'overflow-visible'/,
    );
  });

  it('marks the scaled layer', () => {
    expect(source).toContain('data-ddoc-zoom-layer');
    expect(source).toContain('data-ddoc-zoom=');
  });

  // As in Google Docs, the rail scrolls sideways with a wide page (TEC-3302).
  it('pins the left rail vertically only', () => {
    expect(source).toContain(
      "'max-w-[263px] w-full sticky top-0 self-start z-[2]'",
    );
    expect(source).not.toContain('sticky top-0 left-0');
  });

  it('marks the root and keeps the preserved ids', () => {
    expect(source).toContain('ddoc-editor-root');
    expect(source).toContain('id="editor-canvas"');
    expect(source).toContain('id="toolbar"');
  });
});
