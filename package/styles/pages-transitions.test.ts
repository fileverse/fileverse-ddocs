import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(__dirname, 'editor.css'), 'utf8');

// A pass measures the layout in one frame; a margin still animating after an
// edit would be measured half-way (docs/PAGES_MODE.md §12.3).
describe('Pages layout does not animate', () => {
  it('limits paragraph transitions to non-layout properties', () => {
    const rule =
      /\[data-page-mode='pages'\] \.ProseMirror p\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/transition-property:/);
    expect(rule?.[1]).not.toMatch(/\b(all|margin|padding|height)\b/);
  });
});
