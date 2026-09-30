import { describe, expect, it } from 'vitest';
import { convertMarkdownToHTML, isSoloSlideImage } from './md-to-html';

const pageBreak = '<div data-type="page-break" data-page-break="true"></div>';
const figure = (caption: string, src = 'a.png') =>
  `<figure data-type="resizable-media" data-align="center">\n` +
  `<img src="${src}" alt="chart" />\n` +
  `<figcaption>${caption}</figcaption>\n` +
  `</figure>`;

describe('convertMarkdownToHTML media pagination', () => {
  it('keeps an image and current-schema caption together in order', () => {
    const html = convertMarkdownToHTML(figure('my caption'));

    expect(html).not.toContain(pageBreak);
    expect(html).toContain('class="slide-media"');
    expect(html).toContain('class="slide-image"');
    expect(html).toContain('class="slide-caption"');
    expect(html.indexOf('slide-image')).toBeLessThan(
      html.indexOf('slide-caption'),
    );
  });

  it('preserves caption links and inline formatting through sanitization', () => {
    const html = convertMarkdownToHTML(
      figure(
        'see <strong>the</strong> <a href="https://example.com">source</a><script>alert(1)</script>',
      ),
    );

    expect(html).toContain('<strong>the</strong>');
    expect(html).toContain('<a href="https://example.com">source</a>');
    expect(html).not.toContain('<script>');
  });

  it('keeps only the caption with a captioned image', () => {
    const html = convertMarkdownToHTML(`${figure('caption')}\n\nafter`);
    const slides = html.split(pageBreak);

    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain('caption');
    expect(slides[0]).not.toContain('after');
    expect(slides[1]).toContain('after');
  });

  it('moves the complete pair when the caption needs the remaining space', () => {
    const html = convertMarkdownToHTML(`intro\n\n${figure('caption')}`, {
      maxLinesPerSlide: 4,
    });
    const slides = html.split(pageBreak);

    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain('intro');
    expect(slides[0]).not.toContain('slide-media');
    expect(slides[1]).toContain('slide-media');
    expect(slides[1]).toContain('caption');
  });

  it('keeps uncaptioned-image pagination unchanged', () => {
    const html = convertMarkdownToHTML('![chart](a.png)\n\nafter');
    const slides = html.split(pageBreak);

    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain('class="slide-image"');
    expect(slides[1]).toContain('after');
  });

  it('keeps multiple captioned images as separate atomic slide units', () => {
    const html = convertMarkdownToHTML(
      `${figure('first', 'one.png')}\n${figure('second', 'two.png')}`,
    );
    const slides = html.split(pageBreak);

    expect(slides).toHaveLength(2);
    expect(slides[0]).toContain('first');
    expect(slides[0]).not.toContain('second');
    expect(slides[1]).toContain('second');
  });
});

describe('isSoloSlideImage', () => {
  it('classifies an uncaptioned image as solo', () => {
    expect(isSoloSlideImage('<img class="slide-image" src="a.png">')).toBe(
      true,
    );
    expect(
      isSoloSlideImage(
        '<figure class="slide-media"><img class="slide-image" src="a.png"></figure>',
      ),
    ).toBe(true);
  });

  it('does not classify a captioned image as solo', () => {
    expect(
      isSoloSlideImage(
        '<figure class="slide-media"><img class="slide-image" src="a.png"><figcaption class="slide-caption">caption</figcaption></figure>',
      ),
    ).toBe(false);
  });
});
