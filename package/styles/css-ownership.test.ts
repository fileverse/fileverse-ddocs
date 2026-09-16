import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import postcss, { type Container, type Root, type Rule } from 'postcss';
import nested from 'postcss-nested';
import selectorParser from 'postcss-selector-parser';

type SelectorNode = selectorParser.Node;
type Selector = selectorParser.Selector;

// Every first-party stylesheet is checked. *.module.css is hashed at build time and exempt.
// This predicate covers ddoc's own source stylesheets only: CSS imported from third-party
// packages (the highlight.js themes, tippy) is not walked here and is not held to this
// ownership guarantee — see the README's "Migrating from 4.x" notes.
const PACKAGE_DIR = path.resolve(__dirname, '..');

// A selector is owned when the element it styles is guaranteed to sit inside one of
// these roots, or carries a ddoc-owned class, or is an explicitly listed shared selector.
const APPROVED_ROOTS = new Set([
  '.ProseMirror',
  '[data-ddoc-editor-root]',
  '[data-ddoc-editor-root="true"]',
  '#editor-wrapper',
  '#editor-canvas',
  '[data-split-view-preview]',
]);
const OWNED_PREFIXES = [
  'ddoc-',
  'node-',
  'd-block',
  'dblock',
  'collaboration-cursor__',
  'custom-cursor__',
  'inline-comment--',
  'suggestion-',
  'autocomplete-',
  'animate-aiwriter-',
];
// Selectors the package styles outside an editor root. Each entry needs a reason.
// This list is the backlog for scoping or namespacing; adding to it is a reviewed decision.
const SHARED_SELECTORS: Record<string, string> = {
  '.no-scrollbar': 'identical rule exists in the consumer',
  '.drag-handle':
    'block handle rendered beside the content root; scoping candidate',
  '.vertical-divider': 'toolbar divider; scoping candidate',
  '.custom-border': 'toolbar chrome; scoping candidate',
  '.img-placeholder': 'image node placeholder; scoping candidate',
  '.scroll-container': 'editor scroll container; scoping candidate',
  '.invalid-content': 'invalid-content banner; scoping candidate',
  '.animate-border': 'AI writer border animation; scoping candidate',
  '.animate-loading-dots': 'AI writer loading animation; scoping candidate',
  '.grammarly-wrapper': 'host element for the Grammarly integration',
  '.remove-page-break': 'page-break control; scoping candidate',
  '.remove-page-break-icon': 'page-break control; scoping candidate',
  '.has-available-models': 'AI toolbar state; scoping candidate',
  '.hide-inline-comments': 'editor state class on the host element',
  '.ai-preview-editor': 'AI preview editor host',
  '.is-table': 'd-block wrapper state; scoping candidate',
  '.search-result':
    'search/replace decoration inside content; scoping candidate',
  '.trigger-button': 'table cell menu trigger; scoping candidate',
  '.dropdown': 'table cell menu, portal-rendered; namespacing candidate',
  '.table-wrapper':
    'ProseMirror table wrapper inside content; scoping candidate',
  '.resize-cursor': 'ProseMirror table resize state; scoping candidate',
  '.presentation-mode': 'presentation container; scoping candidate',
  '[data-mode="focus"]': 'editor mode attribute on the host element',
  '[data-theme="link-command"]':
    'tippy theme attribute on portal-rendered popovers',
  '[data-schema-version="2"]': 'schema attribute on the host element',
  '[data-page-break="false"]': 'page-break node attribute',
  '[data-type="taskList"]': 'ProseMirror node type attribute',
  '[data-type="d-block"]': 'ProseMirror node type attribute',
  '[data-type="column"]': 'ProseMirror node type attribute',
  '[data-type="columns"]': 'ProseMirror node type attribute',
  '[data-type="horizontalRule"]': 'ProseMirror node type attribute',
  '[data-type="taskItem"]': 'ProseMirror node type attribute',
  '[data-type="callout"]': 'ProseMirror node type attribute',
  '[data-type="page-break"]': 'ProseMirror node type attribute',
  '.buttonless': 'number input inside portal-rendered popovers',
  '.editor-main-lane':
    'editor layout lane wrapper around the content root; scoping candidate',
};
// Theme roots may only declare editor tokens.
const TOKEN_ROOT = /^(:root|\.dark|\.theme-[a-z-]+)$/;

function listCssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') out.push(...listCssFiles(full));
    } else if (
      entry.name.endsWith('.css') &&
      !entry.name.endsWith('.module.css')
    ) {
      out.push(full);
    }
  }
  return out.sort();
}

function flatten(css: string, from: string): Root {
  return postcss([
    nested({ bubble: ['media', 'supports', 'layer', 'container'] }),
  ]).process(css, { from }).root;
}

function collectRules(container: Container, out: Rule[]): void {
  container.each((node) => {
    if (node.type === 'rule') {
      out.push(node);
      // A flattened rule has no child rules; anything found here is unflattened
      // (e.g. a non-bubbled at-rule like @starting-style) and must still be walked.
      collectRules(node, out);
    } else if (
      node.type === 'atrule' &&
      !/keyframes$|^font-face$/.test(node.name)
    ) {
      collectRules(node, out);
    }
  });
}

function token(node: SelectorNode): string | null {
  if (node.type === 'class') return `.${node.value}`;
  if (node.type === 'id') return `#${node.value}`;
  if (node.type === 'attribute') {
    if (!node.value) return `[${node.attribute}]`;
    const flag = node.insensitive ? ' i' : '';
    return `[${node.attribute}${node.operator}"${node.value}"${flag}]`;
  }
  return null;
}

function isPositive(node: SelectorNode): boolean {
  const t = token(node);
  if (!t) return false;
  if (APPROVED_ROOTS.has(t) || t in SHARED_SELECTORS) return true;
  return (
    node.type === 'class' &&
    OWNED_PREFIXES.some((p) => node.value.startsWith(p))
  );
}

// :not() and :has() never anchor: they select the element that is NOT / CONTAINS the argument.
function isAnchor(compound: SelectorNode[]): boolean {
  if (compound.some(isPositive)) return true;
  return compound.some(
    (n) =>
      n.type === 'pseudo' &&
      (n.value === ':is' || n.value === ':where') &&
      n.nodes.length > 0 &&
      n.nodes.every((alt) => isOwned(alt)),
  );
}

// body/html can never be a real descendant of anything (they're the DOM roots), so a
// selector whose subject is a bare body/html tag is unmatchable unless that same compound
// also carries its own anchor (the pre-existing body:where(.ProseMirror) cosmetic case).
function isImpossibleSubject(compound: SelectorNode[]): boolean {
  const isBodyOrHtml = compound.some(
    (n) => n.type === 'tag' && /^(body|html)$/i.test(n.value),
  );
  return isBodyOrHtml && !isAnchor(compound);
}

// Owned when an anchor compound is the subject, or is followed by a descendant/child
// combinator. A sibling combinator right after the anchor leaves the owned subtree.
function isOwned(selector: Selector): boolean {
  const compounds: SelectorNode[][] = [[]];
  const combinators: string[] = [];
  for (const node of selector.nodes) {
    if (node.type === 'combinator') {
      combinators.push(node.value.trim() || ' ');
      compounds.push([]);
    } else {
      compounds[compounds.length - 1].push(node);
    }
  }
  if (
    compounds.length > 1 &&
    isImpossibleSubject(compounds[compounds.length - 1])
  ) {
    return false;
  }
  return compounds.some(
    (c, i) =>
      isAnchor(c) &&
      (i === compounds.length - 1 ||
        combinators[i] === ' ' ||
        combinators[i] === '>'),
  );
}

export function ownershipViolations(css: string, from: string): string[] {
  const rules: Rule[] = [];
  collectRules(flatten(css, from), rules);
  const out: string[] = [];
  const label = path.isAbsolute(from) ? path.relative(PACKAGE_DIR, from) : from;
  const where = (rule: Rule) => `${label}:${rule.source?.start?.line ?? 0}`;
  for (const rule of rules) {
    for (const raw of rule.selectors) {
      const sel = raw.trim();
      if (TOKEN_ROOT.test(sel)) {
        const nonToken = rule.nodes.some(
          (n) => n.type === 'decl' && !n.prop.startsWith('--color-editor-'),
        );
        if (nonToken)
          out.push(`${sel} declares non-token properties (${where(rule)})`);
        continue;
      }
      let owned = false;
      selectorParser((root) => {
        owned = root.nodes.every((s) => isOwned(s));
      }).processSync(sel);
      if (!owned) out.push(`${sel} (${where(rule)})`);
    }
  }
  return out;
}

const cssFiles = listCssFiles(PACKAGE_DIR);
const rel = (f: string) => path.relative(PACKAGE_DIR, f);

describe('css ownership', () => {
  it('finds the first-party stylesheets', () => {
    expect(cssFiles.map(rel)).toEqual([
      'components/split-view/split-view.css',
      'extensions/supercharged-table/extension-table-cell/styles.css',
      'styles/editor.css',
      'styles/fonts.css',
      'styles/index.css',
    ]);
  });

  for (const file of cssFiles) {
    describe(rel(file), () => {
      const css = readFileSync(file, 'utf8');
      const raw = postcss.parse(css);

      it('has no @tailwind directive', () => {
        const found: string[] = [];
        raw.walkAtRules('tailwind', (a) => found.push(a.params));
        expect(found).toEqual([]);
      });

      it('does not import ui or katex stylesheets', () => {
        const found: string[] = [];
        raw.walkAtRules('import', (a) => {
          if (/@fileverse\/ui|katex/.test(a.params)) found.push(a.params);
        });
        expect(found).toEqual([]);
      });

      it('styles only owned elements', () => {
        expect(ownershipViolations(css, file)).toEqual([]);
      });
    });
  }
});

describe('ownership predicate', () => {
  const check = (css: string) => ownershipViolations(css, 'fixture.css');

  it.each([
    'body {}',
    '* {}',
    'ul {}',
    'body:not(.ProseMirror) {}',
    'body:has(.ProseMirror) {}',
    '.ProseMirror + main {}',
    '.ProseMirror ~ .toast {}',
    ':where(body) {}',
    ':is(*) {}',
    "[dir='rtl'] {}",
    ':is(.ProseMirror, body) p {}',
    '.dark { color: red }',
    "[data-theme='dark'] {}",
    '.dark { --color-bg-default: 0, 0%, 18%, 1 }',
    '[data-type*="callout"] {}',
    '.ProseMirror { @starting-style { body { color: red } } }',
    '.ProseMirror { @scope { body { color: red } } }',
  ])('rejects %s', (css) => {
    expect(check(css)).toHaveLength(1);
  });

  it.each([
    '.ProseMirror p + p {}',
    ':where(.ProseMirror) ul {}',
    '.ProseMirror > .node-iframe {}',
    '.node-iframe {}',
    '.drag-handle:hover {}',
    ':is(.ProseMirror, [data-ddoc-editor-root]) h1 {}',
    '.ProseMirror:not(.readonly) p {}',
    '.dark { --color-editor-rose: red }',
    '@media (hover: none) { .ProseMirror p {} }',
    "[data-theme='link-command'] {}",
  ])('accepts %s', (css) => {
    expect(check(css)).toEqual([]);
  });

  it.each([
    ['.ProseMirror { @media (hover: none) { p {} } }', []],
    ['.inline-comment--draft { .dark & {} }', []],
    ['.ProseMirror { h1, h2 { span {} } }', []],
    [
      '.ProseMirror { :is(&, body) {} }',
      [':is(.ProseMirror, body) (fixture.css:1)'],
    ],
    [
      '.presentation-mode { &.fullscreen { @media (min-width: 900px) { h1 {} } } }',
      [],
    ],
  ])('normalizes nesting before checking: %s', (css, expected) => {
    expect(check(css)).toEqual(expected);
  });
});
