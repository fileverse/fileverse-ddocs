import { handleContentPrint } from './handle-print';

const HTML = '<h2>Title</h2><p>Body text</p>';

const readMounted = () => ({
  style: document.querySelector('style[data-ddoc-print]')?.textContent ?? '',
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
