import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';
import { createCommentStore } from './comment-store';
import type { CommentAnchor } from '../extensions/comment/comment-decoration-plugin';
import { SuggestionTrackingExtension } from '../extensions/suggestion/suggestion-tracking-extension';
import { resolveSuggestionStructureType } from '../extensions/suggestion/multiline-structure';

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

    for (const [direction, html] of [
      [
        'paragraph to list',
        '<p>ABCfirst</p><ul><li><p>secondDEF</p></li></ul>',
      ],
      [
        'list to paragraph',
        '<ul><li><p>ABCfirst</p></li></ul><p>secondDEF</p>',
      ],
    ] as const) {
      it(`blocks selected Enter from ${direction} before creating a draft in v${schemaVersion}`, () => {
        const { store } = setup();
        editor!.commands.setContent(html);
        let from = -1;
        let to = -1;
        editor!.state.doc.descendants((node, pos) => {
          if (node.isText && node.text?.startsWith('ABC')) from = pos + 3;
          if (node.isText && node.text?.startsWith('second')) to = pos + 6;
        });
        editor!.commands.setTextSelection({ from, to });
        const before = editor!.state.doc.toJSON();
        const selection = {
          from: editor!.state.selection.from,
          to: editor!.state.selection.to,
        };

        store.getState().appendBreakToDraftAtCursor(false);

        expect(store.getState().drafts).toEqual({});
        expect(editor!.state.doc.toJSON()).toEqual(before);
        expect({
          from: editor!.state.selection.from,
          to: editor!.state.selection.to,
        }).toEqual(selection);
      });

      it(`leaves an existing ${direction} deletion draft unchanged on Enter in v${schemaVersion}`, () => {
        const { store } = setup();
        editor!.commands.setContent(html);
        let from = -1;
        let to = -1;
        editor!.state.doc.descendants((node, pos) => {
          if (node.isText && node.text?.startsWith('ABC')) from = pos + 3;
          if (node.isText && node.text?.startsWith('second')) to = pos + 6;
        });
        store.getState().startDeleteDraft(from, to);
        const drafts = store.getState().drafts;
        const selection = {
          from: editor!.state.selection.from,
          to: editor!.state.selection.to,
        };
        const before = editor!.state.doc.toJSON();

        store.getState().appendBreakToDraftAtCursor(false);

        expect(store.getState().drafts).toEqual(drafts);
        expect(editor!.state.doc.toJSON()).toEqual(before);
        expect({
          from: editor!.state.selection.from,
          to: editor!.state.selection.to,
        }).toEqual(selection);
      });
    }

    it(`keeps typed Replace and break-owning Add separate in v${schemaVersion}`, () => {
      const { store, start } = setup();
      store.getState().startDeleteDraft(start, start + 3);
      store.getState().appendToDraftAtCursor('xxxx');
      store.getState().appendBreakToDraftAtCursor(false);
      store.getState().appendToDraftAtCursor('yyy');
      const drafts = Object.values(store.getState().drafts);
      expect(drafts).toHaveLength(2);
      expect(drafts[0].insertedText).toBe('xxxx');
      expect(drafts[0].multilineStructure).toBeUndefined();
      expect(drafts[1].insertedText).toBe('\nyyy');
      expect(drafts[1].multilineStructure?.structureType).toEqual(['block']);
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
      expect(drafts[0].multilineStructure?.structureType).toEqual(['block']);
      expect(drafts[1].insertedText).toBe('yyy');
      expect(drafts[1].multilineStructure).toBeUndefined();
      expect(drafts[1].followsSuggestionId).toBe(drafts[0].id);
      expect(editor!.state.doc.textContent).toBe('ABColdDEF');
    });

    for (const shift of [false, true]) {
      for (const middle of ['', '<p>middle</p>']) {
        it(`accepts ${shift ? 'Shift+Enter' : 'Enter'} across paragraphs (middle=${!!middle}, v${schemaVersion})`, () => {
          const { store } = setup();
          editor!.commands.setContent(
            `<p>ABCfirst</p>${middle}<p>secondDEF</p>`,
          );
          let from = 0;
          let to = 0;
          editor!.state.doc.descendants((node, pos) => {
            if (node.isText && node.text === 'ABCfirst') from = pos + 3;
            if (node.isText && node.text === 'secondDEF') to = pos + 6;
          });
          editor!.commands.setTextSelection({ from, to });
          const before = editor!.state.doc.toJSON();
          store.getState().appendBreakToDraftAtCursor(shift);
          const draft = Object.values(store.getState().drafts)[0];
          expect(draft).toBeDefined();
          store.getState().submitDraft(draft.id);
          expect(editor!.state.doc.toJSON()).toEqual(before);

          store.getState().acceptSuggestion(draft.id);

          const anchor =
            store.getState()._externalDepsRef!.current!.commentAnchorsRef!
              .current[0];
          expect(anchor.resolved).toBe(true);
          expect(
            editor!.state.doc.textBetween(
              0,
              editor!.state.doc.content.size,
              '\n',
              '\n',
            ),
          ).toBe('ABC\nDEF');
          let paragraphs = 0;
          let hardBreaks = 0;
          editor!.state.doc.descendants((node) => {
            if (node.type.name === 'paragraph') paragraphs++;
            if (node.type.name === 'hardBreak') hardBreaks++;
          });
          expect(paragraphs).toBe(shift ? 1 : 2);
          expect(hardBreaks).toBe(shift ? 1 : 0);
        });
      }
    }

    it(`undoes text and breaks without losing the remaining parts in v${schemaVersion}`, () => {
      const { store, start } = setup();
      editor!.commands.setTextSelection(start);
      store.getState().appendToDraftAtCursor('x');
      store.getState().appendBreakToDraftAtCursor(false);
      store.getState().appendToDraftAtCursor('y');
      store.getState().undoLastKeystrokeInActiveDraft();
      let draft = Object.values(store.getState().drafts)[0];
      expect(draft.insertedText).toBe('x\n');
      expect(draft.multilineStructure?.insertedTexts).toEqual(['x', '']);
      store.getState().undoLastKeystrokeInActiveDraft();
      draft = Object.values(store.getState().drafts)[0];
      expect(draft.insertedText).toBe('x');
      expect(draft.multilineStructure).toBeUndefined();
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
      expect(created[0].comment.multilineStructure?.insertedTexts).toEqual([
        'x',
        'y',
      ]);
      expect(created[0].meta?.multilineStructure?.structureType).toEqual([
        'block',
      ]);
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
        resolveSuggestionStructureType(editor!, from + 3, undefined, false, {
          from,
          to: from + 3,
          insertedText: '',
        }),
      ).toBe('listItem');
      expect(
        resolveSuggestionStructureType(editor!, from + 6, undefined, false, {
          from,
          to: from + 6,
          insertedText: '',
        }),
      ).toBeNull();
      expect(
        resolveSuggestionStructureType(
          editor!,
          from + 3,
          {
            version: 1,
            insertedTexts: ['x', ''],
            structureType: ['listItem'],
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

    it(`blocks Enter on an empty list item without creating a draft in v${schemaVersion}`, () => {
      const { store } = setup();
      for (const html of [
        '<ul><li><p></p></li></ul>',
        '<ul><li><p>Outer</p><ul><li><p></p></li></ul></li></ul>',
        '<ul data-type="taskList"><li data-type="taskItem"><p></p></li></ul>',
      ]) {
        editor!.commands.setContent(html);
        let emptyPosition: number | null = null;
        editor!.state.doc.descendants((node, pos) => {
          if (
            emptyPosition === null &&
            node.type.name === 'paragraph' &&
            node.content.size === 0
          ) {
            emptyPosition = pos + 1;
          }
        });
        expect(emptyPosition).not.toBeNull();
        editor!.commands.setTextSelection(emptyPosition!);
        const before = editor!.state.doc.toJSON();

        store.getState().appendBreakToDraftAtCursor(false);

        expect(store.getState().drafts).toEqual({});
        expect(editor!.state.doc.toJSON()).toEqual(before);
      }
    });

    it(`blocks a second Enter that would exit a proposed empty list item in v${schemaVersion}`, () => {
      const { store } = setup();
      editor!.commands.setContent('<ul><li><p>Item</p></li></ul>');
      let position = 0;
      editor!.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Item') position = pos + 4;
      });
      editor!.commands.setTextSelection(position);
      const before = editor!.state.doc.toJSON();

      store.getState().appendBreakToDraftAtCursor(false);
      store.getState().appendBreakToDraftAtCursor(false);

      const drafts = Object.values(store.getState().drafts);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].multilineStructure?.structureType).toEqual(['listItem']);
      expect(editor!.state.doc.toJSON()).toEqual(before);
    });

    it(`does not create a Replace draft when Enter would empty a list item in v${schemaVersion}`, () => {
      const { store } = setup();
      editor!.commands.setContent('<ul><li><p>Item</p></li></ul>');
      let from = 0;
      editor!.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === 'Item') from = pos;
      });
      editor!.commands.setTextSelection({ from, to: from + 4 });
      const before = editor!.state.doc.toJSON();

      store.getState().appendBreakToDraftAtCursor(false);

      expect(store.getState().drafts).toEqual({});
      expect(editor!.state.doc.toJSON()).toEqual(before);
    });
  }
});
