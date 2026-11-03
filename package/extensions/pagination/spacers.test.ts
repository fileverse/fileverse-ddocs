import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { DecorationSet } from '@tiptap/pm/view';
import { collectLeaves, SPACER_CLASS } from './collect-leaves';
import type { Spacer } from './place';
import {
  buildSpacerDecorations,
  rowSpacerHeader,
  spacerKey,
  spacersMatch,
} from './spacers';

const sp = (over: Partial<Spacer> = {}): Spacer => ({
  kind: 'block',
  pos: 0,
  height: 412,
  page: 3,
  print: true,
  ...over,
});

describe('spacers', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ extensions: getHeadlessExtensions() });
    editor.commands.setContent('<p>one</p><p>two</p><p>three</p>');
  });
  afterEach(() => editor.destroy());

  const doc = () => editor.state.doc;
  const positions = () => {
    const out: number[] = [];
    doc().forEach((_, off) => out.push(off));
    return out;
  };

  it('builds the widget element', () => {
    const set = buildSpacerDecorations(doc(), [sp()]);
    const [deco] = set.find();
    const el = (
      deco as unknown as {
        type: { toDOM: (v: unknown, g: () => number) => HTMLElement };
      }
    ).type.toDOM(null, () => 0);
    expect(el.classList.contains(SPACER_CLASS)).toBe(true);
    expect(el.getAttribute('contenteditable')).toBe('false');
    expect(el.getAttribute('role')).toBe('separator');
    expect(el.getAttribute('aria-label')).toBe('Page 3');
    expect(el.style.height).toBe('412px');
  });

  it('keys ignore pos', () => {
    expect(spacerKey(sp({ pos: 1 }))).toBe(spacerKey(sp({ pos: 9 })));
    expect(spacerKey(sp())).not.toBe(spacerKey(sp({ height: 400 })));
    expect(spacerKey(sp())).not.toBe(spacerKey(sp({ kind: 'inText' })));
    expect(spacerKey(sp())).not.toBe(spacerKey(sp({ page: 4 })));
  });

  it('drops zero-height spacers', () => {
    expect(buildSpacerDecorations(doc(), [sp({ height: 0 })]).find()).toEqual(
      [],
    );
    expect(spacersMatch(DecorationSet.empty, [sp({ height: 0 })], doc())).toBe(
      true,
    );
  });

  it('matches against the set in the view', () => {
    const [, p2] = positions();
    const list = [sp({ pos: p2 })];
    const set = buildSpacerDecorations(doc(), list);
    expect(spacersMatch(set, list, doc())).toBe(true);
    expect(spacersMatch(set, [sp({ pos: p2, height: 300 })], doc())).toBe(
      false,
    );
    expect(spacersMatch(set, [sp({ pos: positions()[2] })], doc())).toBe(false);
    expect(spacersMatch(set, [], doc())).toBe(false);
  });

  it('detects a widget lost to a replace over its position', () => {
    const [, p2] = positions();
    const list = [sp({ pos: p2 })];
    const set = buildSpacerDecorations(doc(), list);
    const tr = editor.state.tr.delete(p2 - 1, p2 + 2);
    const mapped = set.map(tr.mapping, tr.doc);
    expect(spacersMatch(mapped, list, tr.doc)).toBe(false);
  });

  it('matches a mix of nested and top-level spacers', () => {
    const [p1, p2] = positions();
    const list = [
      sp({ kind: 'inText', pos: p1 + 2, height: 20 }),
      sp({ pos: p2 }),
    ];
    const set = buildSpacerDecorations(doc(), list);
    expect(spacersMatch(set, list, doc())).toBe(true);
  });
});

// docs/PAGES_MODE.md §13.6: a spacer between table rows is a spacer row, then a
// clone of the header row when the screen repeats it.
describe.each([1, 2])('row spacers, schema v%i', (schemaVersion) => {
  let editor: Editor;
  const TABLE = (header: boolean) =>
    `<p>before</p><table><tbody><tr>${
      header
        ? '<th><p>H1</p></th><th colspan="2"><p>H2</p></th>'
        : '<td><p>x</p></td><td colspan="2"><p>y</p></td>'
    }</tr><tr><td><p>a</p></td><td><p>b</p></td><td><p>c</p></td></tr><tr><td><p>d</p></td><td><p>e</p></td><td><p>f</p></td></tr></tbody></table>`;
  const setup = (header = true) => {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: getHeadlessExtensions({ schemaVersion }),
    });
    editor.commands.setContent(TABLE(header));
  };
  afterEach(() => editor.destroy());

  const rowPos = (index: number) => {
    let found = -1;
    let seen = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== 'tableRow') return true;
      if (seen++ === index) found = pos;
      return false;
    });
    return found;
  };
  const show = (list: Spacer[]) => {
    const set = buildSpacerDecorations(editor.state.doc, list);
    editor.view.setProps({ decorations: () => set });
    return set;
  };
  const tbodyRows = () =>
    Array.from(editor.view.dom.querySelectorAll('tbody > tr')) as HTMLElement[];

  it('a row spacer renders a spacer tr and a header clone, both skipped as spacers', () => {
    setup();
    const list = [sp({ pos: rowPos(2), height: 300, header: 40, page: 2 })];
    const set = show(list);
    const rows = tbodyRows();
    expect(rows.map((r) => r.textContent)).toEqual([
      'H1H2',
      'abc',
      '',
      'H1H2',
      'def',
    ]);
    const [, , spacer, clone] = rows;
    expect(spacer.classList.contains(SPACER_CLASS)).toBe(true);
    expect(spacer.classList.contains('ddoc-page-spacer-row')).toBe(true);
    expect(spacer.style.height).toBe('260px');
    const cells = spacer.querySelectorAll('td');
    expect(cells).toHaveLength(1);
    expect(cells[0].colSpan).toBe(3);
    expect(cells[0].style.padding).toBe('0px');
    expect(clone.classList.contains(SPACER_CLASS)).toBe(true);
    expect(clone.classList.contains('ddoc-page-spacer-header')).toBe(true);
    expect(clone.getAttribute('contenteditable')).toBe('false');
    expect(clone.querySelectorAll('th')).toHaveLength(2);
    expect(spacersMatch(set, list, editor.state.doc)).toBe(true);
    expect(
      spacersMatch(set, [{ ...list[0], header: 30 }], editor.state.doc),
    ).toBe(false);
    // Neither row is a leaf; the real rows still are.
    const rects = Range.prototype.getClientRects;
    Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    try {
      const leafRows = collectLeaves(editor.view, 931).filter(
        (l) => editor.state.doc.nodeAt(l.pos)?.type.name === 'tableRow',
      );
      expect(leafRows).toHaveLength(3);
    } finally {
      Range.prototype.getClientRects = rects;
    }
  });

  it('a header height off by measurement noise matches the same spacers', () => {
    setup();
    const list = [
      sp({ pos: rowPos(2), height: 300, header: 29.078125, page: 2 }),
    ];
    const set = show(list);
    expect(
      spacersMatch(
        set,
        [{ ...list[0], header: 29.07815967 }],
        editor.state.doc,
      ),
    ).toBe(true);
  });

  it('editing the header changes the clone key', () => {
    setup();
    const list = [sp({ pos: rowPos(2), height: 300, header: 40, page: 2 })];
    const set = show(list);
    let h1Pos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'H1') h1Pos = pos;
    });
    const tr = editor.state.tr.insertText('x', h1Pos + 2);
    editor.view.dispatch(tr);
    const mapped = list.map((s) => ({ ...s, pos: tr.mapping.map(s.pos) }));
    // Same spacer, new header content: the set in the view no longer matches.
    expect(spacersMatch(set.map(tr.mapping, tr.doc), mapped, tr.doc)).toBe(
      false,
    );
    const keys = (s: DecorationSet) =>
      s.find().map((d) => (d as unknown as { spec: { key: string } }).spec.key);
    const before = keys(set);
    const after = keys(buildSpacerDecorations(tr.doc, mapped));
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    // The skip rule reads the header back from the row spacer's key.
    expect(rowSpacerHeader(before[0])).toBe(40);
    expect(rowSpacerHeader(before[1])).toBe(0);
  });

  // Header cells are React node views: hover and selection chrome (the "…"
  // trigger) must not freeze into the clones.
  it('strips node-view chrome and selection classes from the clone', () => {
    setup();
    const live = document.createElement('tr');
    live.innerHTML =
      '<th class="selectedCell ProseMirror-selectednode"><div><div data-node-view-content=""><p>H1<span contenteditable="false">atom</span></p></div><label class="trigger-button" contenteditable="false">…</label><div contenteditable="false">menu</div></div></th>' +
      '<th colspan="2"><p>H2<span contenteditable="false">math</span></p></th>';
    vi.spyOn(editor.view, 'nodeDOM').mockReturnValue(live);
    show([sp({ pos: rowPos(2), height: 300, header: 40, page: 2 })]);
    const clone = editor.view.dom.querySelector(
      'tr.ddoc-page-spacer-header',
    ) as HTMLElement;
    expect(clone.querySelector('.trigger-button')).toBeNull();
    expect(clone.textContent).toBe('H1atomH2math');
    expect(clone.querySelector('.selectedCell')).toBeNull();
    expect(clone.querySelector('.ProseMirror-selectednode')).toBeNull();
    // The live row keeps its chrome.
    expect(live.querySelector('.trigger-button')).not.toBeNull();
  });

  it('a table without a header row gets only the spacer tr', () => {
    setup(false);
    show([sp({ pos: rowPos(2), height: 300, page: 2 })]);
    const rows = tbodyRows();
    expect(rows.map((r) => r.textContent)).toEqual(['xy', 'abc', '', 'def']);
    expect(rows[2].style.height).toBe('300px');
  });

  it('a spacer before the table stays a div', () => {
    setup();
    let tablePos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'table') tablePos = pos;
      return tablePos < 0;
    });
    const $t = editor.state.doc.resolve(tablePos);
    const outer = schemaVersion === 1 ? $t.before($t.depth) : tablePos;
    show([sp({ pos: outer, height: 300 })]);
    const el = editor.view.dom.querySelector(`.${SPACER_CLASS}`);
    expect(el?.tagName).toBe('DIV');
  });
});
