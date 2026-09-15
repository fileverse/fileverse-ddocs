import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { CustomCodeBlockLowlight } from './custom-code-block-lowlight';

// The extension itself, mounted in a real (jsdom) view so the lowlight
// decorations render: the wrapper around the upstream plugin must keep
// highlighting live for edits that reach a code block and keep existing
// decorations for edits that do not.
const lowlight = createLowlight(common);

const makeEditor = (content: string) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    content,
    extensions: [
      StarterKit.configure({ codeBlock: false, trailingNode: false }),
      CustomCodeBlockLowlight.configure({
        lowlight,
        defaultLanguage: 'javascript',
        mermaidLimits: {},
      }),
    ] as AnyExtension[],
  });
  return { editor, element };
};

const highlightedTokens = (editor: Editor) =>
  Array.from(editor.view.dom.querySelectorAll('[class*="hljs-"]')).map(
    (el) => el.textContent,
  );

describe('CustomCodeBlockLowlight plugin gate', () => {
  const mounted: { editor: Editor; element: HTMLElement }[] = [];
  const track = (m: { editor: Editor; element: HTMLElement }) => {
    mounted.push(m);
    return m;
  };

  afterEach(() => {
    mounted.splice(0).forEach(({ editor, element }) => {
      editor.destroy();
      element.remove();
    });
  });

  it('highlights a code block on load', () => {
    const { editor } = track(
      makeEditor(
        '<p>Before</p><pre><code class="language-javascript">const a = 1;</code></pre>',
      ),
    );
    expect(highlightedTokens(editor)).toContain('const');
  });

  it('keeps highlighting while typing in a paragraph elsewhere', () => {
    const { editor } = track(
      makeEditor(
        '<p>Before</p><pre><code class="language-javascript">const a = 1;</code></pre>',
      ),
    );
    editor.commands.insertContentAt(2, 'xyz');
    expect(editor.getText()).toContain('Bxyzefore');
    expect(highlightedTokens(editor)).toContain('const');
  });

  it('re-highlights when typing inside the code block', () => {
    const { editor } = track(
      makeEditor(
        '<p>Before</p><pre><code class="language-javascript">const a = 1;</code></pre>',
      ),
    );
    const end = editor.state.doc.content.size - 1;
    editor.commands.insertContentAt(end, '\nreturn "kw";');
    const tokens = highlightedTokens(editor);
    expect(tokens).toContain('return');
    expect(tokens).toContain('"kw"');
  });

  it('highlights a code block inserted later', () => {
    const { editor } = track(makeEditor('<p>Before</p>'));
    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'codeBlock',
      attrs: { language: 'javascript' },
      content: [{ type: 'text', text: 'let b = 2;' }],
    });
    expect(highlightedTokens(editor)).toContain('let');
  });
});
