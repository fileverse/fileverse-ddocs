import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import {
  SPACER_CLASS,
  collapsedMargin,
  collectLeaves,
  leadingOffset,
  spacerDisplacement,
} from './collect-leaves';

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
    const leaves = collectLeaves(editor.view, 931, { tableRows: true });
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

  it('treats a table as one atomic leaf by default', () => {
    const doc = editor.state.doc;
    const kinds = collectLeaves(editor.view, 931).map((l) => [
      l.kind,
      doc.nodeAt(l.pos)?.type.name,
    ]);
    expect(kinds).toContainEqual(['atomic', 'table']);
    expect(kinds).not.toContainEqual(['atomic', 'tableRow']);
  });

  it('anchors a spacer at the outermost node that starts with the leaf', () => {
    const doc = editor.state.doc;
    const leaves = collectLeaves(editor.view, 931);
    for (const leaf of leaves) {
      if (leaf.kind === 'forced') continue;
      expect(leaf.spacerPos).toBeLessThanOrEqual(leaf.pos);
      expect(doc.resolve(leaf.spacerPos).depth).toBeLessThanOrEqual(
        doc.resolve(leaf.pos).depth,
      );
    }
    const inner = leaves.find(
      (l) => doc.nodeAt(l.pos)?.textContent === 'inner',
    );
    const anchor = inner?.kind === 'forced' ? 0 : (inner?.spacerPos ?? 0);
    expect(doc.nodeAt(anchor)?.type.name).toBe('bulletList');
    const first = leaves[0];
    expect(first.kind === 'forced' ? -1 : first.spacerPos).toBe(0);
  });

  it('ignores spacer elements already in the DOM', () => {
    const bare = collectLeaves(editor.view, 931).length;
    const spacer = document.createElement('div');
    spacer.className = SPACER_CLASS;
    spacer.contentEditable = 'false';
    spacer.getBoundingClientRect = () =>
      ({ top: 0, bottom: 200, height: 200 }) as DOMRect;
    editor.view.dom.insertBefore(spacer, editor.view.dom.children[1]);
    expect(collectLeaves(editor.view, 931)).toHaveLength(bare);
  });

  it('marks headings and the table header row', () => {
    const leaves = collectLeaves(editor.view, 931, { tableRows: true });
    expect(leaves[0]).toMatchObject({ kind: 'text', isHeading: true });
    expect(leaves[1]).toMatchObject({ kind: 'text', isHeading: false });
    const rows = leaves.filter((l) => l.kind === 'atomic' && l.row);
    expect(rows.map((l) => l.kind === 'atomic' && l.row?.isHeader)).toEqual([
      true,
      false,
    ]);
  });
});

// After a forced break print keeps the margin, border and padding of every box
// that starts with the leaf; margins that collapse through count once.
describe('leadingOffset', () => {
  const box = (top: number, marginTop: number, blocksCollapse = false) => ({
    top,
    marginTop,
    blocksCollapse,
  });

  it('is the leaf margin when nothing starts with it', () => {
    expect(leadingOffset([box(100, 12)])).toBe(12);
  });

  it('keeps an ancestor margin that collapses through', () => {
    expect(leadingOffset([box(100, 0), box(100, 0), box(100, 24)])).toBe(24);
  });

  it('counts collapsed margins once, the largest', () => {
    expect(leadingOffset([box(100, 16), box(100, 8)])).toBe(16);
  });

  it('adds padding and border of an ancestor that stops collapsing', () => {
    // A callout with a 1px border and 16px padding: the leaf sits 17px in.
    expect(leadingOffset([box(117, 0), box(100, 0, true)])).toBe(17);
    expect(leadingOffset([box(117, 0), box(100, 24, true)])).toBe(41);
  });
});

describe('spacer math', () => {
  it('collapsedMargin', () => {
    expect(collapsedMargin(12, 24)).toBe(24);
    expect(collapsedMargin(-8, 20)).toBe(12);
    expect(collapsedMargin(-8, -20)).toBe(-20);
  });

  it('spacerDisplacement adds back the margin the spacer swallowed', () => {
    expect(
      spacerDisplacement({ height: 200, marginAbove: 12, marginBelow: 24 }),
    ).toBe(212);
  });
});
