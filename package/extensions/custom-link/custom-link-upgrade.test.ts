import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Selection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import {
  makeEditor,
  destroyTracked,
  track,
  endOf,
  startOf,
  caretTo,
} from '../caret-marks/test-helpers';
import { applyLinkWithText } from '../../utils/apply-link-with-text';
import { useEditorCommands } from '../../hooks/use-editor-commands';
import {
  embedPasteAsCandidate,
  getPasteAsCandidate,
} from '../paste-as/paste-as-candidate';

// Probes for TIPTAP_UPGRADE.md §5.4 (extendMarkRange / getMarkRange next to a
// link with a different href) and §5.18 (link paste and typing). They pin 3.11;
// a bump that changes one is decided in the spec, never by `vitest -u`.

class FakeClipboardEvent extends Event {
  clipboardData: {
    getData: (type: string) => string;
    types: string[];
    files: never[];
    items: never[];
  };
  constructor(text: string) {
    super('paste', { bubbles: true, cancelable: true });
    this.clipboardData = {
      types: ['text/plain'],
      files: [],
      items: [],
      getData: (t: string) => (t === 'text/plain' ? text : ''),
    };
  }
}

beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ClipboardEvent ??= Event;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (document as any).elementFromPoint ??= () => null;
});
afterEach(destroyTracked);

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

const TWO_LINKS =
  '<p><a href="https://a.dev">aaa</a><a href="https://b.dev">bbb</a> tail</p>';

/** Each run as `text -> href` (or `text` when it carries no link). */
const runs = (editor: Editor) => {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return;
    const href = node.marks.find((m) => m.type.name === 'link')?.attrs.href;
    out.push(href ? `${node.text} -> ${href}` : node.text!);
  });
  return out;
};

const mount = (schemaVersion: number, html = TWO_LINKS) =>
  track(makeEditor(schemaVersion, html));

const inA = (editor: Editor) => caretTo(editor, startOf(editor, 'aaa') + 1);
const inB = (editor: Editor) => caretTo(editor, startOf(editor, 'bbb') + 1);
const selectRun = (editor: Editor, text: string) =>
  editor.commands.setTextSelection({
    from: startOf(editor, text),
    to: endOf(editor, text),
  });

describe.each([1, 2])(
  'link range from a caret, §5.4 (schema v%i)',
  (version) => {
    describe('applyLinkWithText', () => {
      it('empty caret inside the first link, same text, new href', () => {
        const editor = mount(version);
        inA(editor);
        applyLinkWithText(editor, 'aaa', 'https://new.dev');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('selection of the first link, same text, new href', () => {
        const editor = mount(version);
        selectRun(editor, 'aaa');
        applyLinkWithText(editor, 'aaa', 'https://new.dev');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('selection of the second link, same text, new href', () => {
        const editor = mount(version);
        selectRun(editor, 'bbb');
        applyLinkWithText(editor, 'bbb', 'https://new.dev');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('selection of the first link, same text, empty href (unlink)', () => {
        const editor = mount(version);
        selectRun(editor, 'aaa');
        applyLinkWithText(editor, 'aaa', '');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('selection of the first link, new text', () => {
        const editor = mount(version);
        selectRun(editor, 'aaa');
        applyLinkWithText(editor, 'zzz', 'https://new.dev');
        expect(runs(editor)).toMatchSnapshot();
      });
    });

    describe('insert.link (useEditorCommands)', () => {
      const run = (editor: Editor, url: string) => {
        const { result } = renderHook(() => useEditorCommands(editor));
        act(() => result.current['insert.link'].run(url));
      };

      it('set from a caret inside the first link', () => {
        const editor = mount(version);
        inA(editor);
        run(editor, 'new.dev');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('set from a caret inside the second link', () => {
        const editor = mount(version);
        inB(editor);
        run(editor, 'new.dev');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('unset from a caret inside the first link', () => {
        const editor = mount(version);
        inA(editor);
        run(editor, '');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('unset from a caret inside the second link', () => {
        const editor = mount(version);
        inB(editor);
        run(editor, '');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('re-apply after unset from a caret inside the first link', () => {
        const editor = mount(version);
        inA(editor);
        run(editor, '');
        act(() => {
          inA(editor);
        });
        run(editor, 'again.dev');
        expect(runs(editor)).toMatchSnapshot();
      });

      it('set over a selection that spans both links', () => {
        const editor = mount(version);
        editor.commands.setTextSelection({
          from: startOf(editor, 'aaa'),
          to: endOf(editor, 'bbb'),
        });
        run(editor, 'new.dev');
        expect(runs(editor)).toMatchSnapshot();
      });
    });

    describe('paste-as candidate next to an existing link', () => {
      const IMG = 'https://example.com/pic.png';

      const pasteAtEnd = (editor: Editor, text: string, at: number) => {
        editor.commands.setTextSelection(at);
        editor.view.dispatch(
          editor.state.tr
            .insertText(text)
            .setMeta('paste', true)
            .setMeta('uiEvent', 'paste'),
        );
      };

      it('image URL pasted right after the second link', () => {
        const editor = mount(version, '<p><a href="https://b.dev">bbb</a></p>');
        pasteAtEnd(editor, IMG, endOf(editor, 'bbb'));
        const candidate = getPasteAsCandidate(editor.state);
        expect({
          candidate: candidate?.kind ?? null,
          runs: runs(editor),
        }).toMatchSnapshot('before embed');
        if (candidate) embedPasteAsCandidate(editor, candidate);
        expect(runs(editor)).toMatchSnapshot('after embed');
      });

      it('image URL pasted right before the first link', () => {
        const editor = mount(version, '<p><a href="https://a.dev">aaa</a></p>');
        pasteAtEnd(editor, IMG, startOf(editor, 'aaa'));
        const candidate = getPasteAsCandidate(editor.state);
        expect({
          candidate: candidate?.kind ?? null,
          runs: runs(editor),
        }).toMatchSnapshot('before embed');
        if (candidate) embedPasteAsCandidate(editor, candidate);
        expect(runs(editor)).toMatchSnapshot('after embed');
      });
    });
  },
);

describe.each([1, 2])(
  'link paste and typing, §5.18 (schema v%i)',
  (version) => {
    const paste = async (editor: Editor, text: string) => {
      editor.view.pasteText(text, new FakeClipboardEvent(text) as never);
      await flush();
    };
    const linkMarks = (editor: Editor) => {
      const found: Record<string, unknown>[] = [];
      editor.state.doc.descendants((node) =>
        node.marks.forEach((mark) => {
          if (mark.type.name === 'link') {
            found.push({ text: node.text, ...mark.attrs });
          }
        }),
      );
      return found;
    };

    const PASTES = ['example.com', 'https://example.com', 'www.example.com'];

    it.each(PASTES)('%s pasted over a selection', async (text) => {
      const editor = mount(version, '<p>some words</p>');
      editor.commands.setTextSelection({
        from: startOf(editor, 'words'),
        to: endOf(editor, 'words'),
      });
      await paste(editor, text);
      expect({
        text: editor.state.doc.textContent,
        links: linkMarks(editor),
      }).toMatchSnapshot();
    });

    it.each(PASTES)('%s pasted into empty text', async (text) => {
      const editor = mount(version, '<p></p>');
      editor.commands.setTextSelection(
        Selection.atStart(editor.state.doc).from,
      );
      await paste(editor, text);
      expect({
        text: editor.state.doc.textContent,
        links: linkMarks(editor),
      }).toMatchSnapshot();
    });

    it('a space typed after a link', () => {
      const editor = mount(version, '<p><a href="https://a.dev">aaa</a></p>');
      caretTo(editor, endOf(editor, 'aaa'));
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp('handleTextInput', (f) =>
        f(editor.view, from, to, ' '),
      );
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(' '));
      expect({ handled: !!handled, runs: runs(editor) }).toMatchSnapshot();
    });

    it('a word typed after that space', () => {
      const editor = mount(version, '<p><a href="https://a.dev">aaa</a></p>');
      caretTo(editor, endOf(editor, 'aaa'));
      editor.view.dispatch(editor.state.tr.insertText(' '));
      editor.view.dispatch(editor.state.tr.insertText('more'));
      expect(runs(editor)).toMatchSnapshot();
    });
  },
);
