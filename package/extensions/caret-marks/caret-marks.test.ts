import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { insertCommands } from '../../utils/insert-commands';
import { CaretMarks } from './caret-marks';
import {
  makeEditor,
  track,
  destroyTracked,
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
    expect(typedMarks(editor)).toEqual(['bold', 'textStyle']);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });

  it('never stamps a non-empty block', () => {
    const editor = track(makeEditor(version, '<p>abc</p>'));
    caretTo(editor, endOf(editor, 'abc'));
    editor.commands.toggleBold();
    expect(stampOf(caretBlock(editor).node)).toBeNull();
    expect(typedMarks(editor)).toEqual(['bold']);
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

  it('is tagged: a restore never counts as the user formatting the line', () => {
    const editor = track(
      makeEditor(version, '<p><strong>abc</strong></p><p></p>'),
    );
    const before = editor.state.doc;
    caretTo(editor, textblocks(editor)[1].pos + 1);
    caretTo(editor, endOf(editor, 'abc'));
    caretTo(editor, textblocks(editor)[1].pos + 1);
    expect(editor.state.doc.eq(before)).toBe(true);
  });
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
    const sizeStyle = typedTextStyle(size);
    expect(sizeStyle?.fontSize ?? null).toBeNull();
    expect(sizeStyle?.fontFamily).toBe('Georgia');
    expect(typedMarks(size)).toEqual(['bold', 'textStyle']);
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
    const style = typedTextStyle(editor);
    expect(style?.fontFamily ?? null).toBeNull();
    expect(style?.fontSize).toBe('32px');
    expect(typedMarks(editor)).toEqual(['bold', 'textStyle']);
  });

  it('bold on an empty legacy 32px line types bold 32px', () => {
    const editor = track(
      makeEditor(version, '<p style="font-size: 32px"></p>'),
    );
    editor.commands.toggleBold();
    expect(typedMarks(editor)).toEqual(['bold', 'textStyle']);
    expect(typedTextStyle(editor)?.fontSize).toBe('32px');
  });
});

describe('trailing node (schema v1)', () => {
  it('carries no font attrs; entering it restores nothing from an unformatted heading', () => {
    const editor = track(
      makeEditor(1, '<p style="font-family: Georgia">abc</p><h2>t</h2>'),
    );
    const trailing = textblocks(editor).at(-1)!.node;
    expect(trailing.attrs.class).toBe('trailing-node');
    expect(trailing.attrs.fontFamily).toBeNull();
    expect(trailing.attrs.fontSize).toBeNull();
    caretTo(editor, textblocks(editor).at(-1)!.pos + 1);
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
    expect(typedMarks(editor)).toEqual(expected);
    expect(typedTextStyle(editor)).toMatchObject({
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
});
