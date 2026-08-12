import { MATH_REGIONS } from './math-aware-escape';

// Import-lane math shield (TEC-2634 P0 item 1). On .md import, math regions
// travel through markdown-it and two sup/sub regexes as ordinary prose, which
// corrupts TeX: CommonMark escape-stripping turns `\{`→`{`, `\%`→`%`,
// `\*`→`*` and would halve `\\` (array row separators); `^…^`/`~…~` become
// <sup>/<sub> tags mid-formula. shieldMathRegions swaps each region for an
// inert placeholder before processing and restore() reinserts the verbatim
// text (HTML-escaped) afterwards, so what pandoc typesets is exactly what the
// file contained. Region detection reuses MATH_REGIONS — pandoc parity is the
// contract.
//
// Code is exempt, matching pandoc's parse order (code before math): regions
// are only shielded OUTSIDE fenced blocks and inline code spans, so a stray
// `$` in a shell snippet can never pair with prose and swallow a ```
// boundary.
const CODE_REGIONS_SOURCE =
  // fenced block: ```/~~~ opener at line start, closed by a same-length
  // fence (or EOF); then inline code: backtick string closed by an
  // equal-length one.
  String.raw`^(${'`'}{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\1[ \t]*(?=\n|$)|$)|(${'`'}+)[\s\S]*?\2`;

// Private-use-area delimiters: survive markdown-it, DOMPurify and the sup/sub
// regexes untouched (no ^/~/*/_ or tag chars), and cannot collide with
// real document text.
const placeholder = (i: number) => `\uE000M${i}\uE001`;
const PLACEHOLDER_MATCHER = /\uE000M(\d+)\uE001/g;

const escapeHtmlText = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export interface MathShield {
  shielded: string;
  restore: (html: string) => string;
}

export const shieldMathRegions = (markdown: string): MathShield => {
  const stash: string[] = [];
  const shieldSegment = (segment: string) =>
    segment.replace(new RegExp(MATH_REGIONS.source, 'g'), (region) => {
      stash.push(region);
      return placeholder(stash.length - 1);
    });

  let shielded = '';
  let last = 0;
  const codeScanner = new RegExp(CODE_REGIONS_SOURCE, 'gm');
  let match: RegExpExecArray | null;
  while ((match = codeScanner.exec(markdown)) !== null) {
    shielded += shieldSegment(markdown.slice(last, match.index)) + match[0];
    last = match.index + match[0].length;
  }
  shielded += shieldSegment(markdown.slice(last));

  const restore = (html: string) =>
    stash.length
      ? html.replace(PLACEHOLDER_MATCHER, (_all, i) =>
          escapeHtmlText(stash[Number(i)] ?? ''),
        )
      : html;

  return { shielded, restore };
};
