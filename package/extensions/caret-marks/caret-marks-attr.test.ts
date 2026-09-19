import { describe, it, expect, afterEach } from 'vitest';
import {
  makeEditor,
  track,
  destroyTracked,
  endOf,
  caretTo,
  caretBlock,
  createdBlock,
  textblocks,
  stampBlock,
  stampOf,
  type,
} from './test-helpers';

afterEach(destroyTracked);

describe.each([1, 2])('caretMarks attribute (schema v%i)', (version) => {
  it('exists on paragraphs and headings, defaults to null, and has no HTML form', () => {
    const editor = track(makeEditor(version, '<h2>t</h2><p>x</p>'));
    editor.state.doc.descendants((node) => {
      if (node.isTextblock) expect(node.attrs.caretMarks).toBeNull();
    });
    stampBlock(editor, caretBlock(editor).pos, '[{"type":"bold"}]');
    expect(editor.getHTML()).not.toContain('caretMarks');
    expect(editor.getHTML()).not.toContain('bold');
  });

  it('survives a JSON round-trip through setContent', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    stampBlock(editor, caretBlock(editor).pos, '[{"type":"bold"}]');
    const json = editor.getJSON();
    const other = track(makeEditor(version, null));
    other.commands.setContent(json);
    expect(stampOf(textblocks(other)[0].node)).toBe('[{"type":"bold"}]');
  });

  it('renders the stamped font on an empty line as a decoration, not markup', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    stampBlock(
      editor,
      caretBlock(editor).pos,
      '[{"type":"textStyle","attrs":{"fontFamily":"Georgia","fontSize":"24px"}}]',
    );
    const p = () => editor.view.dom.querySelector('p') as HTMLParagraphElement;
    expect(p().style.fontSize).toBe('24px');
    expect(p().style.fontFamily).toBe('Georgia');
    expect(editor.getHTML()).not.toContain('24px');

    type(editor, 'x');
    expect(p().style.fontSize).toBe('');
    editor.view.dispatch(
      editor.state.tr.delete(
        editor.state.selection.from - 1,
        editor.state.selection.from,
      ),
    );
    expect(p().style.fontSize).toBe('24px');
  });
});

describe('keepOnSplit (schema v2)', () => {
  it('does not copy caretMarks or the legacy font attrs onto the block an end split creates', () => {
    const editor = track(
      makeEditor(2, '<p style="font-family: Georgia; font-size: 24px">abc</p>'),
    );
    stampBlock(editor, 0, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock();
    const created = createdBlock(editor).node;
    expect(created.attrs.fontFamily).toBeNull();
    expect(created.attrs.fontSize).toBeNull();
    // The split's own declaration (Task 5) stamps it later; at this point it is null or the declared value.
    expect(stampOf(created)).not.toBe('[{"type":"bold"}]');
  });
});
