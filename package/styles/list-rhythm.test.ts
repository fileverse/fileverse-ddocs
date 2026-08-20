import { describe, expect, it, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { Editor } from '@tiptap/react';
import type { AnyExtension } from '@tiptap/core';
import { getHeadlessExtensions } from '../hooks/use-headless-editor';

/**
 * TEC-2701 A9.5: "list item — not able to remove space after".
 *
 * Lists were the one place in the document that did NOT follow "a block owns
 * the gap below it". Tailwind's `space-y-2` put the inter-item gap on the NEXT
 * item's margin-top, and the block gap below the list sat on the <ul> itself.
 * Neither is reachable from the `listItem` attribute that Add/Remove space and
 * the custom spacing dialog write to, so removing space after a bullet was a
 * silent no-op — measured in Chrome, the gap stayed at 8px and the gap after
 * the list stayed at 24px.
 *
 * These are SOURCE assertions rather than rendered ones on purpose. jsdom
 * resolves this cascade differently from a browser (see the note in
 * block-rhythm.test.ts), so the numbers were verified in Chrome against the
 * built stylesheet and the rules are pinned here.
 */

const css = readFileSync(path.join(__dirname, 'editor.css'), 'utf8');
const root = postcss.parse(css);

type Decl = { chain: string; prop: string; value: string };

const decls: Decl[] = [];
root.walkDecls((decl) => {
  if (!/^margin(-top|-bottom)?$/.test(decl.prop)) return;
  const parts: string[] = [];
  let node: postcss.Container | undefined = decl.parent as postcss.Container;
  while (node && node.type !== 'root') {
    if (node.type === 'rule') {
      parts.unshift((node as postcss.Rule).selector.replace(/\s+/g, ' '));
    }
    node = node.parent as postcss.Container;
  }
  decls.push({
    chain: parts.join(' >> '),
    prop: decl.prop,
    value: decl.value.trim(),
  });
});

const find = (chain: string, prop: string) =>
  decls.find((d) => d.chain === chain && d.prop === prop);

describe('list rhythm', () => {
  it('gives the list container no gap of its own', () => {
    expect(find('.ProseMirror >> :is(ul, ol)', 'margin-bottom')?.value).toBe(
      '0',
    );
  });

  it('puts the inter-item gap below each item, not above the next', () => {
    expect(
      find('.ProseMirror >> :is(ul, ol) >> > li', 'margin-bottom')?.value,
    ).toBe('0.5rem');
  });

  // This is the one that makes the reported case work: the gap after the whole
  // list becomes the LAST item's own margin-bottom, so writing spaceAfter on
  // that item removes it.
  it('moves the block gap after a flat-schema list onto its last item', () => {
    expect(
      find('.ProseMirror >> & > :is(ul, ol) > li:last-child', 'margin-bottom')
        ?.value,
    ).toBe('1.5rem');
    expect(
      find(
        '.ProseMirror >> & > :is(ul, ol):last-child > li:last-child',
        'margin-bottom',
      )?.value,
    ).toBe('0');
  });

  // v1 nests twice, and the dBlock block rule is (0,2,0) — the plain
  // `:is(ul, ol)` reset is only (0,1,1) and loses to it, so the container has
  // to be zeroed again at matching specificity or the <ul> keeps its 1.5rem.
  it('does the same for a v1 list, out-specifying the dBlock rule', () => {
    expect(
      find(
        ".ProseMirror >> & > [data-type='d-block'] > * > :is(ul, ol)",
        'margin-bottom',
      )?.value,
    ).toBe('0');
    expect(
      find(
        ".ProseMirror >> & > [data-type='d-block'] > * > :is(ul, ol) >> > li:last-child",
        'margin-bottom',
      )?.value,
    ).toBe('1.5rem');
    expect(
      find(
        ".ProseMirror >> & > [data-type='d-block']:last-child > * > :is(ul, ol) > li:last-child",
        'margin-bottom',
      )?.value,
    ).toBe('0');
  });
});

describe('list markup', () => {
  const mounted: Editor[] = [];
  afterEach(() => mounted.splice(0).forEach((editor) => editor.destroy()));

  const listHtml = (schemaVersion: number, content: string) => {
    const element = document.createElement('div');
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      extensions: getHeadlessExtensions({ schemaVersion }) as AnyExtension[],
      textDirection: 'auto',
    });
    editor.commands.setContent(content);
    mounted.push(editor);
    return editor.getHTML();
  };

  // space-y-2 is what put the gap on the wrong end. If it comes back, the CSS
  // above still applies but the utility wins for margin-top and the reported
  // bug returns for the inter-item gap.
  it.each([1, 2])(
    'renders bullet and ordered lists without space-y-2 on schema v%i',
    (version) => {
      const html = listHtml(
        version,
        '<ul><li><p>one</p></li></ul><ol><li><p>two</p></li></ol>',
      );

      expect(html).toContain('<ul');
      expect(html).toContain('<ol');
      expect(html).not.toContain('space-y-2');
    },
  );

  it.each([1, 2])('renders task lists without space-y-2 on v%i', (version) => {
    const html = listHtml(
      version,
      '<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>todo</p></li></ul>',
    );

    expect(html).toContain('data-type="taskList"');
    expect(html).not.toContain('space-y-2');
  });
});
