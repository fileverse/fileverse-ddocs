import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
import { yUndoPluginKey } from '@tiptap/y-tiptap';
import { fromUint8Array } from 'js-base64';
import { deserializeCommentAnchors } from '../../utils/comment-anchor-serialization';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import {
  applyAcceptedSuggestion,
  CommentDecorationExtension,
  commentDecorationPluginKey,
  createCommentAnchorFromEditor,
  createCommentAnchorPointFromEditor,
  triggerDecorationRebuild,
  resolveSuggestionAddPointInState,
  type CommentAnchor,
} from './comment-decoration-plugin';

const makeCommentEditor = (schemaVersion = 1, ydoc = new Y.Doc()) => {
  const anchors: CommentAnchor[] = [];
  const editor = new Editor({
    extensions: [
      ...getHeadlessExtensions({ ydoc, schemaVersion }),
      CommentDecorationExtension.configure({
        getAnchors: () => anchors,
        getActiveCommentId: () => null,
      }),
    ],
    textDirection: 'auto',
  });
  return { editor, ydoc, anchors };
};

const findRange = (editor: Editor, needle: string) => {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const index = node.text.indexOf(needle);
    if (index === -1) return;
    found = { from: pos + index, to: pos + index + needle.length };
  });
  if (!found) throw new Error(`"${needle}" not found`);
  return found as { from: number; to: number };
};

const decoratedText = (editor: Editor, commentId: string): string | null => {
  const decorations =
    commentDecorationPluginKey
      .getState(editor.state)
      ?.decorations.find(
        undefined,
        undefined,
        (spec) => spec?.commentId === commentId,
      ) ?? [];

  if (decorations.length === 0) return null;

  const from = Math.min(...decorations.map((d) => d.from));
  const to = Math.max(...decorations.map((d) => d.to));
  return editor.state.doc.textBetween(from, to, ' ');
};

const applySuggestion = (
  editor: Editor,
  needle: string,
  suggestionType: 'delete' | 'replace',
  suggestedContent = '',
) => {
  const range = findRange(editor, needle);
  const relative = createCommentAnchorFromEditor(editor, range.from, range.to);
  if (!relative) throw new Error(`Could not anchor "${needle}"`);

  return applyAcceptedSuggestion(editor, {
    id: 'suggestion-1',
    ...relative,
    resolved: false,
    deleted: false,
    isSuggestion: true,
    suggestionType,
    originalContent: needle,
    suggestedContent,
  });
};

describe('comment decoration anchoring', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  for (const schemaVersion of [1, 2]) {
    for (const followsParent of [false, true]) {
      it(`uses linear parent lookups for Add decorations (parent=${followsParent}, v${schemaVersion})`, () => {
        const harness = makeCommentEditor(schemaVersion);
        editor = harness.editor;
        editor.commands.setContent('<p>ABC</p>');
        const point = createCommentAnchorPointFromEditor(
          editor,
          findRange(editor, 'ABC').from,
        )!;
        let idReads = 0;
        for (let index = 0; index < 500; index++) {
          harness.anchors.push({
            ...point,
            get id() {
              idReads++;
              return `add-${index}`;
            },
            resolved: false,
            deleted: false,
            isSuggestion: true,
            suggestionType: 'add',
            suggestedContent: 'x',
            followsSuggestionId: followsParent ? 'parent' : undefined,
          });
        }
        harness.anchors.push({
          ...point,
          id: 'parent',
          resolved: true,
          deleted: false,
        });

        triggerDecorationRebuild(editor);

        expect(idReads).toBeLessThan(500 * 20);
        expect(
          editor.view.dom.querySelectorAll('[data-suggestion-id]'),
        ).toHaveLength(500);
      });
    }
  }

  it('keeps the highlight on the anchored text when text is inserted before it', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    expect(editor.state.doc.textBetween(target.from, target.to, ' ')).toBe(
      'foobar',
    );

    const relative = createCommentAnchorFromEditor(
      editor,
      target.from,
      target.to,
    );
    expect(relative).not.toBeNull();

    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...relative!,
    });
    triggerDecorationRebuild(editor);

    expect(decoratedText(editor, 'c1')).toBe('foobar');

    // Type two characters well before the anchor.
    const start = findRange(editor, 'Hello');
    editor.commands.insertContentAt(start.from, 'XX');

    expect(decoratedText(editor, 'c1')).toBe('foobar');
  });

  it('keeps the highlight on the anchored text when text is deleted before it', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    const relative = createCommentAnchorFromEditor(
      editor,
      target.from,
      target.to,
    );

    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...relative!,
    });
    triggerDecorationRebuild(editor);
    expect(decoratedText(editor, 'c1')).toBe('foobar');

    // Delete "Hello " before the anchor.
    const hello = findRange(editor, 'Hello ');
    editor.commands.deleteRange({ from: hello.from, to: hello.to });

    expect(decoratedText(editor, 'c1')).toBe('foobar');
  });

  it('grows the highlight when text is typed inside the anchored range', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...createCommentAnchorFromEditor(editor, target.from, target.to)!,
    });
    triggerDecorationRebuild(editor);

    // Insert inside "foo|bar".
    editor.commands.insertContentAt(target.from + 3, 'ZZ');

    expect(decoratedText(editor, 'c1')).toBe('fooZZbar');
  });

  it('keeps the highlight aligned when a remote peer edits before the anchor', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors, ydoc } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...createCommentAnchorFromEditor(editor, target.from, target.to)!,
    });
    triggerDecorationRebuild(editor);
    expect(decoratedText(editor, 'c1')).toBe('foobar');

    // Simulate a collaborator typing before the anchor. The edit is made in a
    // second editor bound to a peer Y.Doc and synced back, so it arrives
    // through the Yjs observer instead of a local ProseMirror transaction.
    const peerDoc = new Y.Doc();
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(ydoc));
    const peerEditor = new Editor({
      extensions: getHeadlessExtensions({ ydoc: peerDoc }),
      textDirection: 'auto',
    });
    peerEditor.commands.insertContentAt(
      findRange(peerEditor, 'Hello').from,
      'XX',
    );
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(peerDoc));
    peerEditor.destroy();

    expect(editor.state.doc.textContent).toBe('XXHello world foobar');
    expect(decoratedText(editor, 'c1')).toBe('foobar');
  });

  it('drops the highlight when the anchored text is deleted', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    const { anchors } = harness;

    editor.commands.setContent('<p>Hello world foobar</p>');
    const target = findRange(editor, 'foobar');
    anchors.push({
      id: 'c1',
      resolved: false,
      deleted: false,
      ...createCommentAnchorFromEditor(editor, target.from, target.to)!,
    });
    triggerDecorationRebuild(editor);

    editor.commands.deleteRange({ from: target.from, to: target.to });

    expect(decoratedText(editor, 'c1')).toBeNull();
  });
});

describe('accepted suggestions', () => {
  let editor: Editor | null = null;

  afterEach(() => {
    editor?.destroy();
    editor = null;
  });

  it('keeps a pending Add in the moved suffix of a v1 dBlock', () => {
    const harness = makeCommentEditor(1);
    editor = harness.editor;
    editor.commands.setContent('<p>Alpha base<br><br>Beta base</p>');
    const firstPosition = findRange(editor, 'Alpha base').to;
    const laterPosition = findRange(editor, 'Beta base').to;
    const first: CommentAnchor = {
      id: 'first',
      ...createCommentAnchorPointFromEditor(editor, firstPosition)!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' FIRST\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' FIRST', ''],
        structureType: ['block'],
      },
    };
    const later: CommentAnchor = {
      id: 'later',
      ...createCommentAnchorPointFromEditor(editor, laterPosition)!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' SECOND\n\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' SECOND', '', ''],
        structureType: ['soft', 'block'],
      },
    };
    harness.anchors.push(first, later);
    triggerDecorationRebuild(editor);
    const immutableAnchor = Y.encodeRelativePosition(later.anchorFrom);

    expect(applyAcceptedSuggestion(editor, first, harness.anchors)).toBe(true);
    first.resolved = true;
    expect(
      resolveSuggestionAddPointInState(later, editor.state, harness.anchors),
    ).toBe(findRange(editor, 'Beta base').to);
    expect(Y.encodeRelativePosition(later.anchorFrom)).toEqual(immutableAnchor);
    expect(
      commentDecorationPluginKey
        .getState(editor.state)
        ?.decorations.find(
          undefined,
          undefined,
          (spec) => spec?.commentId === later.id,
        )[0]?.from,
    ).toBe(findRange(editor, 'Beta base').to);

    const clone = new Y.Doc();
    Y.applyUpdate(clone, Y.encodeStateAsUpdate(harness.ydoc));
    const reloaded = makeCommentEditor(1, clone);
    expect(
      resolveSuggestionAddPointInState(
        later,
        reloaded.editor.state,
        harness.anchors,
      ),
    ).toBe(findRange(reloaded.editor, 'Beta base').to);
    reloaded.editor.destroy();

    expect(applyAcceptedSuggestion(editor, later, harness.anchors)).toBe(true);
    const paragraphs: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'paragraph') paragraphs.push(node.textContent);
    });
    expect(paragraphs).toContain('Beta base SECOND');
    expect(editor.state.doc.toJSON()).toEqual(
      expect.objectContaining({ type: 'doc' }),
    );
  });

  it('keeps the effective point aligned through undo and redo of the v1 split', () => {
    const harness = makeCommentEditor(1);
    editor = harness.editor;
    editor.commands.setContent('<p>Alpha base<br><br>Beta base</p>');
    const first: CommentAnchor = {
      id: 'undo-first',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Alpha base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' FIRST\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' FIRST', ''],
        structureType: ['block'],
      },
    };
    const later: CommentAnchor = {
      id: 'undo-later',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Beta base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' SECOND',
    };
    harness.anchors.push(first, later);
    triggerDecorationRebuild(editor);
    const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager;
    expect(undoManager).toBeDefined();
    undoManager!.stopCapturing();
    expect(applyAcceptedSuggestion(editor, first, harness.anchors)).toBe(true);
    expect(
      resolveSuggestionAddPointInState(later, editor.state, harness.anchors),
    ).toBe(findRange(editor, 'Beta base').to);
    expect(editor.commands.undo()).toBe(true);
    expect(
      harness.ydoc
        .getMap<Y.Map<Uint8Array>>('suggestionAddPointOverrides')
        .get('default')
        ?.has(later.id),
    ).toBe(false);
    expect(
      resolveSuggestionAddPointInState(later, editor.state, harness.anchors),
    ).toBe(findRange(editor, 'Beta base').to);
    expect(editor.commands.redo()).toBe(true);
    expect(
      harness.ydoc
        .getMap<Y.Map<Uint8Array>>('suggestionAddPointOverrides')
        .get('default')
        ?.has(later.id),
    ).toBe(true);
    expect(
      resolveSuggestionAddPointInState(later, editor.state, harness.anchors),
    ).toBe(findRange(editor, 'Beta base').to);
  });

  it('leaves Adds in other v1 dBlocks untouched', () => {
    const harness = makeCommentEditor(1);
    editor = harness.editor;
    editor.commands.setContent(
      '<p>Alpha base</p><p>Beta base</p><p>Gamma base</p>',
    );
    const first: CommentAnchor = {
      id: 'separate-first',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Alpha base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' FIRST\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' FIRST', ''],
        structureType: ['block'],
      },
    };
    const others = ['Beta base', 'Gamma base'].map((text) => ({
      id: text,
      ...createCommentAnchorPointFromEditor(
        editor!,
        findRange(editor!, text).to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add' as const,
      suggestedContent: ' LATER',
    }));
    harness.anchors.push(first, ...others);
    triggerDecorationRebuild(editor);
    expect(applyAcceptedSuggestion(editor, first, harness.anchors)).toBe(true);
    for (const other of others) {
      expect(
        resolveSuggestionAddPointInState(other, editor.state, harness.anchors),
      ).toBe(findRange(editor, other.id).to);
    }
    expect(
      harness.ydoc
        .getMap<Y.Map<Uint8Array>>('suggestionAddPointOverrides')
        .get('default'),
    ).toBeUndefined();
  });

  it('does not write a v2 override for an independent Add', () => {
    const harness = makeCommentEditor(2);
    editor = harness.editor;
    editor.commands.setContent('<p>Alpha base<br><br>Beta base</p>');
    const first: CommentAnchor = {
      id: 'v2-first',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Alpha base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' FIRST\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' FIRST', ''],
        structureType: ['block'],
      },
    };
    const later: CommentAnchor = {
      id: 'v2-later',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Beta base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' LATER',
    };
    harness.anchors.push(first, later);
    expect(applyAcceptedSuggestion(editor, first, harness.anchors)).toBe(true);
    expect(
      harness.ydoc
        .getMap<Y.Map<Uint8Array>>('suggestionAddPointOverrides')
        .get('default'),
    ).toBeUndefined();
  });

  it('updates a remote peer from the v1 split and override together', async () => {
    const harness = makeCommentEditor(1);
    editor = harness.editor;
    editor.commands.setContent('<p>Alpha base<br><br>Beta base</p>');
    const first: CommentAnchor = {
      id: 'peer-first',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Alpha base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' FIRST\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' FIRST', ''],
        structureType: ['block'],
      },
    };
    const later: CommentAnchor = {
      id: 'peer-later',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Beta base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' LATER',
    };
    harness.anchors.push(first, later);
    triggerDecorationRebuild(editor);
    const peerDoc = new Y.Doc();
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(harness.ydoc));
    const peer = makeCommentEditor(1, peerDoc);
    peer.anchors.push(first, later);
    triggerDecorationRebuild(peer.editor);

    expect(applyAcceptedSuggestion(editor, first, harness.anchors)).toBe(true);
    first.resolved = true;
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(harness.ydoc));
    await Promise.resolve();
    expect(
      resolveSuggestionAddPointInState(later, peer.editor.state, peer.anchors),
    ).toBe(findRange(peer.editor, 'Beta base').to);
    expect(
      commentDecorationPluginKey
        .getState(peer.editor.state)
        ?.decorations.find(
          undefined,
          undefined,
          (spec) => spec?.commentId === later.id,
        )[0]?.from,
    ).toBe(findRange(peer.editor, 'Beta base').to);

    // A map-only update has no document step to trigger ProseMirror's normal
    // remote decoration rebuild.
    const changedPoint = createCommentAnchorPointFromEditor(
      editor,
      findRange(editor, 'Beta base').from,
    )!;
    harness.ydoc
      .getMap<Y.Map<Uint8Array>>('suggestionAddPointOverrides')
      .get('default')!
      .set(later.id, Y.encodeRelativePosition(changedPoint.anchorFrom));
    Y.applyUpdate(peerDoc, Y.encodeStateAsUpdate(harness.ydoc));
    await Promise.resolve();
    expect(
      commentDecorationPluginKey
        .getState(peer.editor.state)
        ?.decorations.find(
          undefined,
          undefined,
          (spec) => spec?.commentId === later.id,
        )[0]?.from,
    ).toBe(findRange(peer.editor, 'Beta base').from);
    peer.editor.destroy();
  });

  it('does not rebase an Add point deleted by the accepted v1 replacement', () => {
    const harness = makeCommentEditor(1);
    editor = harness.editor;
    editor.commands.setContent('<p>Alpha target<br><br>Beta base</p>');
    const target = findRange(editor, 'target');
    const first: CommentAnchor = {
      id: 'delete-first',
      ...createCommentAnchorFromEditor(editor, target.from, target.to)!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'replace',
      originalContent: 'target',
      suggestedContent: 'X\n',
      multilineStructure: {
        version: 1,
        insertedTexts: ['X', ''],
        structureType: ['block'],
      },
    };
    const later: CommentAnchor = {
      id: 'deleted-point',
      ...createCommentAnchorPointFromEditor(editor, target.from + 3)!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' LATER',
    };
    harness.anchors.push(first, later);
    triggerDecorationRebuild(editor);
    expect(applyAcceptedSuggestion(editor, first, harness.anchors)).toBe(true);
    expect(
      harness.ydoc
        .getMap<Y.Map<Uint8Array>>('suggestionAddPointOverrides')
        .get('default')
        ?.has(later.id),
    ).not.toBe(true);
  });

  it('ignores an Add anchor that cannot resolve in the active v1 tab', () => {
    const harness = makeCommentEditor(1);
    editor = harness.editor;
    editor.commands.setContent('<p>Alpha base<br><br>Beta base</p>');
    const first: CommentAnchor = {
      id: 'invalid-first',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Alpha base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' FIRST\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' FIRST', ''],
        structureType: ['block'],
      },
    };
    const unrelatedDoc = new Y.Doc();
    const foreignPoint = Y.createRelativePositionFromTypeIndex(
      unrelatedDoc.getXmlFragment('foreign'),
      0,
    );
    const invalid: CommentAnchor = {
      id: 'invalid-later',
      anchorFrom: foreignPoint,
      anchorTo: foreignPoint,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' LATER',
    };
    harness.anchors.push(first, invalid);
    expect(applyAcceptedSuggestion(editor, first, harness.anchors)).toBe(true);
    expect(
      harness.ydoc
        .getMap<Y.Map<Uint8Array>>('suggestionAddPointOverrides')
        .get('default')
        ?.has(invalid.id),
    ).not.toBe(true);
  });

  it('rejects repeated acceptance of an already resolved suggestion', () => {
    const harness = makeCommentEditor(1);
    editor = harness.editor;
    editor.commands.setContent('<p>Alpha base</p>');
    const first: CommentAnchor = {
      id: 'repeat-first',
      ...createCommentAnchorPointFromEditor(
        editor,
        findRange(editor, 'Alpha base').to,
      )!,
      resolved: false,
      deleted: false,
      isSuggestion: true,
      suggestionType: 'add',
      suggestedContent: ' FIRST\n',
      multilineStructure: {
        version: 1,
        insertedTexts: [' FIRST', ''],
        structureType: ['block'],
      },
    };
    expect(applyAcceptedSuggestion(editor, first, [first])).toBe(true);
    first.resolved = true;
    const acceptedDoc = editor.state.doc.toJSON();
    expect(applyAcceptedSuggestion(editor, first, [first])).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(acceptedDoc);
  });

  it('removes one surrounding space when deleting a middle word', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red apples</p>');

    expect(applySuggestion(editor, 'red', 'delete')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like apples');
  });

  it('does not normalize a deletion next to punctuation', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red, apples</p>');

    expect(applySuggestion(editor, 'red', 'delete')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like , apples');
  });

  it('does not remove another character when the selection includes a space', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red apples</p>');

    expect(applySuggestion(editor, 'red ', 'delete')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like apples');
  });

  it('preserves surrounding spaces for replacement suggestions', () => {
    const harness = makeCommentEditor();
    editor = harness.editor;
    editor.commands.setContent('<p>I like red apples</p>');

    expect(applySuggestion(editor, 'red', 'replace', 'green')).toBe(true);
    expect(editor.state.doc.textContent).toBe('I like green apples');
  });

  for (const schemaVersion of [1, 2]) {
    it(`previews the recorded break kinds in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      const { anchors } = harness;
      editor.commands.setContent('<p>ABCDEF</p>');
      const position = findRange(editor, 'DEF').from;
      anchors.push({
        id: 'preview',
        ...createCommentAnchorPointFromEditor(editor, position)!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: 'x\ny\nz',
        multilineStructure: {
          version: 1,
          insertedTexts: ['x', 'y', 'z'],
          structureType: ['block', 'soft'],
        },
      });
      triggerDecorationRebuild(editor);
      expect(
        Array.from(
          editor.view.dom.querySelectorAll('[data-suggestion-break]'),
        ).map((node) => node.getAttribute('data-suggestion-break')),
      ).toEqual(['block', 'soft']);
      expect(editor.state.doc.textContent).toBe('ABCDEF');
    });

    it(`previews a heading-end block break as a paragraph in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<h1>Heading1 (H1)</h1>');
      const position = findRange(editor, 'Heading1 (H1)').to;
      harness.anchors.push({
        id: 'heading-preview',
        ...createCommentAnchorPointFromEditor(editor, position)!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: '\nHeading 1',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', 'Heading 1'],
          structureType: ['block'],
        },
      });
      triggerDecorationRebuild(editor);

      const widget = editor.view.dom.querySelector(
        '[data-suggestion-id="heading-preview"]',
      );
      expect(
        widget?.querySelector('br[data-suggestion-break="block"]')?.hidden,
      ).toBe(true);
      expect(
        widget?.querySelector('.suggestion-paragraph-line')?.textContent,
      ).toBe('Heading 1');
      expect(editor.state.doc.textContent).toBe('Heading1 (H1)');
    });

    it(`previews an ordinary block break with paragraph spacing in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<p>Before</p>');
      harness.anchors.push({
        id: 'paragraph-preview',
        ...createCommentAnchorPointFromEditor(
          editor,
          findRange(editor, 'Before').to,
        )!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: '\nAfter',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', 'After'],
          structureType: ['block'],
        },
      });
      triggerDecorationRebuild(editor);

      const widget = editor.view.dom.querySelector(
        '[data-suggestion-id="paragraph-preview"]',
      );
      expect(
        widget?.querySelector('br[data-suggestion-break="block"]')?.hidden,
      ).toBe(true);
      expect(
        widget?.querySelector('.suggestion-paragraph-line')?.textContent,
      ).toBe('After');
      expect(
        widget?.querySelector('.suggestion-paragraph-after-heading'),
      ).toBeNull();
    });

    it(`previews nested bullets without displacing the caret in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ul><li><p>Parent</p><ul><li><p>hello</p><ul><li><p>Grandchild</p></li></ul></li></ul></li></ul>',
      );

      for (const [id, text] of [
        ['child-preview', 'hello'],
        ['grandchild-preview', 'Grandchild'],
      ]) {
        const position = findRange(editor, text).to;
        harness.anchors.push({
          id,
          ...createCommentAnchorPointFromEditor(editor, position)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: '\nyes',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', 'yes'],
            structureType: ['listItem'],
          },
        });
      }
      triggerDecorationRebuild(editor);

      const child = editor.view.dom.querySelector(
        '[data-suggestion-id="child-preview"]',
      );
      expect(child?.tagName).toBe('LI');
      expect(child?.previousElementSibling?.textContent).toContain(
        'Grandchild',
      );
      const grandchild = editor.view.dom.querySelector(
        '[data-suggestion-id="grandchild-preview"]',
      );
      expect(grandchild?.tagName).toBe('LI');
      expect(grandchild?.parentElement?.tagName).toBe('UL');
      expect(grandchild?.previousElementSibling?.textContent).toContain(
        'Grandchild',
      );
    });

    it(`previews nested ordered items with the accepted counter style in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ol><li><p>Parent</p><ol><li><p>Child</p></li><li><p>Another<br></p><ol><li><p>Grandchild</p></li></ol></li></ol></li></ol>',
      );
      for (const [id, text] of [
        ['alpha-preview', 'Another'],
        ['roman-preview', 'Grandchild'],
      ]) {
        harness.anchors.push({
          id,
          ...createCommentAnchorPointFromEditor(
            editor,
            findRange(editor, text).to,
          )!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          isDraft: id === 'alpha-preview',
          suggestionType: 'add',
          suggestedContent: '\nNew',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', 'New'],
            structureType: ['listItem'],
          },
        });
      }
      triggerDecorationRebuild(editor);

      const alpha = editor.view.dom.querySelector(
        '[data-suggestion-id="alpha-preview"]',
      );
      expect(alpha?.tagName).toBe('LI');
      expect(alpha?.previousElementSibling?.textContent).toContain(
        'Grandchild',
      );
      expect(alpha?.parentElement?.tagName).toBe('OL');
      expect(alpha?.textContent).toBe('New');
      const roman = editor.view.dom.querySelector(
        '[data-suggestion-id="roman-preview"]',
      );
      expect(roman?.tagName).toBe('LI');
      expect(roman?.parentElement?.tagName).toBe('OL');
      expect(roman?.previousElementSibling?.textContent).toContain(
        'Grandchild',
      );
      editor.commands.setTextSelection(findRange(editor, 'Another').to);
      triggerDecorationRebuild(editor);
      expect(
        editor.view.dom
          .querySelector('[data-suggestion-id="alpha-preview"]')
          ?.getAttribute('data-visual-caret'),
      ).toBe('true');
      expect(
        editor.view.dom.querySelector('.suggestion-source-caret-hidden'),
      ).not.toBeNull();
    });

    it(`advances each proposed nested ordered marker in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ol><li><p>Parent</p><ol><li><p>One</p></li><li><p>Two</p></li></ol></li></ol>',
      );
      const anchor: CommentAnchor = {
        id: 'two-ordered-items',
        ...createCommentAnchorPointFromEditor(
          editor,
          findRange(editor, 'Two').to,
        )!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: '\nThree\nFour',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', 'Three', 'Four'],
          structureType: ['listItem', 'listItem'],
        },
      };
      harness.anchors.push(anchor);
      triggerDecorationRebuild(editor);

      const markers = Array.from(
        editor.view.dom.querySelectorAll(
          '[data-suggestion-id="two-ordered-items"] .suggestion-list-marker',
        ),
        (marker) => marker.textContent,
      );
      expect(markers).toEqual(['c. ', 'd. ']);
      expect(applyAcceptedSuggestion(editor, anchor)).toBe(true);
      const items: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'listItem') {
          items.push(node.firstChild?.textContent ?? '');
        }
      });
      expect(items).toEqual(['Parent', 'One', 'Two', 'Three', 'Four']);
    });

    it(`previews a suggested task as a native task row in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Current</p></li><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>',
      );
      harness.anchors.push({
        id: 'task-preview',
        ...createCommentAnchorPointFromEditor(
          editor,
          findRange(editor, 'Current').to,
        )!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: '\nNext',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', 'Next'],
          structureType: ['listItem'],
        },
      });
      triggerDecorationRebuild(editor);

      const preview = editor.view.dom.querySelector(
        '[data-suggestion-id="task-preview"]',
      );
      expect(preview?.tagName).toBe('LI');
      expect(preview?.parentElement?.getAttribute('data-type')).toBe(
        'taskList',
      );
      expect(preview?.classList.contains('task-item')).toBe(true);
      expect(
        preview?.querySelector(':scope > label > input[type="checkbox"]'),
      ).not.toBeNull();
      expect(preview?.querySelector(':scope > div > p')?.textContent).toBe(
        'Next',
      );
      expect(preview?.previousElementSibling?.textContent).toContain('Current');
      expect(preview?.nextElementSibling?.textContent).toContain('Done');
    });

    it(`keeps nested tasks visually under their proposed parent in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ul data-type="taskList"><li data-type="taskItem"><p>Parent</p><ul data-type="taskList"><li data-type="taskItem"><p>Child</p></li></ul></li></ul>',
      );
      const position = findRange(editor, 'Parent').to;
      const anchor: CommentAnchor = {
        id: 'nested-task-preview',
        ...createCommentAnchorPointFromEditor(editor, position)!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: '\nNew parent',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', 'New parent'],
          structureType: ['listItem'],
        },
      };
      harness.anchors.push(anchor);
      triggerDecorationRebuild(editor);

      const preview = editor.view.dom.querySelector(
        '[data-suggestion-id="nested-task-preview"]',
      );
      expect(preview?.tagName).toBe('SPAN');
      expect(preview?.querySelector('[data-task="true"]')).not.toBeNull();
      expect(
        preview?.querySelector('.suggestion-task-line')?.textContent,
      ).toContain('New parent');
      expect(preview?.closest('li')?.textContent).toContain('Child');
      expect(applyAcceptedSuggestion(editor, anchor)).toBe(true);
      const json = editor.state.doc.toJSON();
      const taskList =
        schemaVersion === 1
          ? json.content?.[0].content?.[0]
          : json.content?.[0];
      expect(taskList?.content?.[1].content?.[1].type).toBe('taskList');
    });

    it(`accepts a recorded block split in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<p>ABCDEF</p>');
      const position = findRange(editor, 'DEF').from;
      const point = createCommentAnchorPointFromEditor(editor, position)!;
      const before = editor.state.doc;
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'multiline',
          ...point,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: 'xxxx\nyyy',
          multilineStructure: {
            version: 1,
            insertedTexts: ['xxxx', 'yyy'],
            structureType: ['block'],
          },
        }),
      ).toBe(true);
      expect(editor.state.doc).not.toBe(before);
      expect(
        editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'),
      ).toBe('ABCxxxx\nyyyDEF');
    });

    it(`accepts repeated and soft breaks in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<p>ABCDEF</p>');
      const position = findRange(editor, 'DEF').from;
      const point = createCommentAnchorPointFromEditor(editor, position)!;
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'mixed-breaks',
          ...point,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: 'x\n\ny\nz',
          multilineStructure: {
            version: 1,
            insertedTexts: ['x', '', 'y', 'z'],
            structureType: ['block', 'block', 'soft'],
          },
        }),
      ).toBe(true);
      expect(
        editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'),
      ).toContain('ABCx\n\nyzDEF');
      expect(editor.state.doc.toJSON().content?.length).toBe(3);
      const finalBlock =
        schemaVersion === 1
          ? editor.state.doc.toJSON().content?.[2].content?.[0]
          : editor.state.doc.toJSON().content?.[2];
      expect(
        finalBlock?.content?.some((node) => node.type === 'hardBreak'),
      ).toBe(true);
    });

    it(`creates a next list item in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<ul><li><p>ABCDEF</p></li></ul>');
      const position = findRange(editor, 'DEF').from;
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'list-break',
          ...createCommentAnchorPointFromEditor(editor, position)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: 'x\ny',
          multilineStructure: {
            version: 1,
            insertedTexts: ['x', 'y'],
            structureType: ['listItem'],
          },
        }),
      ).toBe(true);
      const json = editor.state.doc.toJSON();
      const list =
        schemaVersion === 1
          ? json.content?.[0].content?.[0]
          : json.content?.[0];
      expect(list?.content).toHaveLength(2);
      expect(editor.state.doc.textContent).toBe('ABCxyDEF');
    });

    it(`keeps a nested list on its original item when accepting a following item in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ol><li><p>Parent</p><ol><li><p>Child</p></li><li><p>Another<br></p><ol><li><p>Grandchild</p></li></ol></li></ol></li></ol>',
      );
      const position = findRange(editor, 'Another').to;
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'nested-ordered-break',
          ...createCommentAnchorPointFromEditor(editor, position)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: '\nNew',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', 'New'],
            structureType: ['listItem'],
          },
        }),
      ).toBe(true);
      const json = editor.state.doc.toJSON();
      const rootList =
        schemaVersion === 1
          ? json.content?.[0].content?.[0]
          : json.content?.[0];
      expect(
        rootList?.content?.[0].content?.[1].content?.map((node) => ({
          text: node.content?.[0].content?.[0]?.text,
          children:
            node.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text,
        })),
      ).toEqual([
        { text: 'Child', children: undefined },
        { text: 'Another', children: 'Grandchild' },
        { text: 'New', children: undefined },
      ]);
    });

    it(`records a literal newline inside code in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<pre><code>ABCDEF</code></pre>');
      const position = findRange(editor, 'DEF').from;
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'code-break',
          ...createCommentAnchorPointFromEditor(editor, position)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: 'x\ny',
          multilineStructure: {
            version: 1,
            insertedTexts: ['x', 'y'],
            structureType: ['text'],
          },
        }),
      ).toBe(true);
      expect(editor.state.doc.textContent).toContain('ABCx\nyDEF');
    });

    it(`creates a paragraph after a heading in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<h2>ABC</h2>');
      const position = findRange(editor, 'ABC').to;
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'heading-break',
          ...createCommentAnchorPointFromEditor(editor, position)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: 'x\ny',
          multilineStructure: {
            version: 1,
            insertedTexts: ['x', 'y'],
            structureType: ['block'],
          },
        }),
      ).toBe(true);
      const json = editor.state.doc.toJSON();
      const blocks =
        schemaVersion === 1
          ? json.content?.map((node) => node.content?.[0])
          : json.content;
      expect(blocks?.[0]?.type).toBe('heading');
      expect(blocks?.[1]?.type).toBe('paragraph');
    });

    it(`inherits inline formatting across an accepted split in v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<p><strong>ABCDEF</strong></p>');
      const position = findRange(editor, 'DEF').from;
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'formatted-break',
          ...createCommentAnchorPointFromEditor(editor, position)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: 'x\ny',
          multilineStructure: {
            version: 1,
            insertedTexts: ['x', 'y'],
            structureType: ['block'],
          },
        }),
      ).toBe(true);
      const json = editor.state.doc.toJSON();
      const blocks =
        schemaVersion === 1
          ? json.content?.map((node) => node.content?.[0])
          : json.content;
      expect(blocks?.[0]?.content?.[0].marks?.[0].type).toBe('bold');
      expect(blocks?.[1]?.content?.[0].marks?.[0].type).toBe('bold');
    });

    it(`rejects stale target text without changing the document in v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<p>ABColdDEF</p>');
      const range = findRange(editor, 'old');
      const anchor: CommentAnchor = {
        id: 'stale',
        ...createCommentAnchorFromEditor(editor, range.from, range.to)!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'replace',
        originalContent: 'old',
        suggestedContent: '\n',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', ''],
          structureType: ['block'],
        },
      };
      editor.commands.insertContentAt(range.from, { type: 'text', text: 'X' });
      const before = editor.state.doc.toJSON();
      expect(applyAcceptedSuggestion(editor, anchor)).toBe(false);
      expect(editor.state.doc.toJSON()).toEqual(before);
    });

    for (const order of ['replace-first', 'add-first'] as const) {
      it(`keeps Replace and break-owning Add independent (${order}, v${schemaVersion})`, () => {
        const harness = makeCommentEditor(schemaVersion);
        editor = harness.editor;
        editor.commands.setContent('<p>ABColdDEF</p>');
        const range = findRange(editor, 'old');
        const replace: CommentAnchor = {
          id: 'replace',
          ...createCommentAnchorFromEditor(editor, range.from, range.to)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'replace',
          originalContent: 'old',
          suggestedContent: 'xxxx',
        };
        const add: CommentAnchor = {
          id: 'add',
          ...createCommentAnchorPointFromEditor(editor, range.to, 1)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: '\nyyy',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', 'yyy'],
            structureType: ['block'],
          },
        };
        expect(editor.state.doc.textContent).toBe('ABColdDEF');
        const ordered =
          order === 'replace-first' ? [replace, add] : [add, replace];
        expect(applyAcceptedSuggestion(editor, ordered[0])).toBe(true);
        expect(applyAcceptedSuggestion(editor, ordered[1])).toBe(true);
        expect(
          editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'),
        ).toBe('ABCxxxx\nyyyDEF');
      });

      it(`keeps break-owning Replace and text-only Add independent (${order}, v${schemaVersion})`, () => {
        const harness = makeCommentEditor(schemaVersion);
        editor = harness.editor;
        editor.commands.setContent('<p>ABColdDEF</p>');
        const range = findRange(editor, 'old');
        const replace: CommentAnchor = {
          id: 'replace',
          ...createCommentAnchorFromEditor(editor, range.from, range.to)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'replace',
          originalContent: 'old',
          suggestedContent: '\n',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', ''],
            structureType: ['block'],
          },
        };
        const add: CommentAnchor = {
          id: 'add',
          ...createCommentAnchorPointFromEditor(editor, range.to)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: 'yyy',
          followsSuggestionId: 'replace',
        };
        const ordered =
          order === 'replace-first' ? [replace, add] : [add, replace];
        expect(applyAcceptedSuggestion(editor, ordered[0])).toBe(true);
        if (order === 'replace-first') replace.resolved = true;
        const reloaded = deserializeCommentAnchors(
          [replace, add].map((entry) => ({
            ...entry,
            anchorFrom: fromUint8Array(
              Y.encodeRelativePosition(entry.anchorFrom),
            ),
            anchorTo: fromUint8Array(Y.encodeRelativePosition(entry.anchorTo)),
          })),
        );
        const second = reloaded.find((entry) => entry.id === ordered[1].id)!;
        expect(applyAcceptedSuggestion(editor, second, reloaded)).toBe(true);
        expect(
          editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'),
        ).toBe('ABC\nyyyDEF');
      });
    }

    for (const kind of ['block', 'soft', 'text'] as const) {
      for (const suffix of ['DEF', '']) {
        it(`keeps the Add at the accepted ${kind} after reload and owner edits (suffix=${suffix}, v${schemaVersion})`, () => {
          const harness = makeCommentEditor(schemaVersion);
          editor = harness.editor;
          editor.commands.setContent(
            kind === 'text'
              ? `<pre><code>ABCold${suffix}</code></pre>`
              : `<p>ABCold${suffix}</p>`,
          );
          const range = findRange(editor, 'old');
          const replace: CommentAnchor = {
            id: 'replace',
            ...createCommentAnchorFromEditor(editor, range.from, range.to)!,
            resolved: false,
            deleted: false,
            isSuggestion: true,
            suggestionType: 'replace',
            originalContent: 'old',
            suggestedContent: '\n',
            multilineStructure: {
              version: 1,
              insertedTexts: ['', ''],
              structureType: [kind],
            },
          };
          const add: CommentAnchor = {
            id: 'add',
            ...createCommentAnchorPointFromEditor(editor, range.to)!,
            resolved: false,
            deleted: false,
            isSuggestion: true,
            suggestionType: 'add',
            suggestedContent: 'yyy',
            followsSuggestionId: replace.id,
          };
          expect(applyAcceptedSuggestion(editor, replace)).toBe(true);
          replace.resolved = true;
          const reloaded = deserializeCommentAnchors(
            [replace, add].map((entry) => ({
              ...entry,
              anchorFrom: fromUint8Array(
                Y.encodeRelativePosition(entry.anchorFrom),
              ),
              anchorTo: fromUint8Array(
                Y.encodeRelativePosition(entry.anchorTo),
              ),
            })),
          );
          const reloadedDoc = new Y.Doc();
          Y.applyUpdate(reloadedDoc, Y.encodeStateAsUpdate(harness.ydoc));
          editor.destroy();
          editor = makeCommentEditor(schemaVersion, reloadedDoc).editor;
          const prefix = findRange(editor, 'ABC');
          if (kind === 'block') {
            editor.view.dispatch(
              editor.state.tr.split(
                prefix.from + 1,
                schemaVersion === 1 ? 2 : 1,
              ),
            );
          } else {
            editor.commands.insertContentAt(prefix.to, {
              type: 'text',
              text: 'XX',
            });
          }
          const point = resolveSuggestionAddPointInState(
            reloaded[1],
            editor.state,
            reloaded,
          )!;
          // The preview and acceptance must agree on the real break endpoint.
          expect(
            editor.state.doc.textBetween(
              point,
              editor.state.doc.content.size,
              '\n',
            ),
          ).toBe(kind === 'text' ? `${suffix}\n` : suffix);
          expect(applyAcceptedSuggestion(editor, reloaded[1], reloaded)).toBe(
            true,
          );
          expect(
            editor.state.doc.textBetween(
              0,
              editor.state.doc.content.size,
              '\n',
              '\n',
            ),
          ).toBe(
            kind === 'block'
              ? `A\nBC\nyyy${suffix}`
              : `ABCXX\nyyy${suffix}${kind === 'text' ? '\n' : ''}`,
          );
        });
      }
    }

    it(`keeps a following Add after a Replace at the document end in v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent('<p>ABCold</p>');
      const range = findRange(editor, 'old');
      const replace: CommentAnchor = {
        id: 'end-replace',
        ...createCommentAnchorFromEditor(editor, range.from, range.to)!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'replace',
        originalContent: 'old',
        suggestedContent: 'xxxx',
      };
      const add: CommentAnchor = {
        id: 'end-add',
        ...createCommentAnchorPointFromEditor(editor, range.to, 1)!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: '\nyyy',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', 'yyy'],
          structureType: ['block'],
        },
        followsSuggestionId: replace.id,
      };
      expect(applyAcceptedSuggestion(editor, replace)).toBe(true);
      replace.resolved = true;
      expect(applyAcceptedSuggestion(editor, add, [replace, add])).toBe(true);
      expect(
        editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n'),
      ).toContain('ABCxxxx\nyyy');
    });
  }
});
