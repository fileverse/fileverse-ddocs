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

// Atoms the user cannot resize are clipped at one page's text height rather
// than split (docs/PAGES_MODE.md §13.5). Columns stay out: they split.
describe('Pages non-editable atoms', () => {
  const rule = (selector: string) => {
    const at = css.indexOf(selector);
    if (at < 0) return '';
    return css.slice(at, css.indexOf('}', at));
  };

  it('clips tweet, action button, AI writer and previewed Mermaid at the text height', () => {
    ['[data-page-atom]', "pre[data-mermaid-view='preview']"].forEach((sel) => {
      const body = rule(`[data-page-mode='pages'] .ProseMirror ${sel}`);
      expect(body, sel).toMatch(/max-height:\s*var\(--ddoc-page-text-h\)/);
      expect(body, sel).toMatch(/overflow:\s*hidden/);
    });
  });

  it('does not clip columns', () => {
    expect(css).not.toMatch(/data-type=['"]?columns[^{]*\{[^}]*page-text-h/);
    expect(css).not.toMatch(/\[data-columns[^{]*\{[^}]*page-text-h/);
  });
});
