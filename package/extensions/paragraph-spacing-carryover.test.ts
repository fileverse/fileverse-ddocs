import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import {
  applyRemote,
  pressEnter,
  undoManager,
} from './caret-marks/test-helpers';

// Carry-over spans the v1 dBlock Enter handler and v2's stock split, so these
// run against a real Collaboration-backed editor rather than the schema-only
// editor used in paragraph-spacing.test.ts.
const makeEditor = (schemaVersion: number, content: string) => {
  // Mounted because that is how the editor really runs. Note this is *not*
  // what made the old version of this file vacuous — a detached editor splits
  // on Enter identically. The bug was reading the block at the cursor: see
  // textblocks() below.
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
    textDirection: 'auto',
  });
  // Collaboration owns the doc — content has to be set after construction.
  editor.commands.setContent(content);
  return editor;
};

const endOf = (editor: Editor, text: string) => {
  let end = 1;
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text?.includes(text)) {
      end = pos + node.text.indexOf(text) + text.length;
    }
  });
  return end;
};

const pressEnterAtEndOf = (editor: Editor, text: string) => {
  editor.commands.setTextSelection(endOf(editor, text));
  pressEnter(editor);
};

/**
 * Every textblock in the document, in order.
 *
 * Deliberately not "the block at the cursor": in v1 the cursor stays in the
 * original paragraph after Enter, so reading from the selection returned the
 * block that already had the spacing and the assertion passed while the newly
 * created block was empty of it.
 */
const textblocks = (editor: Editor) => {
  const blocks: { name: string; attrs: Record<string, unknown> }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isTextblock) {
      blocks.push({ name: node.type.name, attrs: node.attrs });
    }
  });
  return blocks;
};

/** The block Enter created, which is always the one after the original. */
const createdBlock = (editor: Editor) => textblocks(editor)[1];

const editors: Editor[] = [];
const track = (editor: Editor) => {
  editors.push(editor);
  return editor;
};

afterEach(() => {
  editors.splice(0).forEach((editor) => editor.destroy());
});

describe.each([1, 2])(
  'paragraph spacing carry-over (schema v%i)',
  (version) => {
    it('carries both attributes onto the next paragraph', () => {
      const editor = track(
        makeEditor(
          version,
          '<p style="margin-top: 12pt; margin-bottom: 8pt">one</p>',
        ),
      );

      pressEnterAtEndOf(editor, 'one');

      const created = createdBlock(editor);
      expect(created?.name).toBe('paragraph');
      expect(created?.attrs.spaceBefore).toBe(12);
      expect(created?.attrs.spaceAfter).toBe(8);
    });
  },
);

// Both schemas drop to a paragraph when Enter is pressed at the end of a
// heading. An earlier version of this file claimed v1 continued with another
// heading — that came from a detached editor where Enter never split at all.
describe.each([1, 2])(
  'space before across a heading boundary (schema v%i)',
  (version) => {
    it('drops space before, but still carries space after', () => {
      const editor = track(
        makeEditor(
          version,
          '<h2 style="margin-top: 24pt; margin-bottom: 6pt">t</h2>',
        ),
      );

      pressEnterAtEndOf(editor, 't');

      const created = createdBlock(editor);
      expect(created?.name).toBe('paragraph');
      // A heading's section gap must not land on the body text below it.
      expect(created?.attrs.spaceBefore).toBeNull();
      expect(created?.attrs.spaceAfter).toBe(6);
    });
  },
);

describe.each([1, 2])('line height carry-over (schema v%i)', (version) => {
  // lineHeight has always been carried; pinned here because the v1 path that
  // does it is the same hand-written attr list that was dropping spacing.
  it('carries onto the next paragraph', () => {
    const editor = track(makeEditor(version, '<p>one</p>'));
    editor.commands.setTextSelection(endOf(editor, 'one'));
    editor.commands.setLineHeight('240%');

    pressEnterAtEndOf(editor, 'one');

    expect(createdBlock(editor)?.attrs.lineHeight).toBe('240%');
  });
});

describe('blockquote exit (schema v1)', () => {
  it('creates exactly one block and keeps the spacing', () => {
    const editor = track(
      makeEditor(
        1,
        '<blockquote><p style="margin-top: 0pt; margin-bottom: 0pt">quote</p></blockquote>',
      ),
    );
    editor.commands.setTextSelection(endOf(editor, 'quote'));
    pressEnter(editor); // new empty paragraph inside the quote
    const before = textblocks(editor).length;
    expect(pressEnter(editor)).toBe(true); // exit
    expect(textblocks(editor).length).toBe(before);
    const exited = textblocks(editor)[1];
    expect(exited.name).toBe('paragraph');
    expect(exited.attrs.spaceBefore).toBe(0);
    expect(exited.attrs.spaceAfter).toBe(0);
    expect(editor.state.selection.$from.parent.attrs.spaceAfter).toBe(0);
  });
});

describe.each([1, 2])('text alignment carry-over (schema v%i)', (version) => {
  it('carries onto the next paragraph', () => {
    const editor = track(
      makeEditor(version, '<p style="text-align: center">one</p>'),
    );
    editor.commands.setTextSelection(endOf(editor, 'one'));
    pressEnter(editor);
    expect(createdBlock(editor)?.attrs.textAlign).toBe('center');
  });
});

describe('list exit spacing owner (schema v1)', () => {
  it("reads a bullet's spacing from the listItem", () => {
    const editor = track(
      makeEditor(
        1,
        '<ul><li style="margin-top: 12pt; margin-bottom: 8pt"><p>item</p></li></ul>',
      ),
    );
    editor.commands.setTextSelection(endOf(editor, 'item'));
    pressEnter(editor);
    pressEnter(editor);
    const exited = textblocks(editor).find(
      (b) => b.name === 'paragraph' && b.attrs.spaceBefore !== null,
    );
    expect(exited?.attrs).toMatchObject({ spaceBefore: 12, spaceAfter: 8 });
    // The caret lands in that block from insertContentAt's own selection, with
    // no focus(pos) for TextSelection.near to rescue.
    const caret = editor.state.selection.$from.parent;
    expect(caret.type.name).toBe('paragraph');
    expect(caret.attrs).toMatchObject({ spaceBefore: 12, spaceAfter: 8 });
  });

  it("reads a checklist's spacing from its paragraph, explicit zeros included", () => {
    const editor = track(
      makeEditor(
        1,
        '<ul data-type="taskList"><li data-type="taskItem"><p style="margin-top: 0pt; margin-bottom: 0pt">todo</p></li></ul>',
      ),
    );
    editor.commands.setTextSelection(endOf(editor, 'todo'));
    pressEnter(editor);
    pressEnter(editor);
    // Not the last paragraph: the trailing node sits after the exited block.
    const exited = createdBlock(editor);
    expect(exited.attrs.spaceBefore).toBe(0);
    expect(exited.attrs.spaceAfter).toBe(0);
  });
});

describe.each([1, 2])(
  'list exit spacing in production plugin order (schema v%i)',
  (version) => {
    it.each([
      [
        'bullet',
        '<ul><li style="margin-top: 12pt; margin-bottom: 8pt"><p>item</p></li></ul>',
      ],
      [
        'ordered',
        '<ol><li style="margin-top: 12pt; margin-bottom: 8pt"><p>item</p></li></ol>',
      ],
      [
        'task',
        '<ul data-type="taskList"><li data-type="taskItem"><p style="margin-top: 12pt; margin-bottom: 8pt">item</p></li></ul>',
      ],
    ])(
      "Enter-Enter out of a %s list keeps the item's spacing",
      (_kind, content) => {
        const editor = track(makeEditor(version, content));
        editor.commands.setTextSelection(endOf(editor, 'item'));
        pressEnter(editor);
        pressEnter(editor);
        const paragraph = editor.state.selection.$from.parent;
        expect(editor.state.selection.$from.depth).toBe(version === 1 ? 2 : 1);
        expect(paragraph.attrs.spaceBefore).toBe(12);
        expect(paragraph.attrs.spaceAfter).toBe(8);
      },
    );
  },
);

describe('list exit (schema v2)', () => {
  it('gives a paragraph lacking a block id its spacing, an id, and the pending caret style', () => {
    const editor = track(
      makeEditor(
        2,
        '<ul><li style="margin-top: 12pt; margin-bottom: 8pt"><p><strong>item</strong></p></li></ul>',
      ),
    );
    editor.commands.setTextSelection(endOf(editor, 'item'));
    pressEnter(editor);
    // A nested list item's paragraph never gets a block id (BlockId only
    // assigns ids to top-level blocks) — the repair after the lift is real.
    const emptyItemParagraph = editor.state.selection.$from.parent;
    expect(emptyItemParagraph.attrs.blockId).toBeNull();
    pressEnter(editor);
    const paragraph = editor.state.selection.$from.parent;
    expect(editor.state.selection.$from.depth).toBe(1);
    expect(paragraph.attrs.blockId).toBeTruthy();
    expect(paragraph.attrs.spaceBefore).toBe(12);
    expect(paragraph.attrs.spaceAfter).toBe(8);
    expect(paragraph.attrs.caretMarks).toBe('[{"type":"bold"}]');
  });

  it('never restyles when a selected list before a paragraph is deleted, locally or remotely', () => {
    const editor = track(
      makeEditor(
        2,
        '<ul><li style="margin-top: 12pt"><p>item</p></li></ul><p>after</p>',
      ),
    );
    const listSize = editor.state.doc.firstChild!.nodeSize;
    editor.commands.setTextSelection(endOf(editor, 'item'));
    editor.view.dispatch(editor.state.tr.delete(0, listSize));
    expect(editor.state.doc.firstChild?.attrs.spaceBefore).toBeNull();

    const remote = track(
      makeEditor(
        2,
        '<ul><li style="margin-top: 12pt"><p>item</p></li></ul><p>after</p>',
      ),
    );
    remote.commands.setTextSelection(endOf(remote, 'item'));
    const undoStackBefore = undoManager(remote).undoStack.length;
    applyRemote(remote, (tr) => tr.delete(0, listSize));
    expect(remote.state.doc.firstChild?.attrs.spaceBefore).toBeNull();
    expect(undoManager(remote).undoStack.length).toBe(undoStackBefore);
  });

  it('never applies the inner item spacing when an empty nested item is lifted', () => {
    const editor = track(
      makeEditor(
        2,
        '<ul><li><p>outer</p><ul><li style="margin-top: 12pt; margin-bottom: 8pt"><p>inner</p></li></ul></li></ul>',
      ),
    );
    editor.commands.setTextSelection(endOf(editor, 'inner'));
    pressEnter(editor);
    pressEnter(editor);
    const { $from } = editor.state.selection;
    // Still inside a list item, so the exit rule must not have fired.
    expect($from.node(-1).type.name).toBe('listItem');
    expect($from.parent.attrs.spaceBefore).toBeNull();
    expect($from.parent.attrs.spaceAfter).toBeNull();
  });

  it('writes nothing when the caret only moves from an item into a paragraph', () => {
    const editor = track(
      makeEditor(
        2,
        '<ul><li style="margin-top: 12pt"><p>item</p></li></ul><p>after</p>',
      ),
    );
    editor.commands.setTextSelection(endOf(editor, 'item'));
    const before = editor.state.doc;
    editor.commands.setTextSelection(endOf(editor, 'after'));
    expect(editor.state.doc.eq(before)).toBe(true);
  });
});
