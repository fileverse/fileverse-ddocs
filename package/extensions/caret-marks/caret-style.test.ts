import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import {
  CARET_MARKS_ATTR,
  caretStyle,
  fillLegacyFont,
  filterSplittable,
  parseMarks,
  serializeMarks,
  stampAttrs,
} from './caret-style';

const makeEditor = (content: string) => {
  const editor = new Editor({
    extensions: getHeadlessExtensions({ schemaVersion: 2 }) as AnyExtension[],
    textDirection: 'auto',
  });
  editor.commands.setContent(content);
  return editor;
};

let editor: Editor;
afterEach(() => editor?.destroy());

describe('serializeMarks / parseMarks', () => {
  it('round-trips marks with attrs and serialises an empty set as "[]"', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    const marks = [
      schema.marks.bold.create(),
      schema.marks.textStyle.create({ fontSize: '24px' }),
    ];
    const json = serializeMarks(marks);
    expect(JSON.parse(json)).toEqual([
      { type: 'bold' },
      {
        type: 'textStyle',
        attrs: expect.objectContaining({ fontSize: '24px' }),
      },
    ]);
    const back = parseMarks(schema, json);
    expect(back.map((m) => m.type.name)).toEqual(['bold', 'textStyle']);
    expect(back[1].attrs.fontSize).toBe('24px');
    expect(serializeMarks([])).toBe('[]');
    expect(parseMarks(schema, '[]')).toEqual([]);
  });

  it('omits null attrs and parses them back as defaults', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    const only = schema.marks.textStyle.create({ fontSize: '24px' });
    expect(serializeMarks([only])).toBe(
      '[{"type":"textStyle","attrs":{"fontSize":"24px"}}]',
    );
    const [back] = parseMarks(schema, serializeMarks([only]));
    expect(back.attrs).toEqual(only.attrs);
    expect(back.attrs.fontFamily).toBeNull();
    expect(back.attrs.color).toBeNull();

    // link.target defaults to a string, so a null there has to survive.
    const link = schema.marks.link.create({
      href: 'https://x.y',
      target: null,
    });
    expect(parseMarks(schema, serializeMarks([link]))[0].attrs).toEqual(
      link.attrs,
    );
  });

  it('skips unknown mark types and tolerates malformed input', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    expect(
      parseMarks(schema, '[{"type":"nope"},{"type":"bold"}]').map(
        (m) => m.type.name,
      ),
    ).toEqual(['bold']);
    expect(parseMarks(schema, 'not json')).toEqual([]);
    expect(parseMarks(schema, null)).toEqual([]);
    expect(parseMarks(schema, '{"type":"bold"}')).toEqual([]);
  });
});

describe('fillLegacyFont', () => {
  it('fills only the font properties the marks leave unset', () => {
    editor = makeEditor(
      '<p style="font-family: Georgia; font-size: 24px"></p>',
    );
    const { schema } = editor;
    const block = editor.state.doc.firstChild!;
    expect(block.attrs.fontFamily).toBe('Georgia');

    const filled = fillLegacyFont(schema, [], block);
    expect(filled.map((m) => m.type.name)).toEqual(['textStyle']);
    expect(filled[0].attrs).toMatchObject({
      fontFamily: 'Georgia',
      fontSize: '24px',
    });

    const partial = fillLegacyFont(
      schema,
      [
        schema.marks.bold.create(),
        schema.marks.textStyle.create({ fontSize: '32px', color: '#f00' }),
      ],
      block,
    );
    const textStyle = partial.find((m) => m.type.name === 'textStyle')!;
    expect(textStyle.attrs).toMatchObject({
      fontFamily: 'Georgia',
      fontSize: '32px',
      color: '#f00',
    });
    expect(partial.some((m) => m.type.name === 'bold')).toBe(true);
  });

  it('returns the marks unchanged without a legacy block or legacy attrs', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    const bold = schema.marks.bold.create();
    expect(fillLegacyFont(schema, [bold], null)).toEqual([bold]);
    expect(
      fillLegacyFont(schema, [bold], editor.state.doc.firstChild!),
    ).toEqual([bold]);
  });
});

describe('caretStyle', () => {
  it('prefers stored marks, then the marks at the caret, then the legacy fill', () => {
    editor = makeEditor('<p style="font-size: 24px"><strong>ab</strong></p>');
    const { schema, state } = editor;
    const block = state.doc.firstChild!;
    editor.commands.setTextSelection(3);
    expect(
      caretStyle(editor.state, block)
        .map((m) => m.type.name)
        .sort(),
    ).toEqual(['bold', 'textStyle']);

    const tr = editor.state.tr.setStoredMarks([schema.marks.italic.create()]);
    expect(
      caretStyle(tr, block)
        .map((m) => m.type.name)
        .sort(),
    ).toEqual(['italic', 'textStyle']);
    expect(caretStyle(tr, null).map((m) => m.type.name)).toEqual(['italic']);
  });
});

describe('filterSplittable / stampAttrs', () => {
  it('drops link (keepOnSplit: false) and keeps code', () => {
    editor = makeEditor('<p></p>');
    const { schema } = editor;
    const marks = [
      schema.marks.link.create({ href: 'https://x.y' }),
      schema.marks.code.create(),
      schema.marks.bold.create(),
    ];
    expect(
      filterSplittable(marks, editor)
        .map((m) => m.type.name)
        .sort(),
    ).toEqual(['bold', 'code']);
  });

  it('writes the stamp and nulls legacy font attrs only when present', () => {
    editor = makeEditor('<p></p>');
    const bold = editor.schema.marks.bold.create();
    expect(
      stampAttrs({ fontFamily: 'Georgia', fontSize: '24px', lineHeight: '2' }, [
        bold,
      ]),
    ).toEqual({
      fontFamily: null,
      fontSize: null,
      lineHeight: '2',
      [CARET_MARKS_ATTR]: '[{"type":"bold"}]',
    });
    expect(stampAttrs({ level: 2 }, [])).toEqual({
      level: 2,
      [CARET_MARKS_ATTR]: '[]',
    });
  });
});
