import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { ySyncPluginKey, yUndoPluginKey } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { collectLeaves, SPACER_CLASS } from './collect-leaves';
import { PAGINATION_META, Pagination, paginationPluginKey } from './index';
import { PageGrid } from './page-grid';
import { place, type Leaf } from './place';
import { spacerKey } from './spacers';

vi.mock('./collect-leaves', async (importActual) => ({
  ...(await importActual<typeof import('./collect-leaves')>()),
  collectLeaves: vi.fn(),
}));
const collect = vi.mocked(collectLeaves);

const A4 = { mode: 'pages', paper: 'a4' } as const;
const FRAME = 16;
const DEBOUNCE = 300;
const LONG = 'aaaa bbbb cccc dddd eeee';

describe.each([
  ['v1 (dBlock)', 1],
  ['v2 (flat)', 2],
])('Pagination — %s', (_label, schemaVersion) => {
  let editor: Editor;
  let ydoc: Y.Doc;
  let trs: Transaction[];
  let errors: ReturnType<typeof vi.spyOn>;
  // Moves the long paragraph's measured box; a different shift is a
  // different spacer height, so a different placement.
  let shiftLong = 0;

  const paragraphAt = (text: string) => {
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      if (at < 0 && node.type.name === 'paragraph' && node.textContent === text)
        at = pos;
    });
    if (at < 0) throw new Error(`no paragraph "${text}"`);
    return at;
  };

  const paragraphs = () => {
    const out: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph') out.push(pos);
    });
    return out;
  };

  // The first two fit page 1; the third has five 40px lines and splits
  // after three. Found by order, so typing does not lose them.
  const leaves = (): Leaf[] => {
    const [p1, p2, p3] = paragraphs();
    const box = (pos: number, top: number, bottom: number): Leaf => ({
      kind: 'atomic',
      pos,
      top,
      bottom,
      marginTop: 0,
      spacerPos: pos,
      spacerCollapse: 0,
    });
    const top = 900 + shiftLong;
    return [
      box(p1, 96, 130),
      box(p2, 140, 170),
      {
        kind: 'text',
        pos: p3,
        top,
        bottom: top + 200,
        marginTop: 0,
        spacerPos: p3,
        spacerCollapse: 0,
        isHeading: false,
        lines: [0, 1, 2, 3, 4].map((i) => ({
          top: top + 40 * i,
          bottom: top + 40 * (i + 1),
          startPos: p3 + 1 + 5 * i,
        })),
      },
    ];
  };

  const expected = () => place(leaves(), new PageGrid('a4'));
  const decorations = () => paginationPluginKey.getState(editor.state)!.find();
  const paginationTrs = () =>
    trs.filter((tr) => tr.getMeta(PAGINATION_META) !== undefined);
  const storage = () => editor.storage.pagination;

  const enable = (over: Record<string, unknown> = {}) =>
    editor.commands.setPagination({
      pageSetup: A4,
      enabled: true,
      running: true,
      zoom: 1,
      ...over,
    });

  // Runs the first pass and the settle pass after it.
  const enableAndSettle = () => {
    enable();
    vi.advanceTimersByTime(FRAME * 3);
  };

  const typeAt = (pos: number, text: string) =>
    editor.view.dispatch(editor.state.tr.insertText(text, pos));

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'Date',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    });
    errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    shiftLong = 0;
    ydoc = new Y.Doc();
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({
      element,
      extensions: [
        ...getHeadlessExtensions({ ydoc, schemaVersion }),
        Pagination,
      ] as AnyExtension[],
      textDirection: 'auto',
    });
    // y-sync re-renders the doc on a 0 ms timer after mount.
    vi.advanceTimersByTime(1);
    editor.commands.setContent(`<p>one</p><p>two</p><p>${LONG}</p>`);
    vi.advanceTimersByTime(600);
    // lib0 reads the real Date.now, so close the setContent undo group here.
    yUndoPluginKey.getState(editor.state)!.undoManager.stopCapturing();
    collect.mockReset();
    collect.mockImplementation(() => leaves());
    trs = [];
    editor.on('transaction', ({ transaction }) => trs.push(transaction));
  });

  afterEach(() => {
    editor.destroy();
    errors.mockRestore();
    vi.useRealTimers();
  });

  it('is inert by default: no decorations, no scheduler', () => {
    typeAt(2, 'x');
    vi.advanceTimersByTime(1000);
    expect(collect).not.toHaveBeenCalled();
    expect(decorations()).toEqual([]);
    expect(storage().enabled).toBe(false);
    expect(storage().store.get().pageCount).toBeNull();
    expect(editor.view.dom.style.minHeight).toBe('');
  });

  it('stays inert for a Pageless pageSetup', () => {
    enable({ pageSetup: { mode: 'pageless', paper: 'a4' } });
    vi.advanceTimersByTime(1000);
    expect(collect).not.toHaveBeenCalled();
    expect(storage().enabled).toBe(false);
    expect(paginationTrs()).toEqual([]);
  });

  it('setPagination enabled+running runs a pass on the next frame and decorates', () => {
    enable();
    expect(collect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FRAME);
    expect(collect).toHaveBeenCalledTimes(1);
    const want = expected().spacers;
    expect(want).toHaveLength(1);
    expect(want[0].kind).toBe('inText');
    expect(decorations().map((d) => d.from)).toEqual([want[0].pos]);
    expect(editor.view.dom.querySelectorAll(`.${SPACER_CLASS}`)).toHaveLength(
      1,
    );
  });

  it('a pass transaction has no steps and leaves addToHistory unset', () => {
    enableAndSettle();
    const passes = paginationTrs().filter(
      (tr) => 'spacers' in tr.getMeta(PAGINATION_META),
    );
    expect(passes).toHaveLength(1);
    expect(passes[0].steps).toHaveLength(0);
    expect(passes[0].getMeta('addToHistory')).toBeUndefined();
  });

  it('lastPass reports count, timings and dispatched; resets on disable', () => {
    expect(storage().lastPass).toBeNull();
    enableAndSettle();
    const info = storage().lastPass!;
    expect(info.count).toBe(2);
    expect(Object.keys(info.timings)).toEqual(['collect', 'place', 'emit']);
    expect(info.timings.collect).toBeGreaterThanOrEqual(0);
    expect(info.dispatched).toBe(false);
    // The first pass dispatched its spacers, the settle pass did not.
    expect(info.dispatches).toBe(1);
    enable({ enabled: false, running: false });
    expect(storage().lastPass).toBeNull();
    enableAndSettle();
    expect(storage().lastPass!.count).toBe(2);
  });

  it('isIdle is false while a pass is pending and true once settled', () => {
    expect(storage().isIdle()).toBe(true);
    enable();
    expect(storage().isIdle()).toBe(false);
    vi.advanceTimersByTime(FRAME * 3);
    expect(storage().isIdle()).toBe(true);
    typeAt(2, 'x');
    expect(storage().isIdle()).toBe(false);
    vi.advanceTimersByTime(DEBOUNCE + FRAME * 3);
    expect(storage().isIdle()).toBe(true);
  });

  it('refuses a pagination transaction with steps', () => {
    const before = editor.state.doc;
    editor.view.dispatch(
      editor.state.tr.insertText('x', 2).setMeta(PAGINATION_META, {
        spacers: [],
      }),
    );
    expect(editor.state.doc).toBe(before);
    expect(errors).toHaveBeenCalledWith(
      'ddoc pagination: refusing a transaction with steps',
    );
  });

  it('equal placement against the view does not dispatch', () => {
    enableAndSettle();
    const count = paginationTrs().length;
    // A zoom change runs a pass; breaks do not move with zoom.
    enable({ zoom: 1.37 });
    vi.advanceTimersByTime(FRAME * 3);
    expect(collect.mock.calls.length).toBeGreaterThan(2);
    expect(paginationTrs()).toHaveLength(count);
  });

  it('re-emits when a node holding a spacer is replaced', () => {
    enableAndSettle();
    const at = paragraphAt(LONG);
    const node = editor.state.doc.nodeAt(at)!;
    editor.view.dispatch(
      editor.state.tr.replaceWith(
        at,
        at + node.nodeSize,
        node.type.create(node.attrs, editor.schema.text(LONG)),
      ),
    );
    // The widget inside the old paragraph went with it.
    expect(decorations()).toEqual([]);
    vi.advanceTimersByTime(DEBOUNCE + FRAME);
    expect(decorations().map((d) => d.from)).toEqual(
      expected().spacers.map((s) => s.pos),
    );
  });

  it('undo after a pass undoes the last typing, not a pass (y-tiptap undo manager)', () => {
    enableAndSettle();
    const end = paragraphAt('one') + 4;
    typeAt(end, 'A');
    shiftLong = 7;
    enable({ zoom: 1.5 });
    vi.advanceTimersByTime(FRAME);
    expect(
      paginationTrs().filter((tr) => 'spacers' in tr.getMeta(PAGINATION_META)),
    ).toHaveLength(2);
    typeAt(end + 1, 'B');
    expect(editor.state.doc.nodeAt(paragraphAt('oneAB'))).toBeTruthy();
    editor.commands.undo();
    // Typing on both sides of the pass is one undo step.
    expect(() => paragraphAt('one')).not.toThrow();
    expect(() => paragraphAt('two')).not.toThrow();
    expect(() => paragraphAt(LONG)).not.toThrow();
  });

  it('control: a transaction with addToHistory false would split the undo step', () => {
    const end = paragraphAt('one') + 4;
    typeAt(end, 'A');
    editor.view.dispatch(editor.state.tr.setMeta('addToHistory', false));
    typeAt(end + 1, 'B');
    editor.commands.undo();
    expect(() => paragraphAt('oneA')).not.toThrow();
  });

  it('enabled:false clears spacers in one step-less transaction', () => {
    enableAndSettle();
    const count = trs.length;
    editor.commands.setPagination({
      pageSetup: A4,
      enabled: false,
      running: false,
    });
    const after = trs.slice(count);
    expect(after).toHaveLength(1);
    expect(after[0].steps).toHaveLength(0);
    expect(after[0].getMeta(PAGINATION_META)).toEqual({ enabled: false });
    expect(decorations()).toEqual([]);
    expect(editor.view.dom.querySelector(`.${SPACER_CLASS}`)).toBeNull();
    expect(editor.view.dom.style.minHeight).toBe('');
    expect(storage().store.get()).toEqual({
      enabled: false,
      pageCount: null,
      pageStarts: [],
      placement: null,
    });
    collect.mockClear();
    typeAt(paragraphAt('one') + 1, 'x');
    vi.advanceTimersByTime(1000);
    expect(collect).not.toHaveBeenCalled();
  });

  it('enabled:true dispatches its meta once', () => {
    enable();
    enable({ zoom: 2 });
    expect(
      paginationTrs().filter(
        (tr) => tr.getMeta(PAGINATION_META).enabled === true,
      ),
    ).toHaveLength(1);
  });

  it('running:false keeps spacers and stops the scheduler', () => {
    enableAndSettle();
    enable({ running: false });
    expect(decorations()).toHaveLength(1);
    collect.mockClear();
    typeAt(paragraphAt('one') + 1, 'x');
    enable({ running: false, zoom: 3 });
    vi.advanceTimersByTime(1000);
    expect(collect).not.toHaveBeenCalled();
    expect(decorations()).toHaveLength(1);
  });

  it('a throwing pass clears decorations and sets failed; later passes do not run', () => {
    enableAndSettle();
    expect(decorations()).toHaveLength(1);
    collect.mockImplementation(() => {
      throw new Error('boom');
    });
    enable({ zoom: 2 });
    vi.advanceTimersByTime(FRAME);
    expect(decorations()).toEqual([]);
    expect(storage().failed).toBe(true);
    expect(storage().flush()).toBeNull();
    expect(errors).toHaveBeenCalled();
    collect.mockReset();
    collect.mockImplementation(() => leaves());
    enable({ zoom: 1 });
    typeAt(paragraphAt('one') + 1, 'x');
    vi.advanceTimersByTime(1000);
    expect(collect).not.toHaveBeenCalled();
  });

  it('store gets pageCount and placement after a pass', () => {
    enableAndSettle();
    const want = expected();
    expect(want.pageCount).toBe(2);
    expect(storage().store.get()).toEqual({
      enabled: true,
      pageCount: 2,
      pageStarts: want.pageStarts,
      placement: want,
    });
    // Two A4 sheets and the gap between them.
    expect(editor.view.dom.style.minHeight).toBe(`${2 * 1123 + 16}px`);
    expect(storage().flush()).toEqual(want);
  });

  it('flush runs a pending pass synchronously', () => {
    enableAndSettle();
    shiftLong = 5;
    const at = paragraphAt('two');
    editor.view.dispatch(
      editor.state.tr.addMark(
        at,
        paragraphAt(LONG) + 3,
        editor.schema.marks.bold.create(),
      ),
    );
    expect(storage().flush()).toEqual(expected());
  });

  it('flush runs a pending settle follow-up until idle', () => {
    let n = 0;
    collect.mockImplementation(() => {
      shiftLong = n++ ? 5 : 0;
      return leaves();
    });
    enable();
    vi.advanceTimersByTime(FRAME);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(storage().isIdle()).toBe(false);
    const placement = storage().flush();
    // The changed second pass arms a third, which matches and ends the run.
    expect(collect).toHaveBeenCalledTimes(3);
    expect(storage().isIdle()).toBe(true);
    shiftLong = 5;
    expect(placement).toEqual(expected());
  });

  it('debounces a remote edit by 300 ms like a local one', () => {
    enableAndSettle();
    collect.mockClear();
    const tr = editor.state.tr
      .addMark(
        paragraphAt('one'),
        paragraphAt(LONG) + 3,
        editor.schema.marks.bold.create(),
      )
      .setMeta(ySyncPluginKey, { isChangeOrigin: true })
      .setMeta('addToHistory', false);
    editor.view.dispatch(tr);
    vi.advanceTimersByTime(FRAME * 2);
    expect(collect).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE);
    expect(collect).toHaveBeenCalled();
  });

  it('does not diff a remote change when there are no spacers', () => {
    const diff = vi.spyOn(Fragment.prototype, 'findDiffStart');
    editor.view.dispatch(
      editor.state.tr
        .insertText('x', paragraphAt('one') + 1)
        .setMeta(ySyncPluginKey, { isChangeOrigin: true })
        .setMeta('addToHistory', false),
    );
    expect(diff).not.toHaveBeenCalled();
    diff.mockRestore();
  });

  it('skip rule: typing in one textblock skips the pass and maps the placement', () => {
    enableAndSettle();
    collect.mockClear();
    const before = storage().store.get().placement!;
    typeAt(paragraphAt('one') + 1, 'xy');
    vi.advanceTimersByTime(DEBOUNCE + FRAME);
    expect(collect).not.toHaveBeenCalled();
    expect(storage().lastPass).toMatchObject({ count: 3, dispatched: false });
    const after = storage().store.get().placement!;
    expect(after.spacers.map((s) => s.pos)).toEqual(
      before.spacers.map((s) => s.pos + 2),
    );
    expect(decorations().map((d) => d.from)).toEqual(
      after.spacers.map((s) => s.pos),
    );
  });

  it('runs on the next frame when the caret block ends past its page', () => {
    enableAndSettle();
    collect.mockClear();
    const at = paragraphAt('two');
    const el = editor.view.nodeDOM(at) as HTMLElement;
    const rect = (top: number, bottom: number) =>
      ({ top, bottom, height: bottom - top }) as DOMRect;
    el.getBoundingClientRect = () => rect(500, 540);
    editor.commands.setTextSelection(at + 4);
    typeAt(at + 4, 'x');
    vi.advanceTimersByTime(FRAME);
    expect(collect).not.toHaveBeenCalled();
    // Into page 1's bottom margin (text ends at 1027).
    el.getBoundingClientRect = () => rect(1000, 1050);
    typeAt(at + 5, 'y');
    vi.advanceTimersByTime(FRAME);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('waits for compositionend while composing', () => {
    enableAndSettle();
    collect.mockClear();
    const input = (editor.view as unknown as { input: { composing: boolean } })
      .input;
    input.composing = true;
    enable({ zoom: 2 });
    vi.advanceTimersByTime(FRAME * 2);
    expect(collect).not.toHaveBeenCalled();
    editor.view.dom.dispatchEvent(new Event('compositionend'));
    expect(input.composing).toBe(false);
    vi.advanceTimersByTime(FRAME * 2);
    expect(collect).toHaveBeenCalled();
  });

  type FakeObserver = {
    observed: Set<Element>;
    cb: (entries: { target: Element }[]) => void;
  };
  const stubObserver = () => {
    const observers: FakeObserver[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observed = new Set<Element>();
        constructor(public cb: FakeObserver['cb']) {
          observers.push(this);
        }
        observe(el: Element) {
          this.observed.add(el);
        }
        unobserve(el: Element) {
          this.observed.delete(el);
        }
        disconnect() {
          this.observed.clear();
        }
      },
    );
    return observers;
  };

  const resize = (ro: FakeObserver, height: number) => {
    const [child] = Array.from(editor.view.dom.children);
    Object.defineProperty(child, 'offsetHeight', {
      value: height,
      configurable: true,
    });
    ro.cb([{ target: child }]);
  };

  it('a content resize runs a pass; observers go when it stops', () => {
    const observers = stubObserver();
    try {
      enableAndSettle();
      const [ro] = observers;
      expect([...ro.observed]).toEqual(Array.from(editor.view.dom.children));
      collect.mockClear();
      resize(ro, 99);
      vi.advanceTimersByTime(FRAME);
      expect(collect).toHaveBeenCalledTimes(1);
      enable({ running: false });
      expect(ro.observed.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a resize after a capped run starts a fresh settle run', () => {
    const observers = stubObserver();
    try {
      // Every pass measures a new layout, so every pass dispatches.
      collect.mockImplementation(() => {
        shiftLong += 1;
        return leaves();
      });
      enable();
      vi.advanceTimersByTime(FRAME * 8);
      expect(collect).toHaveBeenCalledTimes(4);
      resize(observers[0], 99);
      vi.advanceTimersByTime(FRAME * 2);
      expect(collect).toHaveBeenCalledTimes(6);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('oscillation keeps the current layout and stops', () => {
    let n = 0;
    collect.mockImplementation(() => {
      shiftLong = n++ % 2 ? 7 : 0;
      return leaves();
    });
    enable();
    vi.advanceTimersByTime(FRAME * 8);
    // a, b, then a again: not dispatched.
    expect(collect).toHaveBeenCalledTimes(3);
    const passes = paginationTrs().filter(
      (tr) => 'spacers' in tr.getMeta(PAGINATION_META),
    );
    expect(passes).toHaveLength(2);
    expect(storage().lastPass).toMatchObject({
      count: 3,
      dispatched: false,
      dispatches: 2,
    });
    shiftLong = 7;
    const b = expected();
    expect(storage().store.get().placement).toEqual(b);
    expect(decorations().map((d) => d.spec.key)).toEqual(
      b.spacers.map((sp) => spacerKey(sp)),
    );
  });

  it('spacers survive undo through the y-tiptap undo manager', () => {
    enableAndSettle();
    typeAt(paragraphAt('one') + 1, 'x');
    editor.commands.undo();
    expect(() => paragraphAt('one')).not.toThrow();
    expect(decorations().map((d) => d.from)).toEqual(
      expected().spacers.map((sp) => sp.pos),
    );
  });

  it('spacers survive a Y update from another client', () => {
    enableAndSettle();
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(ydoc));
    const firstText = (el: Y.XmlFragment | Y.XmlElement): Y.XmlText | null => {
      for (const child of el.toArray()) {
        if (child instanceof Y.XmlText) return child;
        if (child instanceof Y.XmlElement) {
          const found = firstText(child);
          if (found) return found;
        }
      }
      return null;
    };
    firstText(other.getXmlFragment('default'))!.insert(0, 'Z');
    Y.applyUpdate(
      ydoc,
      Y.encodeStateAsUpdate(other, Y.encodeStateVector(ydoc)),
    );
    expect(() => paragraphAt('Zone')).not.toThrow();
    expect(decorations().map((d) => d.from)).toEqual(
      expected().spacers.map((sp) => sp.pos),
    );
  });

  it('a caret block on a page the last pass did not have runs a pass', () => {
    shiftLong = -500;
    enableAndSettle();
    expect(storage().store.get().pageCount).toBe(1);
    collect.mockClear();
    const at = paragraphAt('two');
    const el = editor.view.nodeDOM(at) as HTMLElement;
    // Inside page 2's text band (1235..2166).
    el.getBoundingClientRect = () =>
      ({ top: 1300, bottom: 1340, height: 40 }) as DOMRect;
    editor.commands.setTextSelection(at + 4);
    typeAt(at + 4, 'x');
    vi.advanceTimersByTime(FRAME);
    expect(collect).toHaveBeenCalledTimes(1);
  });

  it('an error in the edit path fails the editor, not the edit', () => {
    enableAndSettle();
    const at = paragraphAt('two');
    const el = editor.view.nodeDOM(at) as HTMLElement;
    el.getBoundingClientRect = () => {
      throw new Error('rect');
    };
    editor.commands.setTextSelection(at + 4);
    expect(() => typeAt(at + 4, 'x')).not.toThrow();
    expect(() => paragraphAt('twox')).not.toThrow();
    expect(storage().failed).toBe(true);
    expect(decorations()).toEqual([]);
    expect(errors).toHaveBeenCalled();
  });
});
