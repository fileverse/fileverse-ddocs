import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import { shieldMathRegions } from './math-region-shield';

// The real import pipeline: markdown-it render, then the sup/sub regexes from
// handleMarkdownContent, then restore. Reproduced here so the tests prove the
// shield against the actual damage sources, not a stand-in.
const md = new MarkdownIt({ html: true });
const supRegex = /\^([^\s^]+)\^/g;
const subRegex = /~([^\s~](?:[^~]*[^\s~])?)~/g;

const importPipeline = (markdown: string) => {
  const { shielded, restore } = shieldMathRegions(markdown);
  let html = md.render(shielded);
  html = html.replace(supRegex, '<sup data-type="sup">$1</sup>');
  html = html.replace(subRegex, '<sub data-type="sub">$1</sub>');
  return restore(html);
};

describe('shieldMathRegions', () => {
  it('keeps backslash escapes inside $…$ verbatim (\\{ \\% \\* \\\\)', () => {
    const html = importPipeline(
      'so $P \\{ x \\} \\* 100\\%$ and $\\begin{a} 1 \\\\ 2 \\end{a}$',
    );
    expect(html).toContain('$P \\{ x \\} \\* 100\\%$');
    expect(html).toContain('$\\begin{a} 1 \\\\ 2 \\end{a}$');
  });

  it('still strips backslash escapes in prose (normal CommonMark)', () => {
    const html = importPipeline('prose \\{brace\\} here');
    expect(html).toContain('{brace}');
    expect(html).not.toContain('\\{');
  });

  it('keeps ^…^ and ~…~ verbatim inside math', () => {
    const html = importPipeline('$0.1^i * 0.9^{7-i}$ and $a~b~c$');
    expect(html).toContain('$0.1^i * 0.9^{7-i}$');
    expect(html).toContain('$a~b~c$');
    expect(html).not.toContain('<sup');
    expect(html).not.toContain('<sub');
  });

  it('still converts ^…^ to sup in prose', () => {
    const html = importPipeline('meters^2^ of area');
    expect(html).toContain('<sup data-type="sup">2</sup>');
  });

  it('keeps emphasis-eating asterisks verbatim inside math', () => {
    const html = importPipeline('$s * x_f * G$ stays math');
    expect(html).toContain('$s * x_f * G$');
    expect(html).not.toContain('<em>');
  });

  it('shields multi-line $$…$$ display math', () => {
    const html = importPipeline('see\n\n$$\n\\frac{a}{b} \\{x\\}\n$$\n\nend');
    expect(html).toContain('$$\n\\frac{a}{b} \\{x\\}\n$$');
  });

  it('HTML-escapes < > & when restoring', () => {
    const html = importPipeline('$a < b \\& c > d$');
    expect(html).toContain('$a &lt; b \\&amp; c &gt; d$');
  });

  it('leaves currency prose alone (no false region)', () => {
    const { shielded } = shieldMathRegions('I paid $5 and $10 for it');
    expect(shielded).toBe('I paid $5 and $10 for it');
  });

  it('does not shield inside fenced code blocks', () => {
    const src = '```sh\necho $PATH plus $HOME\n```\n\nthen $x^2$';
    const { shielded } = shieldMathRegions(src);
    expect(shielded).toContain('echo $PATH plus $HOME');
    expect(shielded).not.toContain('$x^2$');
  });

  it('a region can never swallow a fence boundary', () => {
    const src = 'has one $ here\n\n```\ncode $ inside\n```\n\nafter';
    const html = importPipeline(src);
    expect(html).toContain('<code>');
    expect(html).toContain('code $ inside');
  });

  it('does not shield inside inline code spans', () => {
    const src = 'use `$var$` then real $x_1$ math';
    const { shielded } = shieldMathRegions(src);
    expect(shielded).toContain('`$var$`');
    expect(shielded).not.toContain('$x_1$');
    const html = importPipeline(src);
    expect(html).toContain('<code>$var$</code>');
    expect(html).toContain('$x_1$');
  });

  it('restores adjacent inline regions independently', () => {
    const html = importPipeline('$a$$b$ tight pair');
    expect(html).toContain('$a$$b$');
  });

  it('round-trips a realistic VB formula line', () => {
    const line =
      'where $\\sum_{i=4}^7 {7 \\choose i} * 0.1^i * 0.9^{7-i} = 0.002728$ holds';
    const html = importPipeline(line);
    expect(html).toContain(
      '$\\sum_{i=4}^7 {7 \\choose i} * 0.1^i * 0.9^{7-i} = 0.002728$',
    );
  });

  it('is a no-op restore when there is no math', () => {
    const { shielded, restore } = shieldMathRegions('plain text');
    expect(shielded).toBe('plain text');
    expect(restore('<p>plain text</p>')).toBe('<p>plain text</p>');
  });
});
