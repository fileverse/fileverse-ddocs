import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import * as Y from 'yjs';
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
  type CommentAnchor,
} from './comment-decoration-plugin';

const makeCommentEditor = (schemaVersion = 1) => {
  const ydoc = new Y.Doc();
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

    it(`previews top-level and nested list exits at the lifted level in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ul><li><p>Outer</p><ul><li><p></p></li></ul></li></ul><ul><li><p>Last</p></li><li><p></p></li></ul>',
      );
      let count = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'paragraph' || node.content.size !== 0) return;
        const id = count++ === 0 ? 'nested-exit-preview' : 'top-exit-preview';
        harness.anchors.push({
          id,
          ...createCommentAnchorPointFromEditor(editor!, pos + 1)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: '\nAfter',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', 'After'],
            structureType: ['listExit'],
          },
        });
      });
      triggerDecorationRebuild(editor);

      const nested = editor.view.dom.querySelector(
        '[data-suggestion-id="nested-exit-preview"]',
      );
      const top = editor.view.dom.querySelector(
        '[data-suggestion-id="top-exit-preview"]',
      );
      expect(
        nested?.querySelector('.suggestion-list-exit-marker')?.textContent,
      ).toBe('• ');
      expect(top?.querySelector('.suggestion-list-exit-marker')).toBeNull();
      expect(
        nested?.querySelector('br[data-suggestion-break="listExit"]')?.hidden,
      ).toBe(true);
      expect(
        top?.querySelector('br[data-suggestion-break="listExit"]')?.hidden,
      ).toBe(true);
    });

    it(`previews a nested task exit with a task checkbox in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ul data-type="taskList"><li data-type="taskItem"><p>Parent</p><ul data-type="taskList"><li data-type="taskItem"><p></p></li></ul></li></ul>',
      );
      let emptyPosition: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'paragraph' && node.content.size === 0) {
          const $pos = editor!.state.doc.resolve(pos + 1);
          const taskDepth = Array.from({ length: $pos.depth + 1 }, (_, depth) =>
            $pos.node(depth),
          ).filter((ancestor) => ancestor.type.name === 'taskItem').length;
          if (taskDepth === 2) emptyPosition = pos + 1;
        }
      });
      expect(emptyPosition).not.toBeNull();
      harness.anchors.push({
        id: 'task-exit-preview',
        ...createCommentAnchorPointFromEditor(editor, emptyPosition!)!,
        resolved: false,
        deleted: false,
        isSuggestion: true,
        suggestionType: 'add',
        suggestedContent: '\nAfter',
        multilineStructure: {
          version: 1,
          insertedTexts: ['', 'After'],
          structureType: ['listExit'],
        },
      });
      triggerDecorationRebuild(editor);

      const preview = editor.view.dom.querySelector(
        '[data-suggestion-id="task-exit-preview"]',
      );
      expect(
        preview
          ?.querySelector('.suggestion-list-exit-marker')
          ?.getAttribute('data-task'),
      ).toBe('true');
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

    it(`exits an empty list item in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ul><li><p>ABC</p></li><li><p></p></li></ul>',
      );
      let emptyPosition: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (
          emptyPosition === null &&
          node.type.name === 'paragraph' &&
          node.content.size === 0
        ) {
          emptyPosition = pos + 1;
        }
      });
      expect(emptyPosition).not.toBeNull();
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'list-exit',
          ...createCommentAnchorPointFromEditor(editor, emptyPosition!)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: '\ny',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', 'y'],
            structureType: ['listExit'],
          },
        }),
      ).toBe(true);
      expect(editor.state.doc.textContent).toBe('ABCy');
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

    it(`exits an empty nested list item in schema v${schemaVersion}`, () => {
      const harness = makeCommentEditor(schemaVersion);
      editor = harness.editor;
      editor.commands.setContent(
        '<ul><li><p>Outer</p><ul><li><p>Inner</p></li><li><p></p></li></ul></li></ul>',
      );
      let position: number | null = null;
      editor.state.doc.descendants((node, pos) => {
        if (
          position === null &&
          node.type.name === 'paragraph' &&
          node.content.size === 0
        ) {
          position = pos + 1;
        }
      });
      expect(position).not.toBeNull();
      expect(
        applyAcceptedSuggestion(editor, {
          id: 'nested-exit',
          ...createCommentAnchorPointFromEditor(editor, position!)!,
          resolved: false,
          deleted: false,
          isSuggestion: true,
          suggestionType: 'add',
          suggestedContent: '\ny',
          multilineStructure: {
            version: 1,
            insertedTexts: ['', 'y'],
            structureType: ['listExit'],
          },
        }),
      ).toBe(true);
      expect(editor.state.doc.textContent).toContain('y');
      const json = editor.state.doc.toJSON();
      const list =
        schemaVersion === 1
          ? json.content?.[0].content?.[0]
          : json.content?.[0];
      expect(list?.content).toHaveLength(2);
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
