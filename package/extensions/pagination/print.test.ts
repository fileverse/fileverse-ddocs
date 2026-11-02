import { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { searchForSecureImageNodeAndEmbedImageContent } from '../mardown-paste-handler';
import { buildPrintHtml } from './print';
import type { Placement } from './place';

vi.mock('../mardown-paste-handler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mardown-paste-handler')>()),
  searchForSecureImageNodeAndEmbedImageContent: vi.fn(
    async (doc: PMNode) => doc,
  ),
}));

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
