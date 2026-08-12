import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { Editor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import { makeEditor } from '../../utils/make-editor';

beforeAll(() => {
  // jsdom has no ClipboardEvent; prosemirror-view's pasteHTML constructs one
  // to thread through the paste pipeline. Handlers may probe clipboardData,
  // so give it inert methods rather than null.
  if (typeof ClipboardEvent === 'undefined') {
    class ClipboardEventShim extends Event {
      clipboardData = {
        getData: () => '',
        types: [] as string[],
        files: [] as File[],
        items: [] as unknown[],
      };
    }
    (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent =
      ClipboardEventShim;
  }
});

// Regression for TEC-2679: slices with bare top-level blocks (copied from a
// flat v2 doc, or parsed from any external HTML) silently demoted headings
// to paragraph text when pasted into a v1 doc — prosemirror's fitter found
// no legal closed placement under `(dBlock|columns|pageBreak)+` and fell
// back to merging the heading's inline content into the caret paragraph.

const topLevelShapes = (editor: Editor): string[] => {
  const shapes: string[] = [];
  editor.state.doc.forEach((node) => {
    shapes.push(
      node.type.name === 'dBlock'
        ? `dBlock(${node.firstChild?.type.name ?? 'empty'})`
        : node.type.name,
    );
  });
  return shapes;
};

const caretIntoFirstParagraph = (editor: Editor) => {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.near(editor.state.doc.resolve(0), 1),
    ),
  );
};

describe('dblock paste normalizer (v1 destination)', () => {
  let editor: Editor;
  afterEach(() => editor?.destroy());

  it('keeps a pasted bare heading a heading, wrapped in a dBlock', () => {
    editor = makeEditor('<p></p>');
    caretIntoFirstParagraph(editor);

    // Exactly what a v2 copy (or any external site's HTML) puts on the
    // clipboard: a bare <h1>, no dBlock wrappers.
    editor.view.pasteHTML('<h1>Alpha One</h1>');

    const headings: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'heading') headings.push(node.textContent);
    });
    expect(headings).toEqual(['Alpha One']);
    expect(topLevelShapes(editor)).toContain('dBlock(heading)');
  });

  it('keeps multi-block flat pastes intact (heading + paragraph)', () => {
    editor = makeEditor('<p></p>');
    caretIntoFirstParagraph(editor);

    editor.view.pasteHTML('<h2>Beta Two</h2><p>gamma text</p>');

    expect(topLevelShapes(editor)).toEqual([
      'dBlock(heading)',
      'dBlock(paragraph)',
    ]);
  });

  it('still merges plain inline pastes into the caret paragraph', () => {
    editor = makeEditor('<p>hello</p>');
    // caret at the end of "hello"
    const end = editor.state.doc.firstChild!.nodeSize - 1;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.near(editor.state.doc.resolve(end), -1),
      ),
    );

    editor.view.pasteHTML('world');

    // The paste must NOT create a new block — same single dBlock, text
    // appended in place.
    expect(topLevelShapes(editor)).toEqual(['dBlock(paragraph)']);
    expect(editor.state.doc.textContent).toBe('helloworld');
  });
});
