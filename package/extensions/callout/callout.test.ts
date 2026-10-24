import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';

class PasteEvent extends Event {
  clipboardData: {
    types: string[];
    files: never[];
    items: never[];
    getData: (type: string) => string;
  };

  constructor(html: string, text: string) {
    super('paste', { bubbles: true, cancelable: true });
    this.clipboardData = {
      types: ['text/html', 'text/plain'],
      files: [],
      items: [],
      getData: (type) =>
        type === 'text/html' ? html : type === 'text/plain' ? text : '',
    };
  }
}

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

const mount = (schemaVersion: number, content: string) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
    // Match the full editor's plain-text clipboard serializer.
    editorProps: {
      clipboardTextSerializer: (slice) =>
        slice.content.textBetween(0, slice.content.size, '\n\n'),
    },
    textDirection: 'auto',
  });
  editor.commands.setContent(content);
  editors.push(editor);
  return editor;
};

const rangeOf = (editor: Editor, text: string) => {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from === -1 && node.isText && node.text?.includes(text)) {
      from = pos + node.text.indexOf(text);
    }
  });
  if (from === -1) throw new Error(`Text not found: ${text}`);
  return { from, to: from + text.length };
};

const copy = (editor: Editor) => {
  const { dom, text } = editor.view.serializeForClipboard(
    editor.state.selection.content(),
  );
  return { html: dom.innerHTML, text };
};

const paste = (editor: Editor, { html, text }: ReturnType<typeof copy>) =>
  editor.view.pasteHTML(html, new PasteEvent(html, text) as ClipboardEvent);

const calloutHTML = (content: string) =>
  `<aside data-type="callout">${content}</aside>`;

const callouts = (editor: Editor) => {
  const found: { pos: number; paragraphs: string[] }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'callout') {
      const paragraphs: string[] = [];
      node.descendants((child) => {
        if (child.type.name === 'paragraph') paragraphs.push(child.textContent);
      });
      found.push({ pos, paragraphs });
    }
  });
  return found;
};

describe.each([1, 2])('callout paste on schema v%i', (version) => {
  it.each([
    [1, 'paragraph'],
    [1, 'callout'],
    [2, 'paragraph'],
    [2, 'callout'],
  ] as const)(
    'merges a copied word from a v%i %s into the sentence and keeps its marks',
    (sourceVersion, sourceType) => {
      const paragraph = '<p><strong>carefully now</strong></p>';
      const source = mount(
        sourceVersion,
        sourceType === 'callout' ? calloutHTML(paragraph) : paragraph,
      );
      source.commands.setTextSelection(rangeOf(source, 'carefully '));
      const clipboard = copy(source);
      const target = mount(version, calloutHTML('<p>Please review today.</p>'));
      target.commands.setTextSelection(rangeOf(target, 'today.').from);

      paste(target, clipboard);

      expect(callouts(target).map((callout) => callout.paragraphs)).toEqual([
        ['Please review carefully today.'],
      ]);
      const pasted = target.state.doc.nodeAt(
        rangeOf(target, 'carefully ').from,
      );
      expect(pasted?.marks.some((mark) => mark.type.name === 'bold')).toBe(
        true,
      );
    },
  );

  it('replaces a selected word without adding paragraphs', () => {
    const source = mount(version, '<p>tomorrow</p>');
    source.commands.setTextSelection(rangeOf(source, 'tomorrow'));
    const clipboard = copy(source);
    const target = mount(version, calloutHTML('<p>Please review today.</p>'));
    target.commands.setTextSelection(rangeOf(target, 'today'));

    paste(target, clipboard);

    expect(callouts(target)[0].paragraphs).toEqual(['Please review tomorrow.']);
  });

  it('keeps intentional paragraph breaks in a copied text range', () => {
    const source = mount(version, '<p>first</p><p>second</p>');
    source.commands.setTextSelection({
      from: rangeOf(source, 'first').from,
      to: rangeOf(source, 'second').to,
    });
    const clipboard = copy(source);
    const target = mount(version, calloutHTML('<p>before after</p>'));
    target.commands.setTextSelection(rangeOf(target, 'after').from);

    paste(target, clipboard);

    expect(callouts(target)[0].paragraphs).toEqual([
      'before first',
      'secondafter',
    ]);
  });

  it('flattens a whole copied callout while keeping its closed block edges', () => {
    const source = mount(version, calloutHTML('<p>copied block</p>'));
    source.view.dispatch(
      source.state.tr.setSelection(
        NodeSelection.create(source.state.doc, callouts(source)[0].pos),
      ),
    );
    const clipboard = copy(source);
    const target = mount(version, calloutHTML('<p>before after</p>'));
    target.commands.setTextSelection(rangeOf(target, 'after').from);

    paste(target, clipboard);

    expect(callouts(target).map((callout) => callout.paragraphs)).toEqual([
      ['before ', 'copied block', 'after'],
    ]);
  });

  it('merges external inline HTML into the callout sentence', () => {
    const target = mount(version, calloutHTML('<p>Please review today.</p>'));
    target.commands.setTextSelection(rangeOf(target, 'today'));

    paste(target, { html: '<em>carefully</em>', text: 'carefully' });

    expect(callouts(target)[0].paragraphs).toEqual([
      'Please review carefully.',
    ]);
  });

  it('leaves paste into an ordinary paragraph unchanged', () => {
    const source = mount(version, '<p>carefully now</p>');
    source.commands.setTextSelection(rangeOf(source, 'carefully '));
    const clipboard = copy(source);
    const target = mount(version, '<p>Please review today.</p>');
    target.commands.setTextSelection(rangeOf(target, 'today.').from);

    paste(target, clipboard);

    expect(target.state.doc.textContent).toBe('Please review carefully today.');
    expect(callouts(target)).toEqual([]);
  });
});
