import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import { destroyTracked, pressKey, startOf } from './caret-marks/test-helpers';
import {
  addComment,
  expectValid,
  makeListEditor,
  resolvedAnchors,
  shape,
} from './list-toggle/test-helpers';

// Probes for TIPTAP_UPGRADE.md §5.16 (blockquote Backspace). 3.11's Blockquote
// binds no Backspace, so these pin what our keymaps and the core keymap do; a
// bump that makes upstream's quote handler win flips the `chain` entry.

afterEach(destroyTracked);

type Shortcuts = () => Record<string, (props: { editor: Editor }) => boolean>;
type Config = { addKeyboardShortcuts?: (this: unknown) => Shortcuts };
type Registered = { name: string; config: Config };
type Keymapped = {
  props: { handleKeyDown?: (view: unknown, event: KeyboardEvent) => boolean };
};

/**
 * Which keymap takes the key. Rebuilds the plugin list from the extension
 * manager with every extension's shortcuts instrumented, then walks it the way
 * `someProp('handleKeyDown')` does. It edits `editor`, so use a throwaway one.
 */
const keyChain = (editor: Editor, key: string) => {
  const trace: string[] = [];
  const manager = editor.extensionManager as unknown as {
    extensions: Registered[];
    plugins: Keymapped[];
  };
  for (const extension of manager.extensions) {
    const original = extension.config.addKeyboardShortcuts;
    if (typeof original !== 'function') continue;
    extension.config.addKeyboardShortcuts = function () {
      const shortcuts = (
        original as unknown as () => ReturnType<Shortcuts>
      ).call(this);
      return Object.fromEntries(
        Object.entries(shortcuts).map(([shortcut, run]) => [
          shortcut,
          (props: { editor: Editor }) => {
            const result = run(props);
            trace.push(`${extension.name}:${shortcut}=${result}`);
            return result;
          },
        ]),
      );
    } as Config['addKeyboardShortcuts'];
  }
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  for (const plugin of manager.plugins) {
    if (!plugin.props.handleKeyDown) continue;
    const before = trace.length;
    if (plugin.props.handleKeyDown(editor.view, event)) {
      return before === trace.length ? [...trace, 'plugin'] : trace;
    }
  }
  return [...trace, 'unhandled'];
};

const QUOTE_THEN_P = '<blockquote><p>qq</p></blockquote><p>pp</p>';
const QUOTE_THEN_H2 = '<blockquote><p>qq</p></blockquote><h2>hh</h2>';
const QUOTE_TWO = '<blockquote><p>q1</p><p>q2</p></blockquote>';
const QUOTE_THEN_LIST =
  '<blockquote><p>qq</p></blockquote><ul><li><p>ll</p></li></ul>';

const headings = (editor: Editor) => {
  const levels: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'heading') {
      levels.push(`${node.attrs.level}:${node.textContent}`);
    }
  });
  return levels;
};

const CASES = [
  ['a paragraph right after a quote', QUOTE_THEN_P, 'pp', ['qq', 'pp']],
  ['an H2 right after a quote', QUOTE_THEN_H2, 'hh', ['qq', 'hh']],
  ['a non-first child inside a quote', QUOTE_TWO, 'q2', ['q1', 'q2']],
  ['the first child inside a quote', QUOTE_TWO, 'q1', ['q1', 'q2']],
  ['a list right after a quote', QUOTE_THEN_LIST, 'll', ['qq', 'll']],
] as const;

describe.each([1, 2])('blockquote Backspace, §5.16 (schema v%i)', (version) => {
  it.each(CASES)('at the start of %s', (_name, html, caretText, commented) => {
    const h = makeListEditor(version, html);
    commented.forEach((text) => addComment(h, `c-${text}`, text));
    h.editor.commands.setTextSelection(startOf(h.editor, caretText));
    const handled = pressKey(h.editor, 'Backspace');
    expect({
      handled,
      shape: shape(h.editor),
      headings: headings(h.editor),
      anchors: resolvedAnchors(h),
    }).toMatchSnapshot();
    expectValid(h.editor, version);
  });

  it.each(CASES)(
    'which keymap takes Backspace at the start of %s',
    (_name, html, caretText) => {
      const real = makeListEditor(version, html).editor;
      real.commands.setTextSelection(startOf(real, caretText));
      pressKey(real, 'Backspace');

      const traced = makeListEditor(version, html).editor;
      traced.commands.setTextSelection(startOf(traced, caretText));
      const chain = keyChain(traced, 'Backspace');

      expect(shape(traced)).toBe(shape(real));
      expect(chain).toMatchSnapshot();
    },
  );
});
