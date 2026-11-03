import { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { searchForSecureImageNodeAndEmbedImageContent } from '../mardown-paste-handler';
import {
  buildPrintHtml,
  resolvePrintPlacement,
  setPrintInputs,
  printPagesTab,
} from './print';
import { handleContentPrint } from '../../utils/handle-print';
import type { Placement } from './place';

vi.mock('../mardown-paste-handler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mardown-paste-handler')>()),
  searchForSecureImageNodeAndEmbedImageContent: vi.fn(
    async (doc: PMNode) => doc,
  ),
}));

vi.mock('../../utils/handle-print', () => ({ handleContentPrint: vi.fn() }));

const pages = { mode: 'pages', paper: 'a4' } as const;

const textPos = (doc: PMNode, needle: string) => {
  let found = -1;
  doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? '').indexOf(needle) : -1;
    if (found < 0 && at >= 0) found = pos + at;
  });
  return found;
};

describe('buildPrintHtml', () => {
  let editor: Editor;
  let placement: Placement;
  beforeEach(() => {
    editor = new Editor({ extensions: getHeadlessExtensions() });
    editor.commands.setContent('<p>alpha beta</p><p>gamma</p>');
    const doc = editor.state.doc;
    placement = {
      breaks: [{ kind: 'inText', pos: textPos(doc, 'beta') }],
      pageStarts: [
        { kind: 'before', pos: 0 },
        { kind: 'inText', pos: textPos(doc, 'beta') },
      ],
      pageCount: 2,
      spacers: [],
    };
  });
  afterEach(() => {
    editor.destroy();
    vi.restoreAllMocks();
  });

  const count = (html: string, selector: string) => {
    const div = document.createElement('div');
    div.innerHTML = html;
    return div.querySelectorAll(selector).length;
  };

  it('applies the breaks when pages mode is active', async () => {
    const { html, options } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: true,
      placement,
    });
    expect(count(html, '[data-print-break]')).toBe(1);
    expect(options.pageSetup).toEqual(pages);
    expect(options.rootStyle).toBeDefined();
  });

  it('prints without breaks when image embedding changes the structure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(
      searchForSecureImageNodeAndEmbedImageContent,
    ).mockImplementationOnce(async () => {
      const other = new Editor({ extensions: getHeadlessExtensions() });
      other.commands.setContent('<p>a different document</p>');
      const doc = other.state.doc;
      other.destroy();
      return doc;
    });
    const { html } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: true,
      placement,
    });
    expect(count(html, '[data-print-break]')).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  it('pages doc printed while pages is inactive: pages CSS, no breaks', async () => {
    const { html, options } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: false,
      placement,
    });
    expect(count(html, '[data-print-break]')).toBe(0);
    expect(options.pageSetup).toEqual(pages);
  });

  it('pageless prints the editor HTML with no options', async () => {
    const { html, options } = await buildPrintHtml({
      editor,
      isPagesActive: false,
    });
    expect(html).toBe(editor.getHTML());
    expect(options).toEqual({});
  });

  it('debug markers number every page start', async () => {
    const { html } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: true,
      placement,
      debugMarkers: true,
    });
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(
      [...div.querySelectorAll('.ddoc-print-marker')].map((m) => m.textContent),
    ).toEqual(['§P1§', '§P2§']);
  });

  // Gecko places an absolute box against its containing block's unbroken
  // layout, and WebKit paints a glyph on a page edge on both pages. An extra
  // in-flow box would be a flex item in a columns block.
  it('anchors each marker on its relative block, clear of the page edge', async () => {
    const { html } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: true,
      placement,
      debugMarkers: true,
    });
    const div = document.createElement('div');
    div.innerHTML = html;
    const markers = [
      ...div.querySelectorAll<HTMLElement>('.ddoc-print-marker'),
    ];
    expect(markers).toHaveLength(2);
    markers.forEach((marker) => {
      const host = marker.parentElement!;
      expect(host.hasAttribute('data-print-page-start')).toBe(true);
      expect(host.style.position).toBe('relative');
      expect(marker.previousSibling).toBeNull();
      expect(marker.style.position).toBe('absolute');
      expect(parseFloat(marker.style.top)).toBeGreaterThan(0);
    });
  });

  // Ordered lists print as blocks, where adjacent item margins collapse; on
  // screen they sit in a flex column, where they add up.
  it('folds ordered list item margins into one gap per pair', async () => {
    editor.commands.setContent(
      '<ol><li><p>a</p></li><li><p>b</p></li><li><p>c</p></li></ol>',
    );
    const margins: Record<string, [string, string]> = {
      a: ['0px', '8px'],
      b: ['12px', '8px'],
      c: ['0px', '24px'],
    };
    const real = window.getComputedStyle;
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const style = real(el, pseudo);
      const own = el.tagName === 'LI' ? margins[el.textContent ?? ''] : null;
      if (!own) return style;
      return { ...style, marginTop: own[0], marginBottom: own[1] };
    });
    const { html } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: true,
      placement: { breaks: [], pageStarts: [], pageCount: 1, spacers: [] },
    });
    const div = document.createElement('div');
    div.innerHTML = html;
    expect(
      [...div.querySelectorAll<HTMLElement>('ol > li')].map((li) => [
        li.style.marginTop,
        li.style.marginBottom,
      ]),
    ).toEqual([
      ['0px', '0px'],
      ['20px', '0px'],
      ['8px', '24px'],
    ]);
  });

  // A split table keeps the live column widths, which automatic table
  // layout would otherwise recompute for each piece's rows.
  it('pins the live column widths on a table split at a row break', async () => {
    editor.commands.setContent(
      '<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr><tr><td><p>c</p></td><td><p>d</p></td></tr></tbody></table>',
    );
    let rowPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && node.textContent === 'cd')
        rowPos = pos;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      function (this: HTMLElement) {
        const width =
          this.textContent === 'a' || this.textContent === 'c' ? 150 : 452;
        return { width } as DOMRect;
      },
    );
    const { html } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: true,
      placement: {
        breaks: [{ kind: 'before', pos: rowPos }],
        pageStarts: [
          { kind: 'before', pos: 0 },
          { kind: 'before', pos: rowPos },
        ],
        pageCount: 2,
        spacers: [],
      },
    });
    const div = document.createElement('div');
    div.innerHTML = html;
    const tables = [...div.querySelectorAll('table')];
    expect(tables).toHaveLength(2);
    tables.forEach((table) => {
      expect(table.style.tableLayout).toBe('fixed');
      expect(table.style.width).toBe('602px');
      expect(
        [...table.querySelectorAll('col')].map((col) => col.style.width),
      ).toEqual(['150px', '452px']);
    });
    expect(div.querySelector('[data-print-col-widths]')).toBeNull();
  });

  // docs/PAGES_MODE.md §13.6: the piece repeats the header when the screen does.
  it.each([
    [40, 'H'],
    [undefined, undefined],
  ])(
    'clones the header into a split piece per the screen spacer (header %s)',
    async (header, thead) => {
      editor.commands.setContent(
        '<table><tbody><tr><th><p>H</p></th></tr><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></tbody></table>',
      );
      let rowPos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'tableRow' && node.textContent === 'b')
          rowPos = pos;
      });
      const spacer = { kind: 'block' as const, pos: rowPos, height: 300 };
      const { html } = await buildPrintHtml({
        editor,
        pageSetup: pages,
        isPagesActive: true,
        placement: {
          breaks: [{ kind: 'before', pos: rowPos }],
          pageStarts: [
            { kind: 'before', pos: 0 },
            { kind: 'before', pos: rowPos },
          ],
          pageCount: 2,
          spacers: [{ ...spacer, page: 2, print: true, header }],
        },
      });
      const div = document.createElement('div');
      div.innerHTML = html;
      const tables = [...div.querySelectorAll('table')];
      expect(tables).toHaveLength(2);
      expect(tables[1].querySelector('thead')?.textContent).toBe(thead);
      expect(div.querySelector('[data-print-repeat-header]')).toBeNull();
    },
  );

  // A span directly in a <tr> is moved out of the table by the HTML parser.
  it('puts a table row marker inside its first cell', async () => {
    editor.commands.setContent(
      '<table><tbody><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></tbody></table>',
    );
    let rowPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow' && node.textContent === 'b')
        rowPos = pos;
    });
    const { html } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: true,
      placement: {
        breaks: [{ kind: 'before', pos: rowPos }],
        pageStarts: [
          { kind: 'before', pos: 0 },
          { kind: 'before', pos: rowPos },
        ],
        pageCount: 2,
        spacers: [],
      },
      debugMarkers: true,
    });
    const div = document.createElement('div');
    div.innerHTML = html;
    const marker = [...div.querySelectorAll('.ddoc-print-marker')].find(
      (m) => m.textContent === '§P2§',
    );
    expect(marker?.closest('td')?.textContent).toContain('b');
  });

  // Pages prints a Mermaid block in the state it shows: source stays code.
  it('keeps a Mermaid block that shows its source as code', async () => {
    editor.commands.setContent(
      '<pre><code class="language-mermaid">graph TD; A--&gt;B</code></pre>',
    );
    // The React node view renders this attribute; headless toDOM does not,
    // and ProseMirror would undo a hand-set one.
    const shown = document.createElement('pre');
    shown.setAttribute('data-mermaid-view', 'source');
    vi.spyOn(editor.view, 'nodeDOM').mockReturnValue(shown);
    const { html } = await buildPrintHtml({
      editor,
      pageSetup: pages,
      isPagesActive: false,
    });
    const div = document.createElement('div');
    div.innerHTML = html;
    const pre = div.querySelector('pre[data-language="mermaid"]');
    expect(pre?.hasAttribute('data-print-mermaid-source')).toBe(true);
    expect(pre?.textContent).toContain('graph TD');
  });
});

describe('resolvePrintPlacement', () => {
  const stub = (flush: () => Placement | null) =>
    ({ storage: { pagination: { flush: vi.fn(flush) } } }) as unknown as Editor;
  const live: Placement = {
    breaks: [],
    pageStarts: [],
    pageCount: 3,
    spacers: [],
  };

  it('flushes and uses the live placement in Pages', () => {
    const editor = stub(() => live);
    expect(resolvePrintPlacement(editor, true)).toBe(live);
    expect(editor.storage.pagination.flush).toHaveBeenCalledTimes(1);
  });

  it('falls back (undefined) when flush returns null', () => {
    expect(
      resolvePrintPlacement(
        stub(() => null),
        true,
      ),
    ).toBeUndefined();
  });

  it('does not flush in Pageless', () => {
    const editor = stub(() => live);
    expect(resolvePrintPlacement(editor, false)).toBeUndefined();
    expect(editor.storage.pagination.flush).not.toHaveBeenCalled();
  });
});

describe('printPagesTab', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ extensions: getHeadlessExtensions() });
    editor.commands.setContent('<p>alpha beta</p><p>gamma</p>');
    vi.mocked(handleContentPrint).mockClear();
  });
  afterEach(() => editor.destroy());

  const withBreak = () => {
    const doc = editor.state.doc;
    const pos = textPos(doc, 'beta');
    const placement: Placement = {
      breaks: [{ kind: 'inText', pos }],
      pageStarts: [
        { kind: 'before', pos: 0 },
        { kind: 'inText', pos },
      ],
      pageCount: 2,
      spacers: [],
    };
    (editor.storage as unknown as Record<string, unknown>).pagination = {
      flush: () => placement,
    };
  };

  it('returns false and prints nothing without registered inputs', async () => {
    expect(await printPagesTab(editor)).toBe(false);
    expect(handleContentPrint).not.toHaveBeenCalled();
  });

  it('returns false for a Pageless pageSetup', async () => {
    setPrintInputs(editor, () => ({
      pageSetup: { mode: 'pageless', paper: 'a4' },
      isPagesActive: false,
    }));
    expect(await printPagesTab(editor)).toBe(false);
    expect(handleContentPrint).not.toHaveBeenCalled();
  });

  it('prints with the Pages options and the live placement', async () => {
    setPrintInputs(editor, () => ({ pageSetup: pages, isPagesActive: true }));
    withBreak();
    expect(await printPagesTab(editor)).toBe(true);
    const [html, options] = vi.mocked(handleContentPrint).mock.calls[0];
    expect(options?.pageSetup).toEqual(pages);
    expect(html).toContain('data-print-break');
  });

  it('Pages wanted but inactive prints Pages CSS with no breaks', async () => {
    setPrintInputs(editor, () => ({
      pageSetup: { mode: 'pages', paper: 'letter' },
      isPagesActive: false,
    }));
    await printPagesTab(editor);
    const [html, options] = vi.mocked(handleContentPrint).mock.calls[0];
    expect(options?.pageSetup?.paper).toBe('letter');
    expect(html).not.toContain('data-print-break');
  });

  it('setPrintInputs(editor, null) unregisters', async () => {
    setPrintInputs(editor, () => ({ pageSetup: pages, isPagesActive: false }));
    setPrintInputs(editor, null);
    expect(await printPagesTab(editor)).toBe(false);
  });
});
