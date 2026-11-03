import { handleContentPrint, mountContentPrintHost } from './handle-print';

const HTML = '<h2>Title</h2><p>Body text</p>';

const readMounted = () => ({
  style: [...document.querySelectorAll('style[data-ddoc-print]')]
    .map((el) => el.textContent)
    .join('\n'),
  host: document.querySelector('.ddoc-print-host')?.outerHTML ?? '',
});

const cleanupDom = () => {
  document
    .querySelectorAll('style[data-ddoc-print]')
    .forEach((el) => el.remove());
  document.querySelectorAll('.ddoc-print-host').forEach((el) => el.remove());
};

beforeEach(() => {
  vi.spyOn(window, 'print').mockImplementation(() => {});
});
afterEach(() => {
  cleanupDom();
  vi.restoreAllMocks();
});

// Pageless print must stay byte-identical (docs/PAGES_MODE.md §2).
describe('content print, pageless', () => {
  it('matches the pre-Pages output', () => {
    handleContentPrint(HTML);
    expect(readMounted()).toMatchSnapshot();
  });
});

describe('content print, pages', () => {
  // jsdom's CSS parser rejects page-margin boxes (@bottom-right); browsers
  // that support them print page numbers. Only that one sheet fails.
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('pageless pageSetup mounts exactly the pre-Pages output', () => {
    handleContentPrint(HTML);
    const before = readMounted();
    cleanupDom();
    mountContentPrintHost(HTML, {
      pageSetup: { mode: 'pageless', paper: 'a4' },
    });
    expect(readMounted()).toEqual(before);
  });

  it('restates the tab-title-page styles and breaks before each tab section', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    const { style } = readMounted();
    expect(style).toMatch(/\.tab-title-page__text/);
    expect(style).toMatch(/\.tab-title-page\s*\{/);
    expect(style).toMatch(
      /\[data-page-break='true'\]\s*\+\s*\*\s*\{[^}]*break-before:\s*page/,
    );
  });

  it('A4 portrait uses paper size, 1in margins and editor styling', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    const { style } = readMounted();
    expect(style).toContain('size: A4 portrait');
    expect(style).toContain('margin: 1in 0 calc(1in - 20px) 0');
    expect(style).toContain('width: 794px');
    expect(style).toContain('counter(page)');
    expect(style).not.toContain('font-family: Arial');
    const root = document.querySelector(
      '.ddoc-print-host .print-content-root',
    )!;
    expect(root.classList.contains('ProseMirror')).toBe(true);
    expect(root.classList.contains('main-doc-editor')).toBe(true);
    expect(root.getAttribute('data-page-mode')).toBe('pages');
  });

  it('Pages print CSS caps media at the text height', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    expect(readMounted().style).toMatch(/max-height:\s*931px/);
  });

  // renderHTML gives a print video an inline full width; on screen it has
  // its stored width (docs/PAGES_MODE.md §13.5).
  it('prints a video at its stored width', () => {
    const VIDEO =
      '<div data-type="resizable-media" media-type="video"><video controls="true" style="width: 100%" width="400" media-type="video"></video></div>';
    mountContentPrintHost(VIDEO, { pageSetup: { mode: 'pages', paper: 'a4' } });
    const video = document.querySelector<HTMLVideoElement>(
      '.ddoc-print-host video',
    )!;
    expect(video.style.width).toBe('');
    expect(video.getAttribute('width')).toBe('400');
  });

  it('caps media at the text height of the paper and orientation', () => {
    mountContentPrintHost(HTML, {
      pageSetup: { mode: 'pages', paper: 'letter' },
      orientation: 'landscape',
    });
    expect(readMounted().style).toMatch(/max-height:\s*624px/);
  });

  // On screen, cell content sits in the React node view's pre-wrap content
  // div; ProseMirror's own break-spaces wraps a word earlier.
  it('matches screen wrapping inside table cells and lets tables break', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    const { style } = readMounted();
    expect(style).toMatch(/:is\(td, th\)\s*\{[^}]*white-space: pre-wrap/);
    expect(style).toMatch(/\.tableWrapper\s*\{[^}]*overflow: visible/);
  });

  // WebKit cannot break pages inside a flex or grid item, and ignores
  // break-before on a table row (those tables print split).
  it('prints lists as blocks and joins a split table without extra gaps', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    const { style } = readMounted();
    expect(style).toMatch(/ ol\s*\{[^}]*display: flow-root !important/);
    expect(style).toMatch(
      /li\[data-type='taskItem'\]\s*\{[^}]*display: flow-root !important/,
    );
    expect(style).toMatch(
      /li\[data-type='taskItem'\] > label\s*\{[^}]*float: inline-start/,
    );
    expect(style).toMatch(/\[data-print-split\]\s*\{[^}]*margin-bottom: 0/);
    expect(style).toMatch(/\[data-print-continued\]\s*\{[^}]*margin-top: 0/);
  });

  // Sections would break the editor's `.ProseMirror > p` spacing rules, so
  // Pages prints flat and a page break forces its own break.
  it('prints blocks flat and breaks the page after a page break', () => {
    mountContentPrintHost(
      '<p>a</p><br data-page-break="true" style="page-break-after: always"><p>b</p>',
      { pageSetup: { mode: 'pages', paper: 'a4' } },
    );
    const root = document.querySelector('.print-content-root')!;
    expect(root.querySelector('.print-page')).toBeNull();
    expect([...root.children].map((el) => el.tagName)).toEqual([
      'P',
      'BR',
      'P',
    ]);
    // A <br> cannot become a block, so the block after it breaks instead;
    // the <br> itself is hidden, or its line box can spill onto a blank page.
    const { style } = readMounted();
    expect(style).toMatch(
      /\[data-page-break='true'\] \+ \*\s*\{[^}]*break-before: page/,
    );
    expect(style).toMatch(/\[data-page-break='true'\]\s*\{[^}]*display: none/);
  });

  // The code block node view: body 32px under its overlaid header, 20px
  // lines at the inherited size, no wrapping unless word wrap is on.
  it('lays out code blocks like the node view', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    const { style } = readMounted();
    expect(style).toMatch(
      /pre > code\s*\{[^}]*margin-top: 32px[^}]*line-height: 20px/,
    );
    expect(style).toMatch(
      /pre\[data-word-wrap='false'\] > code\s*\{[^}]*white-space: pre/,
    );
  });

  // Pages is only active at 1024px+ editor width, where editor.css caps a v1
  // table block at 90%; print's @media fallback would test the paper width.
  it('keeps the v1 table width cap the editor applies at 1024px+', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    expect(readMounted().style).toMatch(
      /\.is-table > \[data-node-view-content\]\s*\{[^}]*max-width: 90%/,
    );
  });

  // The print root is .ProseMirror, so theme-coloured editor rules apply; a
  // dark theme on <html> would print near-white code on white paper.
  it('prints with the light theme tokens whatever the app theme', () => {
    const theme = document.createElement('style');
    theme.textContent =
      ':root { --color-text-default: 207, 8%, 23%, 1; } .dark { --color-text-default: 0, 0%, 91%, 1; }';
    document.head.appendChild(theme);
    document.documentElement.classList.add('dark');
    try {
      mountContentPrintHost(HTML, {
        pageSetup: { mode: 'pages', paper: 'a4' },
      });
      const host = document.querySelector<HTMLElement>('.ddoc-print-host')!;
      expect(host.style.getPropertyValue('--color-text-default').trim()).toBe(
        '207, 8%, 23%, 1',
      );
    } finally {
      document.documentElement.classList.remove('dark');
      theme.remove();
    }
  });

  it('Letter landscape', () => {
    mountContentPrintHost(HTML, {
      pageSetup: { mode: 'pages', paper: 'letter' },
      orientation: 'landscape',
    });
    const { style } = readMounted();
    expect(style).toContain('size: letter landscape');
    expect(style).toContain('width: 1056px');
  });

  it('copies text styles onto the print root', () => {
    mountContentPrintHost(HTML, {
      pageSetup: { mode: 'pages', paper: 'a4' },
      rootStyle: { fontFamily: 'Georgia', lineHeight: '1.6' },
    });
    const root = document.querySelector<HTMLElement>('.print-content-root')!;
    expect(root.style.fontFamily).toBe('Georgia');
    expect(root.style.lineHeight).toBe('1.6');
  });

  it('cleanup removes the host and the style', () => {
    const { cleanup } = mountContentPrintHost(HTML, {
      pageSetup: { mode: 'pages', paper: 'a4' },
    });
    cleanup();
    expect(readMounted()).toEqual({ style: '', host: '' });
  });
});
