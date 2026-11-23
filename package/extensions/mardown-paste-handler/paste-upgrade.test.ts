import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension, JSONContent } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';

// Probes for TIPTAP_UPGRADE.md §5.14 (link title, typed ordered lists) and
// §5.17 (plain-text OrderedList paste). They pin 3.11 through the real paste
// pipeline; a bump that changes one is decided in the spec, never by `vitest -u`.

class FakeClipboardEvent extends Event {
  clipboardData: {
    getData: (type: string) => string;
    types: string[];
    files: never[];
    items: never[];
  };
  constructor(html: string, text: string) {
    super('paste', { bubbles: true, cancelable: true });
    this.clipboardData = {
      types: ['text/html', 'text/plain'],
      files: [],
      items: [],
      getData: (t: string) => {
        if (t === 'text/html') return html;
        if (t === 'text/plain') return text;
        return '';
      },
    };
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ClipboardEvent ??= Event;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document as any).elementFromPoint ??= () => null;
  URL.createObjectURL ??= () => 'blob:probe';
});

const mounted: Editor[] = [];
afterEach(() => mounted.splice(0).forEach((editor) => editor.destroy()));

const mount = (schemaVersion: number) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
    textDirection: 'auto',
  });
  editor.commands.setContent('<p></p>');
  mounted.push(editor);
  return editor;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

const pastePlain = async (editor: Editor, text: string) => {
  editor.view.pasteText(text, new FakeClipboardEvent('', text) as never);
  await flush();
};
const pasteHtml = async (editor: Editor, html: string, text = 'x') => {
  editor.view.pasteHTML(html, new FakeClipboardEvent(html, text) as never);
  await flush();
};

type Registered = {
  name: string;
  config: { addProseMirrorPlugins?: (this: unknown) => unknown[] };
};
type Pasting = { props: { handlePaste?: (...args: never[]) => boolean } };

const owners = new WeakMap<object, string>();

/**
 * Which plugin takes a paste. Rebuilds the plugin list from the extension
 * manager with each extension's plugins labelled, and answers `someProp`
 * for `handlePaste` from it. It edits `editor`, so use a throwaway one.
 * `roster` is every labelled plugin that has a `handlePaste`, in order.
 */
const pasteChain = async (editor: Editor, text: string) => {
  const manager = editor.extensionManager as unknown as {
    extensions: Registered[];
    plugins: Pasting[];
  };
  for (const extension of manager.extensions) {
    const original = extension.config.addProseMirrorPlugins;
    if (typeof original !== 'function') continue;
    extension.config.addProseMirrorPlugins = function () {
      const plugins = original.call(this) as object[];
      plugins.forEach((plugin) => owners.set(plugin, extension.name));
      return plugins;
    };
  }
  const fresh = manager.plugins.filter((p) => p.props.handlePaste);
  const roster = fresh.map((p) => owners.get(p) ?? 'unlabelled');
  let handledBy = 'default paste';
  const { view } = editor;
  const originalSomeProp = view.someProp.bind(view);
  (view as unknown as { someProp: unknown }).someProp = (
    name: string,
    run: (value: unknown) => unknown,
  ) => {
    if (name !== 'handlePaste') return originalSomeProp(name, run as never);
    for (const [index, plugin] of fresh.entries()) {
      if (run(plugin.props.handlePaste)) {
        handledBy = roster[index];
        return true;
      }
    }
    return undefined;
  };
  await pastePlain(editor, text);
  return { handledBy, roster };
};

/** Doc JSON without random ids, so one snapshot serves a run on any machine. */
const maskIds = (node: JSONContent): JSONContent => {
  const { attrs, content, ...rest } = node;
  const masked: JSONContent = { ...rest };
  if (attrs) {
    masked.attrs = Object.fromEntries(
      Object.entries(attrs).filter(([, value]) => value !== null),
    );
    if (typeof masked.attrs.blockId === 'string') {
      masked.attrs.blockId = '<id>';
    }
  }
  if (content) masked.content = content.map(maskIds);
  return masked;
};
const docJson = (editor: Editor) => maskIds(editor.getJSON());

const PLAIN_PASTES = [
  ['numbered list', '1. a\n2. b'],
  ['lettered list', 'a. x\nb. y'],
  ['roman paren', 'i) x'],
  ['phone number', '(216) 555-1234'],
  ['TEC-2677 literal tildes', '~I missed you~'],
] as const;

describe.each([1, 2])('plain-text paste, §5.17 (schema v%i)', (version) => {
  it.each(PLAIN_PASTES)('%s', async (_name, text) => {
    const editor = mount(version);
    await pastePlain(editor, text);
    expect(docJson(editor)).toMatchSnapshot();
  });

  it.each(PLAIN_PASTES)(
    'which plugin takes the paste: %s',
    async (_name, text) => {
      const real = mount(version);
      await pastePlain(real, text);

      const traced = mount(version);
      const { handledBy } = await pasteChain(traced, text);

      expect(docJson(traced)).toEqual(docJson(real));
      expect(handledBy).toMatchSnapshot();
    },
  );

  it('plugins that carry a handlePaste', async () => {
    const { roster } = await pasteChain(mount(version), 'x');
    expect(roster).toMatchSnapshot();
  });
});

const LINK = '<a href="https://x.dev" title="t">x</a>';
const GDOCS_LI =
  '<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-abc"><ol style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:lower-alpha;" aria-level="1"><p dir="ltr"><span>one</span></p></li><li dir="ltr" style="list-style-type:lower-alpha;" aria-level="1"><p dir="ltr"><span>two</span></p></li></ol></b>';
const STYLED_OL =
  '<ol style="list-style-type:lower-roman"><li><p>one</p></li><li><p>two</p></li></ol>';
const TYPE_ATTR = '<ol type="a" start="3"><li><p>one</p></li></ol>';

const orderedLists = (editor: Editor) => {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'orderedList') {
      const attrs = { ...node.attrs };
      delete attrs.blockId;
      found.push(attrs);
    }
  });
  return found;
};
const renderedOl = (editor: Editor) => {
  const ol = editor.view.dom.querySelector('ol');
  return ol
    ? {
        class: ol.getAttribute('class'),
        type: ol.getAttribute('type'),
        start: ol.getAttribute('start'),
      }
    : null;
};
const linkMarks = (editor: Editor) => {
  const found: Record<string, unknown>[] = [];
  editor.state.doc.descendants((node) =>
    node.marks.forEach((mark) => {
      if (mark.type.name === 'link') found.push({ ...mark.attrs });
    }),
  );
  return found;
};

describe.each([1, 2])(
  'pasted HTML attributes, §5.14 (schema v%i)',
  (version) => {
    it('keeps a link title', async () => {
      const editor = mount(version);
      await pasteHtml(editor, LINK);
      expect(linkMarks(editor)).toMatchSnapshot();
    });

    it.each([
      ['Google Docs list, lower-alpha on the li', GDOCS_LI],
      ['list-style-type on the ol', STYLED_OL],
      ['type attribute on the ol', TYPE_ATTR],
    ])('ordered list: %s', async (_name, html) => {
      const editor = mount(version);
      await pasteHtml(editor, html, 'one');
      expect({
        attrs: orderedLists(editor),
        rendered: renderedOl(editor),
      }).toMatchSnapshot();
    });

    it('markdown and ODT export do not throw on pasted lists and links', async () => {
      const editor = mount(version);
      await pasteHtml(editor, GDOCS_LI, 'one');
      await pasteHtml(editor, LINK);

      const markdown = await editor.commands.exportMarkdownFile({
        returnMDFile: true,
      });
      expect(typeof markdown).toBe('string');
      expect(markdown).toContain('one');

      const odt = await editor.commands.exportOdtFile({ title: 'probe' });
      expect(typeof odt).toBe('string');
    });
  },
);
