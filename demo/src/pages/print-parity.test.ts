import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../../package/hooks/use-headless-editor';
import { measurePrintParity } from './print-parity';

const OPTIONS = { pageSetup: { mode: 'pages', paper: 'a4' } } as const;

// jsdom has no layout: every block is 10px tall, except where a test says so.
// Blocks stack: a block's top is the sum of its previous siblings' heights.
let tallerInPrint = '';
const heightOf = (el: Element) => {
  if ((el as HTMLElement).style.display === 'none') return 0;
  if (/ddoc-page-spacer/.test(el.className)) return 200;
  return el.closest('[data-pages-parity]') && el.textContent === tallerInPrint
    ? 13
    : 10;
};
beforeAll(() => {
  // jsdom rejects the print host's page-margin box sheet (handle-print).
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      let top = 0;
      for (let s = this.previousElementSibling; s; s = s.previousElementSibling) {
        top += heightOf(s);
      }
      const height = heightOf(this);
      return { top, bottom: top + height, height } as DOMRect;
    },
  );
});
afterAll(() => vi.restoreAllMocks());

describe('measurePrintParity', () => {
  let editor: Editor;
  beforeEach(() => {
    tallerInPrint = '';
    editor = new Editor({
      element: document.createElement('div'),
      extensions: getHeadlessExtensions({ schemaVersion: 2 }),
    });
    editor.commands.setContent('<p>alpha</p><p>beta</p><p>gamma</p>');
  });
  afterEach(() => editor.destroy());

  it('is ok when every block has the same height on screen and in print', () => {
    expect(measurePrintParity(editor.view, editor.getHTML(), OPTIONS)).toEqual(
      { ok: true, mismatches: [] },
    );
  });

  it('reports the block that is taller in print', () => {
    tallerInPrint = 'beta';
    const result = measurePrintParity(editor.view, editor.getHTML(), OPTIONS);
    expect(result.ok).toBe(false);
    expect(result.mismatches).toEqual([
      { index: 1, tag: 'P', text: 'beta', screen: 10, print: 13 },
    ]);
  });

  // Print splits a table at a row break; the pieces are one block on screen,
  // and each piece after the first repeats the header the screen shows once.
  it('measures the pieces of a split table as one block', () => {
    tallerInPrint = 'none';
    editor.commands.setContent(
      '<p>alpha</p><table><tbody><tr><td><p>x</p></td></tr></tbody></table>',
    );
    const html =
      '<p>alpha</p><div class="tableWrapper" data-print-split><table><tbody><tr><td><p>x</p></td></tr></tbody></table></div>' +
      '<div class="tableWrapper" data-print-continued><table><thead><tr><th><p>h</p></th></tr></thead><tbody><tr><td><p>y</p></td></tr></tbody></table></div>' +
      '<p><br></p>';
    expect(editor.state.doc.childCount).toBe(3);
    expect(measurePrintParity(editor.view, html, OPTIONS)).toEqual({
      ok: true,
      mismatches: [],
    });
  });

  it('measures the screen without Pages spacers, and puts them back', () => {
    const spacer = document.createElement('div');
    spacer.className = 'ddoc-page-spacer';
    const dom = editor.view.dom;
    dom.insertBefore(spacer, dom.children[1]);
    // A code block's gutter takes the same height (code-block gutter-spacers).
    const gutter = document.createElement('div');
    gutter.className = 'ddoc-page-spacer-gutter';
    dom.insertBefore(gutter, dom.children[3]);
    const result = measurePrintParity(editor.view, editor.getHTML(), OPTIONS);
    expect(result).toEqual({ ok: true, mismatches: [] });
    expect(spacer.style.display).toBe('');
    spacer.remove();
    gutter.remove();
  });

  it('leaves nothing mounted', () => {
    measurePrintParity(editor.view, editor.getHTML(), OPTIONS);
    expect(document.querySelector('[data-pages-parity]')).toBeNull();
  });
});
