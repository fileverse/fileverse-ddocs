import { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import type { Spacer } from './place';
import {
  PassScheduler,
  createSettleGuard,
  editStaysInOneTextblock,
} from './scheduler';

describe('createSettleGuard', () => {
  it('stops after 4 changed passes', () => {
    const g = createSettleGuard();
    expect(['a', 'b', 'c', 'd'].map((s) => g.next(s))).toEqual([
      'continue',
      'continue',
      'continue',
      'stop',
    ]);
  });

  it('stops when the layout from two passes ago returns', () => {
    const g = createSettleGuard();
    expect([g.next('a'), g.next('b'), g.next('a')]).toEqual([
      'continue',
      'continue',
      'stop',
    ]);
  });

  it('reset starts over', () => {
    const g = createSettleGuard();
    g.next('a');
    g.next('b');
    g.reset();
    expect([g.next('a'), g.next('b')]).toEqual(['continue', 'continue']);
  });
});

describe('PassScheduler', () => {
  let run: ReturnType<typeof vi.fn>;
  let composing: boolean;
  let frames: Array<() => void>;
  let s: PassScheduler;
  const flushFrames = () => {
    const f = frames;
    frames = [];
    f.forEach((cb) => cb());
  };
  beforeEach(() => {
    vi.useFakeTimers();
    run = vi.fn();
    composing = false;
    frames = [];
    s = new PassScheduler({
      run,
      isComposing: () => composing,
      raf: (cb) => frames.push(cb),
      cancelRaf: (id) => {
        frames[id - 1] = () => {};
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  it('debounces edits by 300 ms', () => {
    s.onEdit([]);
    vi.advanceTimersByTime(200);
    s.onEdit([]);
    vi.advanceTimersByTime(299);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('now() runs on the next frame, once, and cancels a pending debounce', () => {
    s.onEdit([]);
    s.now();
    s.now();
    expect(run).not.toHaveBeenCalled();
    flushFrames();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('flush() runs a pending pass synchronously, no-op when idle', () => {
    s.flush();
    expect(run).not.toHaveBeenCalled();
    s.onEdit([]);
    s.flush();
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not run while composing; runs on compositionEnd', () => {
    composing = true;
    s.onEdit([]);
    s.now();
    vi.advanceTimersByTime(1000);
    flushFrames();
    expect(run).not.toHaveBeenCalled();
    composing = false;
    s.compositionEnd();
    flushFrames();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('compositionEnd without a deferred pass does nothing', () => {
    s.compositionEnd();
    flushFrames();
    expect(run).not.toHaveBeenCalled();
  });

  it('destroy cancels everything and later calls are no-ops', () => {
    s.onEdit([]);
    s.now();
    s.destroy();
    vi.advanceTimersByTime(1000);
    flushFrames();
    s.onEdit([]);
    s.now();
    s.flush();
    vi.advanceTimersByTime(1000);
    flushFrames();
    expect(run).not.toHaveBeenCalled();
  });

  it('uses window rAF by default', () => {
    const spy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 1);
    const d = new PassScheduler({ run, isComposing: () => false });
    d.now();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('editStaysInOneTextblock', () => {
  let editor: Editor;
  beforeEach(() => {
    editor = new Editor({ extensions: getHeadlessExtensions() });
    editor.commands.setContent('<p>hello</p><p>world</p>');
  });
  afterEach(() => editor.destroy());

  const capture = (fn: () => void): Transaction[] => {
    const trs: Transaction[] = [];
    editor.on('transaction', ({ transaction }) => trs.push(transaction));
    fn();
    editor.off('transaction');
    return trs.filter((t) => t.docChanged);
  };
  const firstTextPos = () => {
    let p = -1;
    editor.state.doc.descendants((n, pos) => {
      if (p < 0 && n.isText) p = pos;
    });
    return p;
  };
  const sp = (over: Partial<Spacer>): Spacer => ({
    kind: 'inText',
    pos: 0,
    height: 10,
    page: 2,
    print: false,
    ...over,
  });

  it('typing in one paragraph is true', () => {
    const p = firstTextPos();
    const trs = capture(() =>
      editor.view.dispatch(editor.state.tr.insertText('x', p + 2)),
    );
    expect(trs.length).toBe(1);
    expect(editStaysInOneTextblock(trs, [])).toBe(true);
  });

  it('Enter (split) is false', () => {
    const p = firstTextPos();
    const split = capture(() =>
      editor.view.dispatch(editor.state.tr.split(p + 2, 2)),
    );
    expect(split.length).toBe(1);
    expect(editStaysInOneTextblock(split, [])).toBe(false);
  });

  it('a paragraph holding an inText spacer is false', () => {
    const p = firstTextPos();
    const trs = capture(() =>
      editor.view.dispatch(editor.state.tr.insertText('x', p + 2)),
    );
    expect(editStaysInOneTextblock(trs, [sp({ pos: p + 3 })])).toBe(false);
    expect(
      editStaysInOneTextblock(trs, [sp({ kind: 'block', pos: p + 3 })]),
    ).toBe(true);
    expect(editStaysInOneTextblock(trs, [sp({ pos: p + 40 })])).toBe(true);
  });

  it('edits in two different paragraphs are false', () => {
    const p = firstTextPos();
    const trs = capture(() => {
      editor.view.dispatch(editor.state.tr.insertText('x', p + 1));
      editor.view.dispatch(editor.state.tr.insertText('y', p + 12));
    });
    expect(trs.length).toBe(2);
    expect(editStaysInOneTextblock(trs, [])).toBe(false);
  });

  it('no steps or an empty list is true', () => {
    expect(editStaysInOneTextblock([], [])).toBe(true);
    expect(editStaysInOneTextblock([editor.state.tr], [])).toBe(true);
  });
});
