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

  // Header rows move into thead (spec §4.3) and v1 dBlocks gain the node
  // view's inner wrapper, so compare a v2 doc without a header row.
  it.runIf(schemaVersion === 2)(
    'without breaks or header rows matches getHTML',
    () => {
      editor.commands.setContent(HTML.replace(/<table>.*?<\/table>/, ''));
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
    expect(marked.map((el) => el.tagName)).toEqual(['LI', 'DIV', 'TR']);
    expect(marked[0].textContent).toBe('second item');
    expect(marked[1].querySelector('img')).not.toBeNull();
    expect(marked[2].textContent).toBe('b');
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
});
