import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import postcss, { type AtRule, type Rule } from 'postcss';

// Touch-first devices (phones/tablets — `@media (hover: none)`) have no way
// to reveal hover-gated chrome: the floating drag-handle cluster is driven
// by real mousemove events and never appears, and the in-DOM heading
// controls are `:hover`-revealed. Without dedicated rules the collapse
// chevron is unreachable there in every mode. These tests pin the touch
// ruleset in editor.css that keeps it reachable.

const css = readFileSync(path.join(__dirname, 'editor.css'), 'utf8');
const root = postcss.parse(css);

const touchRules: Rule[] = [];
root.walkAtRules('media', (atRule: AtRule) => {
  if (!atRule.params.replace(/\s/g, '').includes('hover:none')) return;
  atRule.walkRules((rule) => touchRules.push(rule));
});

const declsOf = (rule: Rule) => {
  const decls: Record<string, string> = {};
  rule.walkDecls((decl) => {
    decls[decl.prop] = decl.value;
  });
  return decls;
};

const findRule = (predicate: (selector: string) => boolean) =>
  touchRules.find((rule) =>
    rule.selectors.some((selector) => predicate(selector)),
  );

describe('heading chrome on hover-less (touch) devices', () => {
  it('has a (hover: none) media block', () => {
    expect(touchRules.length).toBeGreaterThan(0);
  });

  it('shows the v1 in-DOM controls in every mode, not just read-only', () => {
    const rule = findRule(
      (s) =>
        s.includes('.d-block-preview-controls') &&
        !s.includes('-flat') &&
        !s.includes('contenteditable') &&
        !s.includes(':hover'),
    );
    expect(rule).toBeDefined();
    const decls = declsOf(rule!);
    expect(decls.display).toBe('flex');
    expect(decls.visibility).toBe('visible');
  });

  it('shows the flat-schema controls in every mode, not just read-only', () => {
    const rule = findRule(
      (s) =>
        s.includes('.d-block-preview-controls-flat') &&
        !s.includes(':has') &&
        !s.includes('contenteditable') &&
        !s.includes(':hover'),
    );
    expect(rule).toBeDefined();
    const decls = declsOf(rule!);
    expect(decls.display).toBe('flex');
    expect(decls.visibility).toBe('visible');
  });

  it('gives flat headings a positioning context without the read-only gate', () => {
    const rule = findRule(
      (s) =>
        s.includes(':has(> .d-block-preview-controls-flat)') &&
        !s.includes('contenteditable'),
    );
    expect(rule).toBeDefined();
    expect(declsOf(rule!).position).toBe('relative');
  });

  // The base read-only rules set `visibility: hidden` with a higher-specificity
  // selector (`.ProseMirror[contenteditable='false'] …`) than the always-show
  // rules above, so read-only mode needs same-specificity overrides or the
  // chevron stays hover-gated (i.e. unreachable) exactly where viewers need it.
  it('beats the read-only hidden state for both control variants', () => {
    const v1 = findRule(
      (s) =>
        s.includes("[contenteditable='false']") &&
        s.includes('.d-block-preview-controls') &&
        !s.includes('-flat'),
    );
    const flat = findRule(
      (s) =>
        s.includes("[contenteditable='false']") &&
        s.includes('.d-block-preview-controls-flat'),
    );
    expect(v1).toBeDefined();
    expect(flat).toBeDefined();
    expect(declsOf(v1!).visibility).toBe('visible');
    expect(declsOf(flat!).visibility).toBe('visible');
  });

  it('keeps copy-link a preview-only affordance while editing', () => {
    const rule = findRule(
      (s) =>
        s.includes("[contenteditable='true']") &&
        s.includes('.d-block-preview-copy-link'),
    );
    expect(rule).toBeDefined();
    expect(declsOf(rule!).display).toBe('none');
  });

  it('suppresses the mousemove-driven floating cluster', () => {
    // A tap fires a simulated mousemove that can flash the cluster over the
    // same gutter the in-DOM controls occupy.
    const rule = findRule((s) => s.includes('.drag-handle'));
    expect(rule).toBeDefined();
    expect(declsOf(rule!).display).toBe('none');
  });
});
