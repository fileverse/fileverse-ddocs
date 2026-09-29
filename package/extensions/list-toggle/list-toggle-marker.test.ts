import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as Y from 'yjs';
import type { Editor } from '@tiptap/react';
import { DOMSerializer, Fragment } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import { AddMarkStep } from '@tiptap/pm/transform';
import { handleContentPrint } from '../../utils/handle-print';
import {
  destroyTracked,
  endOf,
  makeEditor,
  nativeDelete,
  pressEnter,
  selectText,
  startOf,
  track,
  type,
  undoManager,
} from '../caret-marks/test-helpers';
import {
  MARKER_FONT_FAMILY_VAR,
  MARKER_FONT_SIZE_VAR,
  applyMarkerFonts,
  changedBlockRanges,
  markerFont,
  markerFontPluginKey,
} from './marker-font';
import { caretIn } from './test-helpers';

afterEach(destroyTracked);

/** [name, html, marker font of every list item in document order]. */
const CASES: [string, string, string][] = [
  [
    'a whole item at 12px',
    '<ul><li><p><span style="font-size: 12px">aa</span></p></li><li><p>bb</p></li></ul>',
    '12px/- -/-',
  ],
  [
    'size and family together',
    '<ul><li><p><span style="font-size: 12px; font-family: Georgia">aa</span></p></li></ul>',
    '12px/"georgia"',
  ],
  [
    'one bigger word',
    '<ul><li><p><span style="font-size: 12px">aa </span><span style="font-size: 24px">bb</span></p></li></ul>',
    '-/-',
  ],
  [
    'one size, mixed families',
    '<ul><li><p><span style="font-size: 12px; font-family: Georgia">aa</span> <span style="font-size: 12px; font-family: Arial">bb</span></p></li></ul>',
    '12px/-',
  ],
  [
    'an unmarked space between two formatted words',
    '<ul><li><p><span style="font-size: 12px">b1</span> <span style="font-size: 12px">b2</span></p></li></ul>',
    '12px/-',
  ],
  [
    'one unmarked run',
    '<ul><li><p><span style="font-size: 12px">aa</span>bb</p></li></ul>',
    '-/-',
  ],
  [
    'legacy paragraph attrs',
    '<ul><li><p style="font-size: 12px; font-family: Georgia">aa</p></li></ul>',
    '12px/"georgia"',
  ],
  [
    'a numbered list with nested items',
    '<ol><li><p><span style="font-size: 12px">oo</span></p><ol><li><p>ob</p></li><li><p><span style="font-size: 18px">oc</span></p></li></ol></li></ol>',
    '12px/- -/- 18px/-',
  ],
  [
    'a checklist item',
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p><span style="font-size: 12px">tt</span></p></li></ul>',
    '-/-',
  ],
  [
    'pasted from Google Docs',
    '<ul><li><p><span style="font-size: 11pt; font-family: Arial, sans-serif">Item one</span></p></li></ul>',
    '11pt/"arial", sans-serif',
  ],
  [
    'a relative run over a sized paragraph (M-1)',
    '<ul><li><p style="font-size: 20px"><span style="font-size: 150%">aa</span></p></li></ul>',
    '-/-',
  ],
  [
    'a relative run in a plain paragraph (M-1)',
    '<ul><li><p><span style="font-size: 150%">aa</span></p></li></ul>',
    '150%/-',
  ],
  [
    'an em run in a plain paragraph (M-1)',
    '<ul><li><p><span style="font-size: 1.5em">aa</span></p></li></ul>',
    '1.5em/-',
  ],
  [
    'a relative paragraph size (M-1)',
    '<ul><li><p style="font-size: 150%">aa</p></li></ul>',
    '150%/-',
  ],
  [
    '12px next to 9pt',
    '<ul><li><p><span style="font-size: 12px">aa</span> <span style="font-size: 9pt">bb</span></p></li></ul>',
    '-/-',
  ],
  [
    'a calc() size (M-1)',
    '<ul><li><p><span style="font-size: calc(1em + 2px)">aa</span></p></li></ul>',
    '-/-',
  ],
  [
    'quoted and unquoted "Comic Sans MS" (M-4)',
    '<ul><li><p style="font-family: &quot;Comic Sans MS&quot;"><span style="font-family: &quot;Comic Sans MS&quot;">aa</span> bb</p></li></ul>',
    '-/"comic sans ms"',
  ],
  [
    'a quoted "serif" next to serif (M-4)',
    `<ul><li><p><span style='font-family: "serif"'>aa</span> <span style="font-family: serif">bb</span></p></li></ul>`,
    '-/-',
  ],
  [
    '12px text and an unstyled formula (M-2)',
    '<ul><li><p><span style="font-size: 12px">aa</span> <span data-type="inlineMath" data-latex="x"></span></p></li></ul>',
    '12px/-',
  ],
  [
    'only a formula (M-2)',
    '<ul><li><p><span data-type="inlineMath" data-latex="x"></span></p></li></ul>',
    '-/-',
  ],
];

const fontLabel = (size: string | null, family: string | null) =>
  `${size || '-'}/${family || '-'}`;

/** The marker font `markerFont` reads for every list item, in document order. */
const documentFonts = (editor: Editor) => {
  const fonts: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      const { fontSize, fontFamily } = markerFont(node);
      fonts.push(fontLabel(fontSize, fontFamily));
    }
  });
  return fonts.join(' ');
};

/** Replace the textStyle of `text` — for values the HTML parser would normalize. */
const markText = (
  editor: Editor,
  text: string,
  attrs: Record<string, string>,
) =>
  editor.view.dispatch(
    editor.state.tr.addMark(
      startOf(editor, text),
      endOf(editor, text),
      editor.state.schema.marks.textStyle.create(attrs),
    ),
  );

const ITEM_12PX =
  '<ul><li><p><span style="font-size: 12px">aa</span></p></li></ul>';

/** The marker font every `<li>` under `root` carries, in document order. */
const renderedFonts = (root: ParentNode) =>
  Array.from(root.querySelectorAll('li'))
    .map((li) =>
      fontLabel(
        li.style.getPropertyValue(MARKER_FONT_SIZE_VAR),
        li.style.getPropertyValue(MARKER_FONT_FAMILY_VAR),
      ),
    )
    .join(' ');

/** What print writes: the DOM adapter over the editor's own HTML. */
const printedFonts = (editor: Editor) => {
  const root = document.createElement('div');
  root.innerHTML = editor.getHTML();
  applyMarkerFonts(root);
  return renderedFonts(root);
};

/** A real keydown, so ListToggle's Backspace (§3.8) runs as in the browser. */
const pressBackspace = (editor: Editor) =>
  editor.view.someProp('handleKeyDown', (f) =>
    f(
      editor.view,
      new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace' }),
    ),
  );

/** The first doc-changing transaction `run` dispatches. */
const firstTransaction = (editor: Editor, run: () => void) => {
  const seen: { tr?: Transaction } = {};
  const listener = ({ transaction }: { transaction: Transaction }) => {
    if (transaction.docChanged) seen.tr ??= transaction;
  };
  editor.on('transaction', listener);
  run();
  editor.off('transaction', listener);
  if (!seen.tr) throw new Error('no doc-changing transaction');
  return seen.tr;
};

describe.each([1, 2])('marker font from the document (schema v%i)', (v) => {
  it.each(CASES)('%s', (_name, html, expected) => {
    expect(documentFonts(track(makeEditor(v, html)))).toBe(expected);
  });

  it('treats 12.0px and 12px as one size (M-4)', () => {
    const editor = track(
      makeEditor(
        v,
        '<ul><li><p><span style="font-size: 12px">aa</span> <span style="font-size: 12px">bb</span></p></li></ul>',
      ),
    );
    markText(editor, 'aa', { fontSize: '12.0px' });
    expect(documentFonts(editor)).toBe('12px/-');
  });

  it('ignores a family that would end the inline declaration', () => {
    const editor = track(makeEditor(v, '<ul><li><p>aa</p></li></ul>'));
    markText(editor, 'aa', { fontFamily: 'Georgia; background: red' });
    expect(documentFonts(editor)).toBe('-/-');
  });

  it('gives the empty item Enter creates after a 12px item its stamp', () => {
    const editor = track(makeEditor(v, ITEM_12PX));
    editor.commands.setTextSelection(endOf(editor, 'aa'));
    pressEnter(editor);
    expect(documentFonts(editor)).toBe('12px/- 12px/-');
  });

  it('keeps 12px after deleting the text of a 12px item', () => {
    const editor = track(makeEditor(v, ITEM_12PX));
    nativeDelete(editor, startOf(editor, 'aa'), endOf(editor, 'aa'));
    expect(documentFonts(editor)).toBe('12px/-');
  });
});

describe.each([1, 2])('marker font in the editor (schema v%i)', (v) => {
  it.each(CASES)('renders %s', (_name, html, expected) => {
    expect(renderedFonts(track(makeEditor(v, html)).view.dom)).toBe(expected);
  });

  it('renders 12.0px next to 12px as 12px (M-4)', () => {
    const editor = track(
      makeEditor(
        v,
        '<ul><li><p><span style="font-size: 12px">aa</span> <span style="font-size: 12px">bb</span></p></li></ul>',
      ),
    );
    markText(editor, 'aa', { fontSize: '12.0px' });
    expect(renderedFonts(editor.view.dom)).toBe('12px/-');
  });

  it('follows formatting of the whole line, one word, and undo', () => {
    const editor = track(makeEditor(v, '<ul><li><p>aa bb</p></li></ul>'));
    selectText(editor, 'aa bb');
    editor.commands.setFontSize('12px');
    expect(renderedFonts(editor.view.dom)).toBe('12px/-');
    undoManager(editor).stopCapturing();
    selectText(editor, 'bb');
    editor.commands.setFontSize('24px');
    expect(renderedFonts(editor.view.dom)).toBe('-/-');
    editor.commands.undo();
    expect(renderedFonts(editor.view.dom)).toBe('12px/-');
  });

  it('keeps the marker through a retype, a toggle off and back', () => {
    const editor = track(
      makeEditor(
        v,
        '<ul><li><p><span style="font-size: 12px">aa</span></p></li><li><p>bb</p></li></ul>',
      ),
    );
    caretIn(editor, 'aa');
    editor.commands.toggleOrderedList();
    expect(renderedFonts(editor.view.dom)).toBe('12px/- -/-');
    caretIn(editor, 'aa');
    editor.commands.toggleOrderedList();
    expect(renderedFonts(editor.view.dom)).toBe('-/-');
    caretIn(editor, 'aa');
    editor.commands.toggleBulletList();
    expect(renderedFonts(editor.view.dom)).toBe('12px/- -/-');
  });

  it('gives a bullet the size when wrapping a 12px paragraph', () => {
    const editor = track(
      makeEditor(v, '<p><span style="font-size: 12px">aa</span></p>'),
    );
    caretIn(editor, 'aa');
    editor.commands.toggleBulletList();
    expect(renderedFonts(editor.view.dom)).toBe('12px/-');
  });

  it('gives the empty item Enter creates its stamped size', () => {
    const editor = track(makeEditor(v, ITEM_12PX));
    editor.commands.setTextSelection(endOf(editor, 'aa'));
    pressEnter(editor);
    expect(renderedFonts(editor.view.dom)).toBe('12px/- 12px/-');
  });

  it('keeps 12px after deleting the text of a 12px item', () => {
    const editor = track(makeEditor(v, ITEM_12PX));
    nativeDelete(editor, startOf(editor, 'aa'), endOf(editor, 'aa'));
    expect(renderedFonts(editor.view.dom)).toBe('12px/-');
  });

  it('drops the marker style with Backspace at the start of an item', () => {
    const editor = track(
      makeEditor(
        v,
        '<ul><li><p>aa</p></li><li><p><span style="font-size: 12px">bb</span></p></li><li><p><span style="font-size: 12px">cc</span></p></li></ul>',
      ),
    );
    editor.commands.setTextSelection(startOf(editor, 'bb'));
    pressBackspace(editor);
    expect(renderedFonts(editor.view.dom)).toBe('-/- 12px/-');
  });

  it('follows a collaborator formatting the item', () => {
    const ydocA = new Y.Doc();
    const ydocB = new Y.Doc();
    const a = track(
      makeEditor(v, '<ul><li><p>aa</p></li></ul>', { ydoc: ydocA }),
    );
    Y.applyUpdate(ydocB, Y.encodeStateAsUpdate(ydocA));
    const b = track(makeEditor(v, null, { ydoc: ydocB }));
    selectText(b, 'aa');
    b.commands.setFontSize('12px');
    Y.applyUpdate(
      ydocA,
      Y.encodeStateAsUpdate(ydocB, Y.encodeStateVector(ydocA)),
    );
    expect(renderedFonts(a.view.dom)).toBe('12px/-');
  });

  describe('changedBlockRanges (M-3)', () => {
    it('rebuilds a bulk-formatted list once', () => {
      const items = Array.from(
        { length: 250 },
        (_, i) => `<li><p>item${i}</p></li>`,
      ).join('');
      const editor = track(makeEditor(v, `<ul>${items}</ul>`));
      editor.commands.setTextSelection({
        from: startOf(editor, 'item0'),
        to: endOf(editor, 'item249'),
      });
      const tr = firstTransaction(editor, () =>
        editor.commands.setFontSize('12px'),
      );
      expect(
        tr.steps.filter((step) => step instanceof AddMarkStep),
      ).toHaveLength(250);
      expect(changedBlockRanges(tr)).toEqual([[0, tr.doc.child(0).nodeSize]]);
      expect(renderedFonts(editor.view.dom)).toBe(
        Array(250).fill('12px/-').join(' '),
      );
    });

    it('treats a whole-document replace as one range', () => {
      const editor = track(makeEditor(v, '<p>aa</p>'));
      const tr = firstTransaction(editor, () =>
        editor.commands.setContent('<ul><li><p>bb</p></li></ul><p>cc</p>'),
      );
      expect(changedBlockRanges(tr)).toEqual([[0, tr.doc.content.size]]);
    });

    it('keeps edits in two separate lists apart', () => {
      const editor = track(
        makeEditor(
          v,
          '<ul><li><p>aa</p></li></ul><p>mid</p><ul><li><p>bb</p></li></ul>',
        ),
      );
      const { state } = editor;
      const mark = state.schema.marks.textStyle.create({ fontSize: '12px' });
      const tr = state.tr
        .addMark(startOf(editor, 'aa'), endOf(editor, 'aa'), mark)
        .addMark(startOf(editor, 'bb'), endOf(editor, 'bb'), mark);
      const blocks: [number, number][] = [];
      tr.doc.forEach((node, offset) =>
        blocks.push([offset, offset + node.nodeSize]),
      );
      expect(changedBlockRanges(tr)).toEqual([blocks[0], blocks[2]]);
    });
  });
});

describe('marker font stylesheet', () => {
  const css = readFileSync(
    path.join(__dirname, '../../styles/index.css'),
    'utf8',
  );

  it('resets the properties on every item so nested items never inherit them', () => {
    expect(css).toMatch(
      /\.ProseMirror li \{\s*--ddoc-marker-font-size: initial;\s*--ddoc-marker-font-family: initial;\s*\}/,
    );
  });

  it('feeds them into the native marker and the nested counters', () => {
    expect(css).toMatch(
      /\.ProseMirror li::marker,\s*\.ProseMirror li > ol > li::before \{\s*font-size: var\(--ddoc-marker-font-size\);\s*font-family: var\(--ddoc-marker-font-family\);\s*\}/,
    );
  });
});

describe.each([1, 2])('marker font in print (schema v%i)', (v) => {
  it.each(CASES)('prints %s like the editor', (_name, html, expected) => {
    const editor = track(makeEditor(v, html));
    expect(printedFonts(editor)).toBe(expected);
    expect(printedFonts(editor)).toBe(renderedFonts(editor.view.dom));
  });

  it('prints 12.0px next to 12px as the editor does (M-4)', () => {
    const editor = track(
      makeEditor(
        v,
        '<ul><li><p><span style="font-size: 12px">aa</span> <span style="font-size: 12px">bb</span></p></li></ul>',
      ),
    );
    markText(editor, 'aa', { fontSize: '12.0px' });
    expect(printedFonts(editor)).toBe(renderedFonts(editor.view.dom));
  });

  it('prints an empty item with the default marker (no stamp in HTML)', () => {
    const editor = track(makeEditor(v, ITEM_12PX));
    editor.commands.setTextSelection(endOf(editor, 'aa'));
    pressEnter(editor);
    expect(renderedFonts(editor.view.dom)).toBe('12px/- 12px/-');
    expect(printedFonts(editor)).toBe('12px/- -/-');
  });

  it('keeps every text-bearing atom behind data-type, and no mark uses it (M-2)', () => {
    const { schema } = track(makeEditor(v, '')).state;
    const serializer = DOMSerializer.fromSchema(schema);
    Object.values(schema.nodes)
      .filter((type) => type.isInline && !type.isText)
      .forEach((type) => {
        const dom = serializer.serializeNode(type.createAndFill()!);
        const excluded =
          !dom.textContent ||
          (dom instanceof HTMLElement && dom.hasAttribute('data-type'));
        expect(excluded, type.name).toBe(true);
      });
    Object.values(schema.marks).forEach((type) => {
      const holder = document.createElement('div');
      holder.appendChild(
        serializer.serializeFragment(
          Fragment.from(schema.text('x', [type.create()])),
        ),
      );
      expect(holder.querySelector('[data-type]'), type.name).toBeNull();
    });
  });
});

describe('applyMarkerFonts', () => {
  const apply = (html: string) => {
    const root = document.createElement('div');
    root.innerHTML = html;
    applyMarkerFonts(root);
    return renderedFonts(root);
  };

  it("reads Chrome's normalized spellings the same way (M-4)", () => {
    expect(
      apply(
        `<ul><li><p style='font-family: "Comic Sans MS"'><span style='font-family: "Comic Sans MS"'>aa</span> bb</p></li>` +
          `<li><p style="font-family: Comic Sans MS"><span style='font-family: "Comic Sans MS"'>cc</span> dd</p></li></ul>`,
      ),
    ).toBe('-/"comic sans ms" -/"comic sans ms"');
  });

  it('skips a formula KaTeX has already rendered (M-2)', () => {
    expect(
      apply(
        '<ul><li><p><span style="font-size: 12px">aa</span> <span data-type="inlineMath"><span class="katex">x</span></span></p></li></ul>',
      ),
    ).toBe('12px/-');
  });

  it('leaves checklist items alone', () => {
    expect(
      apply(
        '<ul data-type="taskList"><li data-type="taskItem"><label><input type="checkbox"></label><div><p><span style="font-size: 12px">tt</span></p></div></li></ul>',
      ),
    ).toBe('-/-');
  });
});

describe('handleContentPrint', () => {
  it('marks the printed list items before printing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    handleContentPrint(
      '<ul><li><p><span style="font-size: 12px">aa</span></p></li></ul>',
    );
    const host = document.querySelector('.ddoc-print-host');
    expect(host && renderedFonts(host)).toBe('12px/-');
    await new Promise((resolve) => requestAnimationFrame(resolve));
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
  });
});

describe.each([1, 2])('marker font upkeep cost (schema v%i)', (v) => {
  // A rebuilt decoration gets a new type object; a mapped one keeps its own.
  const decorationTypes = (editor: Editor) =>
    markerFontPluginKey
      .getState(editor.state)!
      .find()
      .map((d) => (d as unknown as { type: object }).type);

  it('keeps the decorations of unchanged markers while typing', () => {
    const editor = track(
      makeEditor(
        v,
        '<ul><li><p><span style="font-size: 12px">aa</span></p></li><li><p><span style="font-size: 12px">bb</span></p></li></ul>',
      ),
    );
    const before = decorationTypes(editor);
    editor.commands.setTextSelection(endOf(editor, 'aa'));
    type(editor, 'x');
    const after = decorationTypes(editor);
    expect(renderedFonts(editor.view.dom)).toBe('12px/- 12px/-');
    expect(after).toHaveLength(2);
    after.forEach((each, i) => expect(each).toBe(before[i]));
  });
});
