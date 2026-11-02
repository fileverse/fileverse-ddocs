import { readFileSync } from 'node:fs';
import path from 'node:path';

const view = readFileSync(
  path.join(__dirname, 'code-block-node-view.tsx'),
  'utf8',
);
const css = readFileSync(
  path.join(__dirname, '../../../styles/editor.css'),
  'utf8',
);

// Paper cannot scroll, so Pages mode shows every line of a long code block
// (docs/PAGES_MODE.md §4.4), like collapsed headings show expanded.
describe('code block in pages mode', () => {
  it('marks the scrolling body with a stable hook', () => {
    expect(view).toContain('data-code-body');
  });

  it('lifts the body height cap in pages mode', () => {
    expect(css).toMatch(
      /\[data-page-mode='pages'\] \.ProseMirror \[data-code-body\]\s*\{[^}]*max-height: none[^}]*overflow: visible/,
    );
  });

  // Pages prints a diagram in the state it shows (docs/PAGES_MODE.md §4.4).
  it('exposes whether a Mermaid block shows its diagram or its source', () => {
    expect(view).toMatch(/data-mermaid-view=\{/);
  });
});
