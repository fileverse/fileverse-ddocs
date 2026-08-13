import { describe, it, expect } from 'vitest';
import { turndownService, setMarkdownInlineStyles } from './index';

const TWEET_HTML =
  '<p>before</p><div data-tweet-id="1790555555555555555">https://twitter.com/i/status/1790555555555555555</div><p>after</p>';

const exportStyled = (html: string) => {
  setMarkdownInlineStyles(true);
  try {
    return turndownService.turndown(html);
  } finally {
    setMarkdownInlineStyles(false);
  }
};

describe('embeddedTweet export', () => {
  it('plain export keeps the bare status URL (Split View round-trip)', () => {
    const md = turndownService.turndown(TWEET_HTML);
    expect(md).toContain('https://twitter.com/i/status/1790555555555555555');
    expect(md).not.toContain('tweet-embed');
  });

  it('styles export emits a static link card', () => {
    const md = exportStyled(TWEET_HTML);
    expect(md).toContain(
      '<div data-tweet-id="1790555555555555555" class="tweet-embed">',
    );
    expect(md).toContain(
      '<a href="https://twitter.com/i/status/1790555555555555555" target="_blank" rel="noopener noreferrer">View post on X</a>',
    );
    expect(md).toContain(
      '<span class="tweet-embed-url">https://twitter.com/i/status/1790555555555555555</span>',
    );
    expect(md).toContain('</div>');
  });

  it('card is one html block: no blank lines inside, blank lines around', () => {
    const md = exportStyled(TWEET_HTML);
    const card = md.slice(md.indexOf('<div data-tweet-id'), md.indexOf('</div>') + 6);
    expect(card).not.toMatch(/\n\s*\n/);
    expect(md).toMatch(/before\n\n<div data-tweet-id/);
    expect(md).toMatch(/<\/div>\n\nafter/);
  });

  it('drops the node when the id attribute is missing', () => {
    const md = exportStyled('<p>x</p><div data-tweet-id=""></div><p>y</p>');
    expect(md).not.toContain('tweet-embed');
    expect(md).not.toContain('twitter.com');
  });
});
