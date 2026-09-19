import { describe, it, expect, afterEach } from 'vitest';
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { PluginKey } from '@tiptap/pm/state';
import { liftTarget } from '@tiptap/pm/transform';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  caretTo,
  caretBlock,
  markNames,
  ySyncPlugin,
} from './test-helpers';
import { EMPTY_CONTEXT, applyDispatchContext } from './dispatch-context';

afterEach(destroyTracked);

const key = new PluginKey('caretMarksTest');
const context = (editor: Editor, tr: Transaction) =>
  applyDispatchContext(tr, EMPTY_CONTEXT, editor.state, key);

describe('dispatch context: provenance', () => {
  it('is local for a plain root and not for y-sync or addToHistory:false roots', () => {
    const editor = track(makeEditor(2, '<p>abc</p>'));
    expect(context(editor, editor.state.tr.insertText('z')).local).toBe(true);
    expect(
      context(
        editor,
        editor.state.tr.insertText('z').setMeta('addToHistory', false),
      ).local,
    ).toBe(false);
    expect(
      context(
        editor,
        editor.state.tr
          .insertText('z')
          .setMeta(ySyncPlugin(editor), { isChangeOrigin: true }),
      ).local,
    ).toBe(false);
  });

  it('tracks pending: explicit unless tagged, cleared by a selection change, left alone by a bare step', () => {
    const editor = track(makeEditor(2, '<p>abc</p>'));
    const bold = editor.schema.marks.bold.create();
    expect(
      context(editor, editor.state.tr.setStoredMarks([bold])).pending,
    ).toEqual({ marks: [bold], explicit: true });
    expect(
      context(editor, editor.state.tr.setStoredMarks([bold]).setMeta(key, true))
        .pending,
    ).toEqual({
      marks: [bold],
      explicit: false,
    });
    expect(
      context(editor, editor.state.tr.setStoredMarks(null)).pending,
    ).toEqual({ marks: null, explicit: true });

    const withPending = context(editor, editor.state.tr.setStoredMarks([bold]));
    const appendedStep = editor.state.tr
      .insertText('z')
      .setMeta('appendedTransaction', editor.state.tr);
    expect(
      applyDispatchContext(appendedStep, withPending, editor.state, key)
        .pending,
    ).toEqual(withPending.pending);
    const appendedSelection = editor.state.tr
      .setSelection(editor.state.selection)
      .setMeta('appendedTransaction', editor.state.tr);
    expect(
      applyDispatchContext(appendedSelection, withPending, editor.state, key)
        .pending,
    ).toBeNull();
    // A root always starts from scratch.
    expect(
      applyDispatchContext(
        editor.state.tr.insertText('z'),
        withPending,
        editor.state,
        key,
      ).pending,
    ).toBeNull();
  });
});

describe('dispatch context: old caret block survival', () => {
  it('follows the block through an insertion before it, dies with its opening token, survives setNodeMarkup', () => {
    const editor = track(makeEditor(2, '<p>one</p><p>two</p>'));
    caretTo(editor, endOf(editor, 'two'));
    const { pos, node } = caretBlock(editor);
    const paragraph = editor.schema.nodes.paragraph.create();

    expect(
      context(editor, editor.state.tr.insert(pos, paragraph)).oldCaret?.pos,
    ).toBe(pos + paragraph.nodeSize);
    expect(
      context(editor, editor.state.tr.insert(0, paragraph)).oldCaret?.pos,
    ).toBe(pos + paragraph.nodeSize);
    expect(
      context(editor, editor.state.tr.delete(pos, pos + node.nodeSize)).oldCaret
        ?.pos,
    ).toBeNull();
    expect(
      context(
        editor,
        editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          lineHeight: '2',
        }),
      ).oldCaret?.pos,
    ).toBe(pos);
    expect(
      context(
        editor,
        editor.state.tr.replaceWith(
          0,
          editor.state.doc.content.size,
          paragraph,
        ),
      ).oldCaret?.pos,
    ).toBeNull();
    expect(
      context(editor, editor.state.tr.insertText('z')).oldCaret,
    ).toMatchObject({ pos, wasEmpty: false });
  });

  it('reports an empty caret block, and no old caret at all for a node selection', () => {
    const empty = track(makeEditor(2, '<p></p>'));
    expect(
      context(empty, empty.state.tr.insertText('z')).oldCaret,
    ).toMatchObject({ wasEmpty: true });

    const withRule = track(makeEditor(2, '<p>abc</p><hr>'));
    let hrPos = -1;
    withRule.state.doc.descendants((node, pos) => {
      if (node.type.name === 'horizontalRule') hrPos = pos;
    });
    expect(hrPos).toBeGreaterThan(-1);
    withRule.commands.setNodeSelection(hrPos);
    expect(
      context(withRule, withRule.state.tr.insertText('z')).oldCaret,
    ).toBeNull();
  });

  it('follows the block through a lift out of a list', () => {
    const editor = track(makeEditor(2, '<ul><li><p>item</p></li></ul>'));
    caretTo(editor, endOf(editor, 'item'));
    const { pos } = caretBlock(editor);
    const range = editor.state.selection.$from.blockRange()!;
    const target = liftTarget(range)!;
    const tr = editor.state.tr.lift(range, target);
    const ctx = context(editor, tr);
    expect(ctx.oldCaret?.pos).not.toBeNull();
    expect(tr.doc.nodeAt(ctx.oldCaret!.pos!)?.textContent).toBe('item');
    expect(ctx.oldCaret?.pos).toBeLessThan(pos);
  });
});

describe('dispatch context: deleted marks', () => {
  it('reports the marks of text deleted inside the caret block, an empty set included', () => {
    const editor = track(makeEditor(2, '<p><strong>ab</strong>c</p>'));
    caretTo(editor, endOf(editor, 'c'));
    const end = endOf(editor, 'c');
    expect(
      markNames(
        context(editor, editor.state.tr.delete(end - 1, end)).oldCaret
          ?.deletedMarks,
      ),
    ).toEqual([]);
    expect(
      markNames(
        context(editor, editor.state.tr.delete(end - 2, end - 1)).oldCaret
          ?.deletedMarks,
      ),
    ).toEqual(['bold']);
    expect(
      context(editor, editor.state.tr.insertText('z')).oldCaret?.deletedMarks,
    ).toBeNull();
    expect(
      context(editor, editor.state.tr.delete(0, 1)).oldCaret?.deletedMarks,
    ).toBeNull();
  });

  it("resolves a later step in that step's own coordinates and document", () => {
    const editor = track(
      makeEditor(2, '<p>one</p><p><strong>t</strong>wo</p>'),
    );
    caretTo(editor, endOf(editor, 'wo'));
    const end = endOf(editor, 'wo');
    // Step 0 shifts everything after "one"; step 1 must still find "o" (plain) in doc[1].
    const tr = editor.state.tr.insertText('ZZZ', endOf(editor, 'one'));
    tr.delete(tr.mapping.map(end - 1), tr.mapping.map(end));
    expect(markNames(context(editor, tr).oldCaret?.deletedMarks)).toEqual([]);

    const tr2 = editor.state.tr.insertText('ZZZ', endOf(editor, 'one'));
    const tEnd = endOf(editor, 't');
    tr2.delete(tr2.mapping.map(tEnd - 1), tr2.mapping.map(tEnd));
    expect(markNames(context(editor, tr2).oldCaret?.deletedMarks)).toEqual([
      'bold',
    ]);
  });

  it('keeps the block alive when a block is inserted at its opening and text is then deleted', () => {
    const editor = track(makeEditor(2, '<p>one</p><p>a</p>'));
    caretTo(editor, endOf(editor, 'a'));
    const { pos } = caretBlock(editor);
    const paragraph = editor.schema.nodes.paragraph.create();
    const tr = editor.state.tr.insert(pos, paragraph);
    const end = tr.mapping.map(endOf(editor, 'a'));
    tr.delete(end - 1, end);
    const ctx = context(editor, tr);
    expect(ctx.oldCaret?.pos).toBe(pos + paragraph.nodeSize);
    expect(markNames(ctx.oldCaret?.deletedMarks)).toEqual([]);
  });
});
