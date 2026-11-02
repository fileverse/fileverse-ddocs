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
});
