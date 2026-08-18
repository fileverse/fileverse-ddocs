import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';

// Default block spacing is expressed as margin-bottom only.
//
// With a top and a bottom margin on every block, adjacent margins collapse and
// the larger wins, so a spaceAfter smaller than the next block's default top
// margin did nothing visible. Owning the gap below a block makes spaceAfter
// authoritative. (spaceBefore still collapses against the previous block's
// bottom margin — that is Word's behaviour too, and is documented.)
//
// Scope is the editing canvas. `.presentation-mode` and `.ai-preview-editor`
// are separate renderers with their own rhythm and are deliberately untouched.
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

describe('editor block rhythm', () => {
  it('gives top-level paragraphs a bottom gap and no top margin', () => {
    expect(find('.ProseMirror >> & > p', 'margin-bottom')?.value).toBe(
      '1.5rem',
    );
    expect(find('.ProseMirror >> & > p', 'margin-top')?.value).toBe('0');
  });

  it('gives nested paragraphs a bottom gap and no top margin', () => {
    expect(find('.ProseMirror >> p', 'margin-top')?.value).toBe('0');
    expect(find('.ProseMirror >> p', 'margin-bottom')?.value).toBe('0.5rem');
  });

  // v1 relied on these collapsing through the dBlock wrapper to hide
  // prose-lg's 48px heading margins. Once nothing collapses, an unpinned
  // heading would expose them, so the pin can no longer be v2-only.
  it('pins heading margins for both schema versions', () => {
    expect(
      find('.ProseMirror >> h1, h2, h3, h4, h5, h6', 'margin-top')?.value,
    ).toBe('0');
    expect(
      find('.ProseMirror >> h1, h2, h3, h4, h5, h6', 'margin-bottom')?.value,
    ).toBe('1.5rem');
    expect(decls.some((d) => d.chain.includes("data-schema-version='2'"))).toBe(
      false,
    );
  });

  // Must match every child, not `* + *`: the bottom margin belongs on each
  // block including the first, where a top-margin rule had to skip it.
  it('applies the generic gap to every child, not every-child-but-first', () => {
    expect(find('.ProseMirror > *', 'margin-bottom')?.value).toBe('1.5em');
    expect(find('.ProseMirror > *', 'margin-top')?.value).toBe('0');
    expect(find('.ProseMirror > * + *', 'margin-top')).toBeUndefined();
  });
});
