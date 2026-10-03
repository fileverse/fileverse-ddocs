import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { NodeSelection, Selection } from '@tiptap/pm/state';
import { makeEditor } from '../../utils/make-editor';
import { defaultExtensions } from '../default-extension';
import { PageBreak } from '../page-break';
import {
  embedPasteAsCandidate,
  findBareLinkCandidate,
  getPasteAsCandidate,
} from './paste-as-candidate';

const IMG = 'https://example.com/pic.png';
const TWEET = 'https://x.com/someone/status/1234567890';

const makeV2Editor = () => {
  const editor = new Editor({
    extensions: [
      ...defaultExtensions({ onError: () => null, schemaVersion: 2 }),
      PageBreak,
    ] as never,
  });
  editor.commands.setContent('<p></p>');
  return editor;
};

// jsdom has no ClipboardEvent; a paste is a text insert tagged with the
// `uiEvent: paste` meta, which is what Link's autolink keys on to mark the URL.
const pasteText = (editor: Editor, text: string) => {
  editor.commands.setTextSelection(Selection.atEnd(editor.state.doc).from);
  editor.view.dispatch(
    editor.state.tr
      .insertText(text)
      .setMeta('paste', true)
      .setMeta('uiEvent', 'paste'),
  );
};

const nodeNames = (editor: Editor) => {
  const names: string[] = [];
  editor.state.doc.descendants((node) => {
    names.push(node.type.name);
  });
  return names;
};

describe('getPasteAsCandidate', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('recognises a pasted image URL', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, IMG);
    expect(getPasteAsCandidate(editor.state)).toMatchObject({
      kind: 'image',
      href: IMG,
    });
  });

  it('matches the image extension on the pathname, ignoring the query', () => {
    editor = makeEditor('<p></p>');
    const href = 'https://cdn.example.com/a/b.jpg?w=800&name=large';
    pasteText(editor, href);
    expect(getPasteAsCandidate(editor.state)).toMatchObject({
      kind: 'image',
      href,
    });
  });

  it('recognises a pasted tweet URL', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, TWEET);
    expect(getPasteAsCandidate(editor.state)).toMatchObject({
      kind: 'tweet',
      tweetId: '1234567890',
    });
  });

  it('ignores a pasted URL that is neither an image nor a tweet', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, 'https://example.com/article');
    expect(getPasteAsCandidate(editor.state)).toBeNull();
  });

  it('is armed only by a paste: entering an existing bare link offers nothing', () => {
    editor = makeEditor(`<p><a href="${IMG}">${IMG}</a></p>`);
    editor.commands.setTextSelection(4);
    expect(findBareLinkCandidate(editor.state)).toMatchObject({
      kind: 'image',
    });
    expect(getPasteAsCandidate(editor.state)).toBeNull();
  });

  it('disarms once the user types after the paste', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, IMG);
    expect(getPasteAsCandidate(editor.state)).not.toBeNull();
    editor.commands.insertContent({ type: 'text', text: ' ' });
    expect(getPasteAsCandidate(editor.state)).toBeNull();
  });

  it('stays armed through a remote edit elsewhere in the doc', () => {
    editor = makeEditor('<p>before</p><p></p>');
    pasteText(editor, IMG);
    editor.view.dispatch(
      editor.state.tr
        .insertText('x', 2)
        .setMeta('y-sync$', { isChangeOrigin: true }),
    );
    expect(getPasteAsCandidate(editor.state)).toMatchObject({ kind: 'image' });
  });

  // use-tab-editor's paste colour clean-up: select the pasted range, re-mark
  // it, then put the caret back at the end, all a tick after the paste.
  it('survives the paste colour clean-up selecting the pasted range', () => {
    editor = makeEditor('<p></p>');
    const from = Selection.atEnd(editor.state.doc).from;
    pasteText(editor, IMG);
    const to = editor.state.selection.from;

    editor.chain().setTextSelection({ from, to }).setColor('').run();
    expect(getPasteAsCandidate(editor.state)).toBeNull();

    editor.commands.setTextSelection(to);
    expect(getPasteAsCandidate(editor.state)).toMatchObject({ kind: 'image' });
  });

  it('disarms once the caret moves', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, IMG);
    editor.commands.setTextSelection(editor.state.selection.from - 1);
    expect(getPasteAsCandidate(editor.state)).toBeNull();
  });
});

describe('findBareLinkCandidate', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('ignores a named link whose text is not the URL', () => {
    editor = makeEditor(`<p><a href="${IMG}">my source</a></p>`);
    editor.commands.setTextSelection(4);
    expect(findBareLinkCandidate(editor.state)).toBeNull();
  });

  it('ignores a caret outside any link', () => {
    editor = makeEditor(`<p><a href="${IMG}">${IMG}</a></p><p>plain</p>`);
    editor.commands.setTextSelection(editor.state.doc.content.size - 2);
    expect(findBareLinkCandidate(editor.state)).toBeNull();
  });
});

describe('embedPasteAsCandidate', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('replaces the image link with a media node in v1', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, IMG);
    const candidate = getPasteAsCandidate(editor.state);
    expect(candidate).not.toBeNull();

    embedPasteAsCandidate(editor, candidate!);

    expect(nodeNames(editor)).toContain('resizableMedia');
    expect(editor.getHTML()).not.toContain('<a ');
    const media = editor.state.doc.firstChild?.firstChild;
    expect(media?.type.name).toBe('resizableMedia');
    expect(media?.attrs.src).toBe(IMG);
    expect(media?.attrs['media-type']).toBe('img');
  });

  it('replaces the image link with a media node in v2', () => {
    editor = makeV2Editor();
    pasteText(editor, IMG);
    const candidate = getPasteAsCandidate(editor.state);
    expect(candidate).not.toBeNull();

    embedPasteAsCandidate(editor, candidate!);

    const media = editor.state.doc.firstChild;
    expect(media?.type.name).toBe('resizableMedia');
    expect(media?.attrs.src).toBe(IMG);
    expect(editor.getHTML()).not.toContain('<a ');
  });

  // The embed becomes the selection, so the caret does not fall into
  // whichever block happens to sit next to it.
  it.each([
    ['v1', () => makeEditor('<p>before</p><p></p><p>after</p>')],
    [
      'v2',
      () => {
        const v2 = makeV2Editor();
        v2.commands.setContent('<p>before</p><p></p><p>after</p>');
        return v2;
      },
    ],
  ])('selects the embedded image (%s)', (_name, make) => {
    editor = make();
    let emptyPos = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) {
        emptyPos = pos + 1;
      }
    });
    editor.commands.setTextSelection(emptyPos);
    editor.view.dispatch(
      editor.state.tr
        .insertText(IMG)
        .setMeta('paste', true)
        .setMeta('uiEvent', 'paste'),
    );

    embedPasteAsCandidate(editor, getPasteAsCandidate(editor.state)!);

    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe('resizableMedia');
    expect((selection as NodeSelection).node.attrs.src).toBe(IMG);
  });

  it('selects the embedded tweet', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, TWEET);
    embedPasteAsCandidate(editor, getPasteAsCandidate(editor.state)!);
    const { selection } = editor.state;
    expect(selection).toBeInstanceOf(NodeSelection);
    expect((selection as NodeSelection).node.type.name).toBe('embeddedTweet');
  });

  it('replaces the tweet link with a tweet embed', () => {
    editor = makeEditor('<p></p>');
    pasteText(editor, TWEET);
    const candidate = getPasteAsCandidate(editor.state);

    embedPasteAsCandidate(editor, candidate!);

    expect(nodeNames(editor)).toContain('embeddedTweet');
    expect(editor.getHTML()).not.toContain('<a ');
  });
});
