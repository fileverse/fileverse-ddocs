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

  // On screen, cell content sits in the React node view's pre-wrap content
  // div; ProseMirror's own break-spaces wraps a word earlier.
  it('matches screen wrapping inside table cells and lets tables break', () => {
    mountContentPrintHost(HTML, { pageSetup: { mode: 'pages', paper: 'a4' } });
    const { style } = readMounted();
    expect(style).toMatch(/:is\(td, th\)\s*\{[^}]*white-space: pre-wrap/);
    expect(style).toMatch(/\.tableWrapper\s*\{[^}]*overflow: visible/);
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
