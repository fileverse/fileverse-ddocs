import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { createCommentStore } from './comment-store';
import type { CommentAnchor } from '../extensions/comment/comment-decoration-plugin';
import { SuggestionTrackingExtension } from '../extensions/suggestion/suggestion-tracking-extension';
import { resolveSuggestionBreak } from '../extensions/suggestion/line-insertion';

describe('suggestion draft breaks', () => {
  let editor: Editor | null = null;

  afterEach(() => editor?.destroy());

  for (const schemaVersion of [1, 2]) {
    const setup = () => {
      const ydoc = new Y.Doc();
      editor = new Editor({
        extensions: getHeadlessExtensions({ ydoc, schemaVersion }),
        textDirection: 'auto',
      });
      editor.commands.setContent('<p>ABColdDEF</p>');
      const store = createCommentStore();
      const commentAnchorsRef = { current: [] as CommentAnchor[] };
      const draftAnchorsRef = { current: [] as CommentAnchor[] };
      store.getState().setExternalDepsRef({
        current: {
          editor,
          ydoc,
          setActiveCommentId: () => {},
          focusCommentWithActiveId: () => {},
          ensResolutionUrl: '',
          commentAnchorsRef,
          draftAnchorsRef,
        },
      });
      let start = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text) start = pos + node.text.indexOf('old');
      });
      return { store, start };
    };

    it(`keeps typed Replace and break-owning Add separate in v${schemaVersion}`, () => {
      const { store, start } = setup();
      store.getState().startDeleteDraft(start, start + 3);
      store.getState().appendToDraftAtCursor('xxxx');
      store.getState().appendBreakToDraftAtCursor(false);
      store.getState().appendToDraftAtCursor('yyy');
      const drafts = Object.values(store.getState().drafts);
      expect(drafts).toHaveLength(2);
      expect(drafts[0].insertedText).toBe('xxxx');
      expect(drafts[0].lineInsertion).toBeUndefined();
      expect(drafts[1].insertedText).toBe('\nyyy');
      expect(drafts[1].lineInsertion?.breaks).toEqual(['block']);
      expect(drafts[1].followsSuggestionId).toBe(drafts[0].id);
      expect(editor!.state.doc.textContent).toBe('ABColdDEF');
      store.getState().discardDraft(drafts[1].id);
      expect(Object.values(store.getState().drafts)).toHaveLength(1);
      expect(store.getState().drafts[drafts[0].id].insertedText).toBe('xxxx');
      expect(editor!.state.doc.textContent).toBe('ABColdDEF');
    });

    it(`keeps selected Enter in Replace and following text in Add in v${schemaVersion}`, () => {
      const { store, start } = setup();
      editor!.commands.setTextSelection({ from: start, to: start + 3 });
      store.getState().appendBreakToDraftAtCursor(false);
      store.getState().appendToDraftAtCursor('yyy');
      const drafts = Object.values(store.getState().drafts);
      expect(drafts).toHaveLength(2);
      expect(drafts[0].insertedText).toBe('\n');
      expect(drafts[0].lineInsertion?.breaks).toEqual(['block']);
      expect(drafts[1].insertedText).toBe('yyy');
      expect(drafts[1].lineInsertion).toBeUndefined();
      expect(drafts[1].followsSuggestionId).toBe(drafts[0].id);
      expect(editor!.state.doc.textContent).toBe('ABColdDEF');
    });

    it(`undoes text and breaks without losing the remaining parts in v${schemaVersion}`, () => {
      const { store, start } = setup();
      editor!.commands.setTextSelection(start);
      store.getState().appendToDraftAtCursor('x');
      store.getState().appendBreakToDraftAtCursor(false);
      store.getState().appendToDraftAtCursor('y');
      store.getState().undoLastKeystrokeInActiveDraft();
      let draft = Object.values(store.getState().drafts)[0];
      expect(draft.insertedText).toBe('x\n');
      expect(draft.lineInsertion?.parts).toEqual(['x', '']);
      store.getState().undoLastKeystrokeInActiveDraft();
      draft = Object.values(store.getState().drafts)[0];
      expect(draft.insertedText).toBe('x');
      expect(draft.lineInsertion).toBeUndefined();
    });

    it(`routes Enter and Shift+Enter without editing the document in v${schemaVersion}`, () => {
      const ydoc = new Y.Doc();
      let suggestionMode = false;
      const breaks: boolean[] = [];
      editor = new Editor({
        extensions: [
          ...getHeadlessExtensions({ ydoc, schemaVersion }),
          SuggestionTrackingExtension.configure({
            getIsSuggestionMode: () => suggestionMode,
            onBreak: (shift) => breaks.push(shift),
          }),
        ],
        textDirection: 'auto',
      });
      editor.commands.setContent('<p>ABCDEF</p>');
      const before = editor.state.doc.toJSON();
      suggestionMode = true;
      for (const shiftKey of [false, true]) {
        const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey });
        const handled = editor.view.someProp('handleKeyDown', (handler) =>
          handler(editor!.view, event),
        );
        expect(handled).toBe(true);
      }
      expect(breaks).toEqual([false, true]);
      expect(editor.state.doc.toJSON()).toEqual(before);
    });

    it(`submits break metadata on the comment and callback in v${schemaVersion}`, () => {
      const { store, start } = setup();
      const deps = store.getState()._externalDepsRef!.current!;
      const created: Array<{
        comment: import('../extensions/comment').IComment;
        meta?: import('../types').CommentMutationMeta;
      }> = [];
      deps.onNewComment = (comment, meta) => created.push({ comment, meta });
      editor!.commands.setTextSelection(start);
      store.getState().appendToDraftAtCursor('x');
      store.getState().appendBreakToDraftAtCursor(false);
      store.getState().appendToDraftAtCursor('y');
      const draft = Object.values(store.getState().drafts)[0];
      expect(deps.draftAnchorsRef?.current[0].isDraft).toBe(true);
      store.getState().submitDraft(draft.id);
      expect(deps.commentAnchorsRef?.current[0].isDraft).toBe(false);
      expect(created).toHaveLength(1);
      expect(created[0].comment.lineInsertion?.parts).toEqual(['x', 'y']);
      expect(created[0].meta?.lineInsertion?.breaks).toEqual(['block']);
      expect(store.getState().drafts).toEqual({});
    });

    it(`uses the proposed list item's content when classifying Enter in v${schemaVersion}`, () => {
      setup();
      editor!.commands.setContent('<ul><li><p>oldDEF</p></li></ul>');
      let from = 0;
      editor!.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes('old')) from = pos;
      });
      expect(
        resolveSuggestionBreak(editor!, from + 3, undefined, false, {
          from,
          to: from + 3,
          insertedText: '',
        }),
      ).toBe('listItem');
      expect(
        resolveSuggestionBreak(editor!, from + 6, undefined, false, {
          from,
          to: from + 6,
          insertedText: '',
        }),
      ).toBe('listExit');
      expect(
        resolveSuggestionBreak(
          editor!,
          from + 3,
          {
            version: 1,
            parts: ['x', ''],
            breaks: ['listItem'],
          },
          false,
          {
            from: from + 3,
            to: from + 3,
            insertedText: 'x\n',
          },
        ),
      ).toBe('listItem');
    });
  }
});
