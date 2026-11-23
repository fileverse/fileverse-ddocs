import { afterEach, describe, expect, it } from 'vitest';
import { cleanup } from '@testing-library/react';
import type { Editor } from '@tiptap/react';
import { mountEditorContent } from '../utils/mount-editor-content';
import {
  destroyTracked,
  makeEditor,
  startOf,
  track,
} from './caret-marks/test-helpers';

// Probes for TIPTAP_UPGRADE.md §5.8. The placeholder runs with
// includeChildren + showOnlyCurrent, so on 3.11 the decoration lands on every
// empty node under the caret, not just the paragraph. CSS reads the
// `is-empty` / `is-editor-empty` classes (editor.css, index.css,
// presentation-mode.tsx), so a snapshot of which elements carry them is what
// the visible placeholders depend on.

afterEach(() => {
  cleanup();
  destroyTracked();
});

const PLACEHOLDER = /^is-(editor-)?empty$/;

/** Every element carrying a placeholder class, as `ancestors>tag[classes]`. */
const marked = (editor: Editor) => {
  const root = editor.view.dom;
  const out: string[] = [];
  root.querySelectorAll('.is-empty, .is-editor-empty').forEach((el) => {
    const chain: string[] = [];
    for (let n: Element | null = el; n && n !== root; n = n.parentElement) {
      chain.unshift(n.tagName.toLowerCase());
    }
    const classes = Array.from(el.classList).filter((c) => PLACEHOLDER.test(c));
    out.push(`${chain.join('>')}[${classes.join(' ')}]`);
  });
  return out;
};

const caretIn = (editor: Editor, pos: number) =>
  editor.commands.setTextSelection(pos);

/** Position inside the first empty textblock. */
const emptyBlockPos = (editor: Editor) => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isTextblock && node.content.size === 0) {
      found = pos + 1;
    }
  });
  if (found === -1) throw new Error('no empty textblock');
  return found;
};

// Mounted, so the React table cell renders its content (mount-editor-content.ts).
const probe = (version: number, html: string) => {
  const editor = mountEditorContent(track(makeEditor(version, html)));
  const inside = emptyBlockPos(editor);
  caretIn(editor, inside);
  const under = marked(editor);
  caretIn(editor, startOf(editor, 'tail'));
  const away = marked(editor);
  return { under, away };
};

const defineSuite = (version: number) => {
  describe(`schema v${version}`, () => {
    it('empty document', () => {
      const editor = track(makeEditor(version, '<p></p>'));
      expect(marked(editor)).toMatchSnapshot();
    });

    it('empty paragraph under the caret, then after it leaves', () => {
      expect(probe(version, '<p>head</p><p></p><p>tail</p>')).toMatchSnapshot();
    });

    it('empty paragraph in a list item', () => {
      expect(
        probe(version, '<ul><li><p></p></li></ul><p>tail</p>'),
      ).toMatchSnapshot();
    });

    it('empty paragraph in a second list item', () => {
      expect(
        probe(
          version,
          '<ul><li><p>one</p></li><li><p></p></li></ul><p>tail</p>',
        ),
      ).toMatchSnapshot();
    });

    it('empty paragraph in a table cell', () => {
      expect(
        probe(
          version,
          '<table><tbody><tr><td><p></p></td><td><p>b</p></td></tr></tbody></table><p>tail</p>',
        ),
      ).toMatchSnapshot();
    });

    it('empty heading under the caret', () => {
      expect(probe(version, '<h2></h2><p>tail</p>')).toMatchSnapshot();
    });
  });
};

describe('Placeholder classes (§5.8)', () => {
  defineSuite(1);
  defineSuite(2);
});
