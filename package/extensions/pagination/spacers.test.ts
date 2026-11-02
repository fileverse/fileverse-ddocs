import { Editor } from '@tiptap/react';
import { getHeadlessExtensions } from '../../hooks/use-headless-editor';
import { DecorationSet } from '@tiptap/pm/view';
import { SPACER_CLASS } from './collect-leaves';
import type { Spacer } from './place';
import { buildSpacerDecorations, spacerKey, spacersMatch } from './spacers';

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
    expect(spacersMatch(DecorationSet.empty, [sp({ height: 0 })])).toBe(true);
  });

  it('matches against the set in the view', () => {
    const [, p2] = positions();
    const list = [sp({ pos: p2 })];
    const set = buildSpacerDecorations(doc(), list);
    expect(spacersMatch(set, list)).toBe(true);
    expect(spacersMatch(set, [sp({ pos: p2, height: 300 })])).toBe(false);
    expect(spacersMatch(set, [sp({ pos: positions()[2] })])).toBe(false);
    expect(spacersMatch(set, [])).toBe(false);
  });

  it('detects a widget lost to a replace over its position', () => {
    const [, p2] = positions();
    const list = [sp({ pos: p2 })];
    const set = buildSpacerDecorations(doc(), list);
    const tr = editor.state.tr.delete(p2 - 1, p2 + 2);
    const mapped = set.map(tr.mapping, tr.doc);
    expect(spacersMatch(mapped, list)).toBe(false);
  });
});
