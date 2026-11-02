import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { collectLeaves } from './collect-leaves';

const HTML = `<h2>Heading</h2><p>Paragraph</p><ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul><table><tbody><tr><th><p>H</p></th></tr><tr><td><p>a</p></td></tr></tbody></table><img src="data:image/svg+xml;base64,PHN2Zy8+"><div data-type="page-break"></div><aside data-type="callout"><p>note</p></aside>`;

// jsdom has no layout: give every text node one 10px line at the top.
beforeAll(() => {
  Range.prototype.getClientRects = function () {
    return [
      { top: 0, bottom: 10, left: 0, right: 10, width: 10, height: 10 },
    ] as unknown as DOMRectList;
  };
});

describe.each([1, 2])('collectLeaves, schema v%i', (schemaVersion) => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: getHeadlessExtensions({ schemaVersion }),
    });
    editor.commands.setContent(HTML);
  });
  afterEach(() => editor.destroy());

  it('yields one leaf per placeable unit, in document order', () => {
    const leaves = collectLeaves(editor.view, 931);
    const doc = editor.state.doc;
    expect(
      leaves.map((leaf) => [leaf.kind, doc.nodeAt(leaf.pos)?.type.name]),
    ).toEqual([
      ['text', 'heading'],
      ['text', 'paragraph'],
      ['text', 'paragraph'],
      ['text', 'paragraph'],
      ['atomic', 'tableRow'],
      ['atomic', 'tableRow'],
      ['atomic', 'resizableMedia'],
      ['forced', 'pageBreak'],
      ['atomic', 'callout'],
      // trailingNode's empty paragraph: no line boxes, so it moves as a unit.
      ['atomic', 'paragraph'],
    ]);
  });

  it('marks headings and the table header row', () => {
    const leaves = collectLeaves(editor.view, 931);
    expect(leaves[0]).toMatchObject({ kind: 'text', isHeading: true });
    expect(leaves[1]).toMatchObject({ kind: 'text', isHeading: false });
    const rows = leaves.filter((l) => l.kind === 'atomic' && l.row);
    expect(rows.map((l) => l.kind === 'atomic' && l.row?.isHeader)).toEqual([
      true,
      false,
    ]);
  });
});
