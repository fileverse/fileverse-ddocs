import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Editor } from '@tiptap/react';
import { Selection } from '@tiptap/pm/state';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import {
  destroyTracked,
  makeEditor,
  pressKey,
  track,
} from '../caret-marks/test-helpers';
import { shape } from '../list-toggle/test-helpers';
import { CustomCodeBlockLowlight } from './custom-code-block-lowlight';

// Probes for TIPTAP_UPGRADE.md §5.9 (the lowlight wrapper) and the §5.18 code
// block ArrowUp row. CustomCodeBlockLowlight wraps the upstream lowlight
// plugin's `apply`; to count calls to the UPSTREAM function the base extension's
// addProseMirrorPlugins is patched to swap in a counting apply before our
// wrapper reads it.

type PluginList = {
  spec: { state?: { apply?: (...args: never[]) => unknown } };
}[];
type Config = { addProseMirrorPlugins?: (this: unknown) => PluginList };

let upstreamCalls = 0;
let restore: (() => void) | null = null;

const countUpstreamApply = () => {
  const config = (CodeBlockLowlight as unknown as { config: Config }).config;
  const original = config.addProseMirrorPlugins!;
  config.addProseMirrorPlugins = function (this: unknown) {
    const plugins = original.call(this);
    plugins.forEach((plugin) => {
      const state = plugin.spec.state;
      if (!state?.apply) return;
      const apply = state.apply;
      state.apply = function (this: unknown, ...args: never[]) {
        upstreamCalls += 1;
        return apply.apply(this, args);
      };
    });
    return plugins;
  };
  restore = () => {
    config.addProseMirrorPlugins = original;
  };
};

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
      getData: (t: string) =>
        t === 'text/html' ? html : t === 'text/plain' ? text : '',
    };
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ClipboardEvent ??= Event;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document as any).elementFromPoint ??= () => null;
});

afterEach(() => {
  destroyTracked();
  restore?.();
  restore = null;
  upstreamCalls = 0;
});

const CODE = '<pre><code class="language-javascript">const a = 1;</code></pre>';
const FILLER = Array.from({ length: 50 }, (_, i) => `<p>filler ${i}</p>`).join(
  '',
);

const tokens = (editor: Editor) =>
  Array.from(editor.view.dom.querySelectorAll('[class*="hljs-"]')).map(
    (el) => `${el.textContent}:${el.className}`,
  );

const codeBlockPos = (editor: Editor) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'codeBlock') found = pos;
  });
  return found;
};
const endOfText = (editor: Editor, text: string) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) {
      found = pos + text.length;
    }
  });
  if (found === -1) throw new Error(`no text ${text}`);
  return found;
};

const defineSuite = (version: number) => {
  describe(`schema v${version}`, () => {
    it('typing 50 blocks away never enters the upstream apply', () => {
      countUpstreamApply();
      const editor = track(makeEditor(version, CODE + FILLER));
      const before = tokens(editor);
      expect(before.length).toBeGreaterThan(0);
      upstreamCalls = 0;

      const at = endOfText(editor, 'filler 49');
      editor.view.dispatch(editor.state.tr.insertText('x', at));
      editor.view.dispatch(editor.state.tr.insertText('y', at + 1));

      expect(upstreamCalls).toBe(0);
      expect(tokens(editor)).toEqual(before);
    });

    it('typing inside the code block enters the upstream apply and keeps highlights', () => {
      countUpstreamApply();
      const editor = track(makeEditor(version, CODE + FILLER));
      upstreamCalls = 0;

      const at = endOfText(editor, 'const a = 1;');
      editor.commands.setTextSelection(at);
      editor.view.dispatch(editor.state.tr.insertText(' let', at));

      expect(upstreamCalls).toBeGreaterThan(0);
      expect(tokens(editor)).toMatchSnapshot();
    });

    it('a language change re-highlights', () => {
      countUpstreamApply();
      const editor = track(
        makeEditor(
          version,
          '<pre><code class="language-javascript">def f(): pass</code></pre><p>tail</p>',
        ),
      );
      const before = tokens(editor);
      upstreamCalls = 0;

      const pos = codeBlockPos(editor);
      editor.commands.setTextSelection(pos + 2);
      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...editor.state.doc.nodeAt(pos)!.attrs,
          language: 'python',
        }),
      );

      expect({
        upstreamEntered: upstreamCalls > 0,
        before,
        after: tokens(editor),
      }).toMatchSnapshot();
    });

    it('inserting a code block enters the upstream apply and highlights it', () => {
      countUpstreamApply();
      const editor = track(makeEditor(version, '<p>head</p>'));
      upstreamCalls = 0;

      editor.commands.insertContentAt(editor.state.doc.content.size, {
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [{ type: 'text', text: 'let b = 2;' }],
      });

      expect(upstreamCalls).toBeGreaterThan(0);
      expect(tokens(editor)).toMatchSnapshot();
    });

    it.each([
      ['an empty paragraph', '<p></p>'],
      ['the end of a paragraph', '<p>head</p>'],
    ])('pasting a code block into %s', async (_name, start) => {
      countUpstreamApply();
      const editor = track(makeEditor(version, start));
      editor.commands.setTextSelection(
        Selection.atStart(editor.state.doc).$from.end(),
      );
      upstreamCalls = 0;

      const html =
        '<pre><code class="language-javascript">let c = 3;</code></pre>';
      editor.view.pasteHTML(
        html,
        new FakeClipboardEvent(html, 'let c = 3;') as never,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect({
        shape: shape(editor),
        upstreamEntered: upstreamCalls > 0,
        tokens: tokens(editor),
      }).toMatchSnapshot();
    });

    it('a selection-only change enters the upstream apply 0 times', () => {
      countUpstreamApply();
      const editor = track(makeEditor(version, CODE + FILLER));
      upstreamCalls = 0;

      editor.commands.setTextSelection(endOfText(editor, 'const a = 1;'));
      editor.commands.setTextSelection(endOfText(editor, 'filler 49'));

      expect(upstreamCalls).toBe(0);
    });
  });
};

describe('lowlight wrapper (§5.9)', () => {
  defineSuite(1);
  defineSuite(2);
});

// §5.18: 3.29 adds an ArrowUp handler to CodeBlock. Our extension defines its
// own addKeyboardShortcuts without calling the parent, so the upstream
// handlers (ArrowDown exit included) are not registered at all.
describe('code block arrow keys (§5.18)', () => {
  it('our shortcut map', () => {
    const keys = Object.keys(
      (
        CustomCodeBlockLowlight.config as unknown as {
          addKeyboardShortcuts: (this: unknown) => Record<string, unknown>;
        }
      ).addKeyboardShortcuts.call({ editor: null }),
    ).sort();
    expect(keys).toMatchSnapshot();
  });

  const arrow = (
    version: number,
    html: string,
    key: string,
    at: 'start' | 'end',
  ) => {
    const editor = track(makeEditor(version, html));
    const pos = codeBlockPos(editor);
    const size = editor.state.doc.nodeAt(pos)!.content.size;
    editor.commands.setTextSelection(at === 'start' ? pos + 1 : pos + 1 + size);
    const handled = pressKey(editor, key);
    return {
      handled,
      shape: shape(editor),
      caretInCode:
        editor.state.selection.$from.parent.type.name === 'codeBlock',
    };
  };

  // v1 is not probed: its gap cursor keymap runs first and measures layout,
  // which jsdom lacks (getClientRects), and the spec says v2 only in practice.
  describe.each([2])('schema v%i', (version) => {
    it('ArrowUp at the start of a code block that is the first node', () => {
      expect(
        arrow(
          version,
          '<pre><code>x</code></pre><p>after</p>',
          'ArrowUp',
          'start',
        ),
      ).toMatchSnapshot();
    });

    it('ArrowUp at the start of a code block after a paragraph (control)', () => {
      expect(
        arrow(
          version,
          '<p>before</p><pre><code>x</code></pre><p>after</p>',
          'ArrowUp',
          'start',
        ),
      ).toMatchSnapshot();
    });

    it('ArrowDown at the end of a code block that is the last node', () => {
      expect(
        arrow(
          version,
          '<p>before</p><pre><code>x</code></pre>',
          'ArrowDown',
          'end',
        ),
      ).toMatchSnapshot();
    });
  });
});
