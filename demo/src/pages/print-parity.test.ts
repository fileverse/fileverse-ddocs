import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../../package/hooks/use-headless-editor';
import { measurePrintParity } from './print-parity';

const OPTIONS = { pageSetup: { mode: 'pages', paper: 'a4' } } as const;

// jsdom has no layout: every block is 10px tall, except where a test says so.
// Blocks stack: a block's top is the sum of its previous siblings' heights.
let tallerInPrint = '';
const heightOf = (el: Element) =>
  el.closest('[data-pages-parity]') && el.textContent === tallerInPrint
    ? 13
    : 10;
beforeAll(() => {
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

  it('leaves nothing mounted', () => {
    measurePrintParity(editor.view, editor.getHTML(), OPTIONS);
    expect(document.querySelector('[data-pages-parity]')).toBeNull();
  });
});
