import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import {
  SPACER_CLASS,
  collapsedMargin,
  collectLeaves,
  effectiveBottomMargin,
  effectiveTopMargin,
  leadingOffset,
  spacerDisplacement,
} from './collect-leaves';

const HTML = `<h2>Heading</h2><p>Paragraph</p><ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul><table><tbody><tr><th><p>H</p></th></tr><tr><td><p>a</p></td></tr></tbody></table><img src="data:image/svg+xml;base64,PHN2Zy8+"><div data-type="page-break"></div><aside data-type="callout"><p>note</p></aside>`;

// jsdom has no layout: give every text node one 10px line at the top.
const lineAt = (top: number) => ({
  top,
  bottom: top + 10,
  left: 0,
  right: 10,
  width: 10,
  height: 10,
});
let lineRects = [lineAt(0)];
beforeAll(() => {
  Range.prototype.getClientRects = function () {
    return lineRects as unknown as DOMRectList;
  };
});
afterEach(() => {
  lineRects = [lineAt(0)];
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
    // With its rows' boxes, for print's row breaks (place's packRows).
    const table = collectLeaves(editor.view, 931).find(
      (l) => l.kind === 'atomic' && doc.nodeAt(l.pos)?.type.name === 'table',
    );
    expect(table?.kind === 'atomic' && table.table?.rows).toHaveLength(2);
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

  describe('with a spacer in the DOM', () => {
    beforeEach(() => {
      editor.commands.setContent('<p>a</p><p>b</p>');
    });
    const rectOf = (el: Element, top: number, height: number) => {
      el.getBoundingClientRect = () =>
        ({ top, bottom: top + height, height }) as DOMRect;
    };
    const topLevel = (el: Element) => {
      let e = el;
      while (e.parentElement !== editor.view.dom) e = e.parentElement!;
      return e as HTMLElement;
    };
    const setup = (style: Record<string, string> = {}) => {
      const [p0, p1] = Array.from(editor.view.dom.querySelectorAll('p'));
      Object.assign(p0.style, { marginBottom: '12px' });
      Object.assign(p1.style, { marginTop: '24px' });
      rectOf(p0, 0, 20);
      rectOf(p1, 220, 20);
      const spacer = document.createElement('div');
      spacer.className = SPACER_CLASS;
      spacer.contentEditable = 'false';
      rectOf(spacer, 20, 200);
      Object.assign(editor.view.dom.style, style);
      editor.view.dom.insertBefore(spacer, topLevel(p1));
      return { p0, p1 };
    };
    const second = () => {
      const leaves = collectLeaves(editor.view, 931);
      return { first: leaves[0], leaf: leaves[1] };
    };

    it('reads natural tops, subtracting the same swallowed margin', () => {
      setup();
      const { first, leaf } = second();
      expect(first.kind === 'forced' ? 0 : first.top).toBe(0);
      if (leaf.kind === 'forced') throw new Error('unexpected');
      expect(leaf.spacerCollapse).toBe(12);
      expect(220 - leaf.top).toBe(200 + leaf.spacerCollapse);
    });

    it('collapses through zero-margin wrappers, not flex parents', () => {
      const { p0, p1 } = setup({ display: 'flex', rowGap: '8px' });
      const { leaf } = second();
      if (leaf.kind === 'forced') throw new Error('unexpected');
      expect(leaf.spacerCollapse).toBe(8);
      expect(220 - leaf.top).toBe(208);
      expect(p0.style.marginBottom).toBe('12px');
      expect(p1.style.marginTop).toBe('24px');
    });

    it('shifts only the lines after a spacer inside a textblock', () => {
      const p = editor.view.dom.querySelectorAll('p')[1];
      const spacer = document.createElement('div');
      spacer.className = SPACER_CLASS;
      spacer.contentEditable = 'false';
      rectOf(spacer, 10, 20);
      lineRects = [lineAt(0), lineAt(30)];
      rectOf(p, 0, 50);
      p.appendChild(spacer);
      document.elementFromPoint = () => null;
      const leaf = collectLeaves(editor.view, 931)[1];
      if (leaf.kind !== 'text') throw new Error('expected a text leaf');
      expect(leaf.top).toBe(0);
      expect(leaf.bottom).toBe(30);
      expect(leaf.lines.map((l) => l.top)).toEqual([0, 10]);
    });
  });

  it("measures a node view's lines from its content, not its chrome", () => {
    // A code block's line-number gutter stays put when a spacer moves the code.
    editor.view.setProps({
      nodeViews: {
        codeBlock: () => {
          const dom = document.createElement('div');
          const gutter = document.createElement('div');
          gutter.textContent = '1';
          const contentDOM = document.createElement('code');
          dom.append(gutter, contentDOM);
          return { dom, contentDOM };
        },
      },
    });
    editor.commands.setContent('<pre><code>alpha</code></pre>');
    const rects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = function (this: Range) {
      const top = this.startContainer.textContent === '1' ? 300 : 0;
      return [lineAt(top)] as unknown as DOMRectList;
    };
    document.elementFromPoint = () => null;
    try {
      const doc = editor.state.doc;
      const leaf = collectLeaves(editor.view, 931).find(
        (l) => doc.nodeAt(l.pos)?.type.name === 'codeBlock',
      );
      if (leaf?.kind !== 'text') throw new Error('expected a text leaf');
      expect(leaf.lines.map((l) => l.top)).toEqual([0]);
    } finally {
      Range.prototype.getClientRects = rects;
    }
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

describe('effective margins', () => {
  const html = (inner: string) => {
    const host = document.createElement('div');
    host.innerHTML = inner;
    document.body.appendChild(host);
    return host.firstElementChild as HTMLElement;
  };
  it('collapse through zero-margin wrappers', () => {
    const el = html(
      '<div><div><p style="margin-top:8px;margin-bottom:4px">x</p></div></div>',
    );
    expect(effectiveTopMargin(el)).toBe(8);
    expect(effectiveBottomMargin(el)).toBe(4);
  });
  it('stop at padding, flex and overflow', () => {
    expect(
      effectiveTopMargin(
        html(
          '<div style="padding-top:1px"><p style="margin-top:8px">x</p></div>',
        ),
      ),
    ).toBe(0);
    expect(
      effectiveBottomMargin(
        html(
          '<div style="display:flex"><p style="margin-bottom:8px">x</p></div>',
        ),
      ),
    ).toBe(0);
    expect(
      effectiveTopMargin(
        html(
          '<div style="overflow:hidden"><p style="margin-top:8px">x</p></div>',
        ),
      ),
    ).toBe(0);
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
