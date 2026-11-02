import { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { buildPrintSchema, serializeWithBreaks } from './print-break-node';

const IMG =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIvPg==';

const HTML = `<h2>Heading text</h2><p>alpha beta gamma</p><ul><li><p>first item</p></li><li><p>second item</p></li></ul><pre><code>line one
line two</code></pre><img src="${IMG}"><table><tbody><tr><th><p>H</p></th></tr><tr><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></tbody></table><table><tbody><tr><td><p>x</p></td></tr></tbody></table>`;

// Position of the n-th node of `type`.
const nodePos = (doc: PMNode, type: string, nth = 0) => {
  let found = -1;
  let seen = 0;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === type) {
      if (seen === nth) found = pos;
      seen += 1;
    }
    return true;
  });
  if (found < 0) throw new Error(`no ${type} #${nth}`);
  return found;
};

// Position just before `needle` inside the text.
const textPos = (doc: PMNode, needle: string) => {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found >= 0) return false;
    const at = node.isText ? (node.text ?? '').indexOf(needle) : -1;
    if (at >= 0) found = pos + at;
    return true;
  });
  if (found < 0) throw new Error(`no text ${needle}`);
  return found;
};

describe.each([1, 2])('serializeWithBreaks, schema v%i', (schemaVersion) => {
  let editor: Editor;
  const html = (
    breaks: Parameters<typeof serializeWithBreaks>[2],
    starts: Parameters<typeof serializeWithBreaks>[3] = [],
  ) =>
    serializeWithBreaks(
      editor.state.doc,
      buildPrintSchema(editor.schema),
      breaks,
      starts,
    );
  const dom = (s: string) => {
    const div = document.createElement('div');
    div.innerHTML = s;
    return div;
  };

  beforeEach(() => {
    editor = new Editor({
      extensions: getHeadlessExtensions({ schemaVersion }),
    });
    editor.commands.setContent(HTML);
  });
  afterEach(() => editor.destroy());

  // Print mirrors node-view DOM (thead, tableWrapper, the v1 dBlock wrapper),
  // so compare a v2 doc without tables.
  it.runIf(schemaVersion === 2)(
    'without breaks or header rows matches getHTML',
    () => {
      editor.commands.setContent(HTML.replace(/<table>.*<\/table>/, ''));
      // Empty textblocks gain the trailing <br> ProseMirror draws on screen.
      const printed = html([]).replaceAll(
        '<br class="ProseMirror-trailingBreak">',
        '',
      );
      expect(printed).toBe(editor.getHTML());
    },
  );

  // The v1 block-spacing rules are written for the node view's DOM:
  // [data-type=d-block] > [data-node-view-content] > block.
  it.runIf(schemaVersion === 1)(
    'wraps dBlock content like the node view',
    () => {
      const blocks = [...dom(html([])).children];
      expect(blocks.length).toBeGreaterThan(0);
      blocks.forEach((block) => {
        expect(block.getAttribute('data-type')).toBe('d-block');
        expect(block.children).toHaveLength(1);
        expect(block.children[0].getAttribute('data-node-view-content')).toBe(
          'true',
        );
      });
    },
  );

  it.each([
    ['heading', 'text'],
    ['paragraph', 'beta'],
    ['list item', 'item'],
    ['code block', 'two'],
  ])('puts an inText break inside a %s', (_, needle) => {
    const pos = textPos(editor.state.doc, needle);
    const out = html([{ kind: 'inText', pos }]);
    const span = dom(out).querySelector('[data-print-break]');
    expect(span).not.toBeNull();
    expect(span!.nextSibling?.textContent?.startsWith(needle)).toBe(true);
  });

  it('keeps two inText breaks in one paragraph in order', () => {
    const doc = editor.state.doc;
    const out = html([
      { kind: 'inText', pos: textPos(doc, 'beta') },
      { kind: 'inText', pos: textPos(doc, 'gamma') },
    ]);
    const spans = dom(out).querySelectorAll('[data-print-break]');
    expect(spans).toHaveLength(2);
    expect(spans[0].nextSibling?.textContent).toBe('beta ');
    expect(spans[1].nextSibling?.textContent).toBe('gamma');
  });

  it('marks before-breaks on a list item, an image and a table row', () => {
    const doc = editor.state.doc;
    const out = dom(
      html([
        { kind: 'before', pos: nodePos(doc, 'listItem', 1) },
        { kind: 'before', pos: nodePos(doc, 'resizableMedia') },
        { kind: 'before', pos: nodePos(doc, 'tableRow', 2) },
      ]),
    );
    const marked = [...out.querySelectorAll('[data-print-break-before]')];
    // A row break moves to the table piece the split starts there.
    expect(marked.map((el) => el.tagName)).toEqual(['LI', 'DIV', 'DIV']);
    expect(marked[0].textContent).toBe('second item');
    expect(marked[1].querySelector('img')).not.toBeNull();
    expect(marked[2].querySelector('tbody')?.textContent).toBe('b');
    expect(out.querySelectorAll('ul')).toHaveLength(1);
  });

  it('moves a header row into thead, only for tables that have one', () => {
    const tables = dom(html([])).querySelectorAll('table');
    expect(tables[0].querySelector('thead tr th')?.textContent).toBe('H');
    expect(tables[0].querySelectorAll('tbody tr')).toHaveLength(2);
    expect(tables[1].querySelector('thead')).toBeNull();
  });

  it('numbers page starts in document order', () => {
    const doc = editor.state.doc;
    const out = dom(
      html(
        [{ kind: 'inText', pos: textPos(doc, 'beta') }],
        [
          { kind: 'before', pos: nodePos(doc, 'heading') },
          { kind: 'inText', pos: textPos(doc, 'beta') },
          { kind: 'before', pos: nodePos(doc, 'listItem', 1) },
        ],
      ),
    );
    const starts = [...out.querySelectorAll('[data-print-page-start]')];
    expect(
      starts.map((el) => el.getAttribute('data-print-page-start')),
    ).toEqual(['1', '2', '3']);
    expect(starts[0].tagName).toBe('H2');
    expect(starts[1].hasAttribute('data-print-break')).toBe(true);
  });

  // ProseMirror draws a trailing <br> in an empty textblock, giving it a line
  // of height; without one the printed block collapses to 0.
  it('gives empty textblocks a line break', () => {
    editor.commands.setContent('<p>a</p><p></p><h2></h2><p>b</p>');
    const out = dom(html([]));
    const empty = [...out.querySelectorAll('p, h2')].filter(
      (el) => !el.textContent,
    );
    expect(empty).toHaveLength(2);
    empty.forEach((el) => expect(el.querySelector('br')).not.toBeNull());
  });

  // The table node view renders div.tableWrapper > table; the block gap and
  // other rules hang off the wrapper.
  it('wraps tables like the node view', () => {
    const tables = [...dom(html([])).querySelectorAll('table')];
    expect(tables.length).toBe(2);
    tables.forEach((table) =>
      expect(table.parentElement?.classList.contains('tableWrapper')).toBe(
        true,
      ),
    );
  });

  // A header row prints in a repeated thead, where Chrome ignores
  // break-before; the break and page start belong on the table's wrapper.
  it('moves a break on a header row to the table wrapper', () => {
    const doc = editor.state.doc;
    const headerRow = nodePos(doc, 'tableRow', 0);
    const out = dom(
      html(
        [{ kind: 'before', pos: headerRow }],
        [
          { kind: 'before', pos: nodePos(doc, 'heading') },
          { kind: 'before', pos: headerRow },
        ],
      ),
    );
    const wrapper = out.querySelector('.tableWrapper')!;
    expect(wrapper.hasAttribute('data-print-break-before')).toBe(true);
    expect(wrapper.getAttribute('data-print-page-start')).toBe('2');
    expect(out.querySelector('thead [data-print-break-before]')).toBeNull();
    expect(out.querySelector('thead [data-print-page-start]')).toBeNull();
  });

  // WebKit ignores break-before on a table row: the table splits there, and
  // the piece after the break repeats the header and starts the page.
  it('splits a table at a row break', () => {
    const doc = editor.state.doc;
    const row = nodePos(doc, 'tableRow', 2);
    const out = dom(
      html(
        [{ kind: 'before', pos: row }],
        [
          { kind: 'before', pos: nodePos(doc, 'heading') },
          { kind: 'before', pos: row },
        ],
      ),
    );
    const tables = [...out.querySelectorAll('table')];
    expect(tables).toHaveLength(3);
    const [first, rest] = tables;
    expect(
      [...first.querySelectorAll('tbody tr')].map((r) => r.textContent),
    ).toEqual(['a']);
    expect(
      [...rest.querySelectorAll('tbody tr')].map((r) => r.textContent),
    ).toEqual(['b']);
    expect(rest.querySelector('thead')?.textContent).toBe('H');
    expect(rest.querySelector('[data-print-page-start]')?.textContent).toBe(
      'b',
    );
    expect(out.querySelector('tr[data-print-break-before]')).toBeNull();

    // Each piece is a top-level block; only the second starts a page.
    const top = (el: Element) => {
      while (el.parentElement !== out) el = el.parentElement!;
      return el;
    };
    expect(top(first)).not.toBe(top(rest));
    expect(top(first).hasAttribute('data-print-break-before')).toBe(false);
    expect(top(rest).hasAttribute('data-print-break-before')).toBe(true);
    expect(top(rest).hasAttribute('data-print-page-start')).toBe(false);
    expect(top(first).hasAttribute('data-print-split')).toBe(true);
    expect(top(rest).hasAttribute('data-print-continued')).toBe(true);
    expect(top(rest).hasAttribute('data-print-split')).toBe(false);
  });

  // The dBlock node view marks a table block .is-table; its width cap hangs
  // off that class.
  it.runIf(schemaVersion === 1)('marks a dBlock holding a table', () => {
    const blocks = [...dom(html([])).children];
    const tableBlocks = blocks.filter((b) => b.querySelector('table'));
    expect(tableBlocks).toHaveLength(2);
    tableBlocks.forEach((b) =>
      expect(b.classList.contains('is-table')).toBe(true),
    );
    blocks
      .filter((b) => !b.querySelector('table'))
      .forEach((b) => expect(b.classList.contains('is-table')).toBe(false));
  });
});
