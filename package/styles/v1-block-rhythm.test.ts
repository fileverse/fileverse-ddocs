import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

// editor.css uses native CSS nesting, which jsdom cannot parse, so the v1
// rules are restated here flattened. That makes this a test of *selector
// matching and specificity* against the real v1 DOM — the part text
// assertions cannot check, and the part that was wrong first time round:
// v1 nests blocks twice (dBlock row > div > block), so a rule one level too
// shallow lands the gap on a wrapper instead of on the block that carries the
// spacing attribute.
const V1_RULES = `
  .ProseMirror p { margin-bottom: 8px; }
  .ProseMirror p:where(:last-child) { margin-bottom: 0px; }
  .ProseMirror > [data-type='d-block'] { margin-bottom: 0px; }
  .ProseMirror > [data-type='d-block'] > * { margin-bottom: 0px; }
  .ProseMirror > [data-type='d-block'] > * > * { margin-bottom: 24px; }
`;

const mounted: { editor: Editor; style: HTMLStyleElement }[] = [];

const mountV1 = (content: string) => {
  const style = document.createElement('style');
  style.textContent = V1_RULES;
  document.head.appendChild(style);
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: getHeadlessExtensions({ schemaVersion: 1 }) as AnyExtension[],
    textDirection: 'auto',
  });
  editor.commands.setContent(content);
  mounted.push({ editor, style });
  return element.querySelector('.ProseMirror') as HTMLElement;
};

const marginBottom = (el: Element | null) =>
  el ? window.getComputedStyle(el as HTMLElement).marginBottom : 'NO ELEMENT';

afterEach(() => {
  mounted.splice(0).forEach(({ editor, style }) => {
    editor.destroy();
    style.remove();
  });
});

describe('v1 block rhythm', () => {
  it('leaves both wrappers without a gap, so the block owns it', () => {
    const pm = mountV1('<p>one</p>');
    const wrapper = pm.firstElementChild!;

    expect(marginBottom(wrapper)).toBe('0px');
    expect(marginBottom(wrapper.firstElementChild)).toBe('0px');
  });

  it('puts the gap on the block that carries the spacing attribute', () => {
    const pm = mountV1('<p>one</p>');

    expect(marginBottom(pm.querySelector('p'))).toBe('24px');
  });

  it('beats the nested-paragraph default on specificity', () => {
    const pm = mountV1('<h2>head</h2>');

    // Would be 8px if `.ProseMirror p` won, or unset if the selector missed.
    expect(marginBottom(pm.querySelector('h2'))).toBe('24px');
  });

  // dBlock > div > ul > li > p is deeper than `> * > *`, so the block rule
  // misses it and the nested-paragraph rules decide. It is its item's only
  // child, so the last-child reset applies and the item owns the gap instead.
  // Confirmed in Chrome against the real stylesheet: 0px, and unchanged by
  // the :where() fix — only top-level v1 paragraphs moved (0px -> 24px).
  it('lets the list item own the gap, not the paragraph inside it', () => {
    const pm = mountV1('<ul><li><p>item</p></li></ul>');

    expect(marginBottom(pm.querySelector('li p'))).toBe('0px');
  });
});
