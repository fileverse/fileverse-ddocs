import { Schema } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { gutterSpacers } from './gutter-spacers';

const schema = new Schema({
  nodes: {
    doc: { content: 'text*' },
    text: {},
  },
});
const doc = schema.node('doc', null, [schema.text('ab\ncd\nef')]);
const widget = (pos: number, key: string) =>
  Decoration.widget(pos, () => document.createElement('div'), { key });

describe('gutterSpacers', () => {
  // Rows start at offsets 0, 3 and 6 ("ab", "cd", "ef").
  const rows = [0, 3, 6];

  it('puts a spacer at a row start before that row', () => {
    const set = DecorationSet.create(doc, [widget(3, 'inText:120:2')]);
    expect([...gutterSpacers(set, rows)]).toEqual([[1, 120]]);
  });

  it('puts a spacer inside a wrapped row before the next row', () => {
    const set = DecorationSet.create(doc, [widget(4, 'inText:80:2')]);
    expect([...gutterSpacers(set, rows)]).toEqual([[2, 80]]);
  });

  it('ignores other decorations and no decorations', () => {
    const set = DecorationSet.create(doc, [
      widget(3, 'block:120:2'),
      Decoration.inline(0, 2, { class: 'x' }),
    ]);
    expect(gutterSpacers(set, rows).size).toBe(0);
    expect(gutterSpacers(undefined, rows).size).toBe(0);
  });
});
