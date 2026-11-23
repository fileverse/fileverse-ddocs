import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor, type AnyExtension } from '@tiptap/react';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { defaultExtensions } from './default-extension';
import customTextInputRules from './customTextInputRules';
import { PageBreak } from './page-break';

// Probes for TIPTAP_UPGRADE.md §5.9 (table of contents). The wrapper in
// table-of-contents.ts re-wraps upstream's appendTransaction; upstream
// 3.22.5 fixed a duplicate onUpdate. The editor is built with the same
// extension set as the app, with onTocUpdate observed.

const mounted: { editor: Editor; element: HTMLElement }[] = [];
afterEach(() => {
  mounted.splice(0).forEach(({ editor, element }) => {
    editor.destroy();
    element.remove();
  });
});

type Update = { ids: string[]; isCreate: boolean | undefined };

const mount = (schemaVersion: number, html: string) => {
  const updates: Update[] = [];
  const onTocUpdate = vi.fn((data: { id: string }[], isCreate?: boolean) => {
    updates.push({ ids: data.map((item) => item.id), isCreate });
  });
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: [
      ...defaultExtensions({
        onError: () => null,
        onTocUpdate,
        schemaVersion,
      }).filter((extension) => extension.name !== 'characterCount'),
      customTextInputRules,
      PageBreak,
      Collaboration.configure({ document: new Y.Doc() }),
    ] as unknown as AnyExtension[],
    textDirection: 'auto',
  });
  editor.commands.setContent(html);
  mounted.push({ editor, element });
  return { editor, updates };
};

const headingIds = (editor: Editor) => {
  const ids: unknown[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') ids.push(node.attrs['data-toc-id']);
  });
  return ids as string[];
};
const endOfHeading = (editor: Editor, text: string) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (
      found === -1 &&
      node.type.name === 'heading' &&
      node.textContent === text
    ) {
      found = pos + 1 + text.length;
    }
  });
  if (found === -1) throw new Error(`no heading ${text}`);
  return found;
};

const HTML = '<h1>one</h1><p>body</p><h2>two</h2><h2>three</h2><p>tail</p>';

const defineSuite = (version: number) => {
  describe(`schema v${version}`, () => {
    it('one onUpdate per heading edit', () => {
      const { editor, updates } = mount(version, HTML);
      const counts: number[] = [];
      let text = 'two';
      for (const ch of ['a', 'b', 'c']) {
        updates.length = 0;
        editor.view.dispatch(
          editor.state.tr.insertText(ch, endOfHeading(editor, text)),
        );
        text += ch;
        counts.push(updates.length);
      }
      expect(counts).toMatchSnapshot();
    });

    it('onUpdate flags and item counts on load and on a paragraph edit', () => {
      const { editor, updates } = mount(version, HTML);
      const onLoad = updates.map((u) => ({
        items: u.ids.length,
        isCreate: u.isCreate ?? null,
      }));
      updates.length = 0;
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (
          at === -1 &&
          node.type.name === 'paragraph' &&
          node.textContent === 'tail'
        ) {
          at = pos + 1 + 4;
        }
      });
      editor.view.dispatch(editor.state.tr.insertText('!', at));
      expect({ onLoad, onParagraphEdit: updates.length }).toMatchSnapshot();
    });

    it('data-toc-id values are unique and unchanged across 3 edits', () => {
      const { editor } = mount(version, HTML);
      const before = headingIds(editor);
      expect(before).toHaveLength(3);
      expect(
        before.every((id) => typeof id === 'string' && id.length > 0),
      ).toBe(true);
      expect(new Set(before).size).toBe(3);

      let text = 'two';
      for (const ch of ['a', 'b', 'c']) {
        editor.view.dispatch(
          editor.state.tr.insertText(ch, endOfHeading(editor, text)),
        );
        text += ch;
        expect(headingIds(editor)).toEqual(before);
      }
    });
  });
};

describe('table of contents wrapper (§5.9)', () => {
  defineSuite(1);
  defineSuite(2);
});
