import { act, cleanup, render } from '@testing-library/react';
import { Editor, EditorContent } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';
import tippy from 'tippy.js';
import * as Y from 'yjs';
import { PageSheets } from '../../components/page-sheets';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { EditingProvider } from '../../hooks/use-editing-context';
import { usePaginationSync } from '../../hooks/use-pagination-sync';
import SlashCommand from '../slash-command/slash-comand';
import { PAGINATION_META, Pagination } from './index';
import { SPACER_CLASS } from './collect-leaves';
import { PAGE_MARGIN, PageGrid } from './page-grid';
import type { PrintInputs } from './print';

vi.mock('tippy.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('tippy.js')>();
  return { ...mod, default: Object.assign(vi.fn(mod.default), mod.default) };
});

// Probes for TIPTAP_UPGRADE.md §5.11. jsdom has no layout, so the stub below
// stacks blocks (20px lines, 30px rows, 200px media, 18px code lines) and reads
// spacers back; the numbers are not Chrome's, only their stability is pinned.

const LINE = 20;
const CODE_LINE = 18;
const ROW = 30;
const MEDIA = 200;
const CHARS = 60;
const TEXT_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

const isSpacer = (el: Element) =>
  el.classList.contains(SPACER_CLASS) &&
  !el.classList.contains('ddoc-page-spacer-header');
const root = (el: Element) => el.closest('.ProseMirror');
const codeText = (pre: Element) =>
  pre.querySelector('[data-node-view-content]')?.textContent ?? '';

function textLines(el: Element): number {
  const text = (el.textContent ?? '').length;
  return Math.max(1, Math.ceil(text / CHARS));
}

function measureHeight(el: Element): number {
  if (isSpacer(el)) return parseFloat((el as HTMLElement).style.height) || 0;
  if (
    el.getAttribute('contenteditable') === 'false' &&
    !el.querySelector('img, video')
  ) {
    return 0;
  }
  if (el.hasAttribute('data-media-toolbar')) return 0;
  const tag = el.tagName;
  if (tag === 'IMG' || tag === 'VIDEO') return MEDIA;
  if (tag === 'svg') return 0;
  if (tag === 'PRE') return CODE_LINE * (codeText(el).split('\n').length || 1);
  if (TEXT_BLOCKS.has(tag)) {
    const spacers = Array.from(el.children).filter(isSpacer);
    return (
      LINE * textLines(el) + spacers.reduce((sum, s) => sum + heightOf(s), 0)
    );
  }
  const kids = Array.from(el.children);
  if (tag === 'TR') return Math.max(ROW, ...kids.map(heightOf));
  if (kids.length === 0) return (el.textContent ?? '').trim() ? LINE : 0;
  return kids.reduce((sum, k) => sum + heightOf(k), 0);
}

function measureTop(el: Element): number {
  const parent = el.parentElement;
  if (!parent || el.classList.contains('ProseMirror')) return 0;
  const base =
    topOf(parent) +
    (parent.classList.contains('ProseMirror') ? PAGE_MARGIN : 0);
  if (parent.tagName === 'TR' || parent.tagName === 'PRE') return base;
  if (TEXT_BLOCKS.has(parent.tagName)) return base;
  let top = base;
  for (const sib of Array.from(parent.children)) {
    if (sib === el) break;
    top += heightOf(sib);
  }
  return top;
}

// Walking siblings for every rect is quadratic: keep the numbers until the
// DOM changes (takeRecords reports a mutation synchronously).
const layouts = new WeakMap<
  Element,
  {
    heights: Map<Element, number>;
    tops: Map<Element, number>;
    seen: MutationObserver;
  }
>();
const layoutOf = (el: Element) => {
  const pm = root(el) ?? el;
  let layout = layouts.get(pm);
  if (!layout) {
    const seen = new MutationObserver(() => {});
    seen.observe(pm, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    layout = { heights: new Map(), tops: new Map(), seen };
    layouts.set(pm, layout);
  }
  if (layout.seen.takeRecords().length) {
    layout.heights.clear();
    layout.tops.clear();
  }
  return layout;
};
const memo = (pick: 'heights' | 'tops', measure: (el: Element) => number) =>
  function (el: Element): number {
    if (!root(el) && !el.classList.contains('ProseMirror')) return measure(el);
    const map = layoutOf(el)[pick];
    let value = map.get(el);
    if (value === undefined) {
      value = measure(el);
      map.set(el, value);
    }
    return value;
  };
const heightOf = memo('heights', measureHeight);
const topOf = memo('tops', measureTop);

const rect = (top: number, height: number, width = 600): DOMRect =>
  ({
    top,
    bottom: top + height,
    left: 0,
    right: width,
    width,
    height,
    x: 0,
    y: top,
  }) as DOMRect;

let restoreLayout: () => void = () => {};
const installLayout = () => {
  const rectSpy = vi
    .spyOn(Element.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: Element) {
      if (!root(this)) return rect(0, 0);
      return rect(topOf(this), heightOf(this));
    });
  const proto = Range.prototype as unknown as {
    getClientRects: () => DOMRectList;
  };
  const original = proto.getClientRects;
  proto.getClientRects = function (this: Range) {
    const node = this.startContainer;
    const block = node.parentElement?.closest('p, h1, h2, h3, h4, h5, h6, pre');
    if (!block || !root(block)) return [] as unknown as DOMRectList;
    const lines =
      block.tagName === 'PRE'
        ? (node.textContent ?? '').split('\n').length
        : textLines(block);
    const step = block.tagName === 'PRE' ? CODE_LINE : LINE;
    const top = topOf(block);
    return Array.from({ length: lines }, (_, i) =>
      rect(top + step * i, step, 100),
    ) as unknown as DOMRectList;
  };
  restoreLayout = () => {
    rectSpy.mockRestore();
    proto.getClientRects = original;
  };
};

const A4 = { mode: 'pages', paper: 'a4' } as const;
const GRID = new PageGrid('a4');
const PRINT = {} as PrintInputs;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const para = (n: number) => `<p>Paragraph ${n}</p>`;
const paras = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => para(from + i)).join('');

const tableHtml = (rows: number) =>
  `<table><tbody><tr><th><p>Head A</p></th><th><p>Head B</p></th></tr>${Array.from(
    { length: rows },
    (_, i) => `<tr><td><p>a${i}</p></td><td><p>b${i}</p></td></tr>`,
  ).join('')}</tbody></table>`;

// 36 lines (720px) then a header row and 8 rows: the table crosses page 1.
const FIXTURE =
  paras(0, 36) +
  tableHtml(8) +
  '<img src="https://example.com/a.png">' +
  '<pre><code class="language-js">one\ntwo\nthree\nfour\nfive\nsix</code></pre>' +
  paras(36, 80);

function Pages({ editor }: { editor: Editor }) {
  usePaginationSync(editor, {
    pageSetup: A4,
    orientation: 'portrait',
    zoom: 1,
    isPagesMode: true,
    printInputs: () => PRINT,
  });
  return (
    <EditingProvider isPreviewMode={false}>
      <div data-ddoc-zoom-layer="" className="relative isolate">
        <PageSheets editor={editor} grid={GRID} />
        <div>
          <EditorContent editor={editor} />
        </div>
      </div>
    </EditingProvider>
  );
}

type Entry = { tabId: string; editor: Editor };

// As ddoc-editor.tsx: one PageSheets for the active editor, and one
// EditorContent per warm cache entry (keyed by tab, inactive ones hidden).
function PagesTabs({
  entries,
  activeId,
  keyedSheets,
}: {
  entries: Entry[];
  activeId: string;
  keyedSheets: boolean;
}) {
  const active = entries.find((e) => e.tabId === activeId)!.editor;
  usePaginationSync(active, {
    pageSetup: A4,
    orientation: 'portrait',
    zoom: 1,
    isPagesMode: true,
    printInputs: () => PRINT,
  });
  return (
    <EditingProvider isPreviewMode={false}>
      <div data-ddoc-zoom-layer="" className="relative isolate">
        <PageSheets
          key={keyedSheets ? activeId : undefined}
          editor={active}
          grid={GRID}
        />
        <div>
          {entries.map((entry) => (
            <div
              key={entry.tabId}
              style={{
                visibility: entry.tabId === activeId ? 'visible' : 'hidden',
              }}
            >
              <EditorContent editor={entry.editor} />
            </div>
          ))}
        </div>
      </div>
    </EditingProvider>
  );
}

const editors: Editor[] = [];
const build = (
  version: number,
  html: string | null,
  ydoc = new Y.Doc(),
  field = 'default',
) => {
  const editor = new Editor({
    extensions: [
      ...getHeadlessExtensions({ ydoc, field, schemaVersion: version }),
      Pagination,
    ] as AnyExtension[],
    textDirection: 'auto',
  });
  editors.push(editor);
  if (html !== null) editor.commands.setContent(html);
  return { editor, ydoc };
};

// Node views render by microtask on 3.34: let them, then run every pass the
// scheduler has queued (settle follow-ups included) until it is idle.
const settle = async (editor: Editor) => {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await tick();
      editor.storage.pagination.flush();
    });
    if (editor.storage.pagination.isIdle()) break;
  }
  await act(async () => {
    await tick();
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });
};

const spacerTrs = (log: Transaction[]) =>
  log.filter((tr) => {
    const meta = tr.getMeta(PAGINATION_META);
    return !!meta && 'spacers' in meta;
  });

const nodeName = (editor: Editor, pos: number) =>
  editor.state.doc.nodeAt(pos)?.type.name ?? `(inside ${pos})`;

const placementShape = (editor: Editor) => {
  const placement = editor.storage.pagination.store.get().placement!;
  return {
    pageCount: placement.pageCount,
    pageStarts: placement.pageStarts.map(
      (s) => `${s.kind}@${nodeName(editor, s.pos)}`,
    ),
    spacers: placement.spacers.map(
      (s) =>
        `p${s.page} ${s.kind}@${nodeName(editor, s.pos)} h=${s.height}${
          s.header ? ` header=${s.header}` : ''
        }`,
    ),
  };
};

const masksIn = (editor: Editor) =>
  editor.view.dom.parentElement!.querySelectorAll('.ddoc-page-mask').length;

// A browser's ResizeObserver reports once when it starts observing; that is
// what makes PageSheets re-measure after the editor's host element changes.
class InitialResizeObserver {
  constructor(private callback: ResizeObserverCallback) {}
  observe(target: Element) {
    queueMicrotask(() =>
      this.callback(
        [{ target } as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      ),
    );
  }
  unobserve() {}
  disconnect() {}
}
const realObserver = globalThis.ResizeObserver;
afterEach(() => {
  cleanup();
  editors.splice(0).forEach((e) => e.destroy());
});

describe.each([1, 2])('pagination upgrade probes, schema v%i', (version) => {
  beforeAll(() => {
    installLayout();
    globalThis.ResizeObserver =
      InitialResizeObserver as unknown as typeof ResizeObserver;
  });
  afterAll(() => {
    restoreLayout();
    globalThis.ResizeObserver = realObserver;
  });

  it('dispatches at most one spacer transaction per keystroke in a 300-block doc', async () => {
    const { editor } = build(version, paras(0, 300));
    const log: Transaction[] = [];
    editor.on('transaction', ({ transaction }) => log.push(transaction));
    render(<Pages editor={editor} />);
    await settle(editor);
    expect(editor.storage.pagination.failed).toBe(false);
    const pages = editor.storage.pagination.store.get().pageCount;
    expect(pages).toBeGreaterThan(5);
    expect(spacerTrs(log).length).toBeGreaterThan(0);

    const counts: Record<string, number> = {};
    const keystroke = async (name: string, text: string) => {
      const mark = spacerTrs(log).length;
      // The caret sits in the middle of the document.
      let at = -1;
      editor.state.doc.descendants((node, pos) => {
        if (
          at < 0 &&
          node.isTextblock &&
          node.textContent.startsWith('Paragraph 150')
        )
          at = pos + 1 + node.content.size;
      });
      editor.view.dispatch(editor.state.tr.insertText(text, at));
      await settle(editor);
      counts[name] = spacerTrs(log).length - mark;
      expect(counts[name]).toBeLessThanOrEqual(1);
    };

    await keystroke('plain character', 'x');
    await keystroke('wraps to a second line', ' '.padEnd(CHARS, 'y'));
    expect(editor.storage.pagination.failed).toBe(false);
    expect(counts).toMatchSnapshot();
  }, 30_000);

  it('places a table, media and a code block the same once node views have rendered', async () => {
    const { editor } = build(version, FIXTURE);
    const log: Transaction[] = [];
    editor.on('transaction', ({ transaction }) => log.push(transaction));
    const { container } = render(<Pages editor={editor} />);
    // Pass 1 runs on whatever node views have rendered by now.
    let early = '';
    act(() => {
      editor.storage.pagination.flush();
      early = JSON.stringify(placementShape(editor));
    });
    await settle(editor);
    expect(container.querySelector('td p')).toBeTruthy();
    expect(container.querySelector('img')).toBeTruthy();
    expect(container.querySelector('pre')).toBeTruthy();
    // Both go in the snapshot: on 3.34 a late node-view render shows up as
    // `early` differing from `settled`.
    expect({
      early: JSON.parse(early),
      settled: placementShape(editor),
    }).toMatchSnapshot();
    expect(spacerTrs(log).length).toBeGreaterThan(0);
  });

  // React's flushSync-in-lifecycle warning is 3.11 noise that 3.34 drops; a
  // failed DOM removal is what the probe asserts is absent.
  const watchErrors = () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    return {
      summary: () => {
        const messages = spy.mock.calls.map((c) => String(c[0]));
        return {
          removeChildErrors: messages.filter((m) =>
            /removeChild|NotFoundError|not a child/i.test(m),
          ),
          flushSyncWarning: messages.some((m) => /flushSync/.test(m)),
        };
      },
      restore: () => spy.mockRestore(),
    };
  };
  const layers = () => document.querySelectorAll('.ddoc-page-masks').length;
  const pagesOf = (editor: Editor) =>
    editor.storage.pagination.store.get().pageCount!;

  it('keeps one mask per page boundary when the editor prop is swapped', async () => {
    const errors = watchErrors();
    try {
      const a = build(version, FIXTURE);
      const b = build(version, paras(0, 60), a.ydoc, 'tabB');
      const { rerender } = render(<Pages editor={a.editor} />);
      await settle(a.editor);

      const pagesA = pagesOf(a.editor);
      expect(pagesA).toBeGreaterThan(1);
      // A mask sits on each boundary between two sheets, not on each page.
      expect(masksIn(a.editor)).toBe(pagesA - 1);
      expect(layers()).toBe(1);

      rerender(<Pages editor={b.editor} />);
      await settle(b.editor);
      expect(masksIn(b.editor)).toBe(pagesOf(b.editor) - 1);

      rerender(<Pages editor={a.editor} />);
      await settle(a.editor);
      expect(a.editor.storage.pagination.running).toBe(true);
      expect(b.editor.storage.pagination.running).toBe(false);
      expect(masksIn(a.editor)).toBe(pagesA - 1);

      a.editor.destroy();
      const again = build(version, null, a.ydoc);
      rerender(<Pages editor={again.editor} />);
      await settle(again.editor);
      expect(pagesOf(again.editor)).toBe(pagesA);
      expect(masksIn(again.editor)).toBe(pagesA - 1);
      expect(layers()).toBe(1);
      expect(again.editor.storage.pagination.failed).toBe(false);
      const summary = errors.summary();
      expect(summary.removeChildErrors).toEqual([]);
      expect({ flushSyncWarning: summary.flushSyncWarning }).toMatchSnapshot();
    } finally {
      errors.restore();
    }
  });

  // Production keeps one EditorContent per warm tab: a switch toggles which
  // entry is active, and an evicted tab that returns is a fresh mount.
  describe.each([
    ['PageSheets kept across switches (as ddoc-editor.tsx)', false],
    ['PageSheets keyed per editor', true],
  ])('mounted per tab, %s', (_label, keyedSheets) => {
    it('keeps one mask per boundary through switch, evict and rebuild', async () => {
      const errors = watchErrors();
      try {
        const a = build(version, FIXTURE);
        const b = build(version, paras(0, 60), a.ydoc, 'tabB');
        const entry = (tabId: string, editor: Editor): Entry => ({
          tabId,
          editor,
        });
        const tree = (entries: Entry[], activeId: string) => (
          <PagesTabs
            entries={entries}
            activeId={activeId}
            keyedSheets={keyedSheets}
          />
        );
        const { rerender } = render(tree([entry('a', a.editor)], 'a'));
        await settle(a.editor);
        const pagesA = pagesOf(a.editor);
        expect(masksIn(a.editor)).toBe(pagesA - 1);
        expect(layers()).toBe(1);

        // Tab b opens: a new EditorContent mounts next to the warm one.
        rerender(tree([entry('a', a.editor), entry('b', b.editor)], 'b'));
        await settle(b.editor);
        expect(masksIn(b.editor)).toBe(pagesOf(b.editor) - 1);
        expect(layers()).toBe(1);

        rerender(tree([entry('a', a.editor), entry('b', b.editor)], 'a'));
        await settle(a.editor);
        expect(a.editor.storage.pagination.running).toBe(true);
        expect(b.editor.storage.pagination.running).toBe(false);
        expect(masksIn(a.editor)).toBe(pagesA - 1);
        expect(layers()).toBe(1);

        // a is evicted while b is active: its EditorContent unmounts.
        rerender(tree([entry('b', b.editor)], 'b'));
        a.editor.destroy();
        await settle(b.editor);
        expect(masksIn(b.editor)).toBe(pagesOf(b.editor) - 1);
        expect(layers()).toBe(1);

        // a comes back as a rebuilt editor and a fresh EditorContent mount.
        const again = build(version, null, a.ydoc);
        rerender(tree([entry('b', b.editor), entry('a', again.editor)], 'a'));
        await settle(again.editor);
        expect(pagesOf(again.editor)).toBe(pagesA);
        expect(masksIn(again.editor)).toBe(pagesA - 1);
        expect(layers()).toBe(1);
        expect(again.editor.storage.pagination.failed).toBe(false);
        expect(b.editor.storage.pagination.running).toBe(false);

        const summary = errors.summary();
        expect(summary.removeChildErrors).toEqual([]);
        expect({
          flushSyncWarning: summary.flushSyncWarning,
        }).toMatchSnapshot();
      } finally {
        errors.restore();
      }
    });
  });
});

// Popups: the slash menu and the emoji picker open a tippy popup against the
// suggestion decoration (slash-comand.tsx, emoji.tsx). jsdom has no layout, so
// the decoration measures as all zeros and popper cannot flip or shift: what
// is pinned is that the popup opens, which rect source and placement it asks
// for, and the transform popper writes for that rect. A real first-open
// position after the 3.34 microtask render needs a browser (§8.2 QA).
describe.each([1, 2])('popup probes, schema v%i', (version) => {
  const DECORATION = rect(100, 20, 8);
  Object.assign(DECORATION, { left: 50, right: 58, x: 50 });

  const tippyMock = vi.mocked(tippy) as unknown as ReturnType<typeof vi.fn>;

  // jsdom has no Range geometry; ProseMirror's caret scroll reads it.
  const range = Range.prototype as unknown as Record<string, unknown>;
  const rangeKeys = ['getClientRects', 'getBoundingClientRect'];
  const savedRange = rangeKeys.map((key) => range[key]);
  beforeAll(() => {
    window.scrollBy = vi.fn();
    range.getBoundingClientRect = () => rect(0, 0, 0);
    range.getClientRects = () => [rect(0, 0, 0)];
  });
  afterAll(() => {
    rangeKeys.forEach((key, i) => (range[key] = savedRange[i]));
  });
  beforeEach(() => tippyMock.mockClear());
  afterEach(() => {
    document.querySelectorAll('[data-tippy-root]').forEach((el) => el.remove());
    vi.restoreAllMocks();
  });

  const mount = async (
    extension: 'slash' | 'emoji',
    typed: string,
    decorationRect: DOMRect | null,
  ) => {
    const original = Element.prototype.getBoundingClientRect;
    if (decorationRect) {
      vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
        function (this: Element) {
          return this.hasAttribute('data-decoration-id')
            ? decorationRect
            : original.call(this);
        },
      );
    }
    const editor = new Editor({
      extensions: [
        ...getHeadlessExtensions({
          ydoc: new Y.Doc(),
          schemaVersion: version,
        }),
        ...(extension === 'slash' ? [SlashCommand()] : []),
      ] as AnyExtension[],
      textDirection: 'auto',
    });
    editors.push(editor);
    editor.commands.setContent('<p></p>');
    render(
      <EditingProvider isPreviewMode={false}>
        <EditorContent editor={editor} />
      </EditingProvider>,
    );
    await act(async () => {
      await tick();
    });
    editor.commands.focus('end');
    for (const ch of typed) {
      await act(async () => {
        editor.view.dispatch(editor.state.tr.insertText(ch));
        await new Promise((resolve) => setTimeout(resolve, 30));
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    return editor;
  };

  const observed = () => {
    const calls = tippyMock.mock.calls;
    const [target, options] = calls[0] ?? [];
    const popper = document.querySelector<HTMLElement>('[data-tippy-root]');
    const box = popper?.querySelector<HTMLElement>('.tippy-box');
    const reference = options?.getReferenceClientRect?.() as DOMRect | null;
    return {
      tippyCalls: calls.length,
      target,
      placement: options?.placement,
      appendsToBody: options?.appendTo?.() === document.body,
      interactive: options?.interactive,
      referenceRect: reference
        ? { top: reference.top, left: reference.left, bottom: reference.bottom }
        : null,
      popperCount: document.querySelectorAll('[data-tippy-root]').length,
      transform: popper?.style.transform ?? null,
      dataPlacement: box?.getAttribute('data-placement') ?? null,
      referenceHidden: box?.hasAttribute('data-reference-hidden') ?? null,
    };
  };

  it('slash menu: opens on / with the unlaid-out (zero) reference rect', async () => {
    await mount('slash', '/', null);
    expect(observed()).toMatchSnapshot();
  });

  it('slash menu: places the popup from the decoration rect', async () => {
    await mount('slash', '/', DECORATION);
    expect(observed()).toMatchSnapshot();
  });

  it('emoji picker: opens on :: with the unlaid-out (zero) reference rect', async () => {
    await mount('emoji', '::sm', null);
    expect(observed()).toMatchSnapshot();
  });

  it('emoji picker: places the popup from the decoration rect', async () => {
    await mount('emoji', '::sm', DECORATION);
    expect(observed()).toMatchSnapshot();
  });
});
