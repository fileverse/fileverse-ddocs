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

  it('marks the root and keeps the preserved ids', () => {
    expect(source).toContain('ddoc-editor-root');
    expect(source).toContain('id="editor-canvas"');
    expect(source).toContain('id="toolbar"');
  });
});
