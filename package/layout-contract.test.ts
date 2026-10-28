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

  it('marks the scaled layer', () => {
    expect(source).toContain('data-ddoc-zoom-layer');
    expect(source).toContain('data-ddoc-zoom=');
  });

  // Sticky on both axes so a page wider than the canvas slides under it.
  it('pins the left rail on both axes', () => {
    expect(source).toContain(
      "'max-w-[263px] w-full sticky top-0 left-0 self-start z-[2]'",
    );
  });

  it('marks the root and keeps the preserved ids', () => {
    expect(source).toContain('ddoc-editor-root');
    expect(source).toContain('id="editor-canvas"');
    expect(source).toContain('id="toolbar"');
  });
});
