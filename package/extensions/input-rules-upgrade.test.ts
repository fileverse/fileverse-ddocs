import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import * as Y from 'yjs';
import { createCommentStore } from '../stores/comment-store';
import type { CommentAnchor } from './comment/comment-decoration-plugin';
import { SuggestionTrackingExtension } from './suggestion/suggestion-tracking-extension';
import {
  destroyTracked,
  makeEditor,
  pressKey,
  storedMarkNames,
  textblocks,
  track,
  undoManager,
} from './caret-marks/test-helpers';

// Probes for TIPTAP_UPGRADE.md §5.12. 3.34 dispatches the typed character
// first, then the rule transaction with closeHistory, and Collaboration calls
// undoManager.stopCapturing() on it. They pin 3.11; a bump that changes one is
// decided in the spec, never by `vitest -u`.
//
// Time control: Yjs merges changes inside `captureTimeout` (500ms), measured
// with a Date.now captured by lib0 at import, so fake timers cannot move it.
// The window is widened to one minute instead, which makes grouping
// independent of how fast the test runs, and only stopCapturing() (lastChange
// reset to 0) can split the stack. The harness test below proves it can.

afterEach(destroyTracked);

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

const paste = async (editor: Editor, html: string, text = 'x') => {
  editor.view.pasteHTML(html, new FakeClipboardEvent(html, text) as never);
  await flush();
};

const mod = (editor: Editor, key: string) => {
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  return (
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event)) ?? false
  );
};

const typeChars = (editor: Editor, text: string) => {
  for (const ch of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp('handleTextInput', (f) =>
      f(editor.view, from, to, ch),
    );
    if (!handled)
      editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
};

const caretAtEnd = (editor: Editor) =>
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);

const harness = (version: number, html = '<p></p>') => {
  const editor = track(makeEditor(version, html, { ydoc: new Y.Doc() }));
  const um = undoManager(editor);
  um.captureTimeout = 60_000;
  um.stopCapturing();
  um.clear();
  caretAtEnd(editor);
  return { editor, um };
};

const shapeOf = (node: ProseMirrorNode): string => {
  if (node.isText) {
    const marks = node.marks.map((m) => m.type.name).join('+');
    return `"${node.text}"${marks ? `[${marks}]` : ''}`;
  }
  const attrs = node.type.name === 'heading' ? `${node.attrs.level}` : '';
  const kids: string[] = [];
  node.forEach((child) => kids.push(shapeOf(child)));
  return `${node.type.name}${attrs}(${kids.join(' ')})`;
};
const shape = (editor: Editor) => shapeOf(editor.state.doc);

const SENTENCE = 'It\'s "fine" -- ok';
const SHORTCUTS: [string, string][] = [
  ['bullet list', '- '],
  ['ordered list', '1. '],
  ['task list', '[ ] '],
  ['heading', '# '],
  ['quote', '> '],
  ['bold', '**bold**'],
];

const body = (version: number) => {
  describe('harness', () => {
    it('plain typing is one undo step and stopCapturing splits it', () => {
      const { editor, um } = harness(version);
      typeChars(editor, 'hello world');
      expect(um.undoStack.length).toBe(1);
      um.stopCapturing();
      typeChars(editor, ' again');
      expect(um.undoStack.length).toBe(2);
      expect(editor.state.doc.textContent).toBe('hello world again');
    });
  });

  describe('Typography sentence', () => {
    it('typed text, undo steps and one Mod-Z', () => {
      const { editor, um } = harness(version);
      typeChars(editor, SENTENCE);
      const typed = editor.state.doc.textContent;
      const steps = um.undoStack.length;
      mod(editor, 'z');
      expect({
        typed,
        undoSteps: steps,
        afterOneUndo: editor.state.doc.textContent,
        undoStackAfter: um.undoStack.length,
        redoStackAfter: um.redoStack.length,
      }).toMatchSnapshot();
    });

    it('plain words stay one step (the §5.12 Keep rule)', () => {
      const { editor, um } = harness(version);
      typeChars(editor, 'plain words only');
      expect(um.undoStack.length).toBe(1);
    });

    it('an ordinal replacement stays in the same undo step', () => {
      const { editor, um } = harness(version);
      typeChars(editor, 'the 1st place ok');
      expect(editor.state.doc.textContent).toBe('the 1ˢᵗ place ok');
      expect(um.undoStack.length).toBe(1);
      mod(editor, 'z');
      expect(editor.state.doc.textContent).toBe('');
    });

    it('Backspace right after a smart quote restores the straight quote', () => {
      const { editor } = harness(version);
      typeChars(editor, "It'");
      const afterType = editor.state.doc.textContent;
      const handled = pressKey(editor, 'Backspace');
      expect({
        afterType,
        handled,
        afterBackspace: editor.state.doc.textContent,
      }).toMatchSnapshot();
    });
  });

  describe.each(SHORTCUTS)('%s (%j)', (_name, typed) => {
    it('type, then Mod-Z', () => {
      const { editor, um } = harness(version);
      typeChars(editor, typed);
      const afterType = shape(editor);
      const steps = um.undoStack.length;
      mod(editor, 'z');
      expect({
        afterType,
        undoSteps: steps,
        afterUndo: shape(editor),
        undoStackAfter: um.undoStack.length,
      }).toMatchSnapshot();
    });

    it('retype, then undoInputRule directly (upstream path)', () => {
      const { editor, um } = harness(version);
      typeChars(editor, typed);
      const afterType = shape(editor);
      const steps = um.undoStack.length;
      const handled = editor.commands.undoInputRule();
      expect({
        afterType,
        undoSteps: steps,
        handled,
        afterUndoInputRule: shape(editor),
      }).toMatchSnapshot();
    });

    it('retype, then Backspace', () => {
      const { editor } = harness(version);
      typeChars(editor, typed);
      const afterType = shape(editor);
      const handled = pressKey(editor, 'Backspace');
      expect({
        afterType,
        backspaceHandled: handled,
        afterBackspace: shape(editor),
      }).toMatchSnapshot();
    });
  });

  describe('suggestion mode', () => {
    const suggestionEditor = () => {
      const ydoc = new Y.Doc();
      const store = createCommentStore();
      let suggesting = false;
      const editor = track(
        makeEditor(version, '<p>Hello</p>', {
          ydoc,
          extensions: [
            SuggestionTrackingExtension.configure({
              getIsSuggestionMode: () => suggesting,
              onTextInput: (text) =>
                store.getState().appendToDraftAtCursor(text),
            }),
          ],
        }),
      );
      store.getState().setExternalDepsRef({
        current: {
          editor,
          ydoc,
          setActiveCommentId: () => {},
          focusCommentWithActiveId: () => {},
          ensResolutionUrl: '',
          commentAnchorsRef: { current: [] as CommentAnchor[] },
          draftAnchorsRef: { current: [] as CommentAnchor[] },
        },
      });
      caretAtEnd(editor);
      suggesting = true;
      return { editor, store };
    };
    const draftTexts = (store: ReturnType<typeof createCommentStore>) =>
      Object.values(store.getState().drafts).map((d) => d.insertedText);

    it("typing It's makes one suggestion and leaves the doc alone", () => {
      const { editor, store } = suggestionEditor();
      typeChars(editor, "It's");
      expect(Object.keys(store.getState().drafts)).toHaveLength(1);
      expect(draftTexts(store)).toEqual(["It's"]);
      expect(editor.state.doc.textContent).toBe('Hello');
    });

    it('the Typography sentence and a markdown shortcut', () => {
      const { editor, store } = suggestionEditor();
      typeChars(editor, SENTENCE);
      const sentence = draftTexts(store);
      typeChars(editor, '- ');
      expect({
        sentence,
        afterShortcut: draftTexts(store),
        doc: editor.state.doc.textContent,
      }).toMatchSnapshot();
    });
  });
};

const pasteBody = (version: number) => {
  const SOURCE = '<p>aa</p><p>bb</p><p>cc</p><p></p>';

  const copyFirstTwo = () => {
    const source = track(makeEditor(version, SOURCE, { ydoc: new Y.Doc() }));
    const blocks = textblocks(source);
    source.commands.setTextSelection({
      from: blocks[0].pos + 1,
      to: blocks[1].pos + 1 + 2,
    });
    const { dom, text } = source.view.serializeForClipboard(
      source.state.selection.content(),
    );
    return { html: dom.innerHTML, text };
  };

  const counts = (editor: Editor) => {
    const blocks = textblocks(editor).map((b) => b.node.textContent);
    return {
      all: blocks.length,
      empty: blocks.filter((t) => t === '').length,
      nonEmpty: blocks.filter((t) => t !== '').length,
      texts: blocks,
    };
  };

  // Two pasted paragraphs add two blocks, minus the one they merge into: the
  // empty line is consumed, or the first pasted block joins `cc`. No stray
  // empty paragraph may appear (the 3.29.0 fix).
  it.each([
    ['an empty paragraph', 3, { nonEmpty: 2, empty: -1, all: 1 }],
    ['the end of cc', 2, { nonEmpty: 1, empty: 0, all: 1 }],
  ])(
    'copy then paste two paragraphs into %s',
    async (_label, target, delta) => {
      const { html, text } = copyFirstTwo();
      const editor = track(makeEditor(version, SOURCE, { ydoc: new Y.Doc() }));
      const block = textblocks(editor)[target];
      editor.commands.setTextSelection(block.pos + 1 + block.node.content.size);
      const before = counts(editor);
      await paste(editor, html, text);
      const after = counts(editor);
      expect({
        nonEmpty: after.nonEmpty - before.nonEmpty,
        empty: after.empty - before.empty,
        all: after.all - before.all,
      }).toEqual(delta);
      expect({ before, after }).toMatchSnapshot();
    },
  );

  it('pasting inline content at the end of a bold run', async () => {
    const editor = track(
      makeEditor(version, '<p><strong>bold</strong></p>', {
        ydoc: new Y.Doc(),
      }),
    );
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    await paste(editor, '<span>x</span>', 'x');
    expect({
      shape: shape(editor),
      selection: {
        from: editor.state.selection.from,
        docSize: editor.state.doc.content.size,
      },
      storedMarks: storedMarkNames(editor),
    }).toMatchSnapshot();
  });
};

describe('schema v1 (dBlock)', () => {
  body(1);
  describe('paste', () => pasteBody(1));
});
describe('schema v2 (flat)', () => {
  body(2);
  describe('paste', () => pasteBody(2));
});
