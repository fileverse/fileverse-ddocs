import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { Extension, type AnyExtension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Transform } from '@tiptap/pm/transform';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { insertCommands } from '../../utils/insert-commands';
import { SuggestionTrackingExtension } from '../suggestion/suggestion-tracking-extension';
import { CaretMarks, caretMarksPluginKey } from './caret-marks';
import {
  makeEditor,
  track,
  destroyTracked,
  applyRemote,
  endOf,
  startOf,
  backspace,
  caretTo,
  caretBlock,
  createdBlock,
  textblocks,
  stampBlock,
  stampOf,
  storedMarkNames,
  typedMarks,
  typedRun,
  typedTextStyle,
  selectText,
  pressEnter,
  type,
} from './test-helpers';

afterEach(destroyTracked);

describe.each([1, 2])('Rule A1 — explicit stamp (schema v%i)', (version) => {
  it('stamps an empty line the user formats, and typing gets the marks', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('stamps "[]" when the user clears the pending marks on an empty line', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('fills the legacy font into an explicit stamp and nulls the legacy attrs', () => {
    const editor = track(
      makeEditor(version, '<p style="font-size: 32px"></p>'),
    );
    editor.commands.toggleBold();
    const { node } = caretBlock(editor);
    expect(node.attrs.fontSize).toBeNull();
    const stamp = JSON.parse(stampOf(node)!);
    expect(stamp).toHaveLength(2);
    expect(stamp).toEqual(
      expect.arrayContaining([
        { type: 'bold' },
        {
          type: 'textStyle',
          attrs: expect.objectContaining({ fontSize: '32px' }),
        },
      ]),
    );
    const typed = typedRun(editor);
    expect(typed.names).toEqual(['bold', 'textStyle']);
    expect(typed.textStyle?.fontSize).toBe('32px');
  });

  it('never stamps a non-empty block', () => {
    const editor = track(makeEditor(version, '<p>abc</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBeNull();
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('leaves an empty block that has no caretMarks attr alone (code block)', () => {
    const editor = track(makeEditor(version, '<pre><code></code></pre>'));
    caretTo(editor, textblocks(editor)[0].pos + 1);
    editor.commands.toggleBold();
    // A raw declaration too: toggleBold cannot set a mark a code block
    // forbids, and without the `caretMarks in attrs` guard the stamp could
    // never match the attr it wrote — an append loop that never settles.
    editor.view.dispatch(
      editor.state.tr.setStoredMarks([editor.schema.marks.bold.create()]),
    );
    const { node } = caretBlock(editor);
    expect(node.type.name).toBe('codeBlock');
    expect('caretMarks' in node.attrs).toBe(false);
    expect(typedMarks(editor)).toEqual([]);
  });
});

describe.each([1, 2])('Rule B — restore on entry (schema v%i)', (version) => {
  it('restores a stamp when the caret enters the empty line', () => {
    const editor = track(makeEditor(version, '<p></p><p>abc</p>'));
    // setContent leaves the caret at the end of the document.
    caretTo(editor, textblocks(editor)[0].pos + 1);
    editor.commands.toggleBold();
    caretTo(editor, endOf(editor, 'abc'));
    expect(storedMarkNames(editor)).toBeNull();
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('keeps "[]" cleared even next to bold text', () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    const empty = textblocks(editor)[1];
    stampBlock(editor, empty.pos, '[]');
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it('falls back to the legacy font attrs of a never-stamped line, without a doc write', () => {
    const editor = track(
      makeEditor(version, '<p>abc</p><p style="font-family: Georgia"></p>'),
    );
    caretTo(editor, endOf(editor, 'abc'));
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(typedTextStyle(editor)?.fontFamily).toBe('Georgia');
  });

  it("falls back to the previous block's end marks for a never-stamped, attr-less line", () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(stampOf(caretBlock(editor).node)).toBeNull();
  });
});

const REPAIRED = 'repaired';

const headingPos = (doc: ProseMirrorNode) => {
  let found = -1;
  doc.descendants((node, pos) => {
    if (found === -1 && node.type.name === 'heading') found = pos;
    return found === -1;
  });
  return found;
};

const pluginIndex = (editor: Editor, keyPrefix: string) =>
  editor.state.plugins.findIndex((plugin) =>
    String((plugin as unknown as { key: string }).key).startsWith(keyPrefix),
  );

/**
 * A second plugin that appends an attribute repair once, as soon as it sees a
 * transaction CaretMarks has tagged — in the same dispatch, right after B.
 */
const headingRepair = (priority: number) =>
  Extension.create({
    name: 'caretMarksTestRepair',
    priority,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('caretMarksTestRepair'),
          appendTransaction: (transactions, _oldState, newState) => {
            if (!transactions.some((tr) => tr.getMeta(caretMarksPluginKey))) {
              return null;
            }
            const pos = headingPos(newState.doc);
            const heading = pos === -1 ? null : newState.doc.nodeAt(pos);
            if (!heading || heading.attrs.id === REPAIRED) return null;
            return newState.tr.setNodeMarkup(pos, undefined, {
              ...heading.attrs,
              id: REPAIRED,
            });
          },
        }),
      ];
    },
  });

describe.each([1, 2])('restore provenance (schema v%i)', (version) => {
  it.each([
    ['the repair registered before CaretMarks', 1001],
    ['the repair registered after CaretMarks', 1],
  ])(
    'a repair appended after Rule B is never read back as an A1 stamp — %s',
    (_label, priority) => {
      // The empty line carries a legacy font the stamp does not: a restore
      // read back as explicit would stamp [bold, textStyle] over [bold] and
      // write to the document, which the doc comparison below catches.
      const editor = track(
        makeEditor(
          version,
          '<h2>t</h2><p style="font-size: 32px"></p><p>z</p>',
          { extensions: [headingRepair(priority)] },
        ),
      );
      expect(
        pluginIndex(editor, 'caretMarksTestRepair') <
          pluginIndex(editor, 'caretMarks$'),
      ).toBe(priority > 100);
      // Off the empty line first: entering it is the dispatch under test, and
      // a restore anywhere before it would fire the repair early.
      caretTo(editor, endOf(editor, 'z'));
      stampBlock(editor, textblocks(editor)[1].pos, '[{"type":"bold"}]');
      const before = editor.state.doc;
      const at = headingPos(before);
      expect(before.nodeAt(at)!.attrs.id).not.toBe(REPAIRED);

      caretTo(editor, textblocks(editor)[1].pos + 1);

      const repaired = new Transform(before).setNodeMarkup(at, undefined, {
        ...before.nodeAt(at)!.attrs,
        id: REPAIRED,
      }).doc;
      // Exactly the repair's change: CaretMarks added no document write.
      expect(editor.state.doc.eq(repaired)).toBe(true);
      expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
      expect(storedMarkNames(editor)).toEqual(['bold']);
      expect(typedMarks(editor)).toEqual(['bold']);
    },
  );
});

describe('Rule C — pending marks survive appended steps (schema v2)', () => {
  const orders: [string, (extensions: AnyExtension[]) => AnyExtension[]][] = [
    ['production order', (extensions) => extensions],
    [
      'CaretMarks registered after BlockId',
      (extensions) => [
        ...extensions.filter((e) => e.name !== 'caretMarks'),
        CaretMarks,
      ],
    ],
  ];

  it.each(orders)(
    're-sets marks that blockIdAssign$ wiped (%s)',
    (_label, reorder) => {
      const custom = track(
        new Editor({
          element: document.body.appendChild(document.createElement('div')),
          extensions: reorder(
            getHeadlessExtensions({ schemaVersion: 2 }) as AnyExtension[],
          ),
          textDirection: 'auto',
        }),
      );
      custom.commands.setContent('<p><strong>A</strong>B</p>');
      caretTo(custom, endOf(custom, 'A'));
      // A raw split followed by a declaration: blockIdAssign$ appends a
      // setNodeMarkup for the new block, which nulls storedMarks.
      const tr = custom.state.tr.split(custom.state.selection.from);
      tr.setStoredMarks([custom.schema.marks.bold.create()]);
      custom.view.dispatch(tr);
      expect(createdBlock(custom).node.attrs.blockId).toBeTruthy();
      expect(storedMarkNames(custom)).toEqual(['bold']);
      expect(typedMarks(custom)).toEqual(['bold']);
      expect(createdBlock(custom).node.textContent).toBe('xB');
    },
  );
});

describe('Rule C — a spacing repair wipes the marks (schema v1)', () => {
  it('keeps bold pending across paragraphSpacingHeadingBoundary', () => {
    // The heading sits in a blockquote so core Enter runs: v1's own handler
    // builds its paragraph without spaceBefore, which that plugin never sees.
    const editor = track(
      makeEditor(
        1,
        '<blockquote><h2 style="margin-top: 24pt">t</h2></blockquote>',
      ),
    );
    caretTo(editor, endOf(editor, 't'));
    editor.commands.toggleBold();
    expect(pressEnter(editor)).toBe(true);
    const created = createdBlock(editor);
    expect(created.node.type.name).toBe('paragraph');
    expect(created.node.attrs.spaceBefore).toBeNull();
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });
});

describe('declared inheritance — splitBlock override (schema v2)', () => {
  it('carries bold at the end of a line: stamp, stored marks, typed text', () => {
    const editor = track(makeEditor(2, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    let root: { storedMarksSet: boolean } | null = null;
    editor.on('transaction', ({ transaction }) => {
      root = root ?? transaction;
    });
    expect(editor.commands.splitBlock()).toBe(true);
    expect(root!.storedMarksSet).toBe(true);
    expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('declares an empty style: bold turned off before Enter stays off, stamped "[]"', () => {
    const editor = track(makeEditor(2, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    let root: { storedMarksSet: boolean } | null = null;
    editor.on('transaction', ({ transaction }) => {
      root = root ?? transaction;
    });
    editor.commands.splitBlock();
    expect(root!.storedMarksSet).toBe(true);
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('keeps the pending style in front of the right half on a mid-text split', () => {
    const editor = track(makeEditor(2, '<p><strong>A</strong>B</p>'));
    caretTo(editor, endOf(editor, 'A'));
    editor.commands.splitBlock();
    expect(createdBlock(editor).node.attrs.blockId).toBeTruthy();
    expect(typedMarks(editor)).toEqual(['bold']);
    expect(createdBlock(editor).node.textContent).toBe('xB');
    const b = editor.state.doc.nodeAt(endOf(editor, 'B') - 1);
    expect(b?.marks).toEqual([]);
  });

  it('carries a style set mid-word with nothing selected', () => {
    const editor = track(makeEditor(2, '<p>abc</p>'));
    caretTo(editor, endOf(editor, 'ab'));
    editor.commands.toggleBold();
    editor.commands.splitBlock();
    expect(typedMarks(editor)).toEqual(['bold']);
    expect(editor.state.doc.nodeAt(endOf(editor, 'c') - 1)?.marks).toEqual([]);
  });

  it('carries a legacy font as marks and leaves no attr on the new block', () => {
    const editor = track(makeEditor(2, '<p style="font-size: 32px">abc</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock();
    const created = createdBlock(editor).node;
    expect(created.attrs.fontSize).toBeNull();
    expect(JSON.parse(stampOf(created)!)).toEqual([
      {
        type: 'textStyle',
        attrs: expect.objectContaining({ fontSize: '32px' }),
      },
    ]);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('middle split of a legacy-font paragraph keeps the attr on both halves (documented limitation)', () => {
    const editor = track(
      makeEditor(2, '<p style="font-size: 32px">abcdef</p>'),
    );
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock();
    const [left, right] = textblocks(editor);
    expect(left.node.attrs.fontSize).toBe('32px');
    expect(right.node.attrs.fontSize).toBe('32px');
    expect(right.node.textContent).toBe('def');
  });

  it("drops link from the declaration but leaves the original line's link stamp alone", () => {
    const editor = track(makeEditor(2, '<p></p>'));
    editor.commands.setLink({ href: 'https://x.y' });
    expect(stampOf(caretBlock(editor).node)).toContain('"type":"link"');
    editor.commands.splitBlock();
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(stampOf(caretBlock(editor).node)).toContain('"type":"link"');
    expect(typedMarks(editor)).toEqual(['link']);
  });

  it('keeps inline code active on an empty line', () => {
    const editor = track(makeEditor(2, '<p></p>'));
    editor.commands.toggleCode();
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"code"}]');
    expect(typedMarks(editor)).toEqual(['code']);
  });

  it('passes keepMarks:false through without a declaration', () => {
    const editor = track(makeEditor(2, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.splitBlock({ keepMarks: false });
    expect(stampOf(createdBlock(editor).node)).toBeNull();
  });
});

describe.each([
  [
    'stale non-null stamp on plain text',
    '<p>abc</p>',
    '[{"type":"bold"}]',
    false,
    '[]',
    [],
  ],
  [
    'unstamped bold text',
    '<p><strong>abc</strong></p>',
    null,
    false,
    '[{"type":"bold"}]',
    ['bold'],
  ],
  [
    'plain text stamped "[]" with bold pending',
    '<p>abc</p>',
    '[]',
    true,
    '[{"type":"bold"}]',
    ['bold'],
  ],
])(
  'splitBlock at offset 0 — %s (schema v2)',
  (_label, content, stamp, pendingBold, expectedStamp, expectedMarks) => {
    it('stamps the emptied left half with the captured style; the right half keeps its text', () => {
      const editor = track(makeEditor(2, content));
      if (stamp) stampBlock(editor, 0, stamp);
      caretTo(editor, startOf(editor, 'abc'));
      if (pendingBold) editor.commands.toggleBold();
      editor.commands.splitBlock();
      const [left, right] = textblocks(editor);
      expect(left.node.content.size).toBe(0);
      expect(stampOf(left.node)).toBe(expectedStamp);
      expect(right.node.textContent).toBe('abc');
      expect(editor.state.selection.from).toBe(right.pos + 1);
      // The right-hand caret keeps the pending style in front of the text.
      expect(typedMarks(editor)).toEqual(expectedMarks);
      // Return to the empty line above: the stamp is what typing gets.
      caretTo(editor, left.pos + 1);
      expect(typedMarks(editor)).toEqual(expectedMarks);
    });
  },
);

describe.each([1, 2])('Rule A3 — emptied in place (schema v%i)', (version) => {
  const boldStampedPlainChar = (editor: ReturnType<typeof makeEditor>) => {
    // A line stamped bold whose only character is plain.
    stampBlock(editor, textblocks(editor)[0].pos, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'a'));
  };

  it('backspacing the last plain character of a bold-stamped line leaves it plain, persistently', () => {
    const editor = track(makeEditor(version, '<p>a</p><p>zzz</p>'));
    boldStampedPlainChar(editor);
    backspace(editor);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
    backspace(editor);
    caretTo(editor, endOf(editor, 'zzz'));
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it("uses the deleted text's marks, not the pending style of the moment", () => {
    const editor = track(makeEditor(version, '<p>a</p>'));
    boldStampedPlainChar(editor);
    editor.commands.toggleBold();
    editor.commands.setColor('#ff0000');
    editor.commands.setFontSize('24px');
    backspace(editor);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('backspacing the last bold character stamps bold (the native path sets stored marks)', () => {
    const editor = track(makeEditor(version, '<p><strong>a</strong></p>'));
    caretTo(editor, endOf(editor, 'a'));
    backspace(editor);
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('detects the deletion when an earlier step in the same root edited another paragraph', () => {
    const editor = track(makeEditor(version, '<p>one</p><p>a</p>'));
    stampBlock(editor, textblocks(editor)[1].pos, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'a'));
    const end = endOf(editor, 'a');
    const tr = editor.state.tr.insertText('ZZ', endOf(editor, 'one'));
    tr.delete(tr.mapping.map(end - 1), tr.mapping.map(end));
    editor.view.dispatch(tr);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it("survives a block inserted at the old caret block's opening in the same root", () => {
    const editor = track(makeEditor(version, '<p>one</p><p>a</p>'));
    const { pos } = textblocks(editor)[1];
    stampBlock(editor, pos, '[{"type":"bold"}]');
    caretTo(editor, endOf(editor, 'a'));
    const end = endOf(editor, 'a');
    const inserted =
      version === 1
        ? editor.schema.nodes.dBlock.create(
            null,
            editor.schema.nodes.paragraph.create(),
          )
        : editor.schema.nodes.paragraph.create();
    const at = version === 1 ? editor.state.selection.$from.before(1) : pos;
    const tr = editor.state.tr.insert(at, inserted);
    tr.delete(tr.mapping.map(end - 1), tr.mapping.map(end));
    editor.view.dispatch(tr);
    expect(caretBlock(editor).node.content.size).toBe(0);
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('writes nothing when the caret lands in a different, pre-existing block', () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    caretTo(editor, endOf(editor, 'abc'));
    const { pos, node } = caretBlock(editor);
    const from = version === 1 ? editor.state.selection.$from.before(1) : pos;
    const to = from + (version === 1 ? node.nodeSize + 2 : node.nodeSize);
    editor.view.dispatch(editor.state.tr.delete(from, to));
    expect(caretBlock(editor).node.content.size).toBe(0);
    expect(stampOf(caretBlock(editor).node)).toBeNull();
  });
});

describe.each([1, 2])(
  'declared inheritance — splitListItem override (schema v%i)',
  (version) => {
    it('carries bold into the next bullet', () => {
      const editor = track(
        makeEditor(version, '<ul><li><p><strong>abc</strong></p></li></ul>'),
      );
      caretTo(editor, endOf(editor, 'abc'));
      expect(editor.commands.splitListItem('listItem')).toBe(true);
      expect(stampOf(createdBlock(editor).node)).toBe('[{"type":"bold"}]');
      expect(typedMarks(editor)).toEqual(['bold']);
    });

    it('carries a legacy font out of a list paragraph as marks', () => {
      const editor = track(
        makeEditor(
          version,
          '<ul><li><p style="font-size: 32px">abc</p></li></ul>',
        ),
      );
      caretTo(editor, endOf(editor, 'abc'));
      editor.commands.splitListItem('listItem');
      const created = createdBlock(editor).node;
      expect(created.attrs.fontSize).toBeNull();
      expect(typedTextStyle(editor)?.fontSize).toBe('32px');
    });

    it('stamps the emptied left item on an offset-0 split across the </li><li> boundary', () => {
      const editor = track(
        makeEditor(version, '<ul><li><p><strong>abc</strong></p></li></ul>'),
      );
      caretTo(editor, startOf(editor, 'abc'));
      editor.commands.splitListItem('listItem');
      const [left, right] = textblocks(editor);
      expect(left.node.content.size).toBe(0);
      expect(stampOf(left.node)).toBe('[{"type":"bold"}]');
      expect(right.node.textContent).toBe('abc');
      expect(typedMarks(editor)).toEqual(['bold']);
    });

    it('middle split of a legacy-font list paragraph keeps the attr on both halves', () => {
      const editor = track(
        makeEditor(
          version,
          '<ul><li><p style="font-size: 32px">abcdef</p></li></ul>',
        ),
      );
      caretTo(editor, endOf(editor, 'abc'));
      editor.commands.splitListItem('listItem');
      const [left, right] = textblocks(editor);
      expect(left.node.attrs.fontSize).toBe('32px');
      expect(right.node.attrs.fontSize).toBe('32px');
    });
  },
);

describe.each([1, 2])('legacy fonts (schema v%i)', (version) => {
  it('setFontSize on an empty line writes a stamp, not a paragraph attr', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.setFontSize('24px');
    const { node } = caretBlock(editor);
    expect(node.attrs.fontSize).toBeNull();
    expect(JSON.parse(stampOf(node)!)).toEqual([
      {
        type: 'textStyle',
        attrs: expect.objectContaining({ fontSize: '24px' }),
      },
    ]);
    expect(typedTextStyle(editor)?.fontSize).toBe('24px');
  });

  it('the stale-mirror case: X on empty, type, select, change to Y, Enter, type → Y', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.setFontSize('24px');
    type(editor, 'abc');
    selectText(editor, 'abc');
    editor.commands.setFontSize('32px');
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('resets family and size independently on an empty legacy line', () => {
    const family = track(
      makeEditor(
        version,
        '<p style="font-family: Georgia; font-size: 32px"></p>',
      ),
    );
    family.commands.unsetFontFamily();
    expect(caretBlock(family).node.attrs.fontFamily).toBeNull();
    const familyStyle = typedTextStyle(family);
    expect(familyStyle?.fontFamily ?? null).toBeNull();
    expect(familyStyle?.fontSize).toBe('32px');

    const size = track(
      makeEditor(
        version,
        '<p style="font-family: Georgia; font-size: 32px"></p>',
      ),
    );
    size.commands.toggleBold();
    size.commands.unsetFontSize();
    const typed = typedRun(size);
    expect(typed.textStyle?.fontSize ?? null).toBeNull();
    expect(typed.textStyle?.fontFamily).toBe('Georgia');
    expect(typed.names).toEqual(['bold', 'textStyle']);
  });

  it('keeps a pending mark across unsetFontFamily on an empty legacy line', () => {
    const editor = track(
      makeEditor(
        version,
        '<p style="font-family: Georgia; font-size: 32px"></p>',
      ),
    );
    editor.commands.toggleBold();
    editor.commands.unsetFontFamily();
    const typed = typedRun(editor);
    expect(typed.textStyle?.fontFamily ?? null).toBeNull();
    expect(typed.textStyle?.fontSize).toBe('32px');
    expect(typed.names).toEqual(['bold', 'textStyle']);
  });

  it('bold on an empty legacy 32px line types bold 32px', () => {
    const editor = track(
      makeEditor(version, '<p style="font-size: 32px"></p>'),
    );
    editor.commands.toggleBold();
    const typed = typedRun(editor);
    expect(typed.names).toEqual(['bold', 'textStyle']);
    expect(typed.textStyle?.fontSize).toBe('32px');
  });
});

describe('trailing node (schema v1)', () => {
  it('copies no font attrs off the legacy paragraph it follows', () => {
    // Nested in a blockquote: the removed writer walked the last dBlock's
    // descendants, so it would have copied this paragraph's font onto the
    // trailing node (a trailing <hr> block gave it nothing to find).
    const editor = track(
      makeEditor(
        1,
        '<blockquote><p style="font-family: Georgia">abc</p></blockquote>',
      ),
    );
    const trailing = textblocks(editor).at(-1)!;
    expect(trailing.node.attrs.class).toBe('trailing-node');
    expect(trailing.node.attrs.fontFamily).toBeNull();
    expect(trailing.node.attrs.fontSize).toBeNull();
    caretTo(editor, trailing.pos + 1);
    expect(storedMarkNames(editor)).toBeNull();
  });
});

describe.each([1, 2])('callout insert (schema v%i)', (version) => {
  it("declares the caret style on the callout's paragraph, replacing a fresh doc's only line", () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.toggleBold();
    insertCommands.callout(editor);
    const { node } = caretBlock(editor);
    expect(editor.state.selection.$from.node(-1).type.name).toBe('callout');
    expect(stampOf(node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('declares an empty style too, stamping the callout paragraph "[]"', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    insertCommands.callout(editor);
    expect(editor.state.selection.$from.node(-1).type.name).toBe('callout');
    expect(stampOf(caretBlock(editor).node)).toBe('[]');
    expect(typedMarks(editor)).toEqual([]);
  });

  it('declares it with a second paragraph present, and after leaving and re-entering', () => {
    const editor = track(makeEditor(version, '<p></p><p>zzz</p>'));
    caretTo(editor, 1 + (version === 1 ? 1 : 0));
    editor.commands.setColor('#ff0000');
    insertCommands.callout(editor);
    const inside = caretBlock(editor).pos + 1;
    caretTo(editor, endOf(editor, 'zzz'));
    caretTo(editor, inside);
    expect(typedTextStyle(editor)?.color).toBe('#ff0000');
  });
});

describe.each([1, 2])('Enter through the keymap (schema v%i)', (version) => {
  it('carries every inline format at the end of a line, across a second Enter, and after leaving and returning', () => {
    const editor = track(makeEditor(version, '<p>abc</p>'));
    selectText(editor, 'abc');
    editor.commands.setFontFamily('Georgia');
    editor.commands.setFontSize('24px');
    editor.commands.setColor('#ff0000');
    editor.commands.setHighlight({ color: '#ffff00' });
    editor.commands.toggleBold();
    editor.commands.toggleItalic();
    editor.commands.toggleUnderline();
    editor.commands.toggleStrike();
    caretTo(editor, endOf(editor, 'abc'));
    expect(pressEnter(editor)).toBe(true);
    expect(textblocks(editor).length).toBe(2);
    const expected = [
      'bold',
      'highlight',
      'italic',
      'strike',
      'textStyle',
      'underline',
    ];
    expect(storedMarkNames(editor)).toEqual(expected);
    expect(pressEnter(editor)).toBe(true);
    expect(textblocks(editor).length).toBe(3);
    const third = textblocks(editor)[2];
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, third.pos + 1);
    const typed = typedRun(editor);
    expect(typed.names).toEqual(expected);
    expect(typed.textStyle).toMatchObject({
      fontFamily: 'Georgia',
      fontSize: '24px',
      color: '#ff0000',
    });
  });

  it('keeps bold pending in front of plain text on a mid-text Enter', () => {
    const editor = track(makeEditor(version, '<p><strong>A</strong>B</p>'));
    caretTo(editor, endOf(editor, 'A'));
    pressEnter(editor);
    expect(typedMarks(editor)).toEqual(['bold']);
    expect(createdBlock(editor).node.textContent).toBe('xB');
    expect(editor.state.doc.nodeAt(endOf(editor, 'B') - 1)?.marks).toEqual([]);
  });

  it('an empty style declared at Enter stays plain, also after the neighbour is made bold', () => {
    const editor = track(makeEditor(version, '<p><strong>abc</strong></p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    pressEnter(editor);
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    const created = createdBlock(editor).pos;
    selectText(editor, 'abc');
    editor.commands.unsetAllMarks();
    editor.commands.toggleBold();
    caretTo(editor, created + 1);
    expect(typedMarks(editor)).toEqual([]);
  });

  it.each([
    [
      'stale non-null stamp on plain text',
      '<p>abc</p>',
      '[{"type":"bold"}]',
      false,
      '[]',
      [],
    ],
    [
      'unstamped bold text',
      '<p><strong>abc</strong></p>',
      null,
      false,
      '[{"type":"bold"}]',
      ['bold'],
    ],
    [
      'plain text stamped "[]" with bold pending',
      '<p>abc</p>',
      '[]',
      true,
      '[{"type":"bold"}]',
      ['bold'],
    ],
  ])(
    'Enter at offset 0 — %s',
    (_label, content, stamp, pendingBold, expectedStamp, expectedMarks) => {
      const editor = track(makeEditor(version, content as string));
      if (stamp) stampBlock(editor, textblocks(editor)[0].pos, stamp as string);
      caretTo(editor, startOf(editor, 'abc'));
      if (pendingBold) editor.commands.toggleBold();
      pressEnter(editor);
      const [left, right] = textblocks(editor);
      expect(left.node.content.size).toBe(0);
      expect(stampOf(left.node)).toBe(expectedStamp);
      expect(right.node.textContent).toBe('abc');
      expect(editor.state.selection.from).toBe(right.pos + 1);
      expect(typedMarks(editor)).toEqual(expectedMarks);
      caretTo(editor, textblocks(editor)[0].pos + 1);
      expect(typedMarks(editor)).toEqual(expectedMarks);
    },
  );

  it('Enter at offset 0 of a heading with bold pending: the emptied left half is stamped and the text moves on', () => {
    const editor = track(makeEditor(version, '<h2>abc</h2>'));
    caretTo(editor, startOf(editor, 'abc'));
    editor.commands.toggleBold();
    pressEnter(editor);
    const [left, right] = textblocks(editor);
    expect(left.node.content.size).toBe(0);
    expect(stampOf(left.node)).toBe('[{"type":"bold"}]');
    expect(right.node.textContent).toBe('abc');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('Enter from an empty line stamped with a link: original keeps the link, new line is unlinked', () => {
    const editor = track(makeEditor(version, '<p></p>'));
    editor.commands.setLink({ href: 'https://x.y' });
    pressEnter(editor);
    expect(stampOf(createdBlock(editor).node)).toBe('[]');
    expect(stampOf(textblocks(editor)[0].node)).toContain('"type":"link"');
    expect(typedMarks(editor)).toEqual([]);
    caretTo(editor, textblocks(editor)[0].pos + 1);
    expect(typedMarks(editor)).toEqual(['link']);
  });

  it('Enter at the end of a heading gives a paragraph that carries the marks', () => {
    const editor = track(makeEditor(version, '<h2><em>t</em></h2>'));
    caretTo(editor, endOf(editor, 't'));
    pressEnter(editor);
    expect(createdBlock(editor).node.type.name).toBe('paragraph');
    expect(typedMarks(editor)).toEqual(['italic']);
  });

  it('Enter in a bullet carries marks into the next item', () => {
    const editor = track(
      makeEditor(version, '<ul><li><p><strong>abc</strong></p></li></ul>'),
    );
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    expect(createdBlock(editor).node.type.name).toBe('paragraph');
    expect(editor.state.selection.$from.node(-1).type.name).toBe('listItem');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('Enter at the end of an old-doc paragraph whose 32px is only an attr yields marks and no attr', () => {
    const editor = track(
      makeEditor(version, '<p style="font-size: 32px">abc</p>'),
    );
    caretTo(editor, endOf(editor, 'abc'));
    pressEnter(editor);
    expect(createdBlock(editor).node.attrs.fontSize).toBeNull();
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  // Both schemas re-type the left half of a heading split at offset 0 to the
  // default paragraph (Tiptap's `setNodeMarkup(pos, deflt)`, which takes the
  // default attrs); only v1, which rebuilds the block, restores the line's own.
  const offsetZeroAttrs: [
    string,
    string,
    Record<string, unknown>,
    Record<string, unknown>,
  ][] = [
    [
      'a paragraph',
      '<p style="line-height: 240%; margin-top: 12pt; margin-bottom: 8pt">abc</p>',
      { lineHeight: '240%', spaceBefore: 12, spaceAfter: 8 },
      { lineHeight: '240%', spaceBefore: 12, spaceAfter: 8 },
    ],
    [
      'a heading',
      '<h2 style="line-height: 240%; margin-top: 24pt; margin-bottom: 6pt">abc</h2>',
      { lineHeight: '240%', spaceBefore: 24, spaceAfter: 6 },
      version === 1
        ? { lineHeight: '240%', spaceBefore: 24, spaceAfter: 6 }
        : { spaceBefore: null, spaceAfter: null },
    ],
  ];

  it.each(offsetZeroAttrs)(
    'Enter at offset 0 of %s keeps the block attrs',
    (_kind, content, rightAttrs, leftAttrs) => {
      const editor = track(makeEditor(version, content));
      caretTo(editor, startOf(editor, 'abc'));
      pressEnter(editor);
      const [left, right] = textblocks(editor);
      expect(left.node.content.size).toBe(0);
      expect(right.node.textContent).toBe('abc');
      expect(right.node.attrs).toMatchObject(rightAttrs);
      expect(left.node.attrs).toMatchObject(leftAttrs);
    },
  );

  it('Enter on an empty last nested item carries its style one level out', () => {
    // v2 takes splitListItem's nested-empty-last-item branch, which builds a
    // NEW paragraph the declaration stamps; v1 lifts the block it already has.
    const editor = track(
      makeEditor(
        version,
        '<ul><li><p>outer</p><ul><li><p><strong>inner</strong></p></li></ul></li></ul>',
      ),
    );
    caretTo(editor, endOf(editor, 'inner'));
    expect(pressEnter(editor)).toBe(true);
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(pressEnter(editor)).toBe(true);
    const { $from } = editor.state.selection;
    expect($from.node(-1).type.name).toBe('listItem');
    expect($from.depth).toBe(version === 1 ? 4 : 3);
    expect(stampOf(caretBlock(editor).node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });
});

describe('Enter on an empty list item (schema v1)', () => {
  it('lifts a nested item one level, moving its block and stamp rather than creating one', () => {
    const editor = track(
      makeEditor(
        1,
        '<ul><li><p>outer</p><ul><li><p>inner</p></li></ul></li></ul>',
      ),
    );
    caretTo(editor, endOf(editor, 'inner'));
    pressEnter(editor);
    const stamp = stampOf(caretBlock(editor).node);
    const blocks = textblocks(editor).length;

    expect(pressEnter(editor)).toBe(true);
    expect(textblocks(editor).length).toBe(blocks);
    const { $from } = editor.state.selection;
    expect($from.node(-1).type.name).toBe('listItem');
    expect($from.node(-2).type.name).toBe('bulletList');
    expect($from.node(-3).type.name).toBe('dBlock');
    expect(stampOf(caretBlock(editor).node)).toBe(stamp);
  });

  it('deletes an empty non-last top-level item and moves the caret to the next one', () => {
    const editor = track(
      makeEditor(1, '<ul><li><p>one</p></li><li><p>two</p></li></ul>'),
    );
    caretTo(editor, endOf(editor, 'one'));
    expect(pressEnter(editor)).toBe(true);
    expect(textblocks(editor)[1].node.content.size).toBe(0);

    expect(pressEnter(editor)).toBe(true);
    expect(textblocks(editor).map(({ node }) => node.textContent)).toEqual([
      'one',
      'two',
      '',
    ]);
    expect(caretBlock(editor).node.textContent).toBe('two');
    expect(editor.state.selection.$from.node(-1).type.name).toBe('listItem');
  });
});

describe.each([1, 2])(
  'loads and replacement never stamp (schema v%i)',
  (version) => {
    it('keeps a loaded "[]" stamp although a style was pending, and restores nothing stale', () => {
      const editor = track(makeEditor(version, '<p></p>'));
      editor.commands.toggleBold();
      const stamped = track(makeEditor(version, '<p></p>'));
      stampBlock(stamped, caretBlock(stamped).pos, '[]');
      const json = stamped.getJSON();
      editor.commands.setContent(json);
      expect(editor.getJSON()).toEqual(json);
      caretTo(editor, textblocks(editor)[0].pos + 1);
      expect(typedMarks(editor)).toEqual([]);
    });

    it('keeps a loaded non-empty stamp untouched, through the headless path too', () => {
      const editor = track(makeEditor(version, '<p></p>'));
      editor.commands.setColor('#ff0000');
      const stamped = track(makeEditor(version, '<p></p>'));
      stampBlock(stamped, caretBlock(stamped).pos, '[{"type":"bold"}]');
      const json = stamped.getJSON();
      editor.commands.setContent(json);
      expect(editor.getJSON()).toEqual(json);
      expect(typedMarks(editor)).toEqual(['bold']);
    });

    it('y-sync and addToHistory:false roots never stamp, even with a style pending', () => {
      const editor = track(makeEditor(version, '<p>abc</p><p></p>'));
      const empty = textblocks(editor)[1];
      caretTo(editor, empty.pos + 1);
      editor.commands.toggleBold();
      stampBlock(editor, empty.pos, '[]');
      applyRemote(editor, (tr) =>
        tr
          .insertText('Z', endOf(editor, 'abc'))
          .setStoredMarks([editor.schema.marks.italic.create()]),
      );
      expect(stampOf(textblocks(editor)[1].node)).toBe('[]');
      editor.view.dispatch(
        editor.state.tr
          .insertText('Y', endOf(editor, 'abc'))
          .setStoredMarks([editor.schema.marks.italic.create()])
          .setMeta('addToHistory', false),
      );
      expect(stampOf(textblocks(editor)[1].node)).toBe('[]');
    });

    it('suggest mode drops the stamp but marks still carry within the session', () => {
      const editor = track(
        makeEditor(version, '<p></p>', {
          extensions: [
            SuggestionTrackingExtension.configure({
              getIsSuggestionMode: () => true,
            }),
          ],
        }),
      );
      editor.commands.toggleBold();
      expect(stampOf(caretBlock(editor).node)).toBeNull();
      expect(storedMarkNames(editor)).toEqual(['bold']);
    });
  },
);

describe.each([1, 2])('navigation and survival (schema v%i)', (version) => {
  it('clicking or arrowing into an unstamped blank line writes nothing', () => {
    const editor = track(
      makeEditor(
        version,
        '<p><strong>abc</strong></p><p></p><p style="font-size: 24px"></p>',
      ),
    );
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    caretTo(editor, textblocks(editor)[2].pos + 1);
    caretTo(editor, endOf(editor, 'abc'));
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it('a bare focus() on a restored blank line re-affirms instead of declaring', () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    const before = editor.state.doc;
    editor.commands.focus();
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(storedMarkNames(editor)).toEqual(['bold']);
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('a bare focus() on an empty legacy line leaves the attr alone', () => {
    const editor = track(
      makeEditor(version, '<p>abc</p><p style="font-size: 32px"></p>'),
    );
    caretTo(editor, textblocks(editor)[1].pos + 1);
    const before = editor.state.doc;
    editor.commands.focus();
    expect(editor.state.doc.eq(before)).toBe(true);
    const { node } = caretBlock(editor);
    expect(node.attrs.fontSize).toBe('32px');
    expect(stampOf(node)).toBeNull();
  });

  it('focus() chained with toggleItalic still declares on that blank line', () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    caretTo(editor, textblocks(editor)[1].pos + 1);
    editor.chain().focus().toggleItalic().run();
    const stamped = JSON.parse(stampOf(textblocks(editor)[1].node)!) as {
      type: string;
    }[];
    expect(stamped.map((mark) => mark.type).sort()).toEqual(['bold', 'italic']);
  });

  it('maintenance elsewhere while the caret rests on a blank line writes nothing to that line', () => {
    const editor = track(makeEditor(version, '<h2>t</h2><p></p>'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    editor.commands.toggleBold();
    const blank = textblocks(editor)[1].node;
    const heading = textblocks(editor)[0];
    editor.view.dispatch(
      editor.state.tr
        .setNodeMarkup(heading.pos, undefined, {
          ...heading.node.attrs,
          id: 'x',
        })
        .setMeta('addToHistory', false),
    );
    expect(textblocks(editor)[0].node.attrs.id).toBe('x');
    expect(textblocks(editor)[1].node.eq(blank)).toBe(true);
    expect(stampOf(textblocks(editor)[1].node)).toBe('[{"type":"bold"}]');
    expect(typedMarks(editor)).toEqual(['bold']);
  });

  it('deleting a formatted paragraph, or a list, before an unstamped blank line does not stamp it', () => {
    for (const first of [
      '<p><strong>abc</strong></p>',
      '<ul><li><p><strong>abc</strong></p></li></ul>',
    ]) {
      const editor = track(makeEditor(version, `${first}<p></p>`));
      caretTo(editor, endOf(editor, 'abc'));
      const size = editor.state.doc.firstChild!.nodeSize;
      editor.view.dispatch(editor.state.tr.delete(0, size));
      expect(stampOf(caretBlock(editor).node)).toBeNull();
      expect(typedMarks(editor)).toEqual([]);
    }
  });

  it('inserting a paragraph before, after, or between formatted ones stamps no survivor', () => {
    const editor = track(
      makeEditor(version, '<p><strong>a</strong></p><p><em>b</em></p>'),
    );
    caretTo(editor, endOf(editor, 'a'));
    const paragraph =
      version === 1
        ? editor.schema.nodes.dBlock.create(
            null,
            editor.schema.nodes.paragraph.create(),
          )
        : editor.schema.nodes.paragraph.create();
    const second = textblocks(editor)[1];
    const at = version === 1 ? second.pos - 1 : second.pos;
    editor.view.dispatch(editor.state.tr.insert(at, paragraph));
    editor.state.doc.descendants((node) => {
      if (node.isTextblock && node.content.size > 0)
        expect(stampOf(node)).toBeNull();
    });
    const inserted = textblocks(editor)[1];
    expect(inserted.node.content.size).toBe(0);
    expect(stampOf(inserted.node)).toBeNull();
  });

  it('a remote root landing the caret on an empty legacy line: typing gets the font, no doc write', () => {
    const editor = track(
      makeEditor(version, '<p>abc</p><p style="font-size: 32px"></p>'),
    );
    caretTo(editor, endOf(editor, 'abc'));
    const empty = textblocks(editor)[1];
    applyRemote(editor, (tr) =>
      tr
        .insertText('Z', 1 + (version === 1 ? 1 : 0))
        .setSelection(
          TextSelection.near(tr.doc.resolve(tr.mapping.map(empty.pos + 1))),
        ),
    );
    const before = editor.state.doc;
    const emptyPos = textblocks(editor)[1].pos;
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
    const line = before.nodeAt(emptyPos)!;
    expect(line.attrs.fontSize).toBe('32px');
    expect(stampOf(line)).toBeNull();
  });
});
