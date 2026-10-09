import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(path.resolve(__dirname, 'ddoc-editor.tsx'), 'utf8');

// docs/DROP_IN_EDITOR.md §2.8: the editor is sized by its parent.
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
  // only if the ref object changes with the scroller (§2.2).
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

  it('marks the root and keeps the preserved ids', () => {
    expect(source).toContain('ddoc-editor-root');
    expect(source).toContain('id="editor-canvas"');
    expect(source).toContain('id="toolbar"');
  });
});
