import type { Node as PMNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { SPACER_CLASS } from './collect-leaves';
import type { Spacer } from './place';

// No pos: the key keeps the DOM node when only positions shift.
export function spacerKey(s: Spacer): string {
  return `${s.kind}:${s.height}:${s.page}`;
}

// A 0px div does nothing visible and lets margins collapse through it.
const visible = (spacers: Spacer[]) => spacers.filter((s) => s.height > 0);

function createSpacerElement(s: Spacer): HTMLElement {
  const el = document.createElement('div');
  el.className = SPACER_CLASS;
  el.setAttribute('contenteditable', 'false');
  el.setAttribute('role', 'separator');
  el.setAttribute('aria-label', `Page ${s.page}`);
  el.style.height = `${s.height}px`;
  return el;
}

export function buildSpacerDecorations(
  doc: PMNode,
  spacers: Spacer[],
): DecorationSet {
  return DecorationSet.create(
    doc,
    visible(spacers).map((s) =>
      Decoration.widget(s.pos, () => createSpacerElement(s), {
        side: -1,
        key: spacerKey(s),
        ignoreSelection: true,
        marks: [],
      }),
    ),
  );
}

export function spacersMatch(current: DecorationSet, next: Spacer[]): boolean {
  const want = visible(next);
  const have = current.find();
  return (
    have.length === want.length &&
    have.every(
      (d, i) =>
        d.from === want[i].pos &&
        (d as unknown as { spec: { key?: string } }).spec.key ===
          spacerKey(want[i]),
    )
  );
}
