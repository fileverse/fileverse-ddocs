import { readFileSync } from 'node:fs';
import path from 'node:path';

const css = readFileSync(path.join(__dirname, 'editor.css'), 'utf8');

// Media in Pages mode prints as tall as it shows and fits one page
// (docs/PAGES_MODE.md §13.5).
describe('Pages media', () => {
  it('Pages mode drops the media frame padding and overlays the toolbar', () => {
    expect(css).toMatch(
      /\[data-page-mode='pages'\][^{]*\[data-media-frame\][^{]*\{[^}]*padding:\s*0/,
    );
    expect(css).toMatch(
      /\[data-page-mode='pages'\][^{]*\[data-media-toolbar\][^{]*\{[^}]*position:\s*absolute/,
    );
  });

  it('Pages mode caps media at the page text height', () => {
    expect(css).toMatch(/max-height:\s*var\(--ddoc-page-text-h\)/);
  });
});
