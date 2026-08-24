import { describe, it, expect, afterEach } from 'vitest';
import { turndownService, setMarkdownInlineStyles } from './index';

const withStyles = (html: string) => {
  setMarkdownInlineStyles(true);
  return turndownService.turndown(html);
};

afterEach(() => setMarkdownInlineStyles(false));

describe('block style export', () => {
  it('drops block styles from plain .md', () => {
    const md = turndownService.turndown('<p style="margin-top: 12pt">one</p>');

    expect(md).not.toContain('margin-top');
    expect(md).toContain('one');
  });

  it('emits margins in styles mode', () => {
    const md = withStyles(
      '<p style="margin-top: 12pt; margin-bottom: 8pt">one</p>',
    );

    expect(md).toContain('margin-top: 12pt');
    expect(md).toContain('margin-bottom: 8pt');
  });

  // Without this, every block in the document routes through the raw-HTML rule
  // and the whole export stops being markdown.
  it('leaves an unstyled paragraph as plain markdown', () => {
    const md = withStyles('<p>one</p>');

    expect(md).not.toContain('<p');
    expect(md.trim()).toBe('one');
  });

  it('does not emit the default line height', () => {
    const md = withStyles('<p style="line-height: 138%">one</p>');

    expect(md).not.toContain('line-height');
    expect(md.trim()).toBe('one');
  });

  it('emits a non-default line height', () => {
    const md = withStyles('<p style="line-height: 240%">one</p>');

    expect(md).toContain('line-height: 240%');
  });

  it('keeps alignment and spacing on the same block', () => {
    const md = withStyles(
      '<p style="text-align: center; margin-top: 12pt">one</p>',
    );

    expect(md).toContain('text-align: center');
    expect(md).toContain('margin-top: 12pt');
  });

  it('covers h4 to h6, which the alignment-only rule missed', () => {
    const md = withStyles('<h4 style="margin-top: 20pt">four</h4>');

    expect(md).toContain('<h4');
    expect(md).toContain('margin-top: 20pt');
  });

  it('still emits plain markdown headings when unstyled', () => {
    const md = withStyles('<h2>two</h2>');

    expect(md.trim()).toBe('## two');
  });

  // Known gap, asserted so it is a deliberate limitation rather than a
  // surprise: the custom 'listItem' rule is registered later than 'blockStyle'
  // and turndown checks later rules first, so <li> never reaches this rule.
  // Carrying it would mean emitting the whole list as raw HTML.
  it('does not carry list item spacing (documented limitation)', () => {
    const md = withStyles(
      '<ul><li style="margin-top: 12pt"><p>one</p></li></ul>',
    );

    expect(md).not.toContain('margin-top');
    expect(md.trim()).toBe('* one');
  });
});

describe('block style export edge cases', () => {
  it('emits all three properties on one block', () => {
    const md = withStyles(
      '<p style="text-align: center; margin-top: 12pt; margin-bottom: 8pt; line-height: 240%">one</p>',
    );

    expect(md).toContain('text-align: center');
    expect(md).toContain('margin-top: 12pt');
    expect(md).toContain('margin-bottom: 8pt');
    expect(md).toContain('line-height: 240%');
  });

  it('emits only the property that is set', () => {
    const md = withStyles('<p style="margin-top: 12pt">one</p>');

    expect(md).toContain('margin-top: 12pt');
    expect(md).not.toContain('margin-bottom');
    expect(md).not.toContain('text-align');
  });

  // left/start is the visual default, so it counts as unstyled — otherwise
  // every left-aligned block would route through the raw-HTML rule.
  it('treats left alignment as no alignment', () => {
    const md = withStyles('<p style="text-align: left">one</p>');

    expect(md.trim()).toBe('one');
  });

  it('keeps a zero margin, which is a real authored value', () => {
    const md = withStyles('<p style="margin-top: 0pt">one</p>');

    expect(md).toContain('margin-top: 0pt');
  });
});
